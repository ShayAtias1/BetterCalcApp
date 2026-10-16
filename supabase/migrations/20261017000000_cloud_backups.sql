-- Phase 2: cloud backups of .bettercalc files. Manual, per project, subscribers only.
-- Everything that matters is decided here on the server: who is entitled, how much space they have,
-- and which object path an upload may use. The browser holds only the publishable key.
--
-- Rules from the Commercial Roadmap HANDOFF:
--   * 1 GB of cloud storage per subscriber (entitlements.storage_quota_bytes, default below).
--   * Active or grace-period subscription: read and write.
--   * Ended subscription: read and download only, for 90 days.
--   * No entitlement: no cloud access at all. Local data is never involved.

-- ---------------------------------------------------------------- entitlements
-- One row per subscriber. Written only by trusted server code (the service role, and later the billing
-- webhook). Until billing exists, 'test' rows are inserted by hand, see docs/SUPABASE-SETUP.md.
create table public.entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null check (status in ('active', 'grace', 'ended')),
  source text not null check (source in ('test', 'billing')),
  storage_quota_bytes bigint not null default 1073741824 check (storage_quota_bytes >= 0),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'ended' or ended_at is not null)
);

alter table public.entitlements enable row level security;
revoke all on table public.entitlements from anon, authenticated;
grant select on table public.entitlements to authenticated;
create policy "entitlements: read own" on public.entitlements
  for select to authenticated
  using (user_id = (select auth.uid()));

create trigger entitlements_set_updated_at
  before update on public.entitlements
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- backups
create table public.cloud_backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The user's own project name, shown in the list. Not used for any decision.
  name text not null check (char_length(name) between 1 and 200),
  object_path text not null unique,
  size_bytes bigint not null check (size_bytes > 0),
  project_count integer not null default 1 check (project_count > 0),
  app_schema_version integer,
  status text not null default 'pending' check (status in ('pending', 'complete')),
  -- A pending reservation stops counting (and stops allowing the upload) after this time.
  reserved_until timestamptz not null default now() + interval '1 hour',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (object_path = user_id::text || '/' || id::text || '.bettercalc')
);

create index cloud_backups_user_idx on public.cloud_backups (user_id, created_at desc);

alter table public.cloud_backups enable row level security;
revoke all on table public.cloud_backups from anon, authenticated;
grant select on table public.cloud_backups to authenticated;

-- ---------------------------------------------------------------- entitlement checks
-- No arguments on purpose: they answer only about the caller, so they cannot be used to probe others.
create function public.cloud_can_write()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.entitlements e
    where e.user_id = (select auth.uid()) and e.status in ('active', 'grace')
  );
$$;

create function public.cloud_can_read()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.entitlements e
    where e.user_id = (select auth.uid())
      and (e.status in ('active', 'grace') or (e.status = 'ended' and e.ended_at + interval '90 days' > now()))
  );
$$;

create policy "cloud_backups: read own" on public.cloud_backups
  for select to authenticated
  using (user_id = (select auth.uid()) and public.cloud_can_read());

-- ---------------------------------------------------------------- RPCs
-- Per-file ceiling; matches the app's 300 MB backup limit plus the manifest allowance.
create function public.cloud_backup_max_file_bytes()
returns bigint language sql immutable set search_path = '' as $$ select 335544320::bigint $$;

create function public.cloud_backup_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  ent public.entitlements;
  used bigint;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into ent from public.entitlements where user_id = uid;
  if not found then
    return jsonb_build_object('entitled', false, 'can_read', false, 'can_write', false,
                              'quota_bytes', 0, 'used_bytes', 0, 'status', null);
  end if;
  select coalesce(sum(size_bytes), 0) into used from public.cloud_backups
   where user_id = uid and (status = 'complete' or reserved_until > now());
  return jsonb_build_object(
    'entitled', true,
    'status', ent.status,
    'can_write', public.cloud_can_write(),
    'can_read', public.cloud_can_read(),
    'quota_bytes', ent.storage_quota_bytes,
    'used_bytes', used,
    'ended_at', ent.ended_at,
    'max_file_bytes', public.cloud_backup_max_file_bytes()
  );
end $$;

-- Step 1 of an upload: checks entitlement and quota, then reserves the space and the one object path the
-- upload may use. Nothing is stored yet.
create function public.reserve_cloud_backup(p_name text, p_size_bytes bigint, p_project_count integer, p_schema_version integer)
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
  select coalesce(sum(b.size_bytes), 0), count(*) filter (where b.status = 'pending')
    into used, open_reservations
    from public.cloud_backups b
   where b.user_id = uid and (b.status = 'complete' or b.reserved_until > now());
  if open_reservations >= 5 then raise exception 'too_many_uploads' using errcode = 'P0001'; end if;
  if used + p_size_bytes > ent.storage_quota_bytes then raise exception 'quota_exceeded' using errcode = 'P0001'; end if;
  insert into public.cloud_backups (id, user_id, name, object_path, size_bytes, project_count, app_schema_version)
  values (new_id, uid, left(coalesce(nullif(btrim(p_name), ''), 'Project'), 200),
          uid::text || '/' || new_id::text || '.bettercalc', p_size_bytes, greatest(coalesce(p_project_count, 1), 1), p_schema_version);
  return query select b.id, b.object_path from public.cloud_backups b where b.id = new_id;
end $$;

-- Step 3: after the upload, checks the stored object really exists and fits the reservation, then makes the
-- backup count and show up. A backup that was never completed never appears and stops counting when
-- its reservation expires.
create function public.complete_cloud_backup(p_id uuid)
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
    -- More than was reserved: refuse and release the reservation (returned, not raised, so the release
    -- is kept). The caller removes the object.
    delete from public.cloud_backups where id = b.id;
    return 'size_mismatch';
  end if;
  update public.cloud_backups set status = 'complete', size_bytes = actual, completed_at = now() where id = b.id;
  return 'complete';
end $$;

-- Removes a backup's row, only once its file is gone (the client deletes the file through Storage first).
-- Needs write access: after a subscription ends the cloud is read-only.
create function public.delete_cloud_backup(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  b public.cloud_backups;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.cloud_can_write() then raise exception 'not_entitled' using errcode = 'P0001'; end if;
  select * into b from public.cloud_backups where id = p_id and user_id = uid for update;
  if not found then return; end if;
  if exists (select 1 from storage.objects o where o.bucket_id = 'cloud-backups' and o.name = b.object_path) then
    raise exception 'object_exists' using errcode = 'P0001';
  end if;
  delete from public.cloud_backups where id = b.id;
end $$;

-- Maintenance for trusted server code only: drops reservations that expired without an upload.
-- (Objects uploaded but never completed are listed by cloud_orphan_objects and removed through the Storage API.)
create function public.cleanup_stale_cloud_backups()
returns integer language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  delete from public.cloud_backups b
   where b.status = 'pending' and b.reserved_until <= now()
     and not exists (select 1 from storage.objects o where o.bucket_id = 'cloud-backups' and o.name = b.object_path);
  get diagnostics removed = row_count;
  return removed;
end $$;

create function public.cloud_orphan_objects()
returns table (name text) language sql stable security definer set search_path = '' as $$
  select o.name from storage.objects o
   where o.bucket_id = 'cloud-backups'
     and not exists (select 1 from public.cloud_backups b where b.object_path = o.name and (b.status = 'complete' or b.reserved_until > now()));
$$;

-- ---------------------------------------------------------------- function privileges
revoke execute on function
  public.cloud_can_write(), public.cloud_can_read(), public.cloud_backup_max_file_bytes(), public.cloud_backup_status(),
  public.reserve_cloud_backup(text, bigint, integer, integer), public.complete_cloud_backup(uuid),
  public.delete_cloud_backup(uuid), public.cleanup_stale_cloud_backups(), public.cloud_orphan_objects()
  from public, anon, authenticated;
grant execute on function
  public.cloud_can_write(), public.cloud_can_read(), public.cloud_backup_status(),
  public.reserve_cloud_backup(text, bigint, integer, integer), public.complete_cloud_backup(uuid),
  public.delete_cloud_backup(uuid)
  to authenticated;
-- cloud_backup_max_file_bytes is called by the functions above (definer) and by nobody else.
grant execute on function public.cloud_backup_max_file_bytes() to authenticated;
grant execute on function public.cleanup_stale_cloud_backups(), public.cloud_orphan_objects() to service_role;

-- ---------------------------------------------------------------- private bucket and its policies
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cloud-backups', 'cloud-backups', false, 335544320, array['application/octet-stream'])
on conflict (id) do nothing;

-- Upload: only to the exact path of a live reservation of the caller's own, and only while entitled.
-- There is no update policy, so an existing object can never be overwritten.
create policy "cloud-backups: upload to reserved path" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'cloud-backups'
    and public.cloud_can_write()
    and exists (
      select 1 from public.cloud_backups b
      where b.user_id = (select auth.uid()) and b.object_path = objects.name
        and b.status = 'pending' and b.reserved_until > now()
    )
  );

-- Download and list: own folder, any time while reading is allowed (including the 90 days after a subscription ends).
create policy "cloud-backups: read own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'cloud-backups'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.cloud_can_read()
  );

-- Delete: own folder, writers only.
create policy "cloud-backups: delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'cloud-backups'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.cloud_can_write()
  );
