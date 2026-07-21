-- Yakıt fiyatları tablosu — Supabase Dashboard > SQL Editor'e yapıştırıp çalıştır.

create table if not exists public.fuel_prices (
  country_code text primary key,       -- ISO 3166-1 alpha-2 (TR, DE, FR, ...)
  country_name text not null,          -- Türkçe görünen isim
  gasoline_usd_per_liter numeric,
  diesel_usd_per_liter numeric,
  source text not null,
  updated_at timestamptz not null default now()
);

alter table public.fuel_prices enable row level security;

create policy "Yakıt fiyatları herkese açık okunabilir"
  on public.fuel_prices for select
  using (true);

-- Kasıtlı olarak insert/update/delete policy YOK — sadece Edge Function
-- (service_role anahtarıyla, RLS'i atlayarak) yazabilir. Hiçbir kullanıcı
-- veya anon istemci bu tabloyu doğrudan değiştiremez.

-- Gerçek, doğrulanmış Temmuz 2026 rakamlarıyla ilk tohum veri (otomatik
-- güncelleme çalışana kadar). Tam otomatik kapsam: AB-27 ülkeleri
-- (fuel-prices.eu / AB Komisyonu Haftalık Petrol Bülteni) + Türkiye (EPDK).
-- İsviçre, İngiltere, ABD gibi AB dışı ülkeler için eşit kalitede ücretsiz
-- resmi bir kaynak bulunamadı — bu ülkeler şimdilik elle/periyodik olarak
-- güncellenecek, tabloya eklenmedi (uydurma rakam koymak yerine boş bırakıldı).
insert into public.fuel_prices (country_code, country_name, gasoline_usd_per_liter, diesel_usd_per_liter, source, updated_at)
values
  ('TR', 'Türkiye', 1.340, 1.410, 'EPDK / DailyFuels, 13 Tem 2026', '2026-07-13'),
  ('DE', 'Almanya', 2.401, 2.302, 'AB Komisyonu Haftalık Petrol Bülteni, 13 Tem 2026', '2026-07-13'),
  ('FR', 'Fransa', 2.244, 2.226, 'AB Komisyonu Haftalık Petrol Bülteni, 13 Tem 2026', '2026-07-13'),
  ('PL', 'Polonya', 1.823, 1.842, 'AB Komisyonu Haftalık Petrol Bülteni, 13 Tem 2026', '2026-07-13'),
  ('CZ', 'Çekya', 1.875, 1.732, 'AB Komisyonu Haftalık Petrol Bülteni, 13 Tem 2026', '2026-07-13'),
  ('LU', 'Lüksemburg', 1.940, 1.940, 'AB Komisyonu Haftalık Petrol Bülteni, 13 Tem 2026', '2026-07-13'),
  ('AT', 'Avusturya', 2.014, 2.102, 'AB Komisyonu Haftalık Petrol Bülteni, 13 Tem 2026', '2026-07-13'),
  ('BE', 'Belçika', 2.069, 2.243, 'AB Komisyonu Haftalık Petrol Bülteni, 13 Tem 2026', '2026-07-13'),
  ('NL', 'Hollanda', 2.625, 2.456, 'AB Komisyonu Haftalık Petrol Bülteni, 13 Tem 2026', '2026-07-13'),
  ('DK', 'Danimarka', 2.703, 2.343, 'AB Komisyonu Haftalık Petrol Bülteni, 13 Tem 2026', '2026-07-13')
on conflict (country_code) do update set
  gasoline_usd_per_liter = excluded.gasoline_usd_per_liter,
  diesel_usd_per_liter = excluded.diesel_usd_per_liter,
  source = excluded.source,
  updated_at = excluded.updated_at;
