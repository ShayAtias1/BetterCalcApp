import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACCOUNT_LOCAL_KEYS, ACCOUNT_SESSION_KEYS, clearLocalData, signOutClearingLocalData } from '../../src/lib/account/localDataWipe.ts';

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

test('a blocked or failing database delete is reported, never throws and removes no cached key', async () => {
  for (const deleteDatabase of [async () => false, async () => { throw new Error('x'); }]) {
    const local = store([...ACCOUNT_LOCAL_KEYS]);
    const session = store([...ACCOUNT_SESSION_KEYS]);
    assert.equal(await clearLocalData({ deleteDatabase, local, session }), false);
    assert.equal(local.data.size, ACCOUNT_LOCAL_KEYS.length);
    assert.equal(session.data.size, ACCOUNT_SESSION_KEYS.length);
  }
  const broken = { removeItem: () => { throw new Error('blocked'); } };
  assert.equal(await clearLocalData({ deleteDatabase: async () => true, local: broken, session: broken }), true);
});

function flow(opts: { clears: boolean[]; retries?: boolean[]; signOutOk?: boolean }) {
  const log: string[] = [];
  const clears = [...opts.clears], retries = [...(opts.retries ?? [])];
  return {
    log,
    run: () => signOutClearingLocalData({
      clear: async () => { log.push('clear'); return clears.shift() ?? false; },
      askRetry: async () => { log.push('ask'); return retries.shift() ?? false; },
      signOut: async () => { log.push('signOut'); return opts.signOutOk ?? true; },
    }),
  };
}

test('deletion happens before sign-out', async () => {
  const f = flow({ clears: [true] });
  assert.equal(await f.run(), 'signed-out');
  assert.deepEqual(f.log, ['clear', 'signOut']);
});

test('failed deletion does not sign out; cancelling leaves the user signed in', async () => {
  const f = flow({ clears: [false], retries: [false] });
  assert.equal(await f.run(), 'cancelled');
  assert.deepEqual(f.log, ['clear', 'ask']); // signOut never called
});

test('retry after a failure can succeed, and only then signs out', async () => {
  const f = flow({ clears: [false, false, true], retries: [true, true] });
  assert.equal(await f.run(), 'signed-out');
  assert.deepEqual(f.log, ['clear', 'ask', 'clear', 'ask', 'clear', 'signOut']);
});

test('deleted data with a failed sign-out is reported as such, not as a clean sign-out', async () => {
  const f = flow({ clears: [true], signOutOk: false });
  assert.equal(await f.run(), 'sign-out-failed');
});

test('the wipe module never talks to Supabase or the auth store', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync('src/lib/account/localDataWipe.ts', 'utf8');
  assert.ok(!/supabase|authStore|fetch\(/.test(text.replace(/\/\*[\s\S]*?\*\//g, '')));
});
