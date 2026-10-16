import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cloudUsage,
  deleteCloudBackup,
  getCloudStatus,
  listCloudBackups,
  restoreCloudBackup,
  uploadProjectBackup,
  CloudBackupError,
  type CloudClient,
} from '../../src/lib/cloud/cloudBackup.ts';

const MB = 1024 * 1024;
type Calls = Array<[string, unknown]>;

/** A fake Supabase client whose server side behaves like the migration: reserve → upload → complete. */
function fakeClient(over: { rpc?: Record<string, (args: any) => any>; upload?: () => any; remove?: () => any; download?: () => any; rows?: any[] } = {}) {
  const calls: Calls = [];
  const rpcs: Record<string, (args: any) => any> = {
    cloud_backup_status: () => ({ data: { entitled: true, can_write: true, can_read: true, status: 'active', quota_bytes: 1000, used_bytes: 850, max_file_bytes: 300 }, error: null }),
    reserve_cloud_backup: () => ({ data: [{ id: 'bk1', object_path: 'u/bk1.bettercalc' }], error: null }),
    complete_cloud_backup: () => ({ data: 'complete', error: null }),
    delete_cloud_backup: () => ({ data: null, error: null }),
    ...over.rpc,
  };
  const client = {
    rpc: async (name: string, args?: unknown) => { calls.push([`rpc:${name}`, args]); return rpcs[name](args); },
    from: (table: string) => {
      const chain: any = {
        select: () => chain, eq: () => chain,
        order: async () => ({ data: over.rows ?? [], error: null }),
        maybeSingle: async () => ({ data: (over.rows ?? [])[0] ?? null, error: null }),
      };
      calls.push([`from:${table}`, null]);
      return chain;
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _body: Blob, opts: unknown) => { calls.push([`upload:${bucket}:${path}`, opts]); return over.upload?.() ?? { data: {}, error: null }; },
        download: async (path: string) => { calls.push([`download:${path}`, null]); return over.download?.() ?? { data: new Blob(['x']), error: null }; },
        remove: async (paths: string[]) => { calls.push([`remove:${paths[0]}`, null]); return over.remove?.() ?? { data: [{}], error: null }; },
      }),
    },
  } as unknown as CloudClient;
  return { client, calls };
}
const names = (calls: Calls) => calls.map(([n]) => n);
const exportFn = async () => ({ bytes: new Uint8Array(5 * MB), projectCount: 1 });

test('usage levels: the warning starts at 80% and full at 100%', () => {
  assert.equal(cloudUsage(0, 1000), 'ok');
  assert.equal(cloudUsage(799, 1000), 'ok');
  assert.equal(cloudUsage(800, 1000), 'warning');
  assert.equal(cloudUsage(1000, 1000), 'full');
  assert.equal(cloudUsage(5, 0), 'ok');
});

test('status is read from the server and carries the usage level', async () => {
  const { client } = fakeClient();
  const s = await getCloudStatus(client);
  assert.deepEqual([s.entitled, s.canWrite, s.canRead, s.quotaBytes, s.usedBytes, s.usage], [true, true, true, 1000, 850, 'warning']);
  const none = await getCloudStatus(fakeClient({ rpc: { cloud_backup_status: () => ({ data: { entitled: false, can_read: false, can_write: false, quota_bytes: 0, used_bytes: 0 }, error: null }) } }).client);
  assert.deepEqual([none.entitled, none.canWrite, none.usage], [false, false, 'ok']);
});

test('upload: export → reserve → upload (never upsert) → complete, with the exact size', async () => {
  const { client, calls } = fakeClient();
  const result = await uploadProjectBackup(client, { projectId: 'p', name: 'Villa' }, undefined, exportFn as never);
  assert.deepEqual(names(calls), ['rpc:reserve_cloud_backup', 'upload:cloud-backups:u/bk1.bettercalc', 'rpc:complete_cloud_backup']);
  const reserve = calls[0][1] as Record<string, unknown>;
  assert.deepEqual([reserve.p_name, reserve.p_size_bytes, reserve.p_project_count], ['Villa', 5 * MB, 1]);
  assert.deepEqual(calls[1][1], { contentType: 'application/octet-stream', upsert: false });
  assert.equal(result?.sizeBytes, 5 * MB);
});

test('upload cancelled at the large-backup warning does nothing on the server', async () => {
  const { client, calls } = fakeClient();
  assert.equal(await uploadProjectBackup(client, { projectId: 'p', name: 'x' }, undefined, (async () => null) as never), null);
  assert.deepEqual(calls, []);
});

test('server refusals map to clear errors and nothing is uploaded', async () => {
  for (const [message, code] of [['not_entitled', 'not-entitled'], ['quota_exceeded', 'quota-exceeded'], ['file_too_large', 'file-too-large'], ['too_many_uploads', 'too-many-uploads']] as const) {
    const { client, calls } = fakeClient({ rpc: { reserve_cloud_backup: () => ({ data: null, error: { message } }) } });
    await assert.rejects(uploadProjectBackup(client, { projectId: 'p', name: 'x' }, undefined, exportFn as never), (e: CloudBackupError) => e.code === code);
    assert.ok(!names(calls).some((n) => n.startsWith('upload')));
  }
});

test('a failed upload removes the partial file and reports the cause', async () => {
  const { client, calls } = fakeClient({ upload: () => ({ data: null, error: { message: 'new row violates row-level security policy' } }) });
  await assert.rejects(uploadProjectBackup(client, { projectId: 'p', name: 'x' }, undefined, exportFn as never), (e: CloudBackupError) => e.code === 'not-entitled');
  assert.ok(names(calls).includes('remove:u/bk1.bettercalc'));
  assert.ok(!names(calls).includes('rpc:complete_cloud_backup'));
});

test('offline during upload is reported as a network error and cleaned up', async () => {
  const { client, calls } = fakeClient({ upload: () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(uploadProjectBackup(client, { projectId: 'p', name: 'x' }, undefined, exportFn as never), (e: CloudBackupError) => e.code === 'network');
  assert.ok(names(calls).includes('remove:u/bk1.bettercalc'));
});

test('a file the server finds larger than reserved is not kept', async () => {
  const { client, calls } = fakeClient({ rpc: { complete_cloud_backup: () => ({ data: 'size_mismatch', error: null }) } });
  await assert.rejects(uploadProjectBackup(client, { projectId: 'p', name: 'x' }, undefined, exportFn as never), (e: CloudBackupError) => e.code === 'file-too-large');
  assert.ok(names(calls).includes('remove:u/bk1.bettercalc'));
});

test('list returns completed backups, newest first, in a plain shape', async () => {
  const { client } = fakeClient({ rows: [{ id: 'a', name: 'Villa', size_bytes: '2048', project_count: 1, created_at: '2026-10-17T10:00:00Z' }] });
  assert.deepEqual(await listCloudBackups(client), [{ id: 'a', name: 'Villa', sizeBytes: 2048, projectCount: 1, createdAt: Date.parse('2026-10-17T10:00:00Z') }]);
});

test('restore downloads the file and hands it to the existing import (which never overwrites)', async () => {
  const { client, calls } = fakeClient({ rows: [{ object_path: 'u/a.bettercalc' }] });
  const seen: unknown[] = [];
  const imported = { projects: [{ projectId: 'n', name: 'Villa', importedAsCopy: true }], droppedPlanLinks: [], detachedComparisonRefs: [] };
  const result = await restoreCloudBackup(client, 'a', undefined, (async (blob: Blob) => { seen.push(blob.size); return imported; }) as never);
  assert.deepEqual(result, imported);
  assert.ok(names(calls).includes('download:u/a.bettercalc'));
  assert.deepEqual(seen, [1]);
});

test('restore of an unknown or corrupt backup fails cleanly', async () => {
  await assert.rejects(restoreCloudBackup(fakeClient({ rows: [] }).client, 'zz'), (e: CloudBackupError) => e.code === 'not-found');
  const { client } = fakeClient({ rows: [{ object_path: 'u/a.bettercalc' }], download: () => ({ data: null, error: { message: 'Failed to fetch' } }) });
  await assert.rejects(restoreCloudBackup(client, 'a'), (e: CloudBackupError) => e.code === 'network');
});

test('delete removes the cloud file first and then its record', async () => {
  const { client, calls } = fakeClient({ rows: [{ object_path: 'u/a.bettercalc' }] });
  await deleteCloudBackup(client, 'a');
  assert.deepEqual(names(calls).filter((n) => n.startsWith('remove') || n.startsWith('rpc')), ['remove:u/a.bettercalc', 'rpc:delete_cloud_backup']);
  const refused = fakeClient({ rows: [{ object_path: 'u/a.bettercalc' }], rpc: { delete_cloud_backup: () => ({ data: null, error: { message: 'not_entitled' } }) } });
  await assert.rejects(deleteCloudBackup(refused.client, 'a'), (e: CloudBackupError) => e.code === 'not-entitled');
});

test('the cloud code never touches the project database directly', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync('src/lib/cloud/cloudBackup.ts', 'utf8');
  assert.ok(!/indexedDB|openDB|deleteProject|deleteDatabase|writeImportedProjects/.test(text));
  assert.ok(!/service_role|sb_secret_/.test(text));
});
