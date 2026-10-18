-- PREPARED RELEASE CONFIGURATION ONLY — NOT EXECUTED.
-- Common legal identity: ea-2026-10-18-v1; effective date: 2026-10-18.
-- Execute only under consolidated release approval, after migrations 23 and 24,
-- immediately with publication of the matching client. Do not run during preparation.
-- This changes release metadata only; historical acceptance records stay untouched.
begin;

do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261023000000')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261024000000') then
    raise exception 'Apply and verify migrations 23 and 24 before legal version cutover';
  end if;
  if exists (
    select 1 from public.commercial_settings
    where key in ('ai_enabled', 'payments_enabled', 'credit_purchases_enabled')
      and value is distinct from 'false'::jsonb
  ) or (select count(*) from public.commercial_settings
        where key in ('ai_enabled', 'payments_enabled', 'credit_purchases_enabled')) <> 3 then
    raise exception 'Commercial features must remain explicitly disabled';
  end if;
  if exists (
    select 1 from public.commercial_settings
    where key = 'legal_version'
      and value not in ('null'::jsonb, '"pending"'::jsonb, '"ea-2026-10-18-v1"'::jsonb)
  ) then
    raise exception 'Unexpected existing legal version: review before changing it';
  end if;
  if exists (
    select 1 from public.commercial_settings
    where key = 'legal_effective_date' and value <> '"2026-10-18"'::jsonb
  ) then
    raise exception 'Unexpected existing effective date: review before changing it';
  end if;
end $$;

insert into public.commercial_settings (key, value) values
  ('legal_version', to_jsonb('ea-2026-10-18-v1'::text)),
  ('legal_effective_date', to_jsonb('2026-10-18'::text))
on conflict (key) do update
  set value = excluded.value, updated_at = now()
  where commercial_settings.value is distinct from excluded.value;

commit;
