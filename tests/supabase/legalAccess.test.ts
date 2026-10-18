import { LEGAL_DOC_VERSION } from '../../src/lib/legal/legalDocs.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { legalAccessState } from '../../src/lib/access/legalAccess.ts';
import { FLAGS_OFF, saveBillingProfile, getCommercialFlags, type AccountClient } from '../../src/lib/account/accountApi.ts';
import { GUEST_ACK_KEY, readGuestAckHistory, writeGuestAck } from '../../src/lib/access/guestAck.ts';
import { hasPendingConsent, markPendingConsent, PENDING_CONSENT_KEY } from '../../src/lib/legal/pendingConsent.ts';

const base = {
  accountsEnabled: true, authStatus: 'signedIn' as const, welcomeSeen: true, ack: null,
  profile: { displayName: 'Dana', locale: null, termsVersion: LEGAL_DOC_VERSION, termsAcceptedAt: 1, privacyAcceptedAt: 1, onboardingCompleted: true },
  flags: { ...FLAGS_OFF, legalVersion: LEGAL_DOC_VERSION }, loading: false, loadFailed: false,
};

test('the service gate requires explicit, matching account acceptance even for restored sessions', () => {
  assert.equal(legalAccessState(base), 'ready');
  assert.equal(legalAccessState({ ...base, profile: { ...base.profile, termsVersion: null } }), 'account');
  assert.equal(legalAccessState({ ...base, profile: { ...base.profile, onboardingCompleted: false } }), 'account');
  assert.equal(legalAccessState({ ...base, loading: true, profile: null }), 'wait');
  assert.equal(legalAccessState({ ...base, profile: { ...base.profile, privacyAcceptedAt: null } }), 'account');
  assert.equal(legalAccessState({ ...base, loading: true }), 'ready');
  assert.equal(legalAccessState({ ...base, loadFailed: true }), 'ready');
  assert.equal(legalAccessState({ ...base, profile: null }), 'wait');
  assert.equal(legalAccessState({ ...base, authStatus: 'loading' }), 'wait');
});

test('new effective versions require the matching displayed text, then renewed explicit acceptance', () => {
  const updated = { ...base, flags: { ...FLAGS_OFF, legalVersion: 'v2' } };
  assert.equal(legalAccessState(updated), 'version-mismatch');
  assert.equal(legalAccessState(updated, 'v2'), 'account');
  assert.equal(legalAccessState({ ...updated, profile: { ...base.profile, termsVersion: 'v2' } }, 'v2'), 'ready');
  assert.equal(legalAccessState({ ...base, profile: { ...base.profile, termsVersion: 'v2' } }), 'account');
});

test('guests cannot bypass consent using unconfigured accounts, an old acknowledgement or welcome navigation', () => {
  const guest = { ...base, authStatus: 'signedOut' as const };
  assert.equal(legalAccessState({ ...guest, welcomeSeen: false }), 'welcome');
  assert.equal(legalAccessState(guest), 'guest');
  assert.equal(legalAccessState({ ...guest, ack: { version: 'old', at: 1 } }), 'guest');
  assert.equal(legalAccessState({ ...guest, ack: { version: LEGAL_DOC_VERSION, at: 1 } }), 'ready');
  assert.equal(legalAccessState({ ...guest, authStatus: 'unconfigured', welcomeSeen: false }), 'guest');
  assert.equal(legalAccessState({ ...guest, accountsEnabled: false, welcomeSeen: false }), 'guest');
});

test('guest consent keeps legacy evidence and every subsequent version and timestamp', () => {
  const values = new Map([[GUEST_ACK_KEY, JSON.stringify({ version: 'legacy', at: 10 })]]);
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, v) };
  writeGuestAck(storage, 'v1', 20);
  writeGuestAck(storage, 'v2', 30);
  assert.deepEqual(readGuestAckHistory(storage), [{ version: 'legacy', at: 10 }, { version: 'v1', at: 20 }, { version: 'v2', at: 30 }]);
  assert.throws(() => writeGuestAck(storage, '', 40), /invalid_guest_consent/);
});

test('disabled or unreadable payment flags reject billing writes without touching stored data', async () => {
  for (const result of [{ data: { payments_enabled: false }, error: null }, { data: null, error: { message: 'offline' } }]) {
    let writes = 0;
    const client = { rpc: async () => result, from: () => { writes++; throw new Error('must not touch billing details'); } } as unknown as AccountClient;
    await assert.rejects(saveBillingProfile(client, 'u1', { invoiceName: 'Existing', taxId: '123', addressLine: '', city: '', postalCode: '' }), /billing-disabled/);
    assert.equal(writes, 0);
  }
});

test('consent verification cannot mistake a failed flags request for a confirmed pending version', async () => {
  const client = { rpc: async () => ({ data: null, error: new TypeError('Failed to fetch') }) } as unknown as AccountClient;
  await assert.rejects(getCommercialFlags(client, true), /Failed to fetch/);
  assert.deepEqual(await getCommercialFlags(client), FLAGS_OFF);
});

test('OAuth receipts bind agreement to the displayed version, expire, and reject old boolean markers', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, v), removeItem: (k: string) => void values.delete(k) };
  storage.setItem(PENDING_CONSENT_KEY, '1');
  assert.equal(hasPendingConsent(storage, 'pending', 1000), false);
  markPendingConsent(storage, 'pending', 1000);
  assert.equal(hasPendingConsent(storage, 'pending', 2000), true);
  assert.equal(hasPendingConsent(storage, 'v2', 2000), false);
  assert.equal(hasPendingConsent(storage, 'pending', 0), false);
  assert.equal(hasPendingConsent(storage, 'pending', 1000 + 3600001), false);
});


test('temporary failure preserves verified consent and otherwise requires explicit local consent only', () => {
  assert.equal(legalAccessState({ ...base, loadFailed: true }), 'ready');
  assert.equal(legalAccessState({ ...base, profile: null, loadFailed: true }), 'local-consent');
  assert.equal(legalAccessState({ ...base, profile: null, loadFailed: true, ack: { version: LEGAL_DOC_VERSION, at: 1 } }), 'local');
  assert.equal(legalAccessState({ ...base, profile: null, loadFailed: true, ack: { version: 'old', at: 1 } }), 'local-consent');
  assert.equal(legalAccessState({ ...base, loadFailed: true, flags: { ...FLAGS_OFF, legalVersion: 'new' } }), 'version-mismatch');
});

test('verified consent cache is user- and document-specific and does not fabricate account acceptance', async () => {
  const { cacheVerifiedConsent, readVerifiedConsent } = await import('../../src/lib/legal/verifiedConsent.ts');
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, v), removeItem: (k: string) => void values.delete(k) };
  cacheVerifiedConsent(storage, 'u1', base.profile);
  assert.equal(readVerifiedConsent(storage, 'u1', LEGAL_DOC_VERSION)?.termsAcceptedAt, 1);
  assert.equal(readVerifiedConsent(storage, 'u2', LEGAL_DOC_VERSION), null);
  assert.equal(readVerifiedConsent(storage, 'u1', 'new-version'), null);
  cacheVerifiedConsent(storage, 'u1', { ...base.profile, privacyAcceptedAt: null });
  assert.equal(readVerifiedConsent(storage, 'u1', LEGAL_DOC_VERSION), null);
});


test('only loopback development previews use explicit local consent for a server-version mismatch', () => {
  const mismatch = { ...base, flags: FLAGS_OFF };
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    const development = { enabled: true, hostname };
    assert.equal(legalAccessState(mismatch, LEGAL_DOC_VERSION, development), 'local-consent');
    assert.equal(legalAccessState({ ...mismatch, ack: { version: 'old', at: 1 } }, LEGAL_DOC_VERSION, development), 'local-consent');
    assert.equal(legalAccessState({ ...mismatch, ack: { version: LEGAL_DOC_VERSION, at: 1 } }, LEGAL_DOC_VERSION, development), 'local');
    assert.equal(legalAccessState(mismatch, LEGAL_DOC_VERSION, { enabled: false, hostname }), 'version-mismatch');
  }
  assert.equal(legalAccessState(mismatch, LEGAL_DOC_VERSION, { enabled: true, hostname: 'bettercalcapp.netlify.app' }), 'version-mismatch');
  assert.equal(legalAccessState(mismatch), 'version-mismatch');
  assert.equal(mismatch.profile.termsVersion, LEGAL_DOC_VERSION);
  assert.equal(mismatch.flags.legalVersion, null, 'preview must not fabricate a server version');
});
