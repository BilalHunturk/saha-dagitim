# Saha Dağıtım

Broşür dağıtan saha ekibi için bölge dağıtım uygulaması. Yönetici uydu haritası üzerinde
bölgeleri çokgen olarak çizer ve dağıtıcıları sürükle-bırak ile bu bölgelere atar. Dağıtıcı
telefonundan hangi bölgelerde görevli olduğunu haritada görür.

Next.js (App Router) + Supabase (Postgres + PostGIS, Auth) ile yazılmış bir PWA'dır. Vercel'de
barındırılmak üzere tasarlandı.

**v1'de olanlar:** telefon numarası + şifre ile giriş, bölge çizme/düzenleme/arşivleme,
kişi ekleme/düzenleme/pasifleştirme/şifre yenileme, sürükle-bırak atama ve taşıma, atama
geçmişi (kim, hangi bölgede, hangi tarihler arasında), Uydu/Sokak altlık geçişi, dağıtıcı
ekranında "Konumumu göster" (yalnızca ekranda nokta, kaydedilmez), ana ekrana kurulabilme.

**v1'de olmayanlar:** konum takibi (konum kaydı, bölgede kalış süresi), gruplar / ekip
sorumlusu, otomatik dağıtım önerisi, SMS doğrulama ve bildirimler. Hiçbir şey silinmez:
bölgeler arşivlenir, atamalar sonlandırılır, kişiler pasifleştirilir.

## Roller ve ekranlar

İki rol vardır: **yönetici** (`admin`) ve **dağıtıcı** (`worker`). Herkes telefon numarası ve
şifreyle girer; giriş yapan kişi rolüne göre yönlendirilir.

- `/giris`: telefon + şifre ile giriş.
- `/yonetim` (yönetici): tam ekran harita, bölge listesi ve kişi listesi. "Yeni bölge" ile
  haritada nokta koyarak çokgen çizilir; seçilen bölgenin köşeleri düzenlenir, adı/rengi
  değişir, arşivlenir. Kişi bir bölge kartına veya haritadaki çokgene sürüklenerek atanır;
  kişi zaten başka bölgedeyse "Ekle / Taşı" sorulur. Kişi satırına tıklamak (veya Enter)
  "Bölgeye ata" seçicisini açar.
- `/yonetim/kisiler` (yönetici): dağıtıcı ekleme (üretilen şifre yalnızca bir kez gösterilir),
  düzenleme, pasifleştirme, şifre yenileme.
- `/gorevim` (dağıtıcı): atandığı bölgeler haritada ve altta liste halinde. Atama yoksa
  "Henüz görev atanmadı" yazar.

Dağıtıcı başka kimsenin atamasını veya kişi listesini göremez; bu kural veritabanında RLS ile
uygulanır. Uygulama içinden yalnızca dağıtıcı eklenebilir; yönetici hesabı aşağıdaki
`create-admin` betiğiyle oluşturulur.

## Yerel çalıştırma

Gerekenler:

- Node.js 24 veya üstü (geliştirme Node 26 ile yapıldı). `create-admin` betiği bir `.ts`
  dosyasını doğrudan içe aktarır; bu, Node'un yerleşik TypeScript tip ayıklamasına dayanır.
- Docker Desktop (yerel Supabase bunun içinde çalışır). Komutları çalıştırmadan önce açık olmalı.
- Supabase CLI ayrıca kurulmaz: projede `devDependency` olarak var, `npx supabase` ile çalışır.

Komutların hepsi depo kök dizininde çalıştırılır.

1. Bağımlılıkları kurun:

```bash
npm install
```

2. Yerel Supabase'i başlatın. Uygulamanın kullanmadığı servisler dışarıda bırakılır; çalışan
   servisler veritabanı, auth, REST API, kong ve pg_meta'dır:

```bash
npx supabase start -x studio,imgproxy,edge-runtime,logflare,vector,realtime,storage-api,supavisor,mailpit
```

3. Göçler (`supabase/migrations/`) yeni bir yerel veritabanında `supabase start` sırasında
   otomatik uygulanır. Uygulandığını kontrol edin (`local` ve `remote` sütunlarında aynı
   zaman damgası görünmeli):

```bash
npx supabase migration list
```

   Daha sonra yeni bir göç eklenirse, mevcut verilere dokunmadan uygulamak için:

```bash
npx supabase db push
```

   Yerel veritabanını sıfırdan kurmak gerekirse aşağıdaki komut tüm verileri siler (yerel
   yönetici, bölgeler, kişiler dahil) ve göçleri yeniden uygular:

```bash
npx supabase db reset
```

4. `.env.local` dosyasını oluşturun:

```bash
cp .env.example .env.local
```

   Ardından yerel anahtarları görüntüleyin:

```bash
npx supabase status -o env
```

   Bu çıktıdaki değerleri `.env.local`'a şöyle aktarın:

   | `.env.local` | `supabase status -o env` |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `API_URL` (yerelde `http://127.0.0.1:54321`) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `ANON_KEY` |
   | `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY` |

   `NEXT_PUBLIC_SATELLITE_TILE_URL` boş kalabilir (bkz. "Uydu görüntüsü").

5. İlk yöneticiyi oluşturun. Argümanlar sırasıyla ad soyad, cep telefonu (`0532 123 45 67`,
   `5321234567` veya `+905321234567` biçimlerinden biri) ve en az 6 karakterlik şifredir:

```bash
npm run create-admin -- "Yerel Yönetici" "0500 000 00 01" "<şifre>"
```

   Uçtan uca testleri çalıştıracaksanız aynı telefonu ve şifreyi `.env.local`'a da ekleyin:
   `LOCAL_ADMIN_PHONE=...` ve `LOCAL_ADMIN_PASSWORD=...`.

6. Uygulamayı başlatın ve `http://localhost:3000` adresinde yönetici olarak girin:

```bash
npm run dev
```

İsteğe bağlı örnek veri: Ankara merkezinde üç örnek bölge (Kızılay vb.) eklemek için aşağıdaki
betik `LOCAL_ADMIN_*` ile yönetici olarak girip bölgeleri ekler. Aynı adlı bölge varsa atlar,
tekrar çalıştırmak güvenlidir:

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/e2e/seed-sample-zones.mjs
```

Yerel Supabase'i durdurmak için:

```bash
npx supabase stop
```

## Testler

| Komut | Ne test eder | Gerekenler |
|---|---|---|
| `npm test` | Birim testleri (Vitest, `lib/*.test.ts`): telefon normalleştirme, şifre üretimi, GeoJSON doğrulama, giriş hata mesajları, rol yönlendirme, atama ekranının iyimser güncelleme mantığı. | Hiçbir şey |
| `npm run test:db` | Yerel Supabase'e karşı bütünleşik testler (`tests/db/`): RLS (dağıtıcı başkasının verisini göremez, pasif kullanıcı hiçbir şey göremez), `save_zone` / `archive_zone`, `assign_worker` / `move_worker` / `unassign_worker`, kişi ekleme/düzenleme/pasifleştirme/şifre yenileme. | Çalışan yerel Supabase ve `.env.local` |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` | Hiçbir şey |
| `npm run lint` | ESLint | Hiçbir şey |
| `npm run build` | Üretim derlemesi | `.env.local` (veya ortam değişkenleri) |

`npm run test:db`, `.env.local`'daki `NEXT_PUBLIC_SUPABASE_URL` adresinin sunucusu `localhost`
veya `127.0.0.1` değilse çalışmayı reddeder. Bu testler service role ile kullanıcı oluşturup
siler; üretim veritabanına karşı yanlışlıkla çalışmasın diye bu kontrol vardır.

Uçtan uca tarayıcı testleri (Playwright ile Google Chrome'u sürer) npm betiği değildir,
doğrudan `node` ile çalıştırılır:

```bash
node tests/e2e/admin-map.mjs
```

```bash
node tests/e2e/assignments.mjs
```

```bash
node tests/e2e/worker.mjs
```

- `admin-map.mjs`: `/yonetim` haritası: çizim, kaydetme, köşe düzenleme, altlık geçişi,
  kendini kesen çokgen hatası, bağlantı koptuğunda kaydetme, arşivleme, 1280px ve 375px düzen.
- `assignments.mjs`: sürükle-bırak atama, taşıma, kaldırma, geri alma. Üç örnek bölgeyi
  (`seed-sample-zones.mjs`) ister; yoksa 8 örnek dağıtıcıyı (`+90501000000x`) uygulamanın
  Kişiler sayfasından kendisi ekler.
- `worker.mjs`: `/gorevim` ekranı (375x812) ve PWA dosyaları. İki geçici dağıtıcı oluşturur,
  sonunda siler. Service worker kontrolleri yalnızca `PROD_URL` (bir üretim derlemesinin
  `next start` adresi) verilirse çalışır.

Üçü de şunları ister: çalışan yerel Supabase, `BASE_URL` adresinde çalışan bir `next dev`
(varsayılan `http://localhost:3100`), kurulu Google Chrome (`E2E_CHANNEL` ile başka bir
Playwright kanalı seçilebilir). İlk ikisi `.env.local`'da `LOCAL_ADMIN_PHONE` ve
`LOCAL_ADMIN_PASSWORD` ister. `npm run dev` 3000 portunu kullandığı için ya
`BASE_URL=http://localhost:3000` verin ya da sunucuyu 3100'de başlatın:

```bash
npx next dev -p 3100
```

Ekran görüntüleri `tests/e2e/screenshots/` altına yazılır (git'e girmez). Dikkat: e2e betikleri
`.env.local`'daki service role anahtarıyla kendi oluşturdukları kayıtları kalıcı olarak siler
ve `test:db` gibi yerel adres kontrolü yapmaz. Yalnızca `.env.local` yerel Supabase'i
gösterirken çalıştırın.

## Üretim kurulumu (Supabase + Vercel)

### 1. Supabase projesi

Supabase panelinden yeni bir proje oluşturun. Veritabanı şifresini not edin (göç uygularken
sorulur). Proje referansı (`<ref>`) proje adresindeki `https://<ref>.supabase.co` kısmıdır.

### 2. Göçleri uygulayın

PostGIS'i ayrıca açmanız gerekmez; göç dosyası `create extension if not exists postgis`
ile kendisi açar.

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <ref>
```

Bu CLI sürümünde (3.1.0) `db push` varsayılan olarak **yerel** veritabanını hedefler. Üretim
için `--remote` gerekir. Önce neyin uygulanacağını görün, sonra uygulayın:

```bash
npx supabase db push --remote --dry-run
```

```bash
npx supabase db push --remote
```

Kontrol (`remote` sütununda göçün zaman damgası görünmeli):

```bash
npx supabase migration list --remote
```

### 3. Auth ayarları

Uygulama telefon numarasını sentetik bir e-postaya çevirir (`+905321234567` ->
`905321234567@saha.local`) ve Supabase Auth'un e-posta + şifre girişini kullanır. Bu
adreslere hiçbir zaman e-posta gönderilmez. Panelde Authentication bölümünde:

- **Email sağlayıcısı açık olmalı.** Giriş `signInWithPassword` (e-posta + şifre) ile yapılır.
- **Yeni kayıtları kapatın** ("Allow new users to sign up" kapalı). Kullanıcıları yalnızca
  yönetici oluşturur: hem uygulama hem `create-admin` betiği service role ile
  `auth.admin.createUser` çağırır, bu ayar onları etkilemez. Açık bırakılırsa anon anahtarı
  bilen biri kendine hesap açabilir (profili olmadığı için hiçbir veri göremez, ama gereksiz
  bir kapıdır).
- **E-posta doğrulaması ("Confirm email"):** kod buna dayanmaz. Kullanıcılar
  `email_confirm: true` ile, yani doğrulanmış olarak oluşturulur; telefon değişikliğinde
  e-posta da aynı şekilde doğrulanmış olarak güncellenir. Ayar açık da kapalı da olsa bu
  hesaplar etkilenmez. Kapalı tutmak, `@saha.local` adresine doğrulama postası gitmeye
  çalışılmasını tamamen önler.
- **Şifre kuralları:** uygulamanın ürettiği şifreler 8 karakterdir ve yalnızca küçük harf ve
  rakam içerir. Minimum şifre uzunluğunu 8'in üstüne çıkarmayın ve büyük harf / sembol
  zorunluluğu koymayın; yoksa kişi ekleme ve şifre yenileme başarısız olur. `create-admin`
  betiği en az 6 karakter ister.

### 4. Vercel

Depoyu Vercel'e bağlayın (Next.js otomatik algılanır, ek derleme ayarı gerekmez) ve şu ortam
değişkenlerini girin:

| Değişken | Değer nereden | Zorunlu |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase > Project Settings > API: proje adresi (`https://<ref>.supabase.co`) | Evet |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase > Project Settings > API anahtarları: `anon` anahtarı | Evet |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase > Project Settings > API anahtarları: `service_role` anahtarı | Evet |
| `NEXT_PUBLIC_SATELLITE_TILE_URL` | Uydu karo sağlayıcınız (bkz. "Uydu görüntüsü") | Hayır |

`SUPABASE_SERVICE_ROLE_KEY` RLS'yi atlar ve yalnızca sunucuda kullanılır. Adının başına asla
`NEXT_PUBLIC_` eklemeyin: `NEXT_PUBLIC_` ile başlayan her değişken tarayıcıya giden JavaScript'e
gömülür. `NEXT_PUBLIC_` değişkenleri derleme sırasında koda yazıldığı için değiştirdikten sonra
yeniden deploy etmek gerekir.

### 5. Üretimde ilk yönetici

`create-admin` betiği hedefi iki değişkenden alır: `NEXT_PUBLIC_SUPABASE_URL` ve
`SUPABASE_SERVICE_ROLE_KEY`. Önce kabuktaki ortam değişkenlerine bakar; kabukta tanımlı
olmayanları çalıştırıldığı dizindeki `.env.local` dosyasından okur. Kabukta tanımlı değer
`.env.local`'dakini ezer. Betik hangi projeye yazdığını sormaz ve göstermez.

Üretim için iki değişkeni de komutla birlikte verin (yalnızca birini verirseniz diğeri
`.env.local`'dan, yani yerelden gelir):

```bash
NEXT_PUBLIC_SUPABASE_URL="https://<ref>.supabase.co" SUPABASE_SERVICE_ROLE_KEY="<service_role anahtarı>" npm run create-admin -- "Ad Soyad" "0532 123 45 67" "<şifre>"
```

Çalıştırmadan önce iki şeyi kontrol edin: komuttaki adres gerçekten üretim projesi mi, ve
`.env.local` hangi projeyi gösteriyor (değişkenleri vermeyi unutursanız yönetici yerel
veritabanına yazılır). Bu komut şifreyi ve service role anahtarını kabuk geçmişine bırakır;
sonra temizleyin. Başarılı olursa `Yönetici oluşturuldu: ...` yazar. Uygulamada yönetici
şifresini değiştirme ekranı yoktur (Kişiler sayfası yalnızca dağıtıcıları yönetir).

### 6. Telefona kurulum

- Android (Chrome): siteyi açın, sağ üstteki menüden "Ana ekrana ekle" / "Uygulamayı yükle".
- iPhone (Safari): siteyi açın, Paylaş düğmesi > "Ana Ekrana Ekle".

"Konumumu göster" tarayıcının konum iznini ister ve yalnızca HTTPS'te (veya `localhost`'ta)
çalışır; Vercel adresi HTTPS'tir.

## Uydu görüntüsü

Varsayılan uydu altlığı Esri World Imagery'dir
(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
`components/map/basemaps.ts`). Üretimde kullanmadan önce Esri'nin kullanım şartlarını kontrol
edin; ticari veya yoğun kullanım için hesap/lisans gerekebilir. Sokak altlığı
`tile.openstreetmap.org`'dan gelir ve OpenStreetMap'in karo kullanım politikasına tabidir.

Başka bir sağlayıcıya geçmek için `NEXT_PUBLIC_SATELLITE_TILE_URL`'e bir raster XYZ karo adres
şablonu verin (256px karolar, `{z}`, `{x}`, `{y}` yer tutucularıyla), örneğin:

```
NEXT_PUBLIC_SATELLITE_TILE_URL=https://tiles.ornek-saglayici.com/uydu/{z}/{x}/{y}.jpg?key=ANAHTARINIZ
```

Bu değişken tanımlıyken haritadaki atıf metni "Uydu görüntüsü: yapılandırılmış sağlayıcı" olur.
Sağlayıcınız belirli bir atıf metni istiyorsa `components/map/basemaps.ts` içindeki
`SATELLITE_ATTRIBUTION`'ı değiştirin. Karo adresindeki anahtar tarayıcıya açıktır; yalnızca
alan adına kısıtlanabilen anahtarlar kullanın.

## Bilinmesi gerekenler ve sınırlar

- **Şifre yenileme açık oturumları kapatmaz.** Yenilemeden önce girmiş bir telefon, oturum
  yenileme belirteci tükenene kadar girişli kalır. Birini hemen dışarıda bırakmak için
  pasifleştirin: pasif kullanıcı (açık oturumu olsa bile) hiçbir veri göremez ve girişe
  yönlendirilir.
- **Pasifleştirme atamaları kaldırır.** Bir dağıtıcı pasifleştirildiğinde tüm aktif atamaları
  sonlandırılır (geçmişte kalır). Tekrar aktifleştirilen kişi yeniden atanmalıdır.
- **Silme yok.** Bölge arşivlenince aktif atamaları da sonlandırılır. Kalıcı silme yalnızca
  service role ile veritabanından yapılabilir.
- **Kendini kesen çokgen kaydedilmez.** Çizim aracı buna izin verir; kaydederken sunucu
  reddeder ve hata gösterilir.
- **Yalnızca açık tema** vardır; telefonun karanlık modu uygulamayı değiştirmez.
- **Yalnızca Türkiye cep numaraları** (5xx) kabul edilir. Kişiler tek tek eklenir, toplu içe
  aktarma yoktur. Üretilen şifre yalnızca bir kez gösterilir; kaybolursa "şifre yenile".
- **Telefonda harita atıf kutusu** açılışta haritanın altını kısmen kaplar, dokununca küçülür
  (MapLibre'nin varsayılan davranışı).
- **Uygulama ikonları değişirse** `public/sw.js` içindeki `CACHE` adını değiştirin; ikonlar
  service worker'da bu ada göre önbelleklenir.
- **Giriş hız sınırı:** Supabase Auth giriş denemelerini IP başına sınırlar. Çok sayıda kişi aynı
  ağdan art arda girerse "çok fazla deneme" mesajı görülebilir; sınır Supabase panelinde
  Authentication > Rate Limits altından ayarlanır.
- `supabase/config.toml` içindeki `project_id` geliştirme klasörünün adıdır
  (`scratch-2026-11-12-fc8363`). Yalnızca yerel Docker konteyner adlarını etkiler; değiştirmek
  isterseniz önce `npx supabase stop`, sonra yeniden `start` gerekir.

## Yol haritası

**Konum takibi.** Hedef: dağıtıcının konumunu düzenli aralıklarla (örneğin dakikada bir)
kaydetmek ve hangi bölgede ne kadar kaldığını göstermek. Saf bir PWA bunu yapamaz: tarayıcılar,
özellikle iPhone'da, sayfa arka plandayken veya ekran kilitliyken konum göndermeye izin
vermez. Plan, dağıtıcı tarafını Capacitor ile yerel bir Android/iOS uygulamasına sarmak ve
arka plan konumunu yerel eklentiyle almaktır. Veri tarafında
`location_points(worker_id, recorded_at, geom Point, accuracy)` tablosu (günlük
bölümlenmiş) eklenecek; bölgede kalış süresi `ST_Contains(zones.geom, point)` ile
hesaplanacak. Mevcut şema buna hazır: bölgeler zaten PostGIS çokgeni (`geometry(Polygon,4326)`,
GiST indeksli) ve atama geçmişi tarih aralıklarıyla tutuluyor. Tablo ve kod henüz yazılmadı.

**Gruplar / ekip sorumlusu.** Dağıtıcıların ekiplere ayrılması ve ekip sorumlusunun kendi
ekibini yönetebilmesi.

**Otomatik dağıtım önerisi.** Bölgelere kişi atamasını sistemin önermesi.
