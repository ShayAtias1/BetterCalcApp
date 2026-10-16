import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test, before, beforeEach } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// The real migrations run against an in-process Postgres (PGlite) with a minimal stand-in for
// Supabase's `auth` schema and roles. This proves the SQL and its RLS/grants; it does not replace a
// check against the real project (see docs/SUPABASE-SETUP.md).
const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const migrationSql = () =>
  readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(new URL(f, MIGRATIONS), 'utf8')).join('\n');

const AUTH_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  -- Supabase grants new public tables to the API roles by default; mirror it so the migration's revokes matter.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

let db: PGlite;
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

/** Runs `fn` as an API role with the given JWT subject, then restores the superuser. */
async function as<T>(role: 'anon' | 'authenticated' | 'service_role', sub: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub ?? ''}', false); set role ${role};`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role;');
  }
}
const rows = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;

before(async () => {
  db = new PGlite();
  await db.exec(AUTH_STUB);
  await db.exec(migrationSql());
});

beforeEach(async () => {
  await db.exec('delete from auth.users;');
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@example.com'), ('${B}', 'b@example.com');`);
});

test('creating an auth user creates exactly one profile with safe defaults', async () => {
  const profiles = await rows('select id, locale, terms_accepted_at, created_at, updated_at from public.profiles order by id');
  assert.deepEqual(profiles.map((p) => p.id), [A, B]);
  assert.equal(profiles[0].locale, null);
  assert.equal(profiles[0].terms_accepted_at, null);
  assert.ok(profiles[0].created_at instanceof Date);
});

test('deleting the auth user deletes the profile', async () => {
  await db.exec(`delete from auth.users where id = '${A}'`);
  assert.deepEqual((await rows('select id from public.profiles')).map((p) => p.id), [B]);
});

test('RLS is enabled and only two owner-scoped policies exist', async () => {
  const [table] = await rows(`select relrowsecurity from pg_class where oid = 'public.profiles'::regclass`);
  assert.equal(table.relrowsecurity, true);
  const policies = await rows(`select policyname, cmd, roles::text as roles from pg_policies where tablename = 'profiles' order by cmd`);
  assert.deepEqual(policies.map((p) => p.cmd), ['SELECT', 'UPDATE']);
  for (const p of policies) assert.equal(p.roles, '{authenticated}');
});

test('a user reads only their own profile', async () => {
  const seen = await as('authenticated', A, () => rows('select id from public.profiles'));
  assert.deepEqual(seen.map((p) => p.id), [A]);
  const other = await as('authenticated', A, () => rows(`select id from public.profiles where id = '${B}'`));
  assert.deepEqual(other, []);
});

test('a user can update their own locale and updated_at is maintained by the database', async () => {
  const before = (await rows(`select updated_at from public.profiles where id = '${A}'`))[0].updated_at as Date;
  await new Promise((r) => setTimeout(r, 5));
  await as('authenticated', A, () => db.exec(`update public.profiles set locale = 'he' where id = '${A}'`));
  const [after] = await rows(`select locale, updated_at from public.profiles where id = '${A}'`);
  assert.equal(after.locale, 'he');
  assert.ok((after.updated_at as Date) > before);
});

test('a user cannot update another user, and the attempt changes nothing', async () => {
  const result = await as('authenticated', A, () => db.query(`update public.profiles set locale = 'en' where id = '${B}'`));
  assert.equal(result.affectedRows, 0);
  assert.equal((await rows(`select locale from public.profiles where id = '${B}'`))[0].locale, null);
});

test('a user cannot change protected columns or set an invalid locale', async () => {
  for (const sql of [
    `update public.profiles set terms_accepted_at = now() where id = '${A}'`,
    `update public.profiles set created_at = now() where id = '${A}'`,
    `update public.profiles set id = '${B}' where id = '${A}'`,
    `update public.profiles set updated_at = now() where id = '${A}'`,
  ]) {
    await assert.rejects(as('authenticated', A, () => db.exec(sql)), /permission denied/, sql);
  }
  await assert.rejects(as('authenticated', A, () => db.exec(`update public.profiles set locale = 'fr' where id = '${A}'`)), /check constraint/);
});

test('API roles cannot insert or delete profiles', async () => {
  const C = '33333333-3333-3333-3333-333333333333';
  await assert.rejects(as('authenticated', C, () => db.exec(`insert into public.profiles (id) values ('${C}')`)), /permission denied/);
  await assert.rejects(as('authenticated', A, () => db.exec(`delete from public.profiles where id = '${A}'`)), /permission denied/);
  assert.equal((await rows('select id from public.profiles')).length, 2);
});

test('anonymous visitors cannot read or write profiles', async () => {
  await assert.rejects(as('anon', null, () => rows('select id from public.profiles')), /permission denied/);
  await assert.rejects(as('anon', null, () => db.exec(`update public.profiles set locale = 'he'`)), /permission denied/);
});

test('trigger functions cannot be called by API roles and pin their search_path', async () => {
  for (const fn of ['public.handle_new_user()', 'public.set_updated_at()']) {
    await assert.rejects(as('authenticated', A, () => db.exec(`select ${fn}`)), /permission denied/, fn);
    await assert.rejects(as('anon', null, () => db.exec(`select ${fn}`)), /permission denied/, fn);
  }
  const fns = await rows(`select proname, array_to_string(proconfig, ',') as config, prosecdef from pg_proc where proname in ('handle_new_user', 'set_updated_at')`);
  for (const f of fns) assert.match(String(f.config), /search_path=""/, String(f.proname));
  assert.equal(fns.find((f) => f.proname === 'handle_new_user')?.prosecdef, true);
});

test('the service role (server-side only) can read all profiles', async () => {
  const seen = await as('service_role', null, () => rows('select id from public.profiles'));
  assert.equal(seen.length, 2);
});

test('users that existed before the migration are backfilled, and the backfill is idempotent', async () => {
  const fresh = new PGlite();
  await fresh.exec(AUTH_STUB);
  await fresh.exec(`insert into auth.users (id, email) values ('${A}', 'old@example.com')`);
  await fresh.exec(migrationSql());
  assert.equal((await fresh.query('select id from public.profiles')).rows.length, 1);
  await fresh.exec(`insert into public.profiles (id) select id from auth.users on conflict (id) do nothing`);
  assert.equal((await fresh.query('select id from public.profiles')).rows.length, 1);
});
