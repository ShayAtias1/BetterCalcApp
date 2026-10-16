-- Security hardening, part 1: consent is recorded only against the published terms version, and account deletion
-- requests can be carried out by trusted server code (the account-maintenance Edge Function, service role).

-- ---------------------------------------------------------------- consent
-- The client may only accept the version the server announces: commercial_settings.legal_version once it is set,
-- the placeholder 'pending' (what the app sends) until then. A client can no longer record consent to a made-up version.
create or replace function public.complete_onboarding(p_name text, p_legal_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  clean text := public.clean_display_name(p_name);
  configured jsonb := (select s.value from public.commercial_settings s where s.key = 'legal_version');
  expected text := case when jsonb_typeof(configured) = 'string' then configured #>> '{}' else 'pending' end;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if clean is null then raise exception 'invalid_name' using errcode = 'P0001'; end if;
  if p_legal_version is null or btrim(p_legal_version) <> expected then
    raise exception 'invalid_version' using errcode = 'P0001';
  end if;
  update public.profiles
     set display_name = clean,
         terms_version = expected,
         terms_accepted_at = coalesce(terms_accepted_at, now()),
         privacy_accepted_at = coalesce(privacy_accepted_at, now()),
         onboarding_completed_at = coalesce(onboarding_completed_at, now())
   where id = uid;
  if not found then raise exception 'profile_missing' using errcode = 'P0001'; end if;
end $$;

-- create or replace keeps the existing grants (authenticated only); restated for clarity.
revoke execute on function public.complete_onboarding(text, text) from public, anon;
grant execute on function public.complete_onboarding(text, text) to authenticated;

-- ---------------------------------------------------------------- account deletion (service role only)
-- Picks up requests older than the grace period (the user can cancel until then) and marks them 'processing', which
-- also ends the user's ability to cancel. Requests already 'processing' are returned again, so a failed run is retried.
create function public.claim_account_deletions(p_grace interval)
returns table (user_id uuid) language plpgsql security definer set search_path = '' as $$
begin
  if p_grace is null or p_grace < interval '0' then raise exception 'invalid_grace' using errcode = 'P0001'; end if;
  with claimed as (
    update public.account_deletion_requests r set status = 'processing'
     where r.status = 'requested' and r.requested_at <= now() - p_grace
    returning r.user_id
  )
  insert into public.audit_log (action, target_user) select 'account_deletion_started', c.user_id from claimed c;
  return query select r.user_id from public.account_deletion_requests r where r.status = 'processing' order by r.requested_at;
end $$;

-- Every stored cloud file of one user, so the worker can remove them through the Storage API before deleting the user.
create function public.cloud_user_objects(p_user uuid)
returns table (name text) language sql stable security definer set search_path = '' as $$
  select o.name from storage.objects o
   where o.bucket_id = 'cloud-backups' and (storage.foldername(o.name))[1] = p_user::text
$$;

-- Written right after the auth user is deleted (the request row is gone with it); keeps only the id and the time.
create function public.record_account_deleted(p_user uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (action, target_user) values ('account_deleted', p_user)
$$;

revoke execute on function public.claim_account_deletions(interval), public.cloud_user_objects(uuid),
  public.record_account_deleted(uuid) from public, anon, authenticated;
grant execute on function public.claim_account_deletions(interval), public.cloud_user_objects(uuid),
  public.record_account_deleted(uuid) to service_role;
