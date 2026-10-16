-- Security hardening, part 2: cloud backup quota and file lifecycle, and safer defaults for future objects.
--
-- Closes a quota bypass: a backup reserved small, uploaded large and never completed stopped counting when its
-- reservation expired, yet its file stayed stored and downloadable. Now
--   * every stored file counts at its real size (the larger of reserved and stored) until it is removed, so an
--     abandoned upload uses up the user's own quota instead of free space;
--   * a refused (oversized) upload keeps its row, expired, so the file is counted and cleaned up instead of forgotten;
--   * users may delete their own backups whenever they can still see them (also after a subscription ended).
-- Reading stays as it was (own folder while reading is allowed): Postgres applies SELECT policies to DELETE ... WHERE,
-- which is how the Storage API removes files, so hiding a file from its owner would also stop them deleting it.

-- ---------------------------------------------------------------- usage
-- Bytes a user occupies: completed backups, live reservations, and any file still stored (abandoned or refused uploads)
-- at the larger of its reserved and real size.
create function public.cloud_used_bytes(p_user uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(greatest(b.size_bytes, coalesce((o.metadata ->> 'size')::bigint, 0))), 0)::bigint
    from public.cloud_backups b
    left join storage.objects o on o.bucket_id = 'cloud-backups' and o.name = b.object_path
   where b.user_id = p_user and (b.status = 'complete' or b.reserved_until > now() or o.name is not null)
$$;

create or replace function public.cloud_backup_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  ent public.entitlements;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into ent from public.entitlements where user_id = uid;
  if not found then
    return jsonb_build_object('entitled', false, 'can_read', false, 'can_write', false,
                              'quota_bytes', 0, 'used_bytes', 0, 'status', null);
  end if;
  return jsonb_build_object(
    'entitled', true,
    'status', ent.status,
    'can_write', public.cloud_can_write(),
    'can_read', public.cloud_can_read(),
    'quota_bytes', ent.storage_quota_bytes,
    'used_bytes', public.cloud_used_bytes(uid),
    'ended_at', ent.ended_at,
    'max_file_bytes', public.cloud_backup_max_file_bytes()
  );
end $$;

create or replace function public.reserve_cloud_backup(p_name text, p_size_bytes bigint, p_project_count integer, p_schema_version integer)
returns table (id uuid, object_path text) language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  ent public.entitlements;
  used bigint;
  open_reservations integer;
  new_id uuid := gen_random_uuid();
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  -- Serialises concurrent reservations of one user, so two uploads cannot both squeeze under the quota.
  select * into ent from public.entitlements where user_id = uid for update;
  if not found or ent.status not in ('active', 'grace') then
    raise exception 'not_entitled' using errcode = 'P0001';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > public.cloud_backup_max_file_bytes() then
    raise exception 'file_too_large' using errcode = 'P0001';
  end if;
  select count(*) into open_reservations from public.cloud_backups b
   where b.user_id = uid and b.status = 'pending' and b.reserved_until > now();
  if open_reservations >= 5 then raise exception 'too_many_uploads' using errcode = 'P0001'; end if;
  used := public.cloud_used_bytes(uid);
  if used + p_size_bytes > ent.storage_quota_bytes then raise exception 'quota_exceeded' using errcode = 'P0001'; end if;
  insert into public.cloud_backups (id, user_id, name, object_path, size_bytes, project_count, app_schema_version)
  values (new_id, uid, left(coalesce(nullif(btrim(p_name), ''), 'Project'), 200),
          uid::text || '/' || new_id::text || '.bettercalc', p_size_bytes, greatest(coalesce(p_project_count, 1), 1), p_schema_version);
  return query select b.id, b.object_path from public.cloud_backups b where b.id = new_id;
end $$;

-- A file larger than its reservation is refused as before, but the row is kept with its upload window closed: the
-- file still counts at its real size and can no longer be read, until the client (or the maintenance job) removes it.
create or replace function public.complete_cloud_backup(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  b public.cloud_backups;
  actual bigint;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.cloud_can_write() then raise exception 'not_entitled' using errcode = 'P0001'; end if;
  select * into b from public.cloud_backups where id = p_id and user_id = uid and status = 'pending' for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  select (o.metadata ->> 'size')::bigint into actual
    from storage.objects o where o.bucket_id = 'cloud-backups' and o.name = b.object_path;
  if actual is null then raise exception 'object_missing' using errcode = 'P0001'; end if;
  if actual > b.size_bytes then
    update public.cloud_backups set reserved_until = least(reserved_until, now()) where id = b.id;
    return 'size_mismatch';
  end if;
  update public.cloud_backups set status = 'complete', size_bytes = actual, completed_at = now() where id = b.id;
  return 'complete';
end $$;

-- Deleting one's own backup no longer needs an active subscription: whoever can still see a backup can remove it.
create or replace function public.delete_cloud_backup(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  b public.cloud_backups;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into b from public.cloud_backups where id = p_id and user_id = uid for update;
  if not found then return; end if;
  if exists (select 1 from storage.objects o where o.bucket_id = 'cloud-backups' and o.name = b.object_path) then
    raise exception 'object_exists' using errcode = 'P0001';
  end if;
  delete from public.cloud_backups where id = b.id;
end $$;

revoke execute on function public.cloud_used_bytes(uuid) from public, anon, authenticated;
grant execute on function public.cloud_used_bytes(uuid) to service_role;
-- create or replace keeps grants; restated so this file alone shows who may call what.
revoke execute on function public.cloud_backup_status(), public.reserve_cloud_backup(text, bigint, integer, integer),
  public.complete_cloud_backup(uuid), public.delete_cloud_backup(uuid) from public, anon;
grant execute on function public.cloud_backup_status(), public.reserve_cloud_backup(text, bigint, integer, integer),
  public.complete_cloud_backup(uuid), public.delete_cloud_backup(uuid) to authenticated;

-- ---------------------------------------------------------------- storage policies
-- Delete: own folder, no write entitlement needed. (The read policy still applies to the delete, so this means: whoever
-- can still see their files, including in the 90 days after a subscription ended, can remove them.)
drop policy "cloud-backups: delete own" on storage.objects;
create policy "cloud-backups: delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'cloud-backups'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------- defaults for future objects
-- Supabase grants new tables, sequences and functions in `public` to the API roles by default. Every migration so far
-- revokes and grants explicitly; from now on a forgotten revoke fails closed instead of exposing the object.
-- (Functions also get EXECUTE for PUBLIC from Postgres itself; that cannot be changed per schema without affecting
-- extensions, so migrations keep revoking it explicitly and tests/supabase/schemaGuard.test.ts enforces it.)
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
