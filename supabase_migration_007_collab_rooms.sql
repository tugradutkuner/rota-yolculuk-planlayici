-- Vialume — Gerçek zamanlı ortak rota planlama odaları.
-- Supabase Dashboard > SQL Editor'e yapıştırıp çalıştır.

create table if not exists public.collab_rooms (
  id text primary key,                 -- kısa, tahmin edilmesi zor paylaşım kodu
  owner_id uuid references auth.users(id) on delete set null,
  stops jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.collab_rooms enable row level security;

-- Güvenlik modeli: bu bir "linki bilen herkes düzenleyebilir" (Google Docs
-- linki gibi) basit paylaşım odası — kod tahmin edilemeyecek kadar uzun/rastgele
-- olduğu için erişim kontrolü linkin kendisinde. Hassas veri tutmuyor
-- (sadece durak adres listesi), bu yüzden bu basitlik kabul edilebilir.
create policy "Oda linkini bilen herkes okuyabilir"
  on public.collab_rooms for select
  using (true);

create policy "Giriş yapmış kullanıcı oda oluşturabilir"
  on public.collab_rooms for insert
  with check (auth.uid() is not null);

create policy "Oda linkini bilen herkes güncelleyebilir"
  on public.collab_rooms for update
  using (true);

-- Realtime yayınına ekle (Supabase panelinde Database > Replication'dan da
-- açılabilir ama bu satır aynı işi SQL ile yapar)
alter publication supabase_realtime add table public.collab_rooms;

-- Eski odaları otomatik temizlemek istersen (opsiyonel, şimdilik atlanabilir):
-- 7 günden eski odaları silen bir pg_cron görevi ileride eklenebilir.
