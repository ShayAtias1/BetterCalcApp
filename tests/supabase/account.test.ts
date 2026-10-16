import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from 'zustand/vanilla';
import {
  AccountError,
  cancelAccountDeletion,
  completeOnboarding,
  getAccountOverview,
  getCommercialFlags,
  getDeletionStatus,
  getProfile,
  initialsOf,
  listAiUsage,
  normalizeDisplayName,
  requestAccountDeletion,
  saveBillingProfile,
  updateDisplayName,
  FLAGS_OFF,
  type AccountClient,
} from '../../src/lib/account/accountApi.ts';
import { createAccountStore, LEGAL_VERSION_PENDING } from '../../src/store/accountStore.ts';
import {
  getPaymentProvider,
  PaymentsUnavailableError,
  registerPaymentProvider,
  subscriptionRpcArgs,
  unavailablePaymentProvider,
  type PaymentProvider,
} from '../../src/lib/billing/paymentProvider.ts';
import { requestEmailCode } from '../../src/lib/supabase/authService.ts';

type Calls = Array<[string, unknown]>;
function fakeClient(tables: Record<string, any> = {}, rpcs: Record<string, any> = {}) {
  const calls: Calls = [];
  const table = (name: string) => {
    const chain: any = {
      select: () => chain, order: () => chain, limit: () => ({ data: tables[name] ?? [], error: null, then: (r: any) => r({ data: tables[name] ?? [], error: null }) }),
      eq: async (col: string, val: unknown) => { calls.push([`eq:${name}:${col}`, val]); return { data: null, error: tables[`${name}:error`] ?? null }; },
      update: (patch: unknown) => { calls.push([`update:${name}`, patch]); return chain; },
      upsert: async (row: unknown, opts: unknown) => { calls.push([`upsert:${name}`, [row, opts]]); return { data: null, error: null }; },
      maybeSingle: async () => ({ data: tables[name] ?? null, error: null }),
    };
    return chain;
  };
  const client = {
    from: table,
    rpc: async (name: string, args?: unknown) => { calls.push([`rpc:${name}`, args]); return name in rpcs ? rpcs[name] : { data: null, error: null }; },
  } as unknown as AccountClient;
  return { client, calls };
}

test('names are cleaned and bounded; initials come from the name, then the email', () => {
  assert.equal(normalizeDisplayName('  Dana\nLevi  '), 'Dana Levi');
  assert.equal(normalizeDisplayName('   '), null);
  assert.equal(normalizeDisplayName('x'.repeat(81)), null);
  assert.equal(normalizeDisplayName('x'.repeat(80))?.length, 80);
  assert.equal(initialsOf('Dana Levi', 'a@b.co'), 'DL');
  assert.equal(initialsOf('דנה', null), 'דנ');
  assert.equal(initialsOf('Dana Bar Levi', null), 'DL');
  assert.equal(initialsOf(null, 'zed@b.co'), 'Z');
});

test('flags: read from the server, and everything is off when they cannot be read', async () => {
  const on = fakeClient({}, { commercial_flags: { data: { ai_enabled: true, payments_enabled: false, credit_purchases_enabled: false, legal_version: 'v1' }, error: null } });
  assert.deepEqual(await getCommercialFlags(on.client), { aiEnabled: true, paymentsEnabled: false, creditPurchasesEnabled: false, legalVersion: 'v1' });
  assert.deepEqual(await getCommercialFlags(fakeClient({}, { commercial_flags: { data: null, error: { message: 'x' } } }).client), FLAGS_OFF);
  const boom = { rpc: async () => { throw new TypeError('Failed to fetch'); } } as unknown as AccountClient;
  assert.deepEqual(await getCommercialFlags(boom), FLAGS_OFF);
});

test('profile and onboarding: the name is validated before anything is sent', async () => {
  const { client, calls } = fakeClient({ profiles: { display_name: 'Dana', locale: 'he', terms_version: 'v1', terms_accepted_at: '2026-10-18T10:00:00Z', onboarding_completed_at: '2026-10-18T10:00:00Z' } });
  assert.deepEqual(await getProfile(client), { displayName: 'Dana', locale: 'he', termsVersion: 'v1', termsAcceptedAt: Date.parse('2026-10-18T10:00:00Z'), onboardingCompleted: true });
  await assert.rejects(completeOnboarding(client, '   ', 'v1'), (e: AccountError) => e.code === 'invalid-name');
  await assert.rejects(updateDisplayName(client, 'u', ''), (e: AccountError) => e.code === 'invalid-name');
  assert.deepEqual(calls, []);
  await completeOnboarding(client, '  Dana  ', 'v1');
  assert.deepEqual(calls[0], ['rpc:complete_onboarding', { p_name: 'Dana', p_legal_version: 'v1' }]);
  assert.equal(await updateDisplayName(client, 'u1', ' New '), 'New');
  assert.deepEqual(calls.at(-1), ['eq:profiles:id', 'u1']);
});

test('a server refusal or a lost connection becomes a clear account error', async () => {
  const bad = fakeClient({}, { complete_onboarding: { data: null, error: { message: 'invalid_name' } } });
  await assert.rejects(completeOnboarding(bad.client, 'Dana', 'v1'), (e: AccountError) => e.code === 'invalid-name');
  const down = { rpc: async () => { throw new TypeError('Failed to fetch'); } } as unknown as AccountClient;
  await assert.rejects(completeOnboarding(down, 'Dana', 'v1'), (e: AccountError) => e.code === 'network');
});

test('overview, usage history and deletion requests map plainly', async () => {
  const { client } = fakeClient(
    { ai_usage: [{ id: 'a', kind: 'multi_plan', status: 'completed', pages: 3, credits_charged: '7', context_label: 'Villa', created_at: '2026-10-10T10:00:00Z' }], account_deletion_requests: { status: 'requested' } },
    { account_overview: { data: { purchased_credits: 4, monthly_credits: 2, monthly_expires_at: null, subscription: { plan_code: 'pro', status: 'active', billing_interval: 'month', current_period_end: '2026-11-01T00:00:00Z', cancel_at_period_end: false } }, error: null } },
  );
  const o = await getAccountOverview(client);
  assert.deepEqual([o.purchasedCredits, o.monthlyCredits, o.subscription?.planCode, o.subscription?.periodEnd], [4, 2, 'pro', Date.parse('2026-11-01T00:00:00Z')]);
  assert.deepEqual((await listAiUsage(client))[0], { id: 'a', kind: 'multi_plan', status: 'completed', pages: 3, creditsCharged: 7, label: 'Villa', createdAt: Date.parse('2026-10-10T10:00:00Z') });
  assert.equal(await getDeletionStatus(client), 'requested');
  const calls = fakeClient();
  await requestAccountDeletion(calls.client);
  await cancelAccountDeletion(calls.client);
  assert.deepEqual(calls.calls.map(([n]) => n), ['rpc:request_account_deletion', 'rpc:cancel_account_deletion']);
});

test('invoice details are saved as the owner, with empty fields stored as null', async () => {
  const { client, calls } = fakeClient();
  await saveBillingProfile(client, 'u1', { invoiceName: ' Acme ', taxId: '', addressLine: '', city: 'Haifa', postalCode: '' });
  assert.deepEqual(calls[0], ['upsert:billing_profiles', [{ user_id: 'u1', invoice_name: 'Acme', tax_id: null, address_line: null, city: 'Haifa', postal_code: null }, { onConflict: 'user_id' }]]);
});

test('registration: the chosen name travels with the first code request, and only then', async () => {
  const sent: unknown[] = [];
  const auth = { signInWithOtp: async (a: unknown) => { sent.push(a); return { error: null }; } } as never;
  await requestEmailCode(auth, 'a@b.co', undefined, '  Dana Levi ');
  await requestEmailCode(auth, 'a@b.co');
  assert.deepEqual(sent, [
    { email: 'a@b.co', options: { shouldCreateUser: true, data: { full_name: 'Dana Levi' } } },
    { email: 'a@b.co', options: { shouldCreateUser: true } },
  ]);
});

// ---------------------------------------------------------------- store
function storeFixture(status: 'signedIn' | 'signedOut', profile: any) {
  const auth = createStore<{ status: string; user: { id: string } | null }>()(() => ({ status, user: { id: 'u1' } }));
  const { client, calls } = fakeClient({ profiles: profile }, {
    commercial_flags: { data: { ai_enabled: false, payments_enabled: false, credit_purchases_enabled: false, legal_version: null }, error: null },
    account_overview: { data: { purchased_credits: 0, monthly_credits: 0, subscription: null }, error: null },
  });
  const sync = createAccountStore({ auth: auth as never, loadClient: async () => client });
  return { auth, calls, sync };
}
const settle = () => new Promise((r) => setTimeout(r, 10));

test('signed in without onboarding: the store asks for it; signing out clears the account', async () => {
  const f = storeFixture('signedIn', { display_name: null, locale: null, terms_version: null, terms_accepted_at: null, onboarding_completed_at: null });
  const stop = f.sync.start();
  await settle();
  assert.equal(f.sync.store.getState().needsOnboarding, true);
  assert.equal(f.sync.store.getState().flags.aiEnabled, false);
  f.auth.setState({ status: 'signedOut' });
  await settle();
  assert.deepEqual([f.sync.store.getState().profile, f.sync.store.getState().needsOnboarding], [null, false]);
  stop();
});

test('an onboarded user is never interrupted, and a failed load never blocks work', async () => {
  const done = storeFixture('signedIn', { display_name: 'Dana', onboarding_completed_at: '2026-10-18T10:00:00Z', terms_accepted_at: null });
  done.sync.start();
  await settle();
  assert.equal(done.sync.store.getState().needsOnboarding, false);
  const broken = createAccountStore({
    auth: createStore<any>()(() => ({ status: 'signedIn', user: { id: 'u' } })) as never,
    loadClient: async () => ({ rpc: async () => { throw new TypeError('Failed to fetch'); }, from: () => { throw new TypeError('Failed to fetch'); } }) as never,
  });
  broken.start();
  await settle();
  assert.deepEqual([broken.store.getState().needsOnboarding, broken.store.getState().loadFailed], [false, true]);
});

test('submitting onboarding sends the name with the pending legal version until texts exist', async () => {
  const f = storeFixture('signedIn', { display_name: null, onboarding_completed_at: null });
  f.sync.start();
  await settle();
  await f.sync.store.getState().submitOnboarding(' Dana ');
  assert.deepEqual(f.calls.find(([n]) => n === 'rpc:complete_onboarding'), ['rpc:complete_onboarding', { p_name: 'Dana', p_legal_version: LEGAL_VERSION_PENDING }]);
});

test('payments fail closed: no provider, or the server switch off, means no checkout', async () => {
  await assert.rejects(unavailablePaymentProvider.createCheckout({ kind: 'subscription', productCode: 'x', returnUrl: '/' }), PaymentsUnavailableError);
  await assert.rejects(unavailablePaymentProvider.openCustomerPortal('/'), PaymentsUnavailableError);
  const provider: PaymentProvider = { id: 'demo', createCheckout: async () => ({ url: 'https://pay.example/c' }), openCustomerPortal: async () => ({ url: 'https://pay.example/p' }) };
  registerPaymentProvider(provider);
  try {
    assert.equal(getPaymentProvider(false), unavailablePaymentProvider);
    assert.equal(getPaymentProvider(true), provider);
  } finally {
    registerPaymentProvider(null);
  }
  assert.equal(getPaymentProvider(true), unavailablePaymentProvider);
});

test('a normalized subscription event maps one-to-one to the database call', () => {
  const args = subscriptionRpcArgs('acme', { type: 'subscription.updated', eventRef: 'e', userId: 'u', planCode: 'pro', status: 'active', interval: 'month', customerRef: 'c', subscriptionRef: 's', periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-11-01T00:00:00Z', cancelAtPeriodEnd: false });
  assert.deepEqual(Object.keys(args), ['p_user', 'p_plan', 'p_status', 'p_interval', 'p_provider', 'p_customer_ref', 'p_subscription_ref', 'p_period_start', 'p_period_end', 'p_cancel_at_period_end']);
});
