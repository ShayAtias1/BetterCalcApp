import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test, before, beforeEach } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { AUTH_STUB } from './supabaseStub.ts';

// Runs the real migrations in an in-process Postgres with a stand-in for Supabase auth/storage. It proves
// the SQL rules (entitlement, quota, ownership, no overwrite); a check on the real project is still needed.
const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const migrationSql = () =>
  readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(new URL(f, MIGRATIONS), 'utf8')).join('\n');

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';
const MB = 1024 * 1024;
const GB = 1024 * MB;

let db: PGlite;
async function as<T>(sub: string | null, fn: () => Promise<T>, role = 'authenticated'): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub ?? ''}', false); set role ${role};`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role;');
  }
}
/** Runs `fn` the way the Storage API does: it tags each request with its operation, which the read policy looks at. */
async function asOp<T>(sub: string, op: string, fn: () => Promise<T>): Promise<T> {
  return as(sub, async () => {
    await db.exec(`select set_config('storage.operation', '${op}', false)`);
    try { return await fn(); } finally { await db.exec(`select set_config('storage.operation', '', false)`); }
  });
}
const del = (uid: string, path: string) => asOp(uid, 'storage.object.delete_many', () => db.exec(`delete from storage.objects where name = '${path}'`));
const q = async (sql: string) => (await db.query<Record<string, any>>(sql)).rows;
const grant = (uid: string, status = 'active', extra = '') =>
  db.exec(`insert into public.entitlements (user_id, status, source${status === 'ended' ? ', ended_at' : ''}${extra ? ', storage_quota_bytes' : ''})
           values ('${uid}', '${status}', 'test'${status === 'ended' ? ", now() - interval '10 days'" : ''}${extra ? `, ${extra}` : ''})`);
const reserve = (uid: string, size: number, name = 'Project') =>
  as(uid, async () => (await q(`select * from public.reserve_cloud_backup('${name}', ${size}, 1, 7)`))[0]);
/** The client's upload: an insert into storage.objects, subject to the bucket policy. */
const upload = (uid: string, path: string, size: number) =>
  asOp(uid, 'storage.object.upload', () => db.exec(`insert into storage.objects (bucket_id, name, owner, metadata) values ('cloud-backups', '${path}', '${uid}', '{"size": ${size}}') returning id`));
const rejects = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, re);

before(async () => {
  db = new PGlite();
  await db.exec(AUTH_STUB);
  await db.exec(migrationSql());
});

beforeEach(async () => {
  await db.exec('delete from storage.objects; delete from public.cloud_backups; delete from public.entitlements; delete from auth.users;');
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@x.co'), ('${B}', 'b@x.co'), ('${C}', 'c@x.co');`);
});

test('the bucket is private, size-limited and restricted to backup files', async () => {
  const [bucket] = await q("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'cloud-backups'");
  assert.equal(bucket.public, false);
  assert.equal(Number(bucket.file_size_limit), 335544320);
  assert.deepEqual(bucket.allowed_mime_types, ['application/octet-stream']);
});

test('without an entitlement there is no cloud access at all', async () => {
  const status = await as(A, async () => (await q('select public.cloud_backup_status() as s'))[0].s);
  assert.deepEqual([status.entitled, status.can_read, status.can_write, status.quota_bytes], [false, false, false, 0]);
  await rejects(reserve(A, MB), /not_entitled/);
});

test('anonymous callers can do nothing', async () => {
  await rejects(as(null, () => q('select public.cloud_backup_status()'), 'anon'), /permission denied/);
  await rejects(as(null, () => q("select * from public.reserve_cloud_backup('x', 1, 1, 1)"), 'anon'), /permission denied/);
  await rejects(as(null, () => q('select * from public.cloud_backups'), 'anon'), /permission denied/);
  await rejects(as(null, () => q('select * from public.entitlements'), 'anon'), /permission denied/);
});

test('clients cannot grant themselves an entitlement or edit it', async () => {
  await rejects(as(A, () => db.exec(`insert into public.entitlements (user_id, status, source) values ('${A}', 'active', 'test')`)), /permission denied/);
  await grant(A);
  await rejects(as(A, () => db.exec("update public.entitlements set storage_quota_bytes = 99999999999")), /permission denied/);
  await rejects(as(A, () => db.exec('delete from public.entitlements')), /permission denied/);
  assert.equal((await as(A, () => q('select * from public.entitlements'))).length, 1);
  assert.equal((await as(B, () => q('select * from public.entitlements'))).length, 0);
});

test('the default quota is 1 GB and status reports usage', async () => {
  await grant(A);
  const s = await as(A, async () => (await q('select public.cloud_backup_status() as s'))[0].s);
  assert.deepEqual([s.entitled, s.can_write, s.can_read, Number(s.quota_bytes), Number(s.used_bytes)], [true, true, true, GB, 0]);
});

test('full flow: reserve, upload to the reserved path, complete, list, download, delete', async () => {
  await grant(A);
  const r = await reserve(A, 5 * MB, 'Villa');
  assert.equal(r.object_path, `${A}/${r.id}.bettercalc`);
  // not listed until completed
  assert.equal((await as(A, () => q("select * from public.cloud_backups where status = 'complete'"))).length, 0);
  await upload(A, r.object_path, 5 * MB);
  await as(A, () => db.exec(`select public.complete_cloud_backup('${r.id}')`));
  const list = await as(A, () => q('select name, status, size_bytes from public.cloud_backups'));
  assert.deepEqual(list.map((b) => [b.name, b.status, Number(b.size_bytes)]), [['Villa', 'complete', 5 * MB]]);
  assert.equal((await as(A, () => q('select name from storage.objects'))).length, 1);
  // delete: the file first, then the row
  await rejects(as(A, () => db.exec(`select public.delete_cloud_backup('${r.id}')`)), /object_exists/);
  await del(A, r.object_path);
  await as(A, () => db.exec(`select public.delete_cloud_backup('${r.id}')`));
  assert.equal((await q('select * from public.cloud_backups')).length, 0);
});

test('quota: reservations count immediately and the 1 GB limit cannot be exceeded', async () => {
  await grant(A);
  await reserve(A, 300 * MB);
  await reserve(A, 300 * MB);
  await reserve(A, 300 * MB);
  await rejects(reserve(A, 200 * MB), /quota_exceeded/);
  const s = await as(A, async () => (await q('select public.cloud_backup_status() as s'))[0].s);
  assert.equal(Number(s.used_bytes), 900 * MB);
  await reserve(A, 124 * MB); // exactly fills the 1 GB
  await rejects(reserve(A, 1), /quota_exceeded/);
});

test('quota is per user and honours a custom quota', async () => {
  await grant(A, 'active', String(10 * MB));
  await grant(B);
  await rejects(reserve(A, 11 * MB), /quota_exceeded/);
  await reserve(A, 10 * MB);
  await reserve(B, 300 * MB); // B is unaffected by A
});

test('a single file above the per-file ceiling and bad sizes are refused', async () => {
  await grant(A);
  await rejects(reserve(A, 335544321), /file_too_large/);
  await rejects(reserve(A, 0), /file_too_large/);
  await rejects(reserve(A, -5), /file_too_large/);
});

test('expired reservations stop counting and cannot be used to upload', async () => {
  await grant(A);
  const r = await reserve(A, 300 * MB);
  await db.exec("update public.cloud_backups set reserved_until = now() - interval '1 minute'");
  const s = await as(A, async () => (await q('select public.cloud_backup_status() as s'))[0].s);
  assert.equal(Number(s.used_bytes), 0);
  await rejects(upload(A, r.object_path, 300 * MB), /row-level security/);
  for (let i = 0; i < 3; i++) await reserve(A, 300 * MB); // the full quota is available again
});

test('at most five uploads can be pending at once', async () => {
  await grant(A);
  for (let i = 0; i < 5; i++) await reserve(A, MB);
  await rejects(reserve(A, MB), /too_many_uploads/);
});

test('uploads are allowed only to the exact reserved path, by its owner, once', async () => {
  await grant(A);
  await grant(B);
  const r = await reserve(A, MB);
  await rejects(upload(A, `${A}/other.bettercalc`, MB), /row-level security/); // unreserved path
  await rejects(upload(B, r.object_path, MB), /row-level security/); // someone else's reservation
  await rejects(upload(A, `${B}/x.bettercalc`, MB), /row-level security/); // another user's folder
  await upload(A, r.object_path, MB);
  await rejects(upload(A, r.object_path, MB), /duplicate key|row-level security/); // never twice
});

test('an uploaded object can never be overwritten or edited', async () => {
  await grant(A);
  const r = await reserve(A, MB);
  await upload(A, r.object_path, MB);
  await as(A, () => db.exec(`select public.complete_cloud_backup('${r.id}')`));
  const changed = await as(A, async () => (await db.query(`update storage.objects set metadata = '{"size": 1}' where name = '${r.object_path}' returning name`)).rows);
  assert.equal(changed.length, 0); // no UPDATE policy: zero rows are visible to update
  await rejects(upload(A, r.object_path, MB), /duplicate key|row-level security/);
});

test('completing needs the object, a fitting size and the owner', async () => {
  await grant(A);
  await grant(B);
  const r = await reserve(A, 5 * MB);
  await rejects(as(A, () => db.exec(`select public.complete_cloud_backup('${r.id}')`)), /object_missing/);
  await upload(A, r.object_path, 5 * MB);
  await rejects(as(B, () => db.exec(`select public.complete_cloud_backup('${r.id}')`)), /not_found/);
  const big = await reserve(A, 5 * MB);
  await upload(A, big.object_path, 6 * MB); // larger than reserved
  assert.equal(await as(A, async () => (await q(`select public.complete_cloud_backup('${big.id}') as r`))[0].r), 'size_mismatch');
  // The refused file keeps its row with the upload window closed: it counts at its real size until it is removed
  // (by the client right away, or by the maintenance job).
  const kept = (await q(`select status, reserved_until <= now() as closed from public.cloud_backups where id = '${big.id}'`))[0];
  assert.deepEqual([kept.status, kept.closed], ['pending', true]);
  const usedWithRefused = await as(A, async () => (await q('select public.cloud_backup_status() as s'))[0].s.used_bytes);
  assert.equal(Number(usedWithRefused), 5 * MB + 6 * MB);
  await del(A, big.object_path); // what the client does
  assert.equal(Number(await as(A, async () => (await q('select public.cloud_backup_status() as s'))[0].s.used_bytes)), 5 * MB);
  assert.equal(Number((await as(null, () => q('select public.cleanup_stale_cloud_backups() as n'), 'service_role'))[0].n), 1);
  const small = await reserve(A, 5 * MB);
  await upload(A, small.object_path, 3 * MB); // smaller than reserved: the real size counts
  await as(A, () => db.exec(`select public.complete_cloud_backup('${small.id}')`));
  assert.equal(Number((await q(`select size_bytes from public.cloud_backups where id = '${small.id}'`))[0].size_bytes), 3 * MB);
});

test('users see and download only their own backups', async () => {
  await grant(A);
  await grant(B);
  const r = await reserve(A, MB);
  await upload(A, r.object_path, MB);
  await as(A, () => db.exec(`select public.complete_cloud_backup('${r.id}')`));
  assert.equal((await as(B, () => q('select * from public.cloud_backups'))).length, 0);
  assert.equal((await as(B, () => q('select * from storage.objects'))).length, 0);
  assert.equal((await as(A, () => q('select * from storage.objects'))).length, 1);
  await del(B, r.object_path); // deletes nothing
  assert.equal((await q('select * from storage.objects')).length, 1);
  await as(B, () => db.exec(`select public.delete_cloud_backup('${r.id}')`)); // not B's: no effect
  assert.equal((await q('select * from public.cloud_backups')).length, 1);
});

test('rows cannot be written directly through the API', async () => {
  await grant(A);
  await rejects(as(A, () => db.exec(`insert into public.cloud_backups (user_id, name, object_path, size_bytes) values ('${A}', 'x', 'y', 1)`)), /permission denied/);
  const r = await reserve(A, MB);
  await rejects(as(A, () => db.exec(`update public.cloud_backups set size_bytes = 1, status = 'complete' where id = '${r.id}'`)), /permission denied/);
  await rejects(as(A, () => db.exec('delete from public.cloud_backups')), /permission denied/);
});

test('grace keeps full access; an ended subscription is read-and-download only for 90 days', async () => {
  await grant(A, 'grace');
  await reserve(A, MB);

  await grant(B);
  const r = await reserve(B, MB);
  await upload(B, r.object_path, MB);
  await as(B, () => db.exec(`select public.complete_cloud_backup('${r.id}')`));
  await db.exec(`update public.entitlements set status = 'ended', ended_at = now() - interval '10 days' where user_id = '${B}'`);
  const s = await as(B, async () => (await q('select public.cloud_backup_status() as s'))[0].s);
  assert.deepEqual([s.can_read, s.can_write], [true, false]);
  assert.equal((await as(B, () => q('select * from public.cloud_backups'))).length, 1);
  assert.equal((await as(B, () => q('select * from storage.objects'))).length, 1); // download still works
  await rejects(reserve(B, MB), /not_entitled/);
  // Removing one's own backup stays possible after the subscription ended: file first, then the record.
  await rejects(as(B, () => db.exec(`select public.delete_cloud_backup('${r.id}')`)), /object_exists/);
  await del(B, r.object_path);
  await as(B, () => db.exec(`select public.delete_cloud_backup('${r.id}')`));
  assert.equal((await q(`select * from public.cloud_backups where user_id = '${B}'`)).length, 0);

  // A second completed backup, to check what happens when the read window closes.
  const r2 = await (async () => { await db.exec(`update public.entitlements set status = 'active', ended_at = null where user_id = '${B}'`); return reserve(B, MB); })();
  await upload(B, r2.object_path, MB);
  await as(B, () => db.exec(`select public.complete_cloud_backup('${r2.id}')`));
  await db.exec(`update public.entitlements set status = 'ended', ended_at = now() - interval '91 days' where user_id = '${B}'`);
  const after = await as(B, async () => (await q('select public.cloud_backup_status() as s'))[0].s);
  assert.deepEqual([after.can_read, after.can_write], [false, false]);
  assert.equal((await as(B, () => q('select * from public.cloud_backups'))).length, 0);
  assert.equal((await as(B, () => q('select * from storage.objects'))).length, 0);
});

test('a subscription that ended also blocks uploads to an already reserved path', async () => {
  await grant(A);
  const r = await reserve(A, MB);
  await db.exec(`update public.entitlements set status = 'ended', ended_at = now()`);
  await rejects(upload(A, r.object_path, MB), /row-level security/);
});

test('deleting the user removes their entitlement and backup rows', async () => {
  await grant(A);
  await reserve(A, MB);
  await db.exec(`delete from auth.users where id = '${A}'`);
  assert.equal((await q('select * from public.cloud_backups')).length, 0);
  assert.equal((await q('select * from public.entitlements')).length, 0);
});

test('maintenance functions are for the service role only; orphans are found', async () => {
  await grant(A);
  const r = await reserve(A, MB);
  await upload(A, r.object_path, MB);
  await db.exec("update public.cloud_backups set reserved_until = now() - interval '1 hour'"); // never completed
  await rejects(as(A, () => q('select public.cleanup_stale_cloud_backups()')), /permission denied/);
  await rejects(as(A, () => q('select * from public.cloud_orphan_objects()')), /permission denied/);
  const orphans = await as(null, () => q('select * from public.cloud_orphan_objects()'), 'service_role');
  assert.deepEqual(orphans.map((o) => o.name), [r.object_path]);
  assert.equal((await as(null, async () => (await q('select public.cleanup_stale_cloud_backups() as n'))[0].n, 'service_role')), 0); // object still there
  await db.exec('delete from storage.objects');
  assert.equal((await as(null, async () => (await q('select public.cleanup_stale_cloud_backups() as n'))[0].n, 'service_role')), 1);
});

test('the SECURITY DEFINER functions pin their search_path', async () => {
  const rows = await q(`select p.proname, array_to_string(p.proconfig, ',') as cfg from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like '%cloud%'`);
  assert.ok(rows.length >= 8);
  for (const r of rows) assert.match(r.cfg, /search_path=/, r.proname);
});

test('quota bypass is closed: a small reservation with a large, never-completed upload keeps counting', async () => {
  await grant(A);
  const r = await reserve(A, 1);
  await upload(A, r.object_path, 300 * MB); // allowed by the bucket limit, far above the reservation
  // During its upload window the file counts at its real size, not the 1 byte reserved.
  let s = await as(A, async () => (await q('select public.cloud_backup_status() as s'))[0].s);
  assert.equal(Number(s.used_bytes), 300 * MB);
  // The client never completes it and the reservation expires.
  await db.exec(`update public.cloud_backups set reserved_until = now() - interval '1 minute' where id = '${r.id}'`);
  s = await as(A, async () => (await q('select public.cloud_backup_status() as s'))[0].s);
  assert.equal(Number(s.used_bytes), 300 * MB); // still counted while the file exists
  // Repeating the trick runs into the quota instead of getting free space.
  for (let i = 0; i < 2; i++) {
    const next = await reserve(A, 1);
    await upload(A, next.object_path, 300 * MB);
    await db.exec(`update public.cloud_backups set reserved_until = now() - interval '1 minute' where id = '${next.id}'`);
  }
  await rejects(reserve(A, 200 * MB), /quota_exceeded/);
  // The maintenance job finds the abandoned files and, once they are removed, the rows go too and the space is free.
  const orphans = await as(null, () => q('select name from public.cloud_orphan_objects()'), 'service_role');
  assert.equal(orphans.length, 3);
  await db.exec(`delete from storage.objects where bucket_id = 'cloud-backups' and name in (${orphans.map((o) => `'${o.name}'`).join(',')})`);
  assert.equal(Number((await as(null, () => q('select public.cleanup_stale_cloud_backups() as n'), 'service_role'))[0].n), 3);
  s = await as(A, async () => (await q('select public.cloud_backup_status() as s'))[0].s);
  assert.equal(Number(s.used_bytes), 0);
});

test('an upload can read its own file back during its upload window (the Storage API needs it)', async () => {
  await grant(A);
  const r = await reserve(A, MB);
  await upload(A, r.object_path, MB);
  // The upload's own INSERT ... RETURNING works (upload() above); a download or listing of it does not.
  assert.equal((await asOp(A, 'storage.object.get_authenticated', () => q(`select * from storage.objects where name = '${r.object_path}'`))).length, 0);
  assert.equal((await asOp(A, 'storage.object.list', () => q(`select * from storage.objects where name = '${r.object_path}'`))).length, 0);
  assert.equal((await asOp(B, 'storage.object.get_authenticated', () => q(`select * from storage.objects where name = '${r.object_path}'`))).length, 0);
});

test('only completed backups can be downloaded; incomplete, refused and expired files cannot, but can be deleted', async () => {
  await grant(A);
  await grant(B);
  const get = (uid: string, path: string) => asOp(uid, 'storage.object.get_authenticated', () => q(`select name from storage.objects where name = '${path}'`));
  const done = await reserve(A, 5 * MB);
  await upload(A, done.object_path, 5 * MB);
  assert.equal((await get(A, done.object_path)).length, 0); // uploaded but not completed
  await as(A, () => db.exec(`select public.complete_cloud_backup('${done.id}')`));
  assert.equal((await get(A, done.object_path)).length, 1); // completed: legitimate download works
  assert.equal((await get(B, done.object_path)).length, 0); // tenant isolation intact
  assert.equal((await asOp(A, 'storage.object.list', () => q('select name from storage.objects'))).length, 1);

  const big = await reserve(A, 5 * MB);
  await upload(A, big.object_path, 6 * MB);
  assert.equal(await as(A, async () => (await q(`select public.complete_cloud_backup('${big.id}') as r`))[0].r), 'size_mismatch');
  assert.equal((await get(A, big.object_path)).length, 0); // refused file stays unreadable

  const stale = await reserve(A, MB);
  await upload(A, stale.object_path, MB);
  await db.exec(`update public.cloud_backups set reserved_until = now() - interval '1 minute' where id = '${stale.id}'`);
  assert.equal((await get(A, stale.object_path)).length, 0); // abandoned file stays unreadable
  assert.equal((await q(`select 1 from storage.objects where name = '${stale.object_path}'`)).length, 1); // still stored and counted

  // Plain SQL (no Storage operation) fails closed for incomplete files too, and a forged path gets nothing.
  assert.deepEqual((await as(A, () => q('select name from storage.objects'))).map((r) => r.name), [done.object_path]);
  await db.exec(`insert into storage.objects (bucket_id, name, metadata) values ('cloud-backups', '${A}/forged.bettercalc', '{"size": 1}')`);
  assert.equal((await get(A, `${A}/forged.bettercalc`)).length, 0);

  // Owners can still remove the unreadable files; others cannot.
  await del(B, big.object_path);
  assert.equal((await q(`select 1 from storage.objects where name = '${big.object_path}'`)).length, 1);
  await del(A, big.object_path);
  await del(A, stale.object_path);
  assert.equal((await q(`select 1 from storage.objects where name in ('${big.object_path}', '${stale.object_path}')`)).length, 0);

  // After the read window closes, even a completed backup is gone from view.
  await db.exec(`update public.entitlements set status = 'ended', ended_at = now() - interval '91 days' where user_id = '${A}'`);
  assert.equal((await get(A, done.object_path)).length, 0);
});

test('API roles have no privileges on identity sequences', async () => {
  const seqs = await q("select c.relname from pg_class c where c.relkind = 'S' and c.relnamespace = 'public'::regnamespace");
  assert.ok(seqs.length >= 2);
  for (const { relname } of seqs) {
    for (const role of ['anon', 'authenticated']) {
      const has = (await q(`select has_sequence_privilege('${role}', 'public.${relname}', 'usage') as u,
                                   has_sequence_privilege('${role}', 'public.${relname}', 'select') as s,
                                   has_sequence_privilege('${role}', 'public.${relname}', 'update') as w`))[0];
      assert.deepEqual([has.u, has.s, has.w], [false, false, false], `${role} on ${relname}`);
    }
    assert.equal((await q(`select has_sequence_privilege('service_role', 'public.${relname}', 'usage') as u`))[0].u, true);
  }
  await rejects(as(A, () => q("select nextval('public.credit_ledger_id_seq')")), /permission denied/);
  await rejects(as(null, () => q("select nextval('public.audit_log_id_seq')"), 'anon'), /permission denied/);
});

test('the owner can delete an abandoned upload after its window closed; nobody else can', async () => {
  await grant(A);
  await grant(B);
  const r = await reserve(A, 1);
  await upload(A, r.object_path, 2 * MB);
  await db.exec(`update public.cloud_backups set reserved_until = now() - interval '1 minute' where id = '${r.id}'`);
  await del(B, r.object_path); // zero rows for B
  assert.equal((await q(`select * from storage.objects where name = '${r.object_path}'`)).length, 1);
  await del(A, r.object_path);
  assert.equal((await q(`select * from storage.objects where name = '${r.object_path}'`)).length, 0);
  assert.equal(Number(await as(A, async () => (await q('select public.cloud_backup_status() as s'))[0].s.used_bytes)), 0);
});

test('cloud_used_bytes is internal: API users cannot call it for anyone', async () => {
  await rejects(as(A, () => q(`select public.cloud_used_bytes('${B}')`)), /permission denied/);
  await rejects(as(null, () => q(`select public.cloud_used_bytes('${B}')`), 'anon'), /permission denied/);
});
