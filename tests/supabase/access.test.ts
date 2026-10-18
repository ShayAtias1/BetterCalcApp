import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTrial, trialStatus, TRIAL_STORAGE_KEY, TRIAL_DAYS, TRIAL_ACTIVATION_ID, TRIAL_RECORD_VERSION } from '../../src/lib/access/trial.ts';
import { evaluateAccess, ACCESS_ENFORCEMENT_ENABLED, ACCOUNTS_ENABLED, CLOUD_BACKUP_ENABLED } from '../../src/lib/access/accessPolicy.ts';
import { createAccessSync } from '../../src/lib/access/accessSync.ts';
import { createStore } from 'zustand/vanilla';

const DAY = 86_400_000;
const T0 = 1_800_000_000_000;
const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

test('the trial starts on first use and lasts exactly 7 days', () => {
  const storage = memory();
  const first = loadTrial(storage, T0)!;
  assert.equal(first.expired, false);
  assert.equal(first.daysLeft, TRIAL_DAYS);
  assert.equal(loadTrial(storage, T0 + 6 * DAY + 1000)!.expired, false);
  assert.equal(loadTrial(storage, T0 + 6 * DAY + 1000)!.daysLeft, 1);
  assert.equal(loadTrial(storage, T0 + 7 * DAY - 1)!.expired, false);
  const done = loadTrial(storage, T0 + 7 * DAY)!;
  assert.equal(done.expired, true);
  assert.equal(done.daysLeft, 0);
  assert.equal(JSON.parse(storage.data.get(TRIAL_STORAGE_KEY)!).startedAt, T0);
});

test('prelaunch records are ignored and every visitor starts a full personal trial on first use', () => {
  for (const record of [{ v: 1, startedAt: T0 - 30 * DAY }, { v: 2, startedAt: T0 - DAY },
    { v: TRIAL_RECORD_VERSION, activation: 'prelaunch', startedAt: T0 - 30 * DAY }]) {
    const storage = memory({ [TRIAL_STORAGE_KEY]: JSON.stringify(record) });
    assert.equal(loadTrial(storage, T0 + 20 * DAY)!.daysLeft, TRIAL_DAYS);
    assert.equal(JSON.parse(storage.data.get(TRIAL_STORAGE_KEY)!).startedAt, T0 + 20 * DAY);
  }
  const visitorA = memory(), visitorB = memory();
  loadTrial(visitorA, T0);
  loadTrial(visitorB, T0 + 10 * DAY);
  assert.equal(loadTrial(visitorA, T0 + 10 * DAY)!.expired, true);
  assert.equal(loadTrial(visitorB, T0 + 10 * DAY)!.daysLeft, 7);
});

test('the trial cannot be tracked when storage is unavailable, so it never restricts', () => {
  assert.equal(loadTrial(null, T0), null);
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(loadTrial(broken, T0), null);
  assert.equal(evaluateAccess('signedOut', null).canCreateOrEdit, true);
});

test('a corrupt record is replaced by a fresh start rather than locking the user out', () => {
  const storage = memory({ [TRIAL_STORAGE_KEY]: '{not json' });
  assert.equal(loadTrial(storage, T0)!.daysLeft, TRIAL_DAYS);
  const bad = memory({ [TRIAL_STORAGE_KEY]: JSON.stringify({ startedAt: 'yesterday' }) });
  assert.equal(loadTrial(bad, T0)!.expired, false);
});

test('a start date in the future never counts as expired', () => {
  assert.equal(trialStatus(T0 + 3 * DAY, T0).expired, false);
});

test('access rules: guest trial, expired guest, registered user', () => {
  const live = trialStatus(T0, T0 + 2 * DAY);
  const dead = trialStatus(T0, T0 + 9 * DAY);
  const trial = evaluateAccess('signedOut', live);
  assert.deepEqual([trial.level, trial.canCreateOrEdit, trial.daysLeft], ['trial', true, 5]);
  const expired = evaluateAccess('signedOut', dead);
  assert.deepEqual([expired.level, expired.canView, expired.canExport, expired.canCreateOrEdit], ['expired', true, true, false]);
  const full = evaluateAccess('signedIn', dead);
  assert.deepEqual([full.level, full.canCreateOrEdit], ['full', true]);
});

test('accounts unavailable or still loading never restrict, even after the trial', () => {
  const dead = trialStatus(T0, T0 + 30 * DAY);
  for (const status of ['unconfigured', 'loading'] as const) {
    const d = evaluateAccess(status, dead);
    assert.deepEqual([d.level, d.canCreateOrEdit], ['open', true]);
  }
});

test('restrictions stay off while accounts are being tested', () => {
  assert.equal(ACCESS_ENFORCEMENT_ENABLED, false);
  assert.equal(ACCOUNTS_ENABLED, true);
  assert.equal(CLOUD_BACKUP_ENABLED, false);
  assert.equal(TRIAL_ACTIVATION_ID, 'early-access-1');
});

function sync(enforce: boolean, storage = memory(), now = T0) {
  const auth = createStore<{ status: string }>()(() => ({ status: 'signedOut' }));
  const allowed: boolean[] = [];
  const s = createAccessSync({
    auth: auth as never,
    storage,
    now: () => now,
    enforce,
    schedule: () => () => {},
    setEditingAllowed: (a) => void allowed.push(a),
  });
  return { auth, allowed, s, storage };
}

test('with enforcement off the trial never starts: storage is not read or written, and nothing is restricted', () => {
  const storage = memory();
  const touched: string[] = [];
  const spy = { getItem: (k: string) => (touched.push('get'), storage.getItem(k)), setItem: (k: string, v: string) => (touched.push('set'), storage.setItem(k, v)) };
  const { s, allowed } = sync(false, spy as never);
  s.start();
  assert.deepEqual(touched, []);
  assert.equal(storage.data.size, 0);
  assert.equal(s.store.getState().level, 'open');
  assert.equal(allowed.at(-1), true);
});

test('with enforcement off even a stale expired record restricts nothing', () => {
  const storage = memory({ [TRIAL_STORAGE_KEY]: JSON.stringify({ v: TRIAL_RECORD_VERSION, activation: TRIAL_ACTIVATION_ID, startedAt: T0 - 20 * DAY }) });
  const { s, allowed } = sync(false, storage);
  s.start();
  assert.equal(s.store.getState().canCreateOrEdit, true);
  assert.equal(allowed.at(-1), true);
});

test('with enforcement on, an expired guest is restricted and signing in lifts it without touching the trial record', () => {
  const record = JSON.stringify({ v: TRIAL_RECORD_VERSION, activation: TRIAL_ACTIVATION_ID, startedAt: T0 - 20 * DAY });
  const storage = memory({ [TRIAL_STORAGE_KEY]: record });
  const { s, allowed, auth } = sync(true, storage);
  s.start();
  s.beginUse();
  assert.equal(allowed.at(-1), false);
  auth.setState({ status: 'signedIn' });
  assert.equal(s.store.getState().level, 'full');
  assert.equal(allowed.at(-1), true);
  auth.setState({ status: 'signedOut' });
  assert.equal(allowed.at(-1), false);
  assert.equal(storage.data.get(TRIAL_STORAGE_KEY), record);
});

test('access code never touches project data', () => {
  for (const f of ['trial', 'accessPolicy', 'accessSync']) {
    const text = readFileSync(`src/lib/access/${f}.ts`, 'utf8');
    assert.ok(!/db\/database|indexedDB|deleteDatabase|\.clear\(/.test(text), f);
  }
});

test('the AI header button state follows the account only, and the low-credit state waits for a decided threshold', async () => {
  const { aiAccountState, LOW_CREDIT_THRESHOLD } = await import('../../src/lib/access/aiAccountState.ts');
  const base = { accountsAvailable: true, auth: 'signedOut' as const, subscription: null, credits: 0 };
  assert.equal(aiAccountState(base), 'guest');
  assert.equal(aiAccountState({ ...base, auth: 'signedIn' }), 'free');
  assert.equal(aiAccountState({ ...base, auth: 'signedIn', subscription: { status: 'canceled' } }), 'free');
  assert.equal(aiAccountState({ ...base, auth: 'signedIn', subscription: { status: 'active' }, credits: 3 }), 'subscribed');
  assert.equal(aiAccountState({ ...base, auth: 'signedIn', subscription: { status: 'active' }, credits: 3, lowThreshold: 5 }), 'low-credits');
  assert.equal(aiAccountState({ ...base, accountsAvailable: false }), 'free'); // purely local build: nothing to sign in to
  assert.equal(LOW_CREDIT_THRESHOLD, null);
});


test('welcome, legal screens and registered sessions do not start a guest trial', () => {
  const { s, storage, auth } = sync(true);
  const stop = s.start();
  assert.equal(storage.data.size, 0);
  s.refresh();
  assert.equal(storage.data.size, 0);
  auth.setState({ status: 'signedIn' });
  s.beginUse();
  assert.equal(storage.data.size, 0);
  auth.setState({ status: 'signedOut' });
  assert.equal(JSON.parse(storage.data.get(TRIAL_STORAGE_KEY)!).startedAt, T0);
  stop();
});

test('trial persistence survives new app instances and unrelated refreshes; active tabs expire at seven days', () => {
  const storage = memory();
  let now = T0;
  let expiry: (() => void) | undefined;
  let delay = 0;
  const auth = createStore<any>()(() => ({ status: 'signedOut' }));
  const make = () => createAccessSync({ auth, storage, now: () => now, enforce: true,
    setEditingAllowed() {}, schedule(callback, ms) { expiry = callback; delay = ms; return () => { expiry = undefined; }; } });
  const first = make();
  const stop = first.start(); first.beginUse();
  const record = storage.data.get(TRIAL_STORAGE_KEY);
  first.refresh(); first.beginUse();
  assert.equal(storage.data.get(TRIAL_STORAGE_KEY), record);
  assert.equal(delay, 7 * DAY);
  stop();
  now += 7 * DAY - 1;
  const reopened = make(); const stopAgain = reopened.start(); reopened.beginUse();
  assert.equal(reopened.store.getState().canCreateOrEdit, true);
  assert.equal(delay, 1);
  now += 1; expiry!();
  assert.equal(reopened.store.getState().level, 'expired');
  assert.equal(reopened.store.getState().canView, true);
  assert.equal(reopened.store.getState().canExport, true);
  assert.equal(reopened.store.getState().canCreateOrEdit, false);
  assert.equal(storage.data.get(TRIAL_STORAGE_KEY), record);
  auth.setState({ status: 'signedIn' });
  assert.equal(reopened.store.getState().canCreateOrEdit, true);
  stopAgain();
});
