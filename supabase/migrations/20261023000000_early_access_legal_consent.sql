-- Early Access: invoice details are read-only while payments are unavailable.
-- Do not clear existing invoice details or change any commercial switches.
alter policy "billing_profiles: create own" on public.billing_profiles
  with check (user_id = (select auth.uid())
    and (select (public.commercial_flags()->>'payments_enabled')::boolean));
alter policy "billing_profiles: update own" on public.billing_profiles
  using (user_id = (select auth.uid())
    and (select (public.commercial_flags()->>'payments_enabled')::boolean))
  with check (user_id = (select auth.uid())
    and (select (public.commercial_flags()->>'payments_enabled')::boolean));

-- Append-only acceptance history, private to each account. Account deletion still
-- cascades to this personal data; no new retention policy is invented here.
create table public.legal_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_version text check (document_version is null or char_length(document_version) between 1 and 40),
  terms_accepted_at timestamptz,
  privacy_accepted_at timestamptz,
  source text not null check (source in ('legacy', 'explicit')),
  check (source = 'legacy' or (document_version is not null and terms_accepted_at is not null and privacy_accepted_at is not null))
);
create index legal_consents_user_idx on public.legal_consents(user_id);
alter table public.legal_consents enable row level security;
revoke all on public.legal_consents from public, anon, authenticated;
grant select on public.legal_consents to authenticated;
grant all on public.legal_consents to service_role;
create policy "legal_consents: read own" on public.legal_consents
  for select to authenticated using (user_id = (select auth.uid()));

-- Preserve exactly the legacy evidence available. Missing versions/timestamps
-- remain null; older acceptances that were never retained cannot be reconstructed.
insert into public.legal_consents (user_id, document_version, terms_accepted_at, privacy_accepted_at, source)
  select id, terms_version, terms_accepted_at, privacy_accepted_at, 'legacy'
    from public.profiles
   where terms_version is not null or terms_accepted_at is not null or privacy_accepted_at is not null;

create or replace function public.complete_onboarding(p_name text, p_legal_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  clean text := public.clean_display_name(p_name);
  configured jsonb := (select s.value from public.commercial_settings s where s.key = 'legal_version');
  expected text := case when jsonb_typeof(configured) = 'string' then configured #>> '{}' else 'pending' end;
  accepted_at timestamptz;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if clean is null then raise exception 'invalid_name' using errcode = 'P0001'; end if;
  if p_legal_version is null or btrim(p_legal_version) <> expected then
    raise exception 'invalid_version' using errcode = 'P0001';
  end if;
  perform 1 from public.profiles where id = uid for update;
  if not found then raise exception 'profile_missing' using errcode = 'P0001'; end if;
  accepted_at := clock_timestamp();
  insert into public.legal_consents (user_id, document_version, terms_accepted_at, privacy_accepted_at, source)
    values (uid, expected, accepted_at, accepted_at, 'explicit');
  update public.profiles
     set display_name = clean, terms_version = expected,
         terms_accepted_at = accepted_at, privacy_accepted_at = accepted_at,
         onboarding_completed_at = coalesce(onboarding_completed_at, accepted_at)
   where id = uid;
end $$;
revoke execute on function public.complete_onboarding(text, text) from public, anon;
grant execute on function public.complete_onboarding(text, text) to authenticated;
