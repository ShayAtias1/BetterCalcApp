import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test, before } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { AUTH_STUB } from './supabaseStub.ts';

// Schema-wide guards over the real migrations: a new table without row-level security, or a new function an API role
// can call without being on the list below, fails here instead of reaching production.
const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const migrationSql = () =>
  readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(new URL(f, MIGRATIONS), 'utf8')).join('\n');

let db: PGlite;
const q = async (sql: string) => (await db.query<Record<string, any>>(sql)).rows;

before(async () => {
  db = new PGlite();
  await db.exec(AUTH_STUB);
  await db.exec(migrationSql());
});

/** Functions the browser may call. Anything else in `public` must be callable by the service role only (or nobody). */
const ANON_FUNCTIONS = ['commercial_flags'];
const AUTHENTICATED_FUNCTIONS = [
  'account_overview', 'cancel_account_deletion', 'clean_display_name', 'cloud_backup_max_file_bytes', 'cloud_backup_status',
  'cloud_can_read', 'cloud_can_write', 'commercial_flags', 'complete_cloud_backup', 'complete_onboarding', 'delete_cloud_backup',
  'request_account_deletion', 'reserve_cloud_backup',
];

const callable = async (role: string) =>
  (await q(`select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
              and has_function_privilege('${role}', p.oid, 'execute') order by 1`)).map((r) => r.proname);

test('every table in public has row-level security enabled', async () => {
  const tables = await q(`select c.relname, c.relrowsecurity from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by 1`);
  assert.ok(tables.length >= 16);
  assert.deepEqual(tables.filter((t) => !t.relrowsecurity).map((t) => t.relname), []);
});

test('API roles can call only the listed functions (PUBLIC execute included)', async () => {
  assert.deepEqual(await callable('anon'), ANON_FUNCTIONS);
  assert.deepEqual(await callable('authenticated'), AUTHENTICATED_FUNCTIONS);
});

test('every SECURITY DEFINER function in public pins its search_path', async () => {
  const loose = await q(`select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
  assert.deepEqual(loose, []);
});

test('API roles never delete or truncate tables directly, and insert only their invoice details', async () => {
  const rows = await q(`select c.relname, r.role,
      has_table_privilege(r.role, c.oid, 'insert') as ins, has_table_privilege(r.role, c.oid, 'delete') as del,
      has_table_privilege(r.role, c.oid, 'truncate') as trunc
    from pg_class c cross join (values ('anon'), ('authenticated')) r(role)
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'`);
  assert.deepEqual(rows.filter((r) => r.del || r.trunc).map((r) => `${r.role}:${r.relname}`), []);
  assert.deepEqual(rows.filter((r) => r.ins).map((r) => `${r.role}:${r.relname}`), ['authenticated:billing_profiles']);
});

test('future tables and sequences in public are not exposed to API roles unless a migration grants them', async () => {
  await db.exec('create table public.zz_future (id bigint generated always as identity primary key)');
  try {
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        assert.equal((await q(`select has_table_privilege('${role}', 'public.zz_future', '${priv}') as ok`))[0].ok, false, `${role} ${priv}`);
      }
      assert.equal((await q(`select has_sequence_privilege('${role}', 'public.zz_future_id_seq', 'usage') as ok`))[0].ok, false);
    }
    assert.equal((await q(`select has_table_privilege('service_role', 'public.zz_future', 'select') as ok`))[0].ok, true);
  } finally {
    await db.exec('drop table public.zz_future');
  }
});
