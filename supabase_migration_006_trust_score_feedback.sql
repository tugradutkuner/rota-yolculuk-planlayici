-- Vialume — güven ağırlıklı puan (Bayesian) + öneri geri bildirim döngüsü.
-- Supabase Dashboard > SQL Editor'e yapıştırıp çalıştır.

-- 1) TRUST SCORE: "1 kişiden 5 yıldız" ile "50 kişiden 4.7 ortalama"yı adil
-- karşılaştırmak için, ham ortalama yerine güven ağırlıklı bir skor.
-- Formül: (C * genel_ortalama + v * rota_ortalaması) / (C + v)
--   v = bu rotaya verilen puan sayısı
--   C = "güven eşiği" (kaç puan gelene kadar rotanın kendi ortalamasına
--       tam güvenmeyip genel ortalamaya doğru çekelim)
alter table public.shared_trips add column if not exists trust_score numeric;

create or replace function public.sync_trip_rating_stats()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  target_trip uuid;
  v_count integer;
  v_avg numeric;
  global_mean numeric;
  confidence constant numeric := 5;
begin
  target_trip := coalesce(new.trip_id, old.trip_id);

  select count(*), avg(rating) into v_count, v_avg
  from public.trip_ratings where trip_id = target_trip;

  select avg(rating) into global_mean from public.trip_ratings;
  if global_mean is null then
    global_mean := 4.0; -- hiç puan yokken makul bir varsayılan
  end if;

  update public.shared_trips t
  set
    rating_count = v_count,
    avg_rating = round(v_avg, 2),
    trust_score = case
      when v_count = 0 then null
      else round(((confidence * global_mean) + (v_count * v_avg)) / (confidence + v_count), 3)
    end
  where t.id = target_trip;

  return coalesce(new, old);
end;
$$;
-- (trigger zaten trip_ratings üzerinde tanımlıydı, fonksiyonu güncellemek yeterli)

-- Mevcut satırlar için trust_score'u bir kere hesapla (yeni puan gelmeden de dolsun)
do $$
declare
  r record;
  global_mean numeric;
  confidence constant numeric := 5;
begin
  select avg(rating) into global_mean from public.trip_ratings;
  if global_mean is null then global_mean := 4.0; end if;

  for r in select id, rating_count, avg_rating from public.shared_trips where rating_count > 0 loop
    update public.shared_trips
    set trust_score = round(((confidence * global_mean) + (r.rating_count * r.avg_rating)) / (confidence + r.rating_count), 3)
    where id = r.id;
  end loop;
end $$;

-- 2) ENRICHMENT_FEEDBACK: "Rotamı Zenginleştir" önerileri gerçekten kabul
-- ediliyor mu, yoksa geçiliyor mu — bu gerçek davranış AI'a geri besleniyor.
create table if not exists public.enrichment_feedback (
  id uuid primary key default gen_random_uuid(),
  place_name text not null,
  city text,
  category text,
  action text not null check (action in ('added', 'dismissed')),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.enrichment_feedback enable row level security;

-- Sadece toplu/anonim istatistik amaçlı okunuyor (isim + sayaç), kişisel
-- veri içermiyor — herkese açık okuma güvenli.
create policy "Geri bildirim istatistikleri herkese açık okunabilir"
  on public.enrichment_feedback for select
  using (true);

create policy "Giriş yapmış kullanıcı kendi geri bildirimini ekleyebilir"
  on public.enrichment_feedback for insert
  with check (auth.uid() = user_id);

create index if not exists idx_enrichment_feedback_place on public.enrichment_feedback (place_name);
