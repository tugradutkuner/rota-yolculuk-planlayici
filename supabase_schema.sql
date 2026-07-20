-- Rota Planlayıcı — gerçek backend şeması
-- Bu dosyayı Supabase Dashboard > SQL Editor içine yapıştırıp "Run" ile çalıştır.

-- 1) PROFILES: her kullanıcı için ek bilgiler (auth.users'a 1-1 bağlı)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  avatar_url text,
  bio text default '',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiller herkese açık okunabilir"
  on public.profiles for select
  using (true);

create policy "Kullanıcı sadece kendi profilini güncelleyebilir"
  on public.profiles for update
  using (auth.uid() = id);

-- Yeni bir kullanıcı kayıt olunca otomatik profil satırı oluştur
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'gezgin_' || substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data->>'avatar_url', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2) SHARED_TRIPS: "Keşfet" — herkesin gördüğü gerçek ortak feed
create table if not exists public.shared_trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text default '',
  stops jsonb not null,
  distance_km numeric,
  duration_min integer,
  like_count integer not null default 0,
  status text not null default 'planned',
  created_at timestamptz not null default now()
);

alter table public.shared_trips enable row level security;

create policy "Paylaşılan rotalar herkese açık"
  on public.shared_trips for select
  using (true);

create policy "Kullanıcı kendi rotasını paylaşabilir"
  on public.shared_trips for insert
  with check (auth.uid() = user_id);

create policy "Kullanıcı sadece kendi paylaşımını silebilir/güncelleyebilir"
  on public.shared_trips for update using (auth.uid() = user_id);

create policy "Kullanıcı sadece kendi paylaşımını silebilir"
  on public.shared_trips for delete using (auth.uid() = user_id);

-- 3) TRIP_LIKES: kim hangi rotayı beğenmiş (çift beğeniyi engelleyen junction tablo)
create table if not exists public.trip_likes (
  trip_id uuid not null references public.shared_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

alter table public.trip_likes enable row level security;

create policy "Beğeniler herkese açık okunabilir"
  on public.trip_likes for select
  using (true);

create policy "Kullanıcı kendi adına beğeni ekleyebilir"
  on public.trip_likes for insert
  with check (auth.uid() = user_id);

create policy "Kullanıcı sadece kendi beğenisini geri alabilir"
  on public.trip_likes for delete
  using (auth.uid() = user_id);

-- Beğeni eklenince/silinince shared_trips.like_count'u otomatik güncelle
create or replace function public.sync_trip_like_count()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.shared_trips set like_count = like_count + 1 where id = new.trip_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.shared_trips set like_count = greatest(like_count - 1, 0) where id = old.trip_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists on_trip_like_change on public.trip_likes;
create trigger on_trip_like_change
  after insert or delete on public.trip_likes
  for each row execute function public.sync_trip_like_count();

-- 4) SAVED_TRIPS: "Gezilerim" — tamamen özel, sadece sahibi görür
create table if not exists public.saved_trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  stops jsonb not null,
  distance_km numeric,
  duration_min integer,
  status text default 'planned',
  created_at timestamptz not null default now()
);

alter table public.saved_trips enable row level security;

create policy "Kullanıcı sadece kendi gezilerini görebilir"
  on public.saved_trips for select
  using (auth.uid() = user_id);

create policy "Kullanıcı kendi gezisini ekleyebilir"
  on public.saved_trips for insert
  with check (auth.uid() = user_id);

create policy "Kullanıcı kendi gezisini güncelleyebilir"
  on public.saved_trips for update using (auth.uid() = user_id);

create policy "Kullanıcı kendi gezisini silebilir"
  on public.saved_trips for delete using (auth.uid() = user_id);

-- Hız için indeksler
create index if not exists idx_shared_trips_created_at on public.shared_trips (created_at desc);
create index if not exists idx_saved_trips_user_id on public.saved_trips (user_id);
create index if not exists idx_trip_likes_trip_id on public.trip_likes (trip_id);
