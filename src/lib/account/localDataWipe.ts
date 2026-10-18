import { NAME_CACHE_KEY } from './accountApi';
import { VERIFIED_CONSENT_KEY } from '../legal/verifiedConsent';
import { PENDING_CONSENT_KEY } from '../legal/pendingConsent';
import { WORKSPACE_SESSION_KEY } from '../workspaceSession';
import { BACKUP_LOG_KEY, REMINDER_SNOOZE_KEY } from '../backup/backupReminder';

/**
 * Browser-storage entries that describe the signed-in account or the local projects. Language, grid, welcome,
 * guest acknowledgement and every other preference are deliberately not listed: they are not account data.
 */
export const ACCOUNT_LOCAL_KEYS = [NAME_CACHE_KEY, VERIFIED_CONSENT_KEY, WORKSPACE_SESSION_KEY, BACKUP_LOG_KEY, REMINDER_SNOOZE_KEY] as const;
export const ACCOUNT_SESSION_KEYS = [PENDING_CONSENT_KEY] as const;

type Removable = Pick<Storage, 'removeItem'> | null;

/**
 * Deletes all local projects and the account-related cached data of this browser. Never signs out and never
 * touches Supabase; callers run it only after an explicit, confirmed request. The project database goes first
 * and the cached keys are removed only once it is really gone, so a failure leaves everything as it was.
 * Returns false when the database could not be deleted (for example another tab keeps it open).
 */
export async function clearLocalData(deps: { deleteDatabase: () => Promise<boolean>; local: Removable; session: Removable }): Promise<boolean> {
  let deleted = false;
  try { deleted = await deps.deleteDatabase(); } catch { deleted = false; }
  if (!deleted) return false;
  for (const key of ACCOUNT_LOCAL_KEYS) { try { deps.local?.removeItem(key); } catch { /* blocked storage */ } }
  for (const key of ACCOUNT_SESSION_KEYS) { try { deps.session?.removeItem(key); } catch { /* blocked storage */ } }
  return true;
}

export type ClearingSignOutResult = 'cancelled' | 'signed-out' | 'sign-out-failed';

/**
 * "Clear local data on sign out": the data is deleted BEFORE signing out. While deletion fails the user stays
 * signed in and is asked whether to retry; declining ends the flow with nothing signed out.
 * Deletion is never reported as done unless `clear` resolved true.
 */
export async function signOutClearingLocalData(deps: {
  clear: () => Promise<boolean>;
  askRetry: () => Promise<boolean>;
  signOut: () => Promise<boolean>;
}): Promise<ClearingSignOutResult> {
  while (!await deps.clear()) {
    if (!await deps.askRetry()) return 'cancelled';
  }
  return await deps.signOut() ? 'signed-out' : 'sign-out-failed';
}
