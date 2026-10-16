import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test, before, beforeEach } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { AUTH_STUB } from './supabaseStub.ts';

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const migrationSql = () =>
  readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(new URL(f, MIGRATIONS), 'utf8')).join('\n');
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

let db: PGlite;
async function as<T>(sub: string | null, fn: () => Promise<T>, role = 'authenticated'): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub ?? ''}', false); set role ${role};`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
}
const q = async (sql: string) => (await db.query<Record<string, any>>(sql)).rows;

before(async () => {
  db = new PGlite();
  await db.exec(AUTH_STUB);
  await db.exec(migrationSql());
});
beforeEach(async () => {
  await db.exec('delete from auth.users;');
  await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values
    ('${A}', 'a@x.co', '{"full_name": "  Dana\\nLevi  "}'),
    ('${B}', 'b@x.co', '{"name": "Google Name"}');`);
});

test('the profile takes a clean name from sign-up metadata (email form or Google)', async () => {
  const names = await q('select id, display_name from public.profiles order by id');
  assert.deepEqual(names.map((n) => n.display_name), ['Dana Levi', 'Google Name']);
  await db.exec("insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333', 'c@x.co')");
  assert.equal((await q("select display_name from public.profiles where id = '33333333-3333-3333-3333-333333333333'"))[0].display_name, null);
});

test('the owner can edit their name but not consent or onboarding columns', async () => {
  await as(A, () => db.exec("update public.profiles set display_name = 'New Name' where id = '" + A + "'"));
  assert.equal((await q(`select display_name from public.profiles where id = '${A}'`))[0].display_name, 'New Name');
  for (const col of ['terms_accepted_at', 'privacy_accepted_at', 'onboarding_completed_at']) {
    await assert.rejects(as(A, () => db.exec(`update public.profiles set ${col} = now() where id = '${A}'`)), /permission denied/);
  }
  await assert.rejects(as(A, () => db.exec(`update public.profiles set terms_version = 'x' where id = '${A}'`)), /permission denied/);
  await assert.rejects(as(A, () => db.exec(`update public.profiles set display_name = '' where id = '${A}'`)), /check constraint/);
  await assert.rejects(as(A, () => db.exec(`update public.profiles set display_name = '${'x'.repeat(81)}' where id = '${A}'`)), /check constraint/);
});

const setLegalVersion = (v: string | null) =>
  db.exec(`update public.commercial_settings set value = ${v === null ? "'null'" : `to_jsonb('${v}'::text)`} where key = 'legal_version'`);

test('onboarding records name and consent with the server clock, once', async () => {
  await setLegalVersion('v1');
  try {
    await as(A, () => db.exec("select public.complete_onboarding('  Dana  ', 'v1')"));
    const first = (await q(`select display_name, terms_version, terms_accepted_at, privacy_accepted_at, onboarding_completed_at from public.profiles where id = '${A}'`))[0];
    assert.equal(first.display_name, 'Dana');
    assert.equal(first.terms_version, 'v1');
    assert.ok(first.terms_accepted_at instanceof Date && first.onboarding_completed_at instanceof Date);
    await setLegalVersion('v2');
    await as(A, () => db.exec("select public.complete_onboarding('Dana L', 'v2')"));
    const again = (await q(`select display_name, terms_version, terms_accepted_at from public.profiles where id = '${A}'`))[0];
    assert.deepEqual([again.display_name, again.terms_version], ['Dana L', 'v2']);
    assert.equal(again.terms_accepted_at.getTime(), first.terms_accepted_at.getTime()); // first agreement time is kept
    assert.equal((await q(`select onboarding_completed_at from public.profiles where id = '${B}'`))[0].onboarding_completed_at, null);
  } finally {
    await setLegalVersion(null);
  }
});

test('onboarding rejects empty names, missing versions and anonymous callers', async () => {
  await assert.rejects(as(A, () => db.exec("select public.complete_onboarding('   ', 'pending')")), /invalid_name/);
  await assert.rejects(as(A, () => db.exec("select public.complete_onboarding('Dana', '')")), /invalid_version/);
  await assert.rejects(as(A, () => db.exec("select public.complete_onboarding('Dana', null)")), /invalid_version/);
  await assert.rejects(as(null, () => db.exec("select public.complete_onboarding('Dana', 'pending')"), 'anon'), /permission denied/);
});

test('consent is recorded only against the version the server announces', async () => {
  // Before the texts are published only the app's placeholder is accepted.
  await assert.rejects(as(A, () => db.exec("select public.complete_onboarding('Dana', 'v9')")), /invalid_version/);
  await as(A, () => db.exec("select public.complete_onboarding('Dana', ' pending ')"));
  assert.equal((await q(`select terms_version from public.profiles where id = '${A}'`))[0].terms_version, 'pending');
  await setLegalVersion('2026-11');
  try {
    for (const wrong of ['pending', '2026-10', '2026-11x']) {
      await assert.rejects(as(B, () => db.exec(`select public.complete_onboarding('Bo', '${wrong}')`)), /invalid_version/, wrong);
    }
    assert.equal((await q(`select onboarding_completed_at from public.profiles where id = '${B}'`))[0].onboarding_completed_at, null);
    await as(B, () => db.exec("select public.complete_onboarding('Bo', '2026-11')"));
    assert.equal((await q(`select terms_version from public.profiles where id = '${B}'`))[0].terms_version, '2026-11');
  } finally {
    await setLegalVersion(null);
  }
});

test('deletion requests: own only, cancellable, and listed for the service role', async () => {
  await as(A, () => db.exec('select public.request_account_deletion()'));
  await as(A, () => db.exec('select public.request_account_deletion()')); // idempotent
  assert.equal((await as(A, () => q('select * from public.account_deletion_requests'))).length, 1);
  assert.equal((await as(B, () => q('select * from public.account_deletion_requests'))).length, 0);
  await assert.rejects(as(A, () => db.exec('delete from public.account_deletion_requests')), /permission denied/);
  await assert.rejects(as(A, () => db.exec("update public.account_deletion_requests set status = 'processing'")), /permission denied/);
  await assert.rejects(as(A, () => q('select * from public.pending_account_deletions()')), /permission denied/);
  const pending = await as(null, () => q('select * from public.pending_account_deletions()'), 'service_role');
  assert.deepEqual(pending.map((p) => p.user_id), [A]);
  await as(A, () => db.exec('select public.cancel_account_deletion()'));
  assert.equal((await q('select status from public.account_deletion_requests'))[0].status, 'cancelled');
  assert.equal((await as(null, () => q('select * from public.pending_account_deletions()'), 'service_role')).length, 0);
  await as(A, () => db.exec('select public.request_account_deletion()')); // can ask again after cancelling
  assert.equal((await q('select status from public.account_deletion_requests'))[0].status, 'requested');
  await db.exec("update public.account_deletion_requests set status = 'processing'");
  await as(A, () => db.exec('select public.cancel_account_deletion()')); // too late once processing
  assert.equal((await q('select status from public.account_deletion_requests'))[0].status, 'processing');
});

test('the deletion worker claims requests after the grace period, only as the service role', async () => {
  await as(A, () => db.exec('select public.request_account_deletion()'));
  await as(B, () => db.exec('select public.request_account_deletion()'));
  await as(B, () => db.exec('select public.cancel_account_deletion()'));
  for (const fn of ["claim_account_deletions('0 days')", `cloud_user_objects('${A}')`, `record_account_deleted('${A}')`]) {
    await assert.rejects(as(A, () => q(`select * from public.${fn}`)), /permission denied/, fn);
    await assert.rejects(as(null, () => q(`select * from public.${fn}`), 'anon'), /permission denied/, fn);
  }
  const claim = (grace: string) => as(null, () => q(`select * from public.claim_account_deletions('${grace}')`), 'service_role');
  assert.deepEqual(await claim('7 days'), []); // still inside the grace period: the user can cancel
  assert.equal((await q(`select status from public.account_deletion_requests where user_id = '${A}'`))[0].status, 'requested');
  await db.exec(`update public.account_deletion_requests set requested_at = now() - interval '8 days'`);
  assert.deepEqual((await claim('7 days')).map((r) => r.user_id), [A]); // the cancelled request is never claimed
  assert.equal((await q(`select status from public.account_deletion_requests where user_id = '${A}'`))[0].status, 'processing');
  await as(A, () => db.exec('select public.cancel_account_deletion()'));
  assert.equal((await q(`select status from public.account_deletion_requests where user_id = '${A}'`))[0].status, 'processing');
  assert.deepEqual((await claim('7 days')).map((r) => r.user_id), [A]); // retried until done
  await assert.rejects(claim('-1 days'), /invalid_grace/);
  await as(null, () => db.exec(`select public.record_account_deleted('${A}')`), 'service_role');
  const audit = await q(`select action from public.audit_log where target_user = '${A}' order by id`);
  assert.deepEqual(audit.map((a) => a.action).slice(-2), ['account_deletion_started', 'account_deleted']);
});

test('deleting the auth user removes the profile and the request', async () => {
  await as(A, () => db.exec('select public.request_account_deletion()'));
  await db.exec(`delete from auth.users where id = '${A}'`);
  assert.equal((await q('select * from public.account_deletion_requests')).length, 0);
  assert.equal((await q(`select * from public.profiles where id = '${A}'`)).length, 0);
});

test('commercial features are off by default and visible to everyone as flags only', async () => {
  const flags = await as(null, async () => (await q('select public.commercial_flags() as f'))[0].f, 'anon');
  assert.deepEqual(flags, { ai_enabled: false, payments_enabled: false, credit_purchases_enabled: false, legal_version: null });
  await assert.rejects(as(A, () => q('select * from public.commercial_settings')), /permission denied/);
  await assert.rejects(as(A, () => db.exec("update public.commercial_settings set value = 'true'")), /permission denied/);
  await db.exec("update public.commercial_settings set value = 'true' where key = 'ai_enabled'");
  assert.equal((await as(A, async () => (await q('select public.commercial_flags() as f'))[0].f)).ai_enabled, true);
});

test('API users cannot probe individual settings', async () => {
  await assert.rejects(as(A, () => q("select public.commercial_flag('credit_spend_order')")), /permission denied/);
});

test('new functions pin their search_path', async () => {
  const rows = await q(`select p.proname, array_to_string(p.proconfig, ',') as cfg from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('clean_display_name','complete_onboarding','request_account_deletion','cancel_account_deletion','pending_account_deletions','commercial_flags','commercial_flag','handle_new_user')`);
  assert.equal(rows.length, 8);
  for (const r of rows) assert.match(r.cfg, /search_path=/, r.proname);
});
