# Saha Dağıtım v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Yöneticinin haritada bölge çizip kişileri sürükle-bırak ile atadığı, dağıtıcının telefonundan görev bölgesini gördüğü PWA.

**Architecture:** Tek Next.js (App Router) projesi. Veri ve yetki Supabase'de (Postgres + PostGIS + RLS); yazma işlemleri `security definer` SQL fonksiyonlarıyla. Kullanıcı oluşturma yalnızca sunucu eylemlerinde service role ile.

**Tech Stack:** Next.js (create-next-app'in kurduğu güncel sürüm) + TypeScript + Tailwind, `@supabase/supabase-js`, `@supabase/ssr`, MapLibre GL JS, terra-draw + terra-draw-maplibre-gl-adapter, `@dnd-kit/core`, Vitest, Supabase CLI (yerel, Docker).

**Spec:** `docs/superpowers/specs/2026-11-12-saha-dagitim-design.md` — her görevden önce oku.

## Global Constraints

- Arayüz metinleri Türkçe; kod, dosya ve tanımlayıcı adları İngilizce (rota adları hariç: `/giris`, `/yonetim`, `/yonetim/kisiler`, `/gorevim`).
- Kurulu Next.js sürümünün kendi kurallarına uy (ör. `AGENTS.md`, `node_modules/next/dist/docs`); ezberden eski API yazma. Middleware dosyasının adı kurulu sürümde ne ise o (`middleware.ts` veya `proxy.ts`).
- Service role anahtarı yalnızca `lib/supabase/admin.ts` içinde ve yalnızca sunucuda; `NEXT_PUBLIC_` ile başlayan hiçbir değişkene konmaz.
- Telefon E.164 saklanır (`+905XXXXXXXXX`). Sentetik e-posta: `905XXXXXXXXX@saha.local`.
- Koordinat sırası her yerde GeoJSON: `[boylam, enlem]`, SRID 4326.
- Harita başlangıcı: Ankara merkez `[32.8597, 39.9334]`, zoom 11.
- Silme yok: bölge arşivlenir (`archived_at`), atama kapatılır (`ended_at`), kişi pasifleştirilir (`active=false`).
- Konum takibi, gruplar, SMS, otomatik dağıtım YAZILMAYACAK.
- Yeni bağımlılık eklemeden önce gerçekten gerekli mi düşün; UI kiti (shadcn, MUI vb.) ekleme, Tailwind yeter.
- Paralel çalışan görevlerde `git commit` yapma; yalnızca kendi görevinin dosyalarına dokun. Sıralı görevlerde görev sonunda commit et.

## Review Focus

1. Aynı telefonla ikinci kişi eklenirse: Türkçe hata, yarım kalmış auth kullanıcısı bırakılmaz. (Görev 4)
2. Kendini kesen çokgen (papyon) kaydedilirse: `save_zone` reddeder, arayüz hatayı gösterir, çizim kaybolmaz. (Görev 2 testi, Görev 5 arayüz)
3. Aynı kişi aynı bölgeye iki kez / hızlı çift bırakma: tek aktif atama kalır, hata gösterilmez. (Görev 2 testi)
4. Pasifleştirilmiş ama oturumu açık dağıtıcı: hiçbir veri göremez, `/giris`e "Hesabınız pasif" iletisiyle döner. (Görev 2 testi, Görev 3)
5. Telefon girişi biçimleri (`0532 123 45 67`, `532-123-4567`, `+90 532…`, `90532…`): hepsi aynı hesaba çıkar; sabit hat/eksik hane reddedilir. (Görev 1 testi)
6. Aktif ataması olan bölge arşivlenirse: atamalar kapanır, dağıtıcı ekranında görünmez. (Görev 2 testi)

---

### Task 1: İskelet, yerel Supabase, saf yardımcılar

**Files:**
- Create: Next.js iskeleti (depo kökünde; mevcut `docs/` korunur), `vitest.config.ts`, `.env.example`, `.env.local` (git dışı), `supabase/config.toml`
- Create: `lib/phone.ts`, `lib/password.ts`, `lib/geo.ts`, `lib/types.ts`
- Test: `lib/phone.test.ts`, `lib/password.test.ts`, `lib/geo.test.ts`

**Interfaces — Produces:**
```ts
// lib/phone.ts
normalizePhone(input: string): string | null   // "+905321234567" ya da null
phoneToEmail(e164: string): string              // "905321234567@saha.local"
formatPhone(e164: string): string               // "0532 123 45 67"
// lib/password.ts
generatePassword(): string  // 8 karakter, alfabe "abcdefghjkmnpqrstuvwxyz23456789", crypto tabanlı
// lib/geo.ts
validatePolygon(input: unknown): { ok: true; polygon: GeoJSON.Polygon } | { ok: false; error: string }
polygonsBounds(polys: GeoJSON.Polygon[]): [[number, number], [number, number]] | null  // [[batı,güney],[doğu,kuzey]]
// lib/types.ts
type Role = 'admin' | 'worker'
type Profile = { id: string; full_name: string; phone: string; role: Role; active: boolean; created_at: string }
type Zone = { id: string; name: string; color: string; note: string | null; geojson: GeoJSON.Polygon; active_count: number }
type Assignment = { id: string; zone_id: string; worker_id: string; started_at: string; ended_at: string | null }
```
npm betikleri: `test` (vitest run, birim), `test:db` (Görev 2'de dolacak), `typecheck` (`tsc --noEmit`), `lint`, `build`.

- [ ] **Step 1:** `create-next-app` ile iskelet (TypeScript, Tailwind, App Router, ESLint, `src/` yok, import alias `@/*`). Klasör boş olmadığı için geçici klasöre kurup köke taşı; `docs/` ve `.git` korunur. `@types/geojson`, `vitest` ekle.
- [ ] **Step 2:** Başarısız testleri yaz. `normalizePhone`: `"0532 123 45 67"`, `"532-123-4567"`, `"+90 532 123 45 67"`, `"905321234567"` → `"+905321234567"`; `"0312 123 45 67"`, `"53212345"`, `""`, `"abc"` → `null`. `phoneToEmail("+905321234567")` → `"905321234567@saha.local"`. `formatPhone` → `"0532 123 45 67"`. `generatePassword`: uzunluk 8, yalnızca alfabe karakterleri, 50 üretimde hepsi farklı. `validatePolygon`: geçerli kapalı kare → ok; `type: "Point"`, 3 konumlu halka, kapanmamış halka, delikli (2 halka), enlem 95 → `ok:false`. `polygonsBounds`: iki kare → birleşik sınır; `[]` → `null`.
- [ ] **Step 3:** `npm test` → FAIL (modül yok).
- [ ] **Step 4:** Dört `lib` dosyasını yaz. `npm test` → PASS.
- [ ] **Step 5:** `npx supabase init`; `npx supabase start -x studio,imgproxy,edge-runtime,logflare,vector,realtime,storage-api,supavisor,mailpit` (hata verirse dışlananları azalt). `npx supabase status -o env` çıktısından `.env.local` yaz: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. `.env.example` aynı adlar + `NEXT_PUBLIC_SATELLITE_TILE_URL` (boş, açıklamalı). `.env.local` gitignore'da olmalı.
- [ ] **Step 6:** `npm run typecheck && npm run lint && npm run build` temiz. Commit: `chore: scaffold app, local supabase, pure helpers`.

### Task 2: Veritabanı şeması, fonksiyonlar, RLS

**Files:**
- Create: `supabase/migrations/<ts>_init.sql`, `scripts/create-admin.mjs`, `vitest.db.config.ts`
- Test: `tests/db/helpers.ts`, `tests/db/rls.test.ts`, `tests/db/zones.test.ts`, `tests/db/assignments.test.ts`

**Interfaces — Consumes:** Görev 1'in `.env.local` anahtarları, `phoneToEmail`.
**Produces (SQL, hepsi `public` şemasında, spec'teki sütunlarla):**
- Tablolar `profiles`, `zones`, `assignments`; görünüm `zones_geojson(id, name, color, note, geojson jsonb, active_count int)` — yalnızca arşivlenmemişler, `security_invoker = true`.
- `is_admin() returns boolean` — çağıranın `profiles.role='admin' and active` olması.
- `save_zone(p_id uuid, p_name text, p_color text, p_note text, p_geojson jsonb) returns uuid` — `p_id null` ise ekler. Geometri Polygon değilse, `ST_IsValid` değilse ya da ad boşsa `raise exception` (mesajlar Türkçe: `'Geçersiz bölge şekli'`, `'Bölge adı gerekli'`).
- `archive_zone(p_id uuid) returns void`, `assign_worker(p_worker uuid, p_zone uuid) returns void` (zaten aktifse no-op; pasif kişi ya da arşivli bölgeye atama hata), `unassign_worker(p_worker uuid, p_zone uuid) returns void`, `move_worker(p_worker uuid, p_from uuid, p_to uuid) returns void`.
- Yazan fonksiyonlar `security definer`, `set search_path = public, extensions`, başta `if not is_admin() then raise exception 'Yetkisiz'`. `anon` rolünden execute geri alınır.
- RLS spec'teki gibi. Dağıtıcı için yardımcı: `is_active_user()`.
- `scripts/create-admin.mjs`: `node scripts/create-admin.mjs "<ad soyad>" "<telefon>" "<şifre>"` — service role ile auth kullanıcısı + `role='admin'` profil. `package.json` betiği `create-admin`.
- `test:db` betiği: `vitest run -c vitest.db.config.ts` (yerel Supabase çalışıyor varsayar).

- [ ] **Step 1:** `tests/db/helpers.ts`: service role istemcisi; `makeUser(role, opts?)` (rastgele telefonla auth kullanıcısı + profil oluşturur, o kullanıcı olarak giriş yapmış anon-key istemcisi döndürür); `SQUARE` ve `BOWTIE` GeoJSON sabitleri (Ankara civarı); test sonunda oluşturulanları temizleyen `cleanup()`.
- [ ] **Step 2:** Başarısız testleri yaz:
  - `rls.test.ts`: dağıtıcı `profiles` sorgusunda yalnızca kendini görür; başka dağıtıcının atamasını ve atanmadığı bölgeyi göremez; atandığı bölgeyi `zones_geojson`'da görür; `zones`'a insert ve `assign_worker` rpc → hata; `active=false` yapılan dağıtıcı kendi atamasını ve bölgesini artık göremez (0 satır); giriş yapmamış istemci 0 satır.
  - `zones.test.ts`: yönetici `save_zone(null, 'A', '#e11d48', null, SQUARE)` → id döner, `zones_geojson.geojson` koordinatları eşleşir; aynı id ile güncelleme adı değiştirir; `BOWTIE` → hata `Geçersiz bölge şekli`; boş ad → hata; `archive_zone` sonrası görünümde yok ve o bölgenin aktif atamalarının `ended_at`'i dolu.
  - `assignments.test.ts`: `assign_worker` iki kez → tek aktif satır; bir kişi iki bölgeye atanabilir, bir bölgeye iki kişi; `move_worker(w, A, B)` → A satırı `ended_at` dolu olarak duruyor, B'de aktif satır var (geçmiş korunur); `unassign_worker` sonrası `active_count` düşer; pasif kişiye atama → hata.
- [ ] **Step 3:** `npm run test:db` → FAIL.
- [ ] **Step 4:** Göçü yaz (`create extension if not exists postgis with schema extensions`), `npx supabase db reset` ile uygula. `npm run test:db` → PASS.
- [ ] **Step 5:** `create-admin` betiğini yaz ve yerelde çalıştırıp bir yönetici oluştur: ad `Yerel Yönetici`, telefon `0500 000 00 01`, şifreyi `generatePassword` mantığıyla üret ve yalnızca `.env.local`'a `LOCAL_ADMIN_PHONE` / `LOCAL_ADMIN_PASSWORD` olarak yaz (sohbete/çıktıya yazma).
- [ ] **Step 6:** Commit: `feat(db): schema, zone and assignment functions, RLS`.

### Task 3: Kimlik, oturum, rol yönlendirme

**Files:**
- Create: `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/supabase/admin.ts`, `lib/auth.ts`, middleware/proxy dosyası, `app/giris/page.tsx`, `app/giris/actions.ts`, `app/page.tsx` (yönlendirme), `app/yonetim/layout.tsx`, `app/gorevim/layout.tsx`, `components/LogoutButton.tsx`
- Test: `lib/auth.test.ts`

**Interfaces — Produces:**
```ts
// lib/supabase/server.ts   createClient(): Promise<SupabaseClient>   (çerez tabanlı, @supabase/ssr)
// lib/supabase/client.ts   createClient(): SupabaseClient            (tarayıcı)
// lib/supabase/admin.ts    createAdminClient(): SupabaseClient       (service role; `import 'server-only'`)
// lib/auth.ts
getSessionProfile(): Promise<Profile | null>            // oturum yoksa ya da profil yoksa null
requireRole(role: Role): Promise<Profile>               // değilse redirect: oturum yok → /giris, pasif → /giris?hata=pasif (oturumu kapatarak), yanlış rol → kendi ana sayfası
homeFor(role: Role): '/yonetim' | '/gorevim'
// app/giris/actions.ts
login(prev: {error?: string}, formData: FormData): Promise<{error?: string}>   // alanlar: phone, password
logout(): Promise<void>
```
- `/giris`: telefon (`inputMode="tel"`) + şifre; hata iletileri: `Telefon numarası geçersiz`, `Telefon veya şifre hatalı`, `Hesabınız pasif. Yöneticinize başvurun.` (`?hata=pasif`).
- `app/yonetim/layout.tsx` `requireRole('admin')`, `app/gorevim/layout.tsx` `requireRole('worker')` çağırır; ikisi de üst barda ad + çıkış gösterir. Yönetim barında gezinme: `Harita` (`/yonetim`), `Kişiler` (`/yonetim/kisiler`).
- Middleware yalnızca oturum çerezini tazeler ve oturumsuz `/yonetim`, `/gorevim` isteklerini `/giris`e yollar.

- [ ] **Step 1:** `lib/auth.test.ts`: `homeFor('admin') === '/yonetim'`, `homeFor('worker') === '/gorevim'` (saf kısım). FAIL → yaz → PASS.
- [ ] **Step 2:** İstemcileri, `lib/auth.ts`, middleware, giriş sayfası ve eylemleri, iki layout'u yaz. `/yonetim` ve `/gorevim` için geçici `page.tsx` (başlık yeter).
- [ ] **Step 3:** Elle doğrula (dev sunucu + tarayıcı ya da `curl`): oturumsuz `/yonetim` → `/giris`; yerel yönetici ile giriş → `/yonetim`; çıkış → `/giris`. `npm run typecheck && npm run lint && npm run build` temiz.
- [ ] **Step 4:** Commit: `feat(auth): phone+password login, role guards`.

### Task 4: Kişi yönetimi (`/yonetim/kisiler`) — Görev 5 ile paralel

**Files:**
- Create: `app/yonetim/kisiler/page.tsx`, `app/yonetim/kisiler/actions.ts`, `app/yonetim/kisiler/PeopleTable.tsx`, `app/yonetim/kisiler/AddPersonForm.tsx`
- Test: `tests/db/people.test.ts`

**Interfaces — Consumes:** `requireRole`, `createAdminClient`, `createClient` (server), `normalizePhone`, `phoneToEmail`, `formatPhone`, `generatePassword`.
**Produces:**
```ts
// app/yonetim/kisiler/actions.ts  — hepsi önce requireRole('admin')
type ActionResult = { ok: true; password?: string } | { ok: false; error: string }
createWorker(input: { fullName: string; phone: string }): Promise<ActionResult>   // password döner
updateWorker(input: { id: string; fullName: string; phone: string }): Promise<ActionResult>  // telefon değişirse auth e-postası da
setWorkerActive(input: { id: string; active: boolean }): Promise<ActionResult>
resetWorkerPassword(input: { id: string }): Promise<ActionResult>                // yeni password döner
// lib/people.ts (eylemlerin çağırdığı, test edilebilir çekirdek; admin istemcisini parametre alır)
createWorkerCore(admin: SupabaseClient, fullName: string, phone: string): Promise<ActionResult>
```
- Hatalar: `Ad soyad gerekli`, `Telefon numarası geçersiz`, `Bu telefon numarası zaten kayıtlı`.
- Profil eklenemezse oluşturulan auth kullanıcısı silinir.
- Üretilen şifre yalnızca bir kez, kopyalama düğmesiyle gösterilir; "Bu şifre tekrar gösterilmez" uyarısı.
- Tablo: ad, telefon (`formatPhone`), durum (Aktif/Pasif), aktif bölge sayısı; satır eylemleri: düzenle, şifre yenile, pasifleştir/aktifleştir. Yönetici satırları listelenmez.
- Dosya `lib/people.ts` de bu görevindir.

- [ ] **Step 1:** `tests/db/people.test.ts` (başarısız): `createWorkerCore` ile kişi oluşur ve dönen şifreyle `signInWithPassword` başarılı; aynı telefonla ikinci çağrı → `Bu telefon numarası zaten kayıtlı` ve `auth.admin.listUsers` içinde o e-postadan tek kullanıcı var; geçersiz telefon → hata, kullanıcı oluşmaz.
- [ ] **Step 2:** `npm run test:db` FAIL → `lib/people.ts`, eylemler ve arayüzü yaz → PASS.
- [ ] **Step 3:** `npm run typecheck && npm run lint` temiz. (Paralel çalışıyorsan commit etme.)

### Task 5: Yönetici haritası — bölge çizme/düzenleme — Görev 4 ile paralel

**Files:**
- Create: `components/map/BaseMap.tsx`, `components/map/basemaps.ts`, `components/map/BasemapToggle.tsx`, `app/yonetim/page.tsx`, `app/yonetim/AdminBoard.tsx`, `app/yonetim/ZoneLayer.tsx`, `app/yonetim/ZoneEditor.tsx`, `app/yonetim/ZoneList.tsx`, `app/yonetim/zone-actions.ts`

**Interfaces — Consumes:** `Zone`, `validatePolygon`, `polygonsBounds`, `createClient`, `requireRole`.
**Produces:**
```ts
// components/map/basemaps.ts
type BasemapId = 'satellite' | 'streets'
basemapStyle(id: BasemapId): maplibregl.StyleSpecification   // raster; uydu URL: NEXT_PUBLIC_SATELLITE_TILE_URL ?? Esri World Imagery; atıf metinleri dahil
// components/map/BaseMap.tsx  ('use client')
<BaseMap basemap={BasemapId} onReady={(map: maplibregl.Map) => void} className? children? />
//   Ankara merkez/zoom 11; altlık değişince stil değişir ve onReady'de eklenen katmanların yeniden eklenebilmesi için `onStyleReload?: (map) => void` çağrılır
// components/map/BasemapToggle.tsx   <BasemapToggle value onChange />   — "Uydu" / "Sokak"; seçim localStorage'da
// app/yonetim/zone-actions.ts  — requireRole('admin') sonrası rpc çağırır, revalidatePath('/yonetim')
saveZone(input: { id: string | null; name: string; color: string; note: string | null; geojson: GeoJSON.Polygon }): Promise<{ ok: true; id: string } | { ok: false; error: string }>
archiveZone(id: string): Promise<{ ok: true } | { ok: false; error: string }>
// app/yonetim/AdminBoard.tsx ('use client')  props: { zones: Zone[]; people: Profile[]; assignments: Assignment[] }
//   Görev 6 bu bileşene kişi paneli ve sürükle-bırak ekleyecek; ZoneList her bölge için <div data-zone-id> kartı üretir ve kart içinde `children`/slot olarak atama çiplerine yer bırakır.
// app/yonetim/ZoneLayer.tsx: çokgenleri `zones` kaynağı, `zones-fill` / `zones-line` / `zones-label` katmanlarıyla çizer (feature.properties.id = zone id).
```
- `app/yonetim/page.tsx` sunucuda `zones_geojson`, dağıtıcı `profiles` ve aktif `assignments` çekip `AdminBoard`'a verir.
- Çizim: "Yeni bölge" → terra-draw polygon modu; haritaya tıklayarak nokta, ilk noktaya/çift tıkla bitir. Bitince ad + renk (8 hazır renk) + not formu; Kaydet/Vazgeç. Sunucu hatası (ör. `Geçersiz bölge şekli`) formda görünür ve çizim ekranda kalır.
- Düzenleme: listeden ya da haritadan bölge seçilir → köşeler sürüklenebilir (terra-draw select modu), ad/renk/not değişir, "Arşivle" (onay sorar: "N kişinin ataması kaldırılacak").
- Düzen: masaüstünde solda 360px panel + harita; dar ekranda panel alttan açılır.
- Renk paleti sabiti: `#e11d48 #ea580c #ca8a04 #16a34a #0891b2 #2563eb #7c3aed #db2777`.

- [ ] **Step 1:** `maplibre-gl`, `terra-draw`, `terra-draw-maplibre-gl-adapter` kur; kurulu sürümlerin README/tiplerinden API'yi doğrula.
- [ ] **Step 2:** `basemaps.ts`, `BaseMap`, `BasemapToggle`, `ZoneLayer`, `ZoneList`, `ZoneEditor`, `zone-actions.ts`, `AdminBoard`, `page.tsx` yaz.
- [ ] **Step 3:** Tarayıcıda doğrula (yerel yönetici ile): bölge çiz-kaydet, sayfayı yenile → duruyor; köşe taşı-kaydet; altlık değiştir → çokgenler kaybolmuyor; arşivle → listeden kalkıyor. `npm run typecheck && npm run lint` temiz. (Paralel çalışıyorsan commit etme.)

### Task 6: Sürükle-bırak atama — Görev 7 ile paralel

**Files:**
- Create: `app/yonetim/PeoplePanel.tsx`, `app/yonetim/AssignmentChip.tsx`, `app/yonetim/AssignDialog.tsx`, `app/yonetim/assignment-actions.ts`, `lib/assignments.ts`
- Modify: `app/yonetim/AdminBoard.tsx`, `app/yonetim/ZoneList.tsx`
- Test: `lib/assignments.test.ts`

**Interfaces — Consumes:** Görev 5'in `AdminBoard`, `ZoneList`, `ZoneLayer` katman adları; Görev 2 rpc'leri.
**Produces:**
```ts
// lib/assignments.ts (saf)
zonesOfWorker(assignments: Assignment[], workerId: string): string[]
type DropIntent = { kind: 'noop' } | { kind: 'assign'; workerId: string; zoneId: string }
               | { kind: 'ask'; workerId: string; zoneId: string; currentZoneIds: string[] }   // Ekle/Taşı sor
               | { kind: 'move'; workerId: string; fromZoneId: string; toZoneId: string }
resolveDrop(assignments: Assignment[], drag: { workerId: string; fromZoneId: string | null }, toZoneId: string): DropIntent
//   kişi listesinden (fromZoneId null): hedefte zaten varsa noop; hiç ataması yoksa assign; başka ataması varsa ask
//   çipten (fromZoneId dolu): aynı bölgeyse noop; hedefte zaten varsa noop; değilse move
// app/yonetim/assignment-actions.ts — requireRole('admin'), rpc, revalidatePath('/yonetim')
assignWorker(workerId: string, zoneId: string), unassignWorker(workerId, zoneId), moveWorker(workerId, fromZoneId, toZoneId)
  : Promise<{ ok: true } | { ok: false; error: string }>
```
- `PeoplePanel`: yalnızca aktif dağıtıcılar; ada/telefona göre arama; filtre `Tümü / Atanmamış / Atanmış`; her satırda rozet: atanmamışsa gri "Atanmadı", atanmışsa bölge renginde nokta(lar) + sayı; satır sürüklenebilir. 700 satırda akıcı olmalı (basit pencereleme ya da 100'lük "daha fazla göster").
- Bırakma hedefleri: `ZoneList` kartları **ve** haritadaki çokgenler (bırakma noktasında `map.queryRenderedFeatures(point, { layers: ['zones-fill'] })`).
- `ask` durumunda `AssignDialog`: "<Ad> şu bölgelerde görevli: A, B." Düğmeler: `Buraya da ekle`, `Taşı` (tek mevcut bölge varsa doğrudan; birden çoksa hangisinden taşınacağı seçilir), `Vazgeç`.
- Çipte × → `unassignWorker`. İyimser güncelleme; hata olursa geri al ve hata şeridi göster.
- Dokunmatik ekranda da çalışmalı (dnd-kit PointerSensor + TouchSensor, 150ms gecikme).

- [ ] **Step 1:** `lib/assignments.test.ts` (başarısız): yukarıdaki `resolveDrop` kurallarının her dalı için birer örnek + `zonesOfWorker` yalnızca `ended_at === null` olanları sayar.
- [ ] **Step 2:** FAIL → `lib/assignments.ts` → PASS.
- [ ] **Step 3:** `@dnd-kit/core` kur; eylemler, panel, çip, diyalog; `AdminBoard`/`ZoneList` bağlantıları.
- [ ] **Step 4:** Tarayıcıda doğrula: atanmamış kişiyi karta bırak → çip + rozet; aynı kişiyi ikinci bölgeye bırak → diyalog, "Buraya da ekle" → iki bölgede; çipi başka karta sürükle → taşındı; haritadaki çokgene bırak → atandı; × → kalktı. `npm test && npm run typecheck && npm run lint` temiz. (Paralel çalışıyorsan commit etme.)

### Task 7: Dağıtıcı ekranı + PWA — Görev 6 ile paralel

**Files:**
- Create: `app/gorevim/page.tsx`, `app/gorevim/WorkerMap.tsx`, `app/manifest.ts`, `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/icon-maskable-512.png`, `public/sw.js`, `components/RegisterSW.tsx`
- Modify: `app/layout.tsx` (lang="tr", metadata, viewport/theme-color, `RegisterSW`)

**Interfaces — Consumes:** `BaseMap`, `BasemapToggle`, `basemapStyle`, `Zone`, `polygonsBounds`, `requireRole('worker')` (layout'ta).

- `page.tsx` sunucuda `zones_geojson` çeker (RLS yalnızca atananları döndürür). Yoksa: "Henüz görev atanmadı. Yöneticinizle iletişime geçin."
- `WorkerMap`: tam ekran harita, bölgeler renkli ve etiketli, açılışta `polygonsBounds` ile hepsine sığdır; altta kaydırılabilir bölge listesi (ad, not), dokununca o bölgeye yakınlaş.
- "Konumumu göster": MapLibre `GeolocateControl` (`trackUserLocation: true`); konum hiçbir yere gönderilmez. İzin reddinde: "Konum izni verilmedi".
- Manifest: `name: "Saha Dağıtım"`, `short_name: "Saha"`, `start_url: "/"`, `display: "standalone"`, `lang: "tr"`, `theme_color: "#0f172a"`, `background_color: "#0f172a"`. İkonlar basit (koyu zemin, harita iğnesi) — bir betikle ya da elde üretilmiş PNG.
- `sw.js`: yalnızca kurulabilirlik + statik varlıklar için cache-first; HTML ve Supabase istekleri her zaman ağdan (bayat görev göstermemek için). Karo isteklerini önbelleğe alma.
- Telefon genişliğinde (375px) yatay kaydırma olmamalı; dokunma hedefleri ≥44px.

- [ ] **Step 1:** Sayfa, harita, manifest, ikonlar, SW, kayıt bileşeni.
- [ ] **Step 2:** Test verisi: `scripts/` altına eklemeden, yerelde bir dağıtıcı oluşturup bir bölgeye ata (service role ile tek seferlik komut). Tarayıcıda 375px'te doğrula: giriş → `/gorevim`, bölge sığdırılmış; atamasız dağıtıcıda boş durum iletisi; `/manifest.webmanifest` 200. `npm run typecheck && npm run lint` temiz. (Paralel çalışıyorsan commit etme.)

### Task 8: README ve son doğrulama

**Files:** Create/Modify: `README.md`

- [ ] **Step 1:** README (Türkçe): ne olduğu; yerel çalıştırma (Docker, `npx supabase start`, `db reset`, `create-admin`, `npm run dev`); üretim kurulumu (Supabase projesi, PostGIS, göçleri `supabase db push` ile uygulama, Auth'ta e-posta doğrulamayı kapatma notu, Vercel ortam değişkenleri); uydu karo sağlayıcısı kullanım şartı notu; ileride takip eklemek için yol haritası (Capacitor + `location_points`).
- [ ] **Step 2:** `npm test && npm run test:db && npm run typecheck && npm run lint && npm run build` — hepsi temiz; çıktıları raporla.
- [ ] **Step 3:** Commit: `docs: README and setup guide`.
