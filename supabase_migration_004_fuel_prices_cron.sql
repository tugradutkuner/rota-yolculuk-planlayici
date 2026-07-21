-- Yakıt fiyatlarını haftalık otomatik güncelleme — Supabase SQL Editor'de çalıştır.
--
-- ÖNEMLİ: Bu dosyayı çalıştırmadan önce:
-- 1) supabase/functions/fetch-fuel-prices/index.ts dosyasının içeriğini
--    Supabase Dashboard > Edge Functions > "Create a new function" ile
--    "fetch-fuel-prices" adında bir fonksiyon olarak yapıştırıp deploy et.
-- 2) O fonksiyonun ayarlarında "Verify JWT" seçeneğini KAPAT (bu fonksiyon
--    sadece cron tarafından tetiklenecek, kullanıcı kimliği kontrolüne
--    ihtiyacı yok).
-- 3) Aşağıdaki <SERVICE_ROLE_KEY> yazan yeri kendi service_role anahtarınla
--    değiştir (Project Settings > API Keys sayfasında bulabilirsin — bu
--    anahtar GİZLİDİR, sadece bu SQL'in içinde, kendi veritabanında kalır).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'fetch-fuel-prices-weekly',
  '0 16 * * 4',  -- her Perşembe 16:00 UTC (AB bülteni saat 15:00 EET'te yayınlanıyor)
  $$
  select net.http_post(
    url := 'https://lzpwuomzulvplfclkovb.supabase.co/functions/v1/fetch-fuel-prices',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Kontrol etmek için: bu SQL'i çalıştırıp zamanlanmış görevi listeleyebilirsin:
-- select * from cron.job;
