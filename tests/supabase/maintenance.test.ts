import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupCloudBackups, processAccountDeletions, runMaintenance, secretMatches, type MaintenanceClient } from '../../supabase/functions/_shared/maintenance.ts';

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';

/** Records every call in order; rpc results come from `rpcs`, and a user id in `failDelete` makes deleteUser fail. */
function fakeClient(rpcs: Record<string, (args?: Record<string, unknown>) => unknown>, failDelete: string[] = []) {
  const calls: string[] = [];
  const client: MaintenanceClient = {
    rpc: async (fn, args) => {
      calls.push(`rpc:${fn}${args ? ':' + JSON.stringify(args) : ''}`);
      const handler = rpcs[fn];
      return handler ? { data: handler(args), error: null } : { data: null, error: { message: `unexpected ${fn}` } };
    },
    storage: { from: (bucket) => ({ remove: async (paths) => { calls.push(`remove:${bucket}:${paths.join(',')}`); return { data: null, error: null }; } }) },
    auth: { admin: { deleteUser: async (id) => { calls.push(`deleteUser:${id}`); return { error: failDelete.includes(id) ? { message: 'boom' } : null }; } } },
  };
  return { client, calls };
}

test('cleanup removes orphan files through Storage first, then the stale reservations', async () => {
  const many = Array.from({ length: 150 }, (_, i) => ({ name: `${U1}/${i}.bettercalc` }));
  const { client, calls } = fakeClient({ cloud_orphan_objects: () => many, cleanup_stale_cloud_backups: () => 3 });
  assert.deepEqual(await cleanupCloudBackups(client), { files: 150, reservations: 3 });
  assert.equal(calls[0], 'rpc:cloud_orphan_objects');
  assert.ok(calls[1].startsWith('remove:cloud-backups:') && calls[1].split(',').length === 100); // batched
  assert.equal(calls[2].split(',').length, 50);
  assert.equal(calls[3], 'rpc:cleanup_stale_cloud_backups');
});

test('account deletion: files, then the auth user, then the audit entry; one failure does not stop the others', async () => {
  const { client, calls } = fakeClient({
    claim_account_deletions: () => [{ user_id: U1 }, { user_id: U2 }],
    cloud_user_objects: (args) => (args?.p_user === U1 ? [{ name: `${U1}/a.bettercalc` }] : []),
    record_account_deleted: () => null,
  }, [U2]);
  const result = await processAccountDeletions(client, 7);
  assert.deepEqual(result.deleted, [U1]);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], new RegExp(`^${U2}: delete user: boom`));
  assert.deepEqual(calls, [
    'rpc:claim_account_deletions:{"p_grace":"7 days"}',
    `rpc:cloud_user_objects:{"p_user":"${U1}"}`,
    `remove:cloud-backups:${U1}/a.bettercalc`,
    `deleteUser:${U1}`,
    `rpc:record_account_deleted:{"p_user":"${U1}"}`,
    `rpc:cloud_user_objects:{"p_user":"${U2}"}`,
    `deleteUser:${U2}`,
  ]);
  await assert.rejects(processAccountDeletions(client, -1), /invalid grace/);
  await assert.rejects(processAccountDeletions(client, Number.NaN), /invalid grace/);
});

test('a failed cleanup is reported and deletions still run', async () => {
  const { client } = fakeClient({ claim_account_deletions: () => [] });
  const report = await runMaintenance(client, 7);
  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0], /^cleanup: list orphans/);
  assert.deepEqual(report.accountsDeleted, []);
});

test('the scheduler secret must match exactly and be long enough', () => {
  const secret = 'x'.repeat(40);
  assert.equal(secretMatches(secret, secret), true);
  assert.equal(secretMatches(secret + 'y', secret), false);
  assert.equal(secretMatches('x'.repeat(39), secret), false);
  assert.equal(secretMatches(null, secret), false);
  assert.equal(secretMatches('short', 'short'), false); // a weak configured secret disables the endpoint
  assert.equal(secretMatches(secret, undefined), false);
});
