-- Vialume — topluluk puanlama + yorum sistemi.
-- Supabase Dashboard > SQL Editor'e yapıştırıp çalıştır.

-- 1) TRIP_RATINGS: her kullanıcı bir paylaşılan rotaya 1-5 arası tek puan verebilir
create table if not exists public.trip_ratings (
  trip_id uuid not null references public.shared_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

alter table public.trip_ratings enable row level security;

create policy "Puanlar herkese açık okunabilir"
  on public.trip_ratings for select
  using (true);

create policy "Kullanıcı kendi puanını ekleyebilir/güncelleyebilir"
  on public.trip_ratings for insert
  with check (auth.uid() = user_id);

create policy "Kullanıcı kendi puanını güncelleyebilir"
  on public.trip_ratings for update using (auth.uid() = user_id);

create policy "Kullanıcı kendi puanını silebilir"
  on public.trip_ratings for delete using (auth.uid() = user_id);

-- shared_trips'e ortalama puan + puan sayısı kolonları
alter table public.shared_trips add column if not exists avg_rating numeric;
alter table public.shared_trips add column if not exists rating_count integer not null default 0;

create or replace function public.sync_trip_rating_stats()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  target_trip uuid;
begin
  target_trip := coalesce(new.trip_id, old.trip_id);
  update public.shared_trips t
  set
    rating_count = (select count(*) from public.trip_ratings r where r.trip_id = target_trip),
    avg_rating = (select round(avg(r.rating)::numeric, 2) from public.trip_ratings r where r.trip_id = target_trip)
  where t.id = target_trip;
  return coalesce(new, old);
end;
$$;

drop trigger if exists on_trip_rating_change on public.trip_ratings;
create trigger on_trip_rating_change
  after insert or update or delete on public.trip_ratings
  for each row execute function public.sync_trip_rating_stats();

-- 2) TRIP_COMMENTS: paylaşılan bir rotaya serbest metin yorum
create table if not exists public.trip_comments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.shared_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.trip_comments enable row level security;

create policy "Yorumlar herkese açık okunabilir"
  on public.trip_comments for select
  using (true);

create policy "Kullanıcı yorum ekleyebilir"
  on public.trip_comments for insert
  with check (auth.uid() = user_id);

create policy "Kullanıcı kendi yorumunu silebilir"
  on public.trip_comments for delete using (auth.uid() = user_id);

create index if not exists idx_trip_ratings_trip_id on public.trip_ratings (trip_id);
create index if not exists idx_trip_comments_trip_id on public.trip_comments (trip_id);
