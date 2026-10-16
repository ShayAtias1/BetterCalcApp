import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createAuthStore } from '../../src/store/authStore.ts';
import {
  classifyAuthError,
  normalizeEmail,
  normalizeOtp,
  confirmEmailCode,
  requestEmailCode,
  signOutLocally,
  type AuthApi,
} from '../../src/lib/supabase/authService.ts';

type Listener = (event: string, session: unknown) => void;
const session = { user: { id: 'u1', email: 'a@b.co' }, access_token: 'SECRET' };

function fakeAuth(over: Record<string, unknown> = {}) {
  const calls: Array<[string, unknown]> = [];
  let listener: Listener = () => {};
  const rec = (name: string, result: unknown = { error: null }) => async (arg?: unknown) => {
    calls.push([name, arg]);
    if (result instanceof Error) throw result;
    return result;
  };
  const auth = {
    signInWithOtp: rec('otp'),
    verifyOtp: rec('verify'),
    signInWithOAuth: rec('oauth'),
    signOut: rec('signOut'),
    getSession: rec('getSession', { data: { session: null }, error: null }),
    onAuthStateChange: (cb: Listener) => {
      listener = cb;
      return { data: { subscription: { unsubscribe() {} } } };
    },
    ...over,
  } as unknown as AuthApi;
  return { auth, calls, emit: (e: string, s: unknown = null) => listener(e, s) };
}

const storageSpy = () => {
  const removed: string[] = [];
  return { removed, storage: { removeItem: (k: string) => void removed.push(k) } };
};
const makeStore = (auth: AuthApi | null, storage: ReturnType<typeof storageSpy>['storage'] | null = null) =>
  createAuthStore({ loadAuth: async () => auth, storage: () => storage, returnUrl: () => 'https://app.test/x' });

test('email and code input is validated before any request', async () => {
  assert.equal(normalizeEmail('  A@B.co '), 'a@b.co');
  assert.equal(normalizeEmail('nope'), null);
  assert.equal(normalizeOtp('123 456'), '123456');
  assert.equal(normalizeOtp('12345'), null);
  assert.equal(normalizeOtp('abcdef'), null);
  const { auth, calls } = fakeAuth();
  assert.deepEqual(await requestEmailCode(auth, 'bad'), { ok: false, reason: 'invalid-email' });
  assert.deepEqual(await confirmEmailCode(auth, 'a@b.co', '12'), { ok: false, reason: 'invalid-code-format' });
  assert.equal(calls.length, 0);
});

test('OTP request and verification use the email flow with a 6-digit token', async () => {
  const { auth, calls } = fakeAuth();
  assert.deepEqual(await requestEmailCode(auth, 'A@b.co'), { ok: true });
  assert.deepEqual(await confirmEmailCode(auth, 'a@b.co', '123456'), { ok: true });
  assert.deepEqual(calls[0], ['otp', { email: 'a@b.co', options: { shouldCreateUser: true } }]);
  assert.deepEqual(calls[1], ['verify', { email: 'a@b.co', token: '123456', type: 'email' }]);
});

test('SDK errors map to a small set of outcomes, network failures included', async () => {
  assert.equal(classifyAuthError({ name: 'AuthRetryableFetchError', status: 0 }), 'network');
  assert.equal(classifyAuthError(new TypeError('Failed to fetch')), 'network');
  assert.equal(classifyAuthError({ code: 'otp_expired', status: 403 }), 'expired-code');
  assert.equal(classifyAuthError({ code: 'over_email_send_rate_limit', status: 429 }), 'rate-limited');
  assert.equal(classifyAuthError({ status: 403, message: 'Token has expired or is invalid' }), 'wrong-code');
  assert.equal(classifyAuthError(null), 'unknown');
  const { auth } = fakeAuth({ verifyOtp: async () => ({ error: { code: 'otp_expired', status: 403 } }) });
  assert.deepEqual(await confirmEmailCode(auth, 'a@b.co', '123456'), { ok: false, reason: 'expired-code' });
  const down = fakeAuth({ signInWithOtp: async () => { throw new TypeError('Failed to fetch'); } });
  assert.deepEqual(await requestEmailCode(down.auth, 'a@b.co'), { ok: false, reason: 'network' });
});

test('Google sign-in starts the redirect back to the current page', async () => {
  const { auth, calls } = fakeAuth();
  const store = makeStore(auth);
  assert.deepEqual(await store.getState().signInWithGoogle(), { ok: true });
  assert.deepEqual(calls[0], ['oauth', { provider: 'google', options: { redirectTo: 'https://app.test/x' } }]);
});

test('unconfigured: the store settles to unconfigured and operations report it', async () => {
  const store = makeStore(null);
  await store.getState().init();
  assert.equal(store.getState().status, 'unconfigured');
  assert.deepEqual(await store.getState().requestEmailCode('a@b.co'), { ok: false, reason: 'not-configured' });
});

test('init restores a stored session and exposes only id and email', async () => {
  const { auth } = fakeAuth({ getSession: async () => ({ data: { session }, error: null }) });
  const store = makeStore(auth);
  await store.getState().init();
  const s = store.getState();
  assert.equal(s.status, 'signedIn');
  assert.deepEqual(s.user, { id: 'u1', email: 'a@b.co' });
  assert.ok(!JSON.stringify(s).includes('SECRET'));
});

test('init is idempotent and subscribes once', async () => {
  let subs = 0;
  const { auth } = fakeAuth({ onAuthStateChange: () => { subs++; return { data: { subscription: {} } }; } });
  const store = makeStore(auth);
  await Promise.all([store.getState().init(), store.getState().init()]);
  await store.getState().init();
  assert.equal(subs, 1);
});

test('a failed session read offline leaves the app usable and flags the network', async () => {
  const { auth } = fakeAuth({ getSession: async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 0 } }) });
  const store = makeStore(auth);
  await store.getState().init();
  assert.equal(store.getState().status, 'signedOut');
  assert.equal(store.getState().networkIssue, true);
});

test('sign-in and token refresh events update the user; refresh keeps the session', async () => {
  const f = fakeAuth();
  const store = makeStore(f.auth);
  await store.getState().init();
  f.emit('SIGNED_IN', session);
  assert.equal(store.getState().status, 'signedIn');
  f.emit('TOKEN_REFRESHED', { ...session, access_token: 'NEW' });
  assert.equal(store.getState().status, 'signedIn');
  assert.equal(store.getState().sessionExpired, false);
});

test('a sign-out the user did not ask for is reported as an expired session', async () => {
  const f = fakeAuth();
  const store = makeStore(f.auth);
  await store.getState().init();
  f.emit('SIGNED_IN', session);
  f.emit('SIGNED_OUT');
  assert.equal(store.getState().status, 'signedOut');
  assert.equal(store.getState().sessionExpired, true);
  store.getState().dismissSessionExpired();
  assert.equal(store.getState().sessionExpired, false);
});

test('user sign-out is local-scope, clears only auth keys, and is not reported as expiry', async () => {
  const f = fakeAuth();
  const { removed, storage } = storageSpy();
  const store = makeStore(f.auth, storage);
  await store.getState().init();
  f.emit('SIGNED_IN', session);
  assert.deepEqual(await store.getState().signOut(), { ok: true });
  assert.deepEqual(f.calls.find(([n]) => n === 'signOut'), ['signOut', { scope: 'local' }]);
  assert.deepEqual(removed, ['bettercalc.auth', 'bettercalc.auth-code-verifier']);
  f.emit('SIGNED_OUT');
  assert.equal(store.getState().status, 'signedOut');
  assert.equal(store.getState().sessionExpired, false);
});

test('sign-out succeeds offline and still removes the stored session', async () => {
  const { auth } = fakeAuth({ signOut: async () => ({ error: { name: 'AuthRetryableFetchError', status: 0 } }) });
  const { removed, storage } = storageSpy();
  assert.deepEqual(await signOutLocally(auth, storage), { ok: true });
  assert.equal(removed.length, 2);
  const store = makeStore(auth, storage);
  await store.getState().init();
  assert.deepEqual(await store.getState().signOut(), { ok: true });
  assert.equal(store.getState().status, 'signedOut');
});

test('a network failure during an operation sets networkIssue, and success clears it', async () => {
  let fail = true;
  const { auth } = fakeAuth({ signInWithOtp: async () => (fail ? { error: { name: 'AuthRetryableFetchError', status: 0 } } : { error: null }) });
  const store = makeStore(auth);
  await store.getState().requestEmailCode('a@b.co');
  assert.equal(store.getState().networkIssue, true);
  fail = false;
  await store.getState().requestEmailCode('a@b.co');
  assert.equal(store.getState().networkIssue, false);
});

test('auth code never touches project data or other browser storage', () => {
  const files = [
    ...readdirSync('src/lib/supabase').map((f) => `src/lib/supabase/${f}`),
    'src/store/authStore.ts',
  ];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!/db\/database|indexedDB|localStorage\.clear|sessionStorage\.clear|deleteDatabase/.test(text), file);
  }
});
