-- Red-team follow-up. Nothing here changes data, commercial switches or any other permission.

-- ---------------------------------------------------------------- cloud backups: download completed files only
-- The read policy let an owner download any object in their folder, including uploads that never completed or were
-- refused as oversized (kept only so they count against the quota until removed). Downloads and listings now need a
-- completed backup row for the exact path. Storage evaluates the SELECT policy for DELETE ... WHERE and for the
-- INSERT ... RETURNING of an upload as well, so those two Storage operations stay allowed: owners can still upload
-- and remove abandoned or refused files, they just cannot read them back out.
-- storage.operation() is set by Storage per request ('storage.object.get_authenticated', 'storage.object.delete_many', ...)
-- and is null in plain SQL,
-- so anything else fails closed.
drop policy "cloud-backups: read own" on storage.objects;
create policy "cloud-backups: read own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'cloud-backups'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.cloud_can_read()
    and (
      coalesce(storage.operation(), '') in
        ('storage.object.upload', 'storage.object.delete', 'storage.object.delete_many')
      or exists (
        select 1 from public.cloud_backups b
        where b.user_id = (select auth.uid()) and b.object_path = objects.name and b.status = 'complete'
      )
    )
  );

-- ---------------------------------------------------------------- sequences
-- Identity sequences (credit_ledger, audit_log) were granted to the API roles by Supabase's old default. Only
-- security-definer functions and the service role ever advance them.
revoke all on all sequences in schema public from public, anon, authenticated;
