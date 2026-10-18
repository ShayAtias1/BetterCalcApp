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

test('each acceptance records its version and a fresh server timestamp, preserving history', async () => {
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
    assert.ok(again.terms_accepted_at.getTime() > first.terms_accepted_at.getTime());
    const history = await as(A, () => q('select document_version, terms_accepted_at from public.legal_consents order by terms_accepted_at'));
    assert.deepEqual(history.map((r) => r.document_version), ['v1', 'v2']);
    assert.equal(history[0].terms_accepted_at.getTime(), first.terms_accepted_at.getTime());
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

test('consent history is append-only for API users, private to its owner, and recorded once per version', async () => {
  await as(A, () => db.exec("select public.complete_onboarding('Dana', 'pending')"));
  const first = (await q(`select terms_accepted_at, privacy_accepted_at, onboarding_completed_at from public.profiles where id = '${A}'`))[0];
  await as(A, () => db.exec("select public.complete_onboarding('Dana R', 'pending')")); // repeat: name may change, consent may not
  const history = await as(A, () => q('select * from public.legal_consents order by terms_accepted_at'));
  assert.equal(history.length, 1);
  assert.ok(history.every((r) => r.document_version === 'pending' && r.source === 'explicit'));
  const after = (await q(`select display_name, terms_accepted_at, privacy_accepted_at, onboarding_completed_at from public.profiles where id = '${A}'`))[0];
  assert.equal(after.display_name, 'Dana R');
  assert.equal(after.terms_accepted_at.getTime(), first.terms_accepted_at.getTime()); // original server timestamps kept
  assert.equal(after.privacy_accepted_at.getTime(), first.privacy_accepted_at.getTime());
  assert.equal(after.onboarding_completed_at.getTime(), first.onboarding_completed_at.getTime());
  assert.equal(history[0].terms_accepted_at.getTime(), first.terms_accepted_at.getTime());
  assert.equal((await as(B, () => q('select * from public.legal_consents'))).length, 0);
  await assert.rejects(as(A, () => db.exec(`insert into public.legal_consents (user_id, source) values ('${A}', 'legacy')`)), /permission denied/);
  await assert.rejects(as(A, () => db.exec("update public.legal_consents set document_version = 'fake'")), /permission denied/);
  await assert.rejects(as(A, () => db.exec('delete from public.legal_consents')), /permission denied/);
  await assert.rejects(as(A, () => db.exec("select public.complete_onboarding('Dana', 'fake')")), /invalid_version/);
  assert.equal((await as(A, () => q('select * from public.legal_consents'))).length, 1);
});

test('adversarial: hundreds of repeated and concurrent acceptances leave one row per user and version', async () => {
  for (let i = 0; i < 200; i++) await as(A, () => db.exec(`select public.complete_onboarding('Dana ${i}', 'pending')`));
  for (let i = 0; i < 20; i++) await as(B, () => db.exec("select public.complete_onboarding('Bo', ' pending ')")); // trimmed to the same version
  assert.deepEqual((await q('select user_id::text, count(*)::int as n from public.legal_consents group by 1 order by 1')).map((r) => [r.user_id, r.n]),
    [[A, 1], [B, 1]]);
  // The unique index is the backstop even if the function were bypassed (service role / future code).
  await assert.rejects(db.exec(`insert into public.legal_consents (user_id, document_version, terms_accepted_at, privacy_accepted_at, source)
    values ('${A}', 'pending', now(), now(), 'explicit')`), /legal_consents_explicit_once/);
  // A new document version is genuine new consent and adds exactly one row, once.
  await setLegalVersion('v2');
  try {
    for (let i = 0; i < 5; i++) await as(A, () => db.exec("select public.complete_onboarding('Dana', 'v2')"));
    assert.deepEqual((await q(`select document_version from public.legal_consents where user_id = '${A}' order by terms_accepted_at`)).map((r) => r.document_version), ['pending', 'v2']);
    assert.equal((await q(`select terms_version from public.profiles where id = '${A}'`))[0].terms_version, 'v2');
  } finally { await setLegalVersion(null); }
});

test('the migration preserves legacy versions and timestamps without fabricating missing evidence', async () => {
  const legacy = new PGlite();
  try {
    await legacy.exec(AUTH_STUB);
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
    const at = files.findIndex((f) => f.includes('early_access_legal_consent'));
    const [last] = files.splice(at, 1); // the legal-consent migration; later ones run after it
    await legacy.exec(files.slice(0, at).map((f) => readFileSync(new URL(f, MIGRATIONS), 'utf8')).join('\n'));
    await legacy.exec(`insert into auth.users(id) values ('${A}'), ('${B}');
      update public.profiles set terms_version = 'v0', terms_accepted_at = '2026-01-02T03:04:05Z', privacy_accepted_at = '2026-01-02T03:04:06Z' where id = '${A}';
      update public.profiles set terms_accepted_at = '2026-01-01T00:00:00Z' where id = '${B}';`);
    await legacy.exec([last, ...files.slice(at)].map((f) => readFileSync(new URL(f, MIGRATIONS), 'utf8')).join('\n'));
    const rows = (await legacy.query<Record<string, any>>('select * from public.legal_consents order by user_id')).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].document_version, 'v0');
    assert.equal(rows[0].terms_accepted_at.toISOString(), '2026-01-02T03:04:05.000Z');
    assert.equal(rows[0].privacy_accepted_at.toISOString(), '2026-01-02T03:04:06.000Z');
    assert.equal(rows[1].document_version, null);
    assert.equal(rows[1].privacy_accepted_at, null);
    assert.ok(rows.every((r) => r.source === 'legacy'));
  } finally { await legacy.close(); }
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
