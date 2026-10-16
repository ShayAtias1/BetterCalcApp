-- Phase 3 foundation, part 1: who the user is (display name), what they agreed to, the right to ask for
-- account deletion, and server-side switches that keep unfinished commercial features off.

-- ---------------------------------------------------------------- profile: name, consent, onboarding
alter table public.profiles
  add column display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 80),
  add column terms_version text check (terms_version is null or char_length(terms_version) between 1 and 40),
  add column privacy_accepted_at timestamptz,
  add column onboarding_completed_at timestamptz;

-- The owner may now edit their name too. Consent and onboarding columns stay server-written only.
grant update (display_name) on table public.profiles to authenticated;

-- A clean, single-line name from sign-up metadata (Google sends full_name/name; the email form sends full_name).
create function public.clean_display_name(raw text)
returns text language sql immutable set search_path = '' as $$
  select nullif(left(btrim(regexp_replace(coalesce(raw, ''), '[[:cntrl:]]+', ' ', 'g')), 80), '')
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, public.clean_display_name(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Records the name and the agreement to the terms and privacy policy in one step, with the server's clock.
-- Idempotent: running it again only refreshes the name and version.
create function public.complete_onboarding(p_name text, p_legal_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  clean text := public.clean_display_name(p_name);
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if clean is null then raise exception 'invalid_name' using errcode = 'P0001'; end if;
  if p_legal_version is null or char_length(btrim(p_legal_version)) not between 1 and 40 then
    raise exception 'invalid_version' using errcode = 'P0001';
  end if;
  update public.profiles
     set display_name = clean,
         terms_version = btrim(p_legal_version),
         terms_accepted_at = coalesce(terms_accepted_at, now()),
         privacy_accepted_at = coalesce(privacy_accepted_at, now()),
         onboarding_completed_at = coalesce(onboarding_completed_at, now())
   where id = uid;
  if not found then raise exception 'profile_missing' using errcode = 'P0001'; end if;
end $$;

-- ---------------------------------------------------------------- account deletion requests
-- Only the request is stored here. The deletion itself runs as trusted server code (service role): it removes
-- the cloud files through the Storage API and then the auth user, which cascades to every row. Local projects
-- on the user's devices are never touched. No waiting period is set here; that is an operations decision.
create table public.account_deletion_requests (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'cancelled', 'processing')),
  requested_at timestamptz not null default now(),
  cancelled_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.account_deletion_requests enable row level security;
revoke all on table public.account_deletion_requests from anon, authenticated;
grant select on table public.account_deletion_requests to authenticated;
create policy "account_deletion_requests: read own" on public.account_deletion_requests
  for select to authenticated using (user_id = (select auth.uid()));

create trigger account_deletion_requests_set_updated_at
  before update on public.account_deletion_requests
  for each row execute function public.set_updated_at();

create function public.request_account_deletion()
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  insert into public.account_deletion_requests (user_id) values (uid)
  on conflict (user_id) do update
    set status = 'requested', requested_at = now(), cancelled_at = null
    where public.account_deletion_requests.status = 'cancelled';
end $$;

-- Possible only until the request is picked up for processing.
create function public.cancel_account_deletion()
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.account_deletion_requests set status = 'cancelled', cancelled_at = now()
   where user_id = uid and status = 'requested';
end $$;

create function public.pending_account_deletions()
returns table (user_id uuid, requested_at timestamptz) language sql stable security definer set search_path = '' as $$
  select r.user_id, r.requested_at from public.account_deletion_requests r where r.status = 'requested' order by r.requested_at
$$;

-- ---------------------------------------------------------------- server-side switches
-- Unfinished commercial features are refused by the database itself, whatever the browser does.
create table public.commercial_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.commercial_settings enable row level security;
revoke all on table public.commercial_settings from anon, authenticated;

insert into public.commercial_settings (key, value) values
  ('ai_enabled', 'false'),
  ('payments_enabled', 'false'),
  ('credit_purchases_enabled', 'false'),
  -- How credits are spent when both kinds exist. Left unset until it is decided; spending refuses to run without it.
  ('credit_spend_order', 'null'),
  -- The version of the terms and privacy policy users are asked to accept. Null until the texts exist.
  ('legal_version', 'null');

create function public.commercial_flags()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'ai_enabled', coalesce((select (value)::text = 'true' from public.commercial_settings where key = 'ai_enabled'), false),
    'payments_enabled', coalesce((select (value)::text = 'true' from public.commercial_settings where key = 'payments_enabled'), false),
    'credit_purchases_enabled', coalesce((select (value)::text = 'true' from public.commercial_settings where key = 'credit_purchases_enabled'), false),
    'legal_version', (select value from public.commercial_settings where key = 'legal_version')
  )
$$;

create function public.commercial_flag(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select (value)::text = 'true' from public.commercial_settings where key = p_key), false)
$$;

-- ---------------------------------------------------------------- function privileges
revoke execute on function
  public.clean_display_name(text), public.complete_onboarding(text, text), public.request_account_deletion(),
  public.cancel_account_deletion(), public.pending_account_deletions(), public.commercial_flags(), public.commercial_flag(text)
  from public, anon, authenticated;
grant execute on function public.complete_onboarding(text, text), public.request_account_deletion(),
  public.cancel_account_deletion() to authenticated;
grant execute on function public.commercial_flags() to anon, authenticated;
grant execute on function public.commercial_flag(text), public.clean_display_name(text) to authenticated;
grant execute on function public.pending_account_deletions() to service_role;
