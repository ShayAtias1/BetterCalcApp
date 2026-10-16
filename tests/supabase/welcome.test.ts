import test from 'node:test';
import assert from 'node:assert/strict';
import { welcomeStep } from '../../src/lib/access/welcome.ts';

const base = { accountsEnabled: true, authStatus: 'signedOut' as const, seen: false };

test('a signed-out visitor who has not chosen yet sees the welcome screen', () => {
  assert.equal(welcomeStep(base), 'show');
});
test('a signed-in user goes straight in', () => {
  assert.equal(welcomeStep({ ...base, authStatus: 'signedIn' }), 'enter');
});
test('someone who already chose (guest) is not shown it again', () => {
  assert.equal(welcomeStep({ ...base, seen: true }), 'enter');
});
test('it waits while the session is being read instead of flashing', () => {
  assert.equal(welcomeStep({ ...base, authStatus: 'loading' }), 'wait');
});
test('without accounts (unconfigured or disabled) the app opens as before', () => {
  assert.equal(welcomeStep({ ...base, authStatus: 'unconfigured' }), 'enter');
  assert.equal(welcomeStep({ ...base, accountsEnabled: false }), 'enter');
});
