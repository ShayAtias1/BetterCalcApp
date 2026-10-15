import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getStorageProtection, requestPersistentStorage, RETRY_AFTER_MS } from '../../src/lib/storagePersistence';
import { projectsNeedingBackup, recordBackup, snoozeBackupReminder, REMINDER_AFTER_MS } from '../../src/lib/backup/backupReminder';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}
function manager(persisted: boolean, grant: boolean) {
  let calls = 0;
  return { calls: () => calls, persisted: async () => persisted, persist: async () => { calls++; return grant; } };
}
const DAY = 24 * 60 * 60 * 1000;

test('unsupported browsers are reported and never throw', async () => {
  assert.equal(await getStorageProtection({ storage: {} }), 'unsupported');
  assert.equal(await requestPersistentStorage({ storage: {}, local: memory() }), 'unsupported');
  const broken = { persisted: async () => { throw new Error('x'); }, persist: async () => true };
  assert.equal(await requestPersistentStorage({ storage: broken, local: memory() }), 'unsupported');
});

test('granted request is reported, and an already persistent site is not asked again', async () => {
  const local = memory();
  const m = manager(false, true);
  assert.equal(await requestPersistentStorage({ storage: m, local, now: 1 }), 'persistent');
  assert.equal(m.calls(), 1);
  const already = manager(true, true);
  assert.equal(await requestPersistentStorage({ storage: already, local: memory() }), 'persistent');
  assert.equal(already.calls(), 0);
});

test('a denied request is not repeated until the retry window passes', async () => {
  const local = memory();
  const m = manager(false, false);
  assert.equal(await requestPersistentStorage({ storage: m, local, now: 1000 }), 'not-persistent');
  assert.equal(await requestPersistentStorage({ storage: m, local, now: 1000 + DAY }), 'not-persistent');
  assert.equal(m.calls(), 1);
  await requestPersistentStorage({ storage: m, local, now: 1000 + RETRY_AFTER_MS + 1 });
  assert.equal(m.calls(), 2);
});

test('status check never requests permission', async () => {
  const m = manager(false, true);
  assert.equal(await getStorageProtection({ storage: m }), 'not-persistent');
  assert.equal(m.calls(), 0);
});

test('backup reminder: never exported, changed since export, snooze', () => {
  const storage = memory();
  const now = 100 * DAY;
  const projects = [{ id: 'a', lastTouched: now - DAY }, { id: 'b', lastTouched: now - 20 * DAY }];
  assert.deepEqual(projectsNeedingBackup(projects, now, storage), ['a', 'b']);

  recordBackup(['a', 'b'], now - 10 * DAY, storage);
  // Backed up 10 days ago: b unchanged since (fine), a changed after the export and the export is old.
  assert.deepEqual(projectsNeedingBackup(projects, now, storage), ['a']);

  recordBackup(['a'], now - DAY, storage);
  assert.deepEqual(projectsNeedingBackup(projects, now, storage), []);

  // A recent export does not nag even if the project changed afterwards.
  recordBackup(['a'], now - 2 * DAY, storage);
  assert.deepEqual(projectsNeedingBackup([{ id: 'a', lastTouched: now - DAY }], now, storage), []);
  assert.ok(REMINDER_AFTER_MS > 2 * DAY);

  const stale = [{ id: 'z', lastTouched: now }];
  assert.deepEqual(projectsNeedingBackup(stale, now, storage), ['z']);
  snoozeBackupReminder(now, storage);
  assert.deepEqual(projectsNeedingBackup(stale, now + DAY, storage), []);
  assert.deepEqual(projectsNeedingBackup(stale, now + 8 * DAY, storage), ['z']);
});

test('reminder tolerates missing or corrupt storage', () => {
  assert.deepEqual(projectsNeedingBackup([{ id: 'a', lastTouched: 1 }], 10, null), ['a']);
  const bad = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); } };
  assert.deepEqual(projectsNeedingBackup([{ id: 'a', lastTouched: 1 }], 10, bad), ['a']);
  assert.doesNotThrow(() => recordBackup(['a'], 1, bad));
});
