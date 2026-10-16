-- Phase 1A: account profiles. One row per auth user, created by a trigger, readable and (partly)
-- editable only by its owner. No project data, files, credits or payments live here.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locale text check (locale in ('he', 'en')),
  -- Consent record. Written only by server-side code (a later SECURITY DEFINER function), never
  -- directly by the client, so it cannot be back-dated.
  terms_accepted_at timestamptz
);

alter table public.profiles enable row level security;

-- Supabase grants new public tables to anon/authenticated by default; start from nothing instead.
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (locale) on table public.profiles to authenticated;

-- Owner-only. There is deliberately NO insert or delete policy: rows are created by the trigger
-- below and removed by the auth.users cascade.
create policy "profiles: read own" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Keeps updated_at honest without trusting the client.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Creates the profile when an auth user is created. SECURITY DEFINER so it works although the
-- signing-up user has no insert privilege; search_path is pinned so it cannot be hijacked.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

-- A trigger function is not an API: nobody may call it directly.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users that existed before this migration get their profile too (idempotent).
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;
