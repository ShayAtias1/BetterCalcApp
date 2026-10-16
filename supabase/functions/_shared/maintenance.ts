/**
 * Server-side maintenance for cloud backups and account deletion. Runs only in the account-maintenance Edge Function
 * with the service role; never bundled into the web app. Pure: the Supabase client is passed in, so the Node tests
 * exercise exactly this code.
 *
 * Order matters and follows docs/SUPABASE-SETUP.md: files are removed through the Storage API (never by deleting
 * storage.objects rows), and only then the database rows / the auth user that point at them.
 */
export const CLOUD_BUCKET = 'cloud-backups';
const REMOVE_BATCH = 100;

type Result<T> = { data: T; error: { message: string } | null };

/** The slice of the service-role client this code uses. */
export interface MaintenanceClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<Result<unknown>>;
  storage: { from(bucket: string): { remove(paths: string[]): PromiseLike<Result<unknown>> } };
  auth: { admin: { deleteUser(id: string): PromiseLike<{ error: { message: string } | null }> } };
}

export interface MaintenanceReport {
  orphanFilesRemoved: number;
  staleReservationsRemoved: number;
  accountsDeleted: string[];
  failures: string[];
}

function unwrap<T>(result: Result<T>, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

async function removeFiles(client: MaintenanceClient, names: string[]): Promise<void> {
  for (let i = 0; i < names.length; i += REMOVE_BATCH) {
    unwrap(await client.storage.from(CLOUD_BUCKET).remove(names.slice(i, i + REMOVE_BATCH)), 'remove files');
  }
}

const names = (rows: unknown): string[] => (Array.isArray(rows) ? rows.map((r) => String((r as { name: unknown }).name)) : []);

/** Files without a completed backup whose upload window has closed, then the reservations left without a file. */
export async function cleanupCloudBackups(client: MaintenanceClient): Promise<{ files: number; reservations: number }> {
  const orphans = names(unwrap(await client.rpc('cloud_orphan_objects'), 'list orphans'));
  await removeFiles(client, orphans);
  const reservations = Number(unwrap(await client.rpc('cleanup_stale_cloud_backups'), 'cleanup reservations') ?? 0);
  return { files: orphans.length, reservations };
}

/**
 * Carries out deletion requests older than the grace period: every cloud file of the user, then the auth user (which
 * cascades to the profile, entitlement, backups, wallet, ledger, usage, billing profile and the request; payments keep
 * their row without the user link). Local projects on the user's devices are never involved. One failing account does
 * not stop the others; it stays 'processing' and is retried on the next run.
 */
export async function processAccountDeletions(client: MaintenanceClient, graceDays: number): Promise<{ deleted: string[]; failures: string[] }> {
  if (!Number.isFinite(graceDays) || graceDays < 0) throw new Error('invalid grace period');
  const rows = unwrap(await client.rpc('claim_account_deletions', { p_grace: `${graceDays} days` }), 'claim deletions');
  const users = Array.isArray(rows) ? rows.map((r) => String((r as { user_id: unknown }).user_id)) : [];
  const deleted: string[] = [];
  const failures: string[] = [];
  for (const userId of users) {
    try {
      await removeFiles(client, names(unwrap(await client.rpc('cloud_user_objects', { p_user: userId }), 'list user files')));
      const { error } = await client.auth.admin.deleteUser(userId);
      if (error) throw new Error(`delete user: ${error.message}`);
      unwrap(await client.rpc('record_account_deleted', { p_user: userId }), 'audit');
      deleted.push(userId);
    } catch (error) {
      failures.push(`${userId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { deleted, failures };
}

export async function runMaintenance(client: MaintenanceClient, graceDays: number): Promise<MaintenanceReport> {
  const failures: string[] = [];
  let orphanFilesRemoved = 0;
  let staleReservationsRemoved = 0;
  try {
    const cleaned = await cleanupCloudBackups(client);
    orphanFilesRemoved = cleaned.files;
    staleReservationsRemoved = cleaned.reservations;
  } catch (error) {
    failures.push(`cleanup: ${error instanceof Error ? error.message : String(error)}`);
  }
  const deletions = await processAccountDeletions(client, graceDays);
  return { orphanFilesRemoved, staleReservationsRemoved, accountsDeleted: deletions.deleted, failures: [...failures, ...deletions.failures] };
}

/** Constant-time comparison of the shared secret the scheduler sends. */
export function secretMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected || expected.length < 32) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}
