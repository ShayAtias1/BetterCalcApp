import test from 'node:test';
import assert from 'node:assert/strict';
import { GUEST_ACK_KEY, guestNeedsAck, readGuestAck, writeGuestAck } from '../../src/lib/access/guestAck.ts';
import { hasAcceptedCurrentTerms } from '../../src/store/accountStore.ts';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const base = { accountsEnabled: true, authStatus: 'signedOut' as const, welcomeSeen: true, ack: null, version: 'pending' };

test('a guest who passed the welcome screen is asked once per version', () => {
  assert.equal(guestNeedsAck(base), true);
  const store = memory();
  const ack = writeGuestAck(store, 'pending', 1000);
  assert.deepEqual(readGuestAck(store), ack);
  assert.equal(guestNeedsAck({ ...base, ack }), false);
  assert.equal(guestNeedsAck({ ...base, ack, version: '2026-12-01' }), true);
});

test('not asked on the welcome screen, while signed in, or while the session is still read', () => {
  assert.equal(guestNeedsAck({ ...base, welcomeSeen: false }), false);
  assert.equal(guestNeedsAck({ ...base, authStatus: 'signedIn' }), false);
  assert.equal(guestNeedsAck({ ...base, authStatus: 'loading' }), false);
  assert.equal(guestNeedsAck({ ...base, accountsEnabled: false }), false);
});

test('unreadable or malformed records ask again, and a blocked storage does not throw', () => {
  const store = memory();
  store.setItem(GUEST_ACK_KEY, '{nope');
  assert.equal(readGuestAck(store), null);
  store.setItem(GUEST_ACK_KEY, JSON.stringify({ version: 1 }));
  assert.equal(readGuestAck(store), null);
  assert.equal(readGuestAck(null), null);
  assert.doesNotThrow(() => writeGuestAck({ getItem: () => null, setItem: () => { throw new Error('blocked'); } }, 'pending', 1));
});

test('signed-in acceptance follows the version the server announces (placeholder "pending" until set)', () => {
  const done = { onboardingCompleted: true, termsVersion: 'pending' };
  assert.equal(hasAcceptedCurrentTerms(done, { legalVersion: null }), true);
  assert.equal(hasAcceptedCurrentTerms(done, { legalVersion: '2026-12-01' }), false);
  assert.equal(hasAcceptedCurrentTerms({ onboardingCompleted: true, termsVersion: '2026-12-01' }, { legalVersion: '2026-12-01' }), true);
  assert.equal(hasAcceptedCurrentTerms({ onboardingCompleted: false, termsVersion: null }, { legalVersion: null }), false);
  assert.equal(hasAcceptedCurrentTerms(null, { legalVersion: null }), false);
  // Accepted before versions were recorded: not interrupted until a version is announced, then asked once.
  assert.equal(hasAcceptedCurrentTerms({ onboardingCompleted: true, termsVersion: null }, { legalVersion: null }), true);
  assert.equal(hasAcceptedCurrentTerms({ onboardingCompleted: true, termsVersion: null }, { legalVersion: '2026-12-01' }), false);
});
