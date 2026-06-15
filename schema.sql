-- ============================================================================
-- LawClaw — Supabase database schema
-- ============================================================================
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh
-- project. It creates every table that server.js references, plus row-level
-- security (RLS) policies, indexes, and the trigger that mirrors auth.users
-- into the `profiles` table.
--
-- NOTE: The API uses the *service role* key, which bypasses RLS. The RLS
-- policies below exist so that the Supabase anon/auth keys (e.g. the realtime
-- client used by the chat UI) can only read/write rows the user owns.
-- ============================================================================

-- Extensions ----------------------------------------------------------------
create extension if not exists "uuid-ossp";

-- ============================================================================
-- profiles — one row per auth user, mirrors role + display name
-- ============================================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        text not null default 'user' check (role in ('user', 'lawyer', 'admin')),
  full_name   text,
  created_at  timestamptz not null default now()
);

-- Keep profiles in sync with auth.users. user_metadata.role / full_name are
-- set at signup in server.js.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'user'),
    new.raw_user_meta_data->>'full_name'
  )
  on conflict (id) do update
    set role      = excluded.role,
        full_name = excluded.full_name;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- lawyers — verified attorney profiles
-- ============================================================================
create table if not exists public.lawyers (
  id                  uuid primary key references auth.users(id) on delete cascade,
  name_en             text not null,
  name_cn             text,
  avatar_initial      text,
  bio_en              text,
  bio_cn              text,
  city                text,
  state               text,
  specialties         text[] not null default '{}',
  languages           text[] not null default '{en}',

  -- Bar verification
  bar_number          text not null,
  bar_state           text not null,
  bar_verified        boolean not null default false,
  bar_status          text,
  bar_last_checked    timestamptz,
  bar_discipline      boolean not null default false,

  -- Subscription / quota
  subscription_active boolean not null default false,
  pitches_limit       integer not null default 5,
  pitches_used        integer not null default 0,
  pitches_period_start timestamptz not null default now(),

  -- Practice details
  years_experience    integer,
  cases_won           integer,
  rating              numeric(2,1) not null default 0,
  review_count        integer not null default 0,
  availability        text not null default 'available'
                        check (availability in ('available','limited','next_month','unavailable')),
  availability_updated timestamptz,
  fee_type            text,
  fee_detail          text,
  contingency_pct     numeric,
  hourly_min          integer,
  hourly_max          integer,
  free_consult        boolean not null default false,
  free_consult_min    integer,

  created_at          timestamptz not null default now(),
  unique (bar_state, bar_number)
);

create index if not exists lawyers_state_idx       on public.lawyers (state);
create index if not exists lawyers_availability_idx on public.lawyers (availability);

-- ============================================================================
-- needs — anonymous legal needs posted by users
-- ============================================================================
create table if not exists public.needs (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  case_type      text not null,
  region         text not null,
  state          text not null,
  language_pref  text,
  visa_status    text,
  description    text not null,
  urgency        text not null default 'normal' check (urgency in ('normal','high')),
  status         text not null default 'open' check (status in ('open','matched','closed')),
  pitch_count    integer not null default 0,

  -- Contact info — only populated after the user chooses to share identity
  user_real_name text,
  user_phone     text,
  user_email     text,

  created_at     timestamptz not null default now()
);

create index if not exists needs_status_idx  on public.needs (status);
create index if not exists needs_state_idx    on public.needs (state);
create index if not exists needs_user_idx      on public.needs (user_id);
create index if not exists needs_created_idx   on public.needs (created_at desc);

-- ============================================================================
-- pitches — a lawyer's offer on a need
-- ============================================================================
create table if not exists public.pitches (
  id            uuid primary key default uuid_generate_v4(),
  need_id       uuid not null references public.needs(id) on delete cascade,
  lawyer_id     uuid not null references public.lawyers(id) on delete cascade,
  message       text not null,
  fee_type      text,
  fee_detail    text,
  availability  text,
  status        text not null default 'pending' check (status in ('pending','accepted','declined')),
  chat_id       uuid,
  sent_at       timestamptz not null default now(),
  unique (need_id, lawyer_id)
);

create index if not exists pitches_need_idx   on public.pitches (need_id);
create index if not exists pitches_lawyer_idx  on public.pitches (lawyer_id);

-- Atomic pitch_count increment (avoids a read-modify-write race in the API).
create or replace function public.increment_pitch_count(need_id_in uuid)
returns void
language sql
as $$
  update public.needs set pitch_count = pitch_count + 1 where id = need_id_in;
$$;

-- ============================================================================
-- chats — opened when a user accepts a pitch
-- ============================================================================
create table if not exists public.chats (
  id               uuid primary key default uuid_generate_v4(),
  need_id          uuid not null references public.needs(id) on delete cascade,
  pitch_id         uuid not null references public.pitches(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  lawyer_id        uuid not null references public.lawyers(id) on delete cascade,
  privacy_level    text not null default 'matched' check (privacy_level in ('public','matched','unlocked')),
  identity_shared  boolean not null default false,
  status           text not null default 'active' check (status in ('active','closed')),
  last_message_at  timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create index if not exists chats_user_idx   on public.chats (user_id);
create index if not exists chats_lawyer_idx  on public.chats (lawyer_id);

-- ============================================================================
-- messages — chat messages
-- ============================================================================
create table if not exists public.messages (
  id           uuid primary key default uuid_generate_v4(),
  chat_id      uuid not null references public.chats(id) on delete cascade,
  sender_id    uuid references auth.users(id) on delete set null,
  sender_type  text not null check (sender_type in ('user','lawyer','system')),
  content      text not null,
  sent_at      timestamptz not null default now()
);

create index if not exists messages_chat_idx on public.messages (chat_id, sent_at);

-- Keep chats.last_message_at fresh for ordering the inbox.
create or replace function public.bump_chat_last_message()
returns trigger
language plpgsql
as $$
begin
  update public.chats set last_message_at = new.sent_at where id = new.chat_id;
  return new;
end;
$$;

drop trigger if exists on_message_insert on public.messages;
create trigger on_message_insert
  after insert on public.messages
  for each row execute function public.bump_chat_last_message();

-- ============================================================================
-- reviews — user reviews of a lawyer after a chat
-- ============================================================================
create table if not exists public.reviews (
  id          uuid primary key default uuid_generate_v4(),
  chat_id     uuid not null references public.chats(id) on delete cascade,
  lawyer_id   uuid not null references public.lawyers(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  rating      integer not null check (rating between 1 and 5),
  text        text,
  case_type   text,
  created_at  timestamptz not null default now(),
  unique (chat_id)
);

create index if not exists reviews_lawyer_idx on public.reviews (lawyer_id);

-- Recompute the lawyer's aggregate rating whenever a review lands.
create or replace function public.recompute_lawyer_rating()
returns trigger
language plpgsql
as $$
declare
  lid uuid := coalesce(new.lawyer_id, old.lawyer_id);
begin
  update public.lawyers l set
    rating = coalesce((select round(avg(rating)::numeric, 1) from public.reviews where lawyer_id = lid), 0),
    review_count = (select count(*) from public.reviews where lawyer_id = lid)
  where l.id = lid;
  return null;
end;
$$;

drop trigger if exists on_review_change on public.reviews;
create trigger on_review_change
  after insert or update or delete on public.reviews
  for each row execute function public.recompute_lawyer_rating();

-- ============================================================================
-- Row-level security
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.lawyers  enable row level security;
alter table public.needs    enable row level security;
alter table public.pitches  enable row level security;
alter table public.chats    enable row level security;
alter table public.messages enable row level security;
alter table public.reviews  enable row level security;

-- profiles: a user can read their own profile.
drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read" on public.profiles
  for select using (auth.uid() = id);

-- lawyers: public profiles are readable by anyone; a lawyer edits their own row.
drop policy if exists "lawyers public read" on public.lawyers;
create policy "lawyers public read" on public.lawyers
  for select using (true);
drop policy if exists "lawyers self update" on public.lawyers;
create policy "lawyers self update" on public.lawyers
  for update using (auth.uid() = id);

-- needs: a user manages their own needs.
drop policy if exists "needs owner all" on public.needs;
create policy "needs owner all" on public.needs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- pitches: lawyers see/insert their own; need owners can read pitches on their need.
drop policy if exists "pitches lawyer own" on public.pitches;
create policy "pitches lawyer own" on public.pitches
  for all using (auth.uid() = lawyer_id) with check (auth.uid() = lawyer_id);
drop policy if exists "pitches need owner read" on public.pitches;
create policy "pitches need owner read" on public.pitches
  for select using (exists (
    select 1 from public.needs n where n.id = need_id and n.user_id = auth.uid()
  ));

-- chats: participants only.
drop policy if exists "chats participants" on public.chats;
create policy "chats participants" on public.chats
  for select using (auth.uid() = user_id or auth.uid() = lawyer_id);

-- messages: participants of the parent chat only.
drop policy if exists "messages participants read" on public.messages;
create policy "messages participants read" on public.messages
  for select using (exists (
    select 1 from public.chats c
    where c.id = chat_id and (c.user_id = auth.uid() or c.lawyer_id = auth.uid())
  ));
drop policy if exists "messages participants write" on public.messages;
create policy "messages participants write" on public.messages
  for insert with check (exists (
    select 1 from public.chats c
    where c.id = chat_id and (c.user_id = auth.uid() or c.lawyer_id = auth.uid())
  ));

-- reviews: public read, author writes.
drop policy if exists "reviews public read" on public.reviews;
create policy "reviews public read" on public.reviews
  for select using (true);
drop policy if exists "reviews author write" on public.reviews;
create policy "reviews author write" on public.reviews
  for insert with check (auth.uid() = user_id);
