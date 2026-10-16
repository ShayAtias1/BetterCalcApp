import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test, before, beforeEach } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { AUTH_STUB } from './supabaseStub.ts';

// The commercial model, run in an in-process Postgres. Flags are switched on only inside this test database
// to exercise logic that is off in the product.
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
const svc = <T>(fn: () => Promise<T>) => as(null, fn, 'service_role');
const q = async (sql: string) => (await db.query<Record<string, any>>(sql)).rows;
const setFlag = (key: string, value: string) => db.exec(`update public.commercial_settings set value = '${value}' where key = '${key}'`);
const wallet = async (uid = A) => {
  const [w] = await q(`select purchased_balance::int as p, monthly_balance::int as m from public.credit_wallets where user_id = '${uid}'`);
  return [w.p, w.m];
};

before(async () => {
  db = new PGlite();
  await db.exec(AUTH_STUB);
  await db.exec(migrationSql());
});
beforeEach(async () => {
  await db.exec(`delete from public.payment_events; delete from public.payments; delete from public.ai_usage; delete from public.credit_ledger;
    delete from public.subscriptions; delete from public.entitlements; delete from public.audit_log; delete from public.prices;
    delete from public.plans; delete from public.credit_packs; delete from auth.users;`);
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@x.co'), ('${B}', 'b@x.co');`);
  await db.exec(`update public.commercial_settings set value = 'false' where key in ('ai_enabled','payments_enabled','credit_purchases_enabled');
    update public.commercial_settings set value = 'null' where key = 'credit_spend_order';`);
});

test('nothing is for sale: no plans, packs or prices exist, and every user has an empty wallet', async () => {
  assert.equal((await q('select count(*)::int as n from public.plans'))[0].n, 0);
  assert.equal((await q('select count(*)::int as n from public.credit_packs'))[0].n, 0);
  assert.equal((await q('select count(*)::int as n from public.prices'))[0].n, 0);
  assert.deepEqual(await wallet(A), [0, 0]);
  assert.deepEqual(await wallet(B), [0, 0]);
});

test('only public plans and active prices are visible, and the catalogue is read-only for clients', async () => {
  await db.exec(`insert into public.plans (code, name_he, name_en, is_public) values ('pro', 'א', 'Pro', true), ('hidden', 'ב', 'Hidden', false);
    insert into public.prices (product_kind, product_code, billing_interval, currency, amount_minor, active) values
      ('plan', 'pro', 'month', 'ILS', 100, true), ('plan', 'pro', 'year', 'ILS', 1000, false), ('plan', 'hidden', 'month', 'ILS', 1, true);`);
  assert.deepEqual((await as(null, () => q('select code from public.plans'), 'anon')).map((p) => p.code), ['pro']);
  assert.equal((await as(A, () => q('select * from public.prices'))).length, 1);
  await assert.rejects(as(A, () => db.exec("insert into public.plans (code, name_he, name_en) values ('x1', 'a', 'b')")), /permission denied/);
  await assert.rejects(as(A, () => db.exec("update public.prices set amount_minor = 1")), /permission denied/);
});

test('users read only their own commercial rows; they cannot write any of them', async () => {
  await db.exec(`insert into public.plans (code, name_he, name_en) values ('pro', 'א', 'Pro');
    insert into public.subscriptions (user_id, plan_code, status, billing_interval, provider, provider_subscription_ref) values ('${A}', 'pro', 'active', 'month', 'test', 's1');
    insert into public.payments (user_id, kind, provider, provider_payment_ref, status, amount_minor, currency) values ('${A}', 'subscription', 'test', 'p1', 'paid', 1, 'ILS');`);
  await svc(() => db.exec(`select public.credit_apply('${A}', 'purchased', 5, 'adjustment', 'k1')`));
  for (const table of ['subscriptions', 'payments', 'credit_wallets', 'credit_ledger']) {
    assert.equal((await as(A, () => q(`select * from public.${table}`))).length, 1, table);
    assert.equal((await as(B, () => q(`select * from public.${table}`))).length, table === 'credit_wallets' ? 1 : 0, table);
    await assert.rejects(as(A, () => db.exec(`delete from public.${table}`)), /permission denied/, table);
  }
  await assert.rejects(as(A, () => db.exec('update public.credit_wallets set purchased_balance = 999')), /permission denied/);
  await assert.rejects(as(A, () => db.exec("update public.subscriptions set status = 'ended'")), /permission denied/);
  await assert.rejects(as(A, () => q('select * from public.payment_events')), /permission denied/);
  await assert.rejects(as(A, () => q('select * from public.audit_log')), /permission denied/);
  await assert.rejects(as(null, () => q('select * from public.payments'), 'anon'), /permission denied/);
});

test('credit functions cannot be called by API roles', async () => {
  for (const sql of [
    `select public.credit_apply('${A}', 'purchased', 5, 'adjustment', 'x')`,
    `select public.credit_admin_grant('${A}', 'purchased', 5, 'x')`,
    `select public.ai_reserve('${A}', 'multi_plan', 1, 1, 'k')`,
    `select public.sync_entitlement('${A}')`,
    `select public.record_payment_event('p', 'e', 't', '{}')`,
  ]) {
    await assert.rejects(as(A, () => db.exec(sql)), /permission denied/, sql);
    await assert.rejects(as(null, () => db.exec(sql), 'anon'), /permission denied/, sql);
  }
});

test('credit operations are idempotent and balances can never go negative', async () => {
  await svc(() => db.exec(`select public.credit_apply('${A}', 'purchased', 10, 'adjustment', 'k1')`));
  assert.equal(await svc(async () => (await q(`select public.credit_apply('${A}', 'purchased', 10, 'adjustment', 'k1') as r`))[0].r), false);
  assert.deepEqual(await wallet(), [10, 0]);
  await assert.rejects(svc(() => db.exec(`select public.credit_apply('${A}', 'purchased', -11, 'adjustment', 'k2')`)), /insufficient_credits/);
  await svc(() => db.exec(`select public.credit_apply('${A}', 'purchased', -10, 'adjustment', 'k3')`));
  assert.deepEqual(await wallet(), [0, 0]);
  assert.equal((await q('select count(*)::int as n from public.credit_ledger'))[0].n, 2);
});

test('monthly credits are replaced at renewal, never accumulated, and purchased ones are untouched', async () => {
  await svc(() => db.exec(`select public.credit_apply('${A}', 'purchased', 7, 'adjustment', 'p')`));
  await svc(() => db.exec(`select public.credit_grant_monthly('${A}', 100, now() + interval '30 days', 'period1')`));
  assert.deepEqual(await wallet(), [7, 100]);
  await svc(() => db.exec(`select public.credit_apply('${A}', 'monthly', -30, 'adjustment', 'use')`));
  await svc(() => db.exec(`select public.credit_grant_monthly('${A}', 100, now() + interval '60 days', 'period2')`));
  assert.deepEqual(await wallet(), [7, 100]); // 70 expired, 100 granted
  const retry = await svc(async () => (await q(`select public.credit_grant_monthly('${A}', 100, now() + interval '60 days', 'period2') as r`))[0].r);
  assert.equal(retry, false);
  assert.deepEqual(await wallet(), [7, 100]);
  const reasons = (await q("select reason from public.credit_ledger where bucket = 'monthly' order by id")).map((r) => r.reason);
  assert.deepEqual(reasons, ['monthly_grant', 'adjustment', 'monthly_expiry', 'monthly_grant']);
});

test('admin grants work while purchases are off, are logged, and need a real amount', async () => {
  await svc(() => db.exec(`select public.credit_admin_grant('${A}', 'purchased', 25, 'goodwill', '${B}')`));
  assert.deepEqual(await wallet(), [25, 0]);
  const [log] = await q('select actor, action, target_user, details from public.audit_log');
  assert.deepEqual([log.actor, log.action, log.target_user, log.details.amount], [B, 'credit_admin_grant', A, 25]);
  await assert.rejects(svc(() => db.exec(`select public.credit_admin_grant('${A}', 'purchased', 0, 'x')`)), /invalid_amount/);
  await assert.rejects(svc(() => db.exec(`select public.credit_admin_grant('${A}', 'nope', 5, 'x')`)), /invalid_bucket/);
});

test('credit purchases are refused until they are switched on', async () => {
  await assert.rejects(svc(() => db.exec(`select public.credit_purchase('${A}', 50, null, 'pay1')`)), /purchases_disabled/);
  await setFlag('credit_purchases_enabled', 'true');
  await svc(() => db.exec(`select public.credit_purchase('${A}', 50, null, 'pay1')`));
  assert.deepEqual(await wallet(), [50, 0]);
});

test('AI is refused while disabled, and needs a configured spending order', async () => {
  await svc(() => db.exec(`select public.credit_apply('${A}', 'purchased', 10, 'adjustment', 'seed')`));
  await assert.rejects(svc(() => db.exec(`select public.ai_reserve('${A}', 'multi_plan', 1, 5, 'k')`)), /ai_disabled/);
  await setFlag('ai_enabled', 'true');
  await assert.rejects(svc(() => db.exec(`select public.ai_reserve('${A}', 'multi_plan', 1, 5, 'k')`)), /spend_order_not_configured/);
  assert.deepEqual(await wallet(), [10, 0]);
  assert.equal((await q('select count(*)::int as n from public.ai_usage'))[0].n, 0);
});

test('AI usage: hold, charge in the configured order, release the rest, record cost and charge separately', async () => {
  await setFlag('ai_enabled', 'true');
  await setFlag('credit_spend_order', '["monthly","purchased"]');
  await svc(() => db.exec(`select public.credit_apply('${A}', 'purchased', 10, 'adjustment', 'p')`));
  await svc(() => db.exec(`select public.credit_grant_monthly('${A}', 6, now() + interval '30 days', 'm')`));
  await assert.rejects(svc(() => db.exec(`select public.ai_reserve('${A}', 'multi_plan', 3, 17, 'too-much')`)), /insufficient_credits/);
  const id = await svc(async () => (await q(`select public.ai_reserve('${A}', 'multi_plan', 3, 9, 'job1', 'Villa') as id`))[0].id);
  assert.deepEqual(await wallet(), [7, 0]); // monthly 6 first, then 3 purchased
  assert.equal(await svc(async () => (await q(`select public.ai_reserve('${A}', 'multi_plan', 3, 9, 'job1') as id`))[0].id), id); // retry is the same job
  assert.deepEqual(await wallet(), [7, 0]);
  await svc(() => db.exec(`select public.ai_finish('${id}', 'completed', 7, 123456, 'req-1')`));
  assert.deepEqual(await wallet(), [9, 0]); // 7 charged: 6 monthly + 1 purchased; 2 purchased returned
  const [u] = await q(`select status, credits_held::int as h, credits_charged::int as c, provider_cost_micro_usd::int as cost, context_label from public.ai_usage where id = '${id}'`);
  assert.deepEqual([u.status, u.h, u.c, u.cost, u.context_label], ['completed', 9, 7, 123456, 'Villa']);
  await svc(() => db.exec(`select public.ai_finish('${id}', 'completed', 0, 1)`)); // settling twice changes nothing
  assert.deepEqual(await wallet(), [9, 0]);
  assert.equal((await as(A, () => q('select * from public.ai_usage'))).length, 1);
  assert.equal((await as(B, () => q('select * from public.ai_usage'))).length, 0);
});

test('a failed AI call without consumption is released in full; one with consumption is charged', async () => {
  await setFlag('ai_enabled', 'true');
  await setFlag('credit_spend_order', '["purchased","monthly"]');
  await svc(() => db.exec(`select public.credit_apply('${A}', 'purchased', 10, 'adjustment', 'p')`));
  const free = await svc(async () => (await q(`select public.ai_reserve('${A}', 'space_detection', 1, 4, 'f1') as id`))[0].id);
  await svc(() => db.exec(`select public.ai_finish('${free}', 'failed', 0, null, null, 'timeout')`));
  assert.deepEqual(await wallet(), [10, 0]);
  const used = await svc(async () => (await q(`select public.ai_reserve('${A}', 'space_detection', 1, 4, 'f2') as id`))[0].id);
  await svc(() => db.exec(`select public.ai_finish('${used}', 'failed', 3, 900, 'r', 'bad-output')`));
  assert.deepEqual(await wallet(), [7, 0]);
  await assert.rejects(svc(() => db.exec(`select public.ai_finish('${used}', 'weird', 0, 0)`)), /invalid_status/);
  const over = await svc(async () => (await q(`select public.ai_reserve('${A}', 'space_detection', 1, 2, 'f3') as id`))[0].id);
  await assert.rejects(svc(() => db.exec(`select public.ai_finish('${over}', 'completed', 5, 0)`)), /invalid_amount/);
});

test('subscription state: refused while payments are off; then entitlement follows it', async () => {
  await db.exec(`insert into public.plans (code, name_he, name_en, storage_quota_bytes, monthly_credits) values ('pro', 'א', 'Pro', 2147483648, 40)`);
  const apply = (status: string, start = "now() - interval '1 day'", end = "now() + interval '29 days'") =>
    svc(() => db.exec(`select public.apply_subscription_state('${A}', 'pro', '${status}', 'month', 'prov', 'cus1', 'sub1', ${start}, ${end}, false)`));
  await assert.rejects(apply('active'), /payments_disabled/);
  await setFlag('payments_enabled', 'true');
  await apply('active');
  let [e] = await q(`select status, source, storage_quota_bytes::bigint as quota, plan_code from public.entitlements where user_id = '${A}'`);
  assert.deepEqual([e.status, e.source, Number(e.quota), e.plan_code], ['active', 'billing', 2147483648, 'pro']);
  assert.deepEqual(await wallet(), [0, 40]); // plan credits granted for the period
  await apply('active'); // same period again: no second grant
  assert.deepEqual(await wallet(), [0, 40]);
  // payment failure: 7-day grace after the period ends, then read-only
  await apply('past_due', "now() - interval '40 days'", "now() - interval '3 days'");
  [e] = await q(`select status from public.entitlements where user_id = '${A}'`);
  assert.equal(e.status, 'grace');
  await apply('past_due', "now() - interval '40 days'", "now() - interval '9 days'");
  [e] = await q(`select status, ended_at from public.entitlements where user_id = '${A}'`);
  assert.equal(e.status, 'ended');
  assert.ok(e.ended_at instanceof Date);
  // cancelled but already paid for the rest of the period keeps access until it ends
  await apply('canceled', "now() - interval '10 days'", "now() + interval '20 days'");
  [e] = await q(`select status from public.entitlements where user_id = '${A}'`);
  assert.equal(e.status, 'active');
  await apply('ended', "now() - interval '40 days'", "now() - interval '10 days'");
  [e] = await q(`select status from public.entitlements where user_id = '${A}'`);
  assert.equal(e.status, 'ended');
  await assert.rejects(svc(() => db.exec(`select public.apply_subscription_state('${A}', 'nope', 'active', 'month', 'prov', null, 'sub9', now(), now(), false)`)), /unknown_plan/);
});

test('cloud backup access follows the billing entitlement', async () => {
  await db.exec(`insert into public.plans (code, name_he, name_en) values ('pro', 'א', 'Pro')`);
  await setFlag('payments_enabled', 'true');
  await svc(() => db.exec(`select public.apply_subscription_state('${A}', 'pro', 'active', 'month', 'prov', null, 'sub1', now(), now() + interval '30 days', false)`));
  const s = await as(A, async () => (await q('select public.cloud_backup_status() as s'))[0].s);
  assert.deepEqual([s.entitled, s.can_write, Number(s.quota_bytes)], [true, true, 1073741824]);
});

test('webhook events are recorded once, and only the server can see them', async () => {
  assert.equal(await svc(async () => (await q(`select public.record_payment_event('prov', 'evt1', 'invoice.paid', '{"a":1}') as r`))[0].r), true);
  assert.equal(await svc(async () => (await q(`select public.record_payment_event('prov', 'evt1', 'invoice.paid', '{"a":1}') as r`))[0].r), false);
  assert.equal((await q('select count(*)::int as n from public.payment_events'))[0].n, 1);
});

test('payments survive account deletion without the user link; subscriptions and wallets do not', async () => {
  await db.exec(`insert into public.plans (code, name_he, name_en) values ('pro', 'א', 'Pro');
    insert into public.subscriptions (user_id, plan_code, status, billing_interval, provider, provider_subscription_ref) values ('${A}', 'pro', 'active', 'month', 'p', 's');
    insert into public.payments (user_id, kind, provider, provider_payment_ref, status, amount_minor, currency) values ('${A}', 'subscription', 'p', 'x', 'paid', 5, 'ILS');`);
  await db.exec(`delete from auth.users where id = '${A}'`);
  assert.equal((await q('select count(*)::int as n from public.subscriptions'))[0].n, 0);
  assert.equal((await q(`select count(*)::int as n from public.credit_wallets where user_id = '${A}'`))[0].n, 0);
  const [p] = await q('select user_id from public.payments');
  assert.equal(p.user_id, null);
});

test('billing profile: the owner creates and edits their own invoice details only', async () => {
  await as(A, () => db.exec(`insert into public.billing_profiles (user_id, invoice_name, tax_id) values ('${A}', 'Acme Ltd', '123')`));
  await as(A, () => db.exec("update public.billing_profiles set city = 'Haifa'"));
  assert.equal((await as(B, () => q('select * from public.billing_profiles'))).length, 0);
  await assert.rejects(as(B, () => db.exec(`insert into public.billing_profiles (user_id) values ('${A}')`)), /row-level security/);
  await assert.rejects(as(A, () => db.exec(`update public.billing_profiles set user_id = '${B}'`)), /permission denied/);
  await assert.rejects(as(A, () => db.exec("update public.billing_profiles set country = 'israel'")), /check constraint/);
});

test('account overview reports balances and the latest subscription for the caller only', async () => {
  await db.exec(`insert into public.plans (code, name_he, name_en) values ('pro', 'א', 'Pro')`);
  await svc(() => db.exec(`select public.credit_apply('${A}', 'purchased', 4, 'adjustment', 'x')`));
  const mine = await as(A, async () => (await q('select public.account_overview() as o'))[0].o);
  assert.deepEqual([mine.purchased_credits, mine.monthly_credits, mine.subscription], [4, 0, null]);
  const theirs = await as(B, async () => (await q('select public.account_overview() as o'))[0].o);
  assert.equal(theirs.purchased_credits, 0);
  await assert.rejects(as(null, () => q('select public.account_overview()'), 'anon'), /permission denied/);
});

test('every SECURITY DEFINER function pins its search_path', async () => {
  const rows = await q(`select p.proname, array_to_string(p.proconfig, ',') as cfg from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef`);
  assert.ok(rows.length >= 25);
  for (const r of rows) assert.match(r.cfg ?? '', /search_path=/, r.proname);
});
