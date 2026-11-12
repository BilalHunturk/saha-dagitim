# Saha Dağıtım — Tasarım (v1)

Tarih: 2026-11-12. "Kullanıcı kararı" yazanlar proje sahibinin sözüdür; "tercih" yazanlar
yönetici ajanın (Fable) seçimidir ve değiştirilebilir.

## Amaç

Ankara'da broşür dağıtan saha ekibinin bölge dağıtımı bugün kâğıt ilçe haritalarına kalemle
çizilerek yapılıyor. Bu sistem o işi dijitale taşır: yönetici harita üzerinde bölge çizer,
kişileri bölgelere atar; dağıtıcı telefonundan nerede görevli olduğunu görür.

## Kapsam (v1)

Kullanıcı kararları:

- Web tabanlı PWA. Barındırma Vercel, arka uç Supabase.
- Tek yönetici rolü. Yönetici harita üzerinde nokta koyarak çokgen bölge oluşturur.
- Yönetici kişileri sürükle-bırak ile bölgelere atar; yer değiştirme de sürükle-bırak ile.
- Atama kalıcıdır: yönetici değiştirene kadar geçerli (günlük sıfırlanmaz).
- Bir bölgede birden çok kişi, bir kişide birden çok bölge olabilir.
- Zaten atanmış kişiler işaretli görünür.
- Yönetici kişileri tek tek ekler. Bugün 20–25 kişi, hedef 500–700.
- Dağıtıcılar kendi telefonlarını kullanır (karışık Android/iPhone).
- Uydu görüntüsü altlığı tercih edilir.
- Arayüz dili Türkçe.

Tercihler:

- Giriş: telefon numarası + yöneticinin ürettiği şifre (SMS yok, maliyet nedeniyle).
- Atama geçmişi tutulur (kim, hangi bölgede, hangi tarihler arasında).
- Sokak haritası / uydu arasında geçiş düğmesi.
- Dağıtıcı ekranında "konumumu göster" (yalnızca ekranda nokta; kaydedilmez).

## Kapsam dışı (v1)

- **Konum takibi** (dakikada bir konum, bölgede kalış süreleri). Kullanıcı şimdilik erteledi.
  Saf PWA arka planda konum gönderemez; takip eklendiğinde dağıtıcı tarafı Capacitor ile
  paketlenecek. Şema buna hazır olmalı ama tablo/kod yazılmayacak.
- Gruplar / ekip sorumlusu kademeleri (ileride).
- Otomatik dağıtım önerisi (ileride).
- SMS doğrulama, bildirimler.

## Başarısızlık sayılacak durumlar

- Dağıtıcının başka birinin atamasını veya kişi listesini görebilmesi.
- Atama değişince geçmişin kaybolması.
- Takip eklemek için şemanın baştan yazılmasının gerekmesi.

## Mimari

- **Uygulama:** Next.js (App Router) + TypeScript, tek proje. Tailwind CSS.
- **Veri:** Supabase Postgres + PostGIS. Erişim `@supabase/ssr` ile; yetki RLS ile.
- **Kimlik:** Supabase Auth, e-posta+şifre sağlayıcısı. Telefon numarası sentetik e-postaya
  çevrilir: `905321234567@saha.local`. Kullanıcı oluşturma/şifre sıfırlama yalnızca
  sunucuda, service role anahtarıyla, çağıranın yönetici olduğu doğrulandıktan sonra.
- **Harita:** MapLibre GL JS. Altlıklar raster: uydu (varsayılan Esri World Imagery,
  `NEXT_PUBLIC_SATELLITE_TILE_URL` ile değiştirilebilir) ve OSM sokak. Atıf metni gösterilir.
  Üretimde uydu sağlayıcısının kullanım şartları ayrıca teyit edilmeli (README'ye not).
- **Çizim:** terra-draw (MapLibre adaptörü): çokgen çizme + köşe düzenleme.
- **Sürükle-bırak:** dnd-kit.
- **PWA:** web manifest + ikonlar + asgari service worker (kurulabilirlik).

## Veri modeli

```
profiles      id uuid PK = auth.users.id, full_name text, phone text unique (E.164, +90…),
              role text check in ('admin','worker'), active bool default true, created_at
zones         id uuid PK, name text, color text, note text null,
              geom geometry(Polygon,4326) not null, created_by, created_at, updated_at,
              archived_at null   -- silme = arşivleme; geçmiş bozulmaz
assignments   id uuid PK, zone_id FK, worker_id FK profiles, assigned_by FK,
              started_at timestamptz default now(), ended_at timestamptz null
              -- ended_at null = aktif. Kısmi benzersiz indeks: (zone_id, worker_id) where ended_at is null
```

İndeksler: `zones.geom` GiST; `assignments(worker_id) where ended_at is null`;
`assignments(zone_id) where ended_at is null`.

İleride (yazılmayacak, yalnızca yer ayrılır): `location_points(worker_id, recorded_at,
geom Point, accuracy)` günlük bölümlenmiş; kalış süresi `ST_Contains(zones.geom, point)` ile.

### Veritabanı fonksiyonları

- `is_admin()` — security definer, RLS politikalarında kullanılır.
- `zones_geojson` görünümü (security_invoker) — `geojson` sütunu `ST_AsGeoJSON(geom)::jsonb`,
  ayrıca aktif atama sayısı.
- `save_zone(p_id, p_name, p_color, p_note, p_geojson)` — ekle/güncelle; geometri geçerli
  ve tek çokgen olmalı (`ST_IsValid`), değilse hata.
- `archive_zone(p_id)` — bölgeyi arşivler ve aktif atamalarını kapatır.
- `assign_worker(p_worker, p_zone)` — zaten aktifse işlem yapmaz.
- `unassign_worker(p_worker, p_zone)` — `ended_at = now()`.
- `move_worker(p_worker, p_from, p_to)` — tek işlemde kapat + aç.

Yazan fonksiyonların hepsi `is_admin()` kontrolü yapar.

### RLS

- Yönetici: üç tabloda her şey.
- Dağıtıcı: yalnızca kendi `profiles` satırı (okuma), kendi aktif `assignments` satırları
  (okuma), ve aktif ataması olan arşivlenmemiş `zones` satırları (okuma). Yazma yok.
- `active = false` olan kullanıcı giriş yapsa bile hiçbir veri göremez.

## Ekranlar

- `/giris` — telefon + şifre. Role göre yönlendirir.
- `/yonetim` — tam ekran harita + yan panel.
  - Bölge listesi (renk, ad, atanan kişi çipleri) ve "Yeni bölge" (haritada nokta koyarak çiz,
    ad/renk ver, kaydet). Bölge seçilince köşeler düzenlenebilir, ad/renk değişir, arşivlenir.
  - Kişi listesi: arama, "atanmamış" filtresi, her kişide atandığı bölge sayısı rozeti.
  - Kişi → bölge kartına (veya haritadaki çokgene) sürüklenir. Kişi zaten başka bölgedeyse
    "Ekle / Taşı" sorulur. Bölge kartındaki çip başka karta sürüklenirse taşıma olur;
    çipteki × atamayı kaldırır.
  - Altlık düğmesi: Uydu / Sokak.
- `/yonetim/kisiler` — kişi ekle (ad, telefon → üretilen şifre bir kez gösterilir), düzenle,
  pasifleştir, şifre yenile.
- `/gorevim` — dağıtıcı: atandığı bölgeler haritada (tümüne sığdırılmış), altta liste,
  "konumumu göster", altlık düğmesi. Atama yoksa "Henüz görev atanmadı".

## Doğrulama

- Birim testleri (Vitest): telefon normalleştirme, şifre üretimi, GeoJSON doğrulama.
- Bütünleşik testler: yerel Supabase'e (Docker) karşı RLS ve fonksiyon testleri —
  dağıtıcı başkasının verisini göremez, taşıma geçmişi korur, geçersiz çokgen reddedilir.
- `npm run build`, `tsc`, lint temiz.

## Kurulumda kullanıcıya kalanlar

Supabase projesi oluşturup anahtarları `.env.local`'a koymak, göçleri uygulamak,
ilk yöneticiyi `npm run create-admin` ile oluşturmak, Vercel'e bağlamak. Adımlar README'de.
