-- Zaten çalıştırdığın supabase_schema.sql'e ek — sadece bunu çalıştırman yeterli,
-- ana şemayı tekrar çalıştırmana gerek yok.
alter table public.shared_trips
  add column if not exists status text not null default 'planned';
