-- READ ONLY. Run after the approved migration; never invoke maintenance here.
begin transaction read only;
select version, name from supabase_migrations.schema_migrations order by version;
select public.commercial_flags();
select to_regclass('public.legal_consents') as consent_history_table;
select schemaname, tablename, rowsecurity from pg_tables
 where schemaname = 'public' and tablename in
 ('profiles','legal_consents','billing_profiles','entitlements','cloud_backups','commercial_settings');
select tablename, policyname, roles, cmd, qual, with_check from pg_policies
 where schemaname = 'public' and tablename in ('profiles','legal_consents','billing_profiles','cloud_backups');
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'cloud-backups';
select count(*) as cloud_entitlement_records from public.entitlements;
select count(*) as registered_accounts,
 count(*) filter (where raw_app_meta_data->>'provider' = 'google'
 or raw_app_meta_data->'providers' ? 'google') as google_accounts from auth.users;
select date_trunc('day', created_at) as registration_day, count(*) as registrations
 from auth.users group by 1 order by 1 desc;
select count(*) as accounts_without_profile from auth.users u
 left join public.profiles p on p.id = u.id where p.id is null;
select tgname, tgenabled from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;
select count(*) as retained_consent_records from public.legal_consents;
select jobid, jobname, schedule, active from cron.job where jobname = 'account-maintenance';
select r.jobid, r.status, r.start_time, r.end_time from cron.job_run_details r
 join cron.job j on j.jobid = r.jobid where j.jobname = 'account-maintenance'
 order by r.start_time desc limit 5;
commit;
