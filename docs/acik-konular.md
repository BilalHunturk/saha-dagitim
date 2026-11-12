# Açık konular (v1 sonrası)

İncelemelerde bulunan, bilerek sonraya bırakılan küçük konular. Hiçbiri veri sızdırmıyor
ya da veri bozmuyor.

## Dağıtıcı ekranı

- Arka plan yenilemesi sırasında sunucu geçici hata verirse harita yerine hata sayfası
  çıkıyor ve otomatik yenileme duruyor (`app/gorevim/WorkerMap.tsx`, `app/error.tsx`).
- Yenileme öncesi bağlantı yoklamasının zaman aşımı yok (`lib/safe-refresh.ts`).
- "Bağlantı yok" yazısı ancak bir yoklama başarısız olunca görünüyor.
- Bölge değişince harita yeniden sığdırılırken "Konumumu göster" takibi bırakılıyor.
- Pasifleştirilmiş dağıtıcı uygulamayı yeniden açınca "Hesabınız pasif" yerine düz giriş
  sayfasını görüyor.
- Service worker'ın statik önbelleği her yayında büyüyor; sürüme bağlı önbellek adı gerekli.

## Yönetici ekranı / veri

- `fetchAll` sayfalama ofset tabanlı; sayfalar arasında veri değişirse anlık tutarlılık
  garantisi yok ve sunucu `max_rows` değerinin en az 1000 olduğunu varsayıyor.
- Dağıtıcı sorgusu kullanılmayan `active_count` sütununu hâlâ seçiyor.
- 1024–1280 px arası ekranlarda kişi sütunu açıkken harita dar kalıyor (sütun gizlenebilir).

## Gerçek ortamda henüz denenmeyenler

- Üretim kurulumu adımları (Supabase barındırılan proje + Vercel) yalnızca komut
  yardımlarına ve koda bakılarak yazıldı; gerçek bir projede çalıştırılmadı.
- Dağıtıcı ekranı gerçek telefonlarda (Android/iPhone) denenmedi; testler masaüstü
  Chrome'da telefon boyutunda yapıldı.
- Giriş sınırı (429) iletisi ve geçici hata yolları yalnızca birim testleriyle doğrulandı.
- Uydu altlığı sağlayıcısının (Esri World Imagery) kullanım şartları üretim için teyit edilmedi.
