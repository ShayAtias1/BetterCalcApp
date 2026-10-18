import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACCOUNT_LOCAL_KEYS, ACCOUNT_SESSION_KEYS, clearLocalData } from '../../src/lib/account/localDataWipe.ts';

function store(initial: string[]) {
  const data = new Map(initial.map((k) => [k, '1']));
  return { data, removeItem: (k: string) => void data.delete(k) };
}

test('clearing removes only account/project keys and the project database', async () => {
  const local = store([...ACCOUNT_LOCAL_KEYS, 'bettercalc.uiLanguage', 'bettercalc.grid', 'unrelated.site.key']);
  const session = store([...ACCOUNT_SESSION_KEYS, 'other']);
  let dbCalls = 0;
  assert.equal(await clearLocalData({ deleteDatabase: async () => (dbCalls++, true), local, session }), true);
  assert.equal(dbCalls, 1);
  assert.deepEqual([...local.data.keys()].sort(), ['bettercalc.grid', 'bettercalc.uiLanguage', 'unrelated.site.key']);
  assert.deepEqual([...session.data.keys()], ['other']);
});

test('a blocked or failing database delete is reported and never throws', async () => {
  const local = store([...ACCOUNT_LOCAL_KEYS]);
  assert.equal(await clearLocalData({ deleteDatabase: async () => false, local, session: null }), false);
  assert.equal(await clearLocalData({ deleteDatabase: async () => { throw new Error('x'); }, local, session: null }), false);
  const broken = { removeItem: () => { throw new Error('blocked'); } };
  assert.equal(await clearLocalData({ deleteDatabase: async () => true, local: broken, session: broken }), true);
});

test('auth sign-out code stays free of deletion (deletion only happens in the confirmed UI flow)', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync('src/lib/account/localDataWipe.ts', 'utf8');
  assert.ok(!/supabase|signOut|fetch\(/.test(text.replace(/\/\*[\s\S]*?\*\//g, '')));
});
