import type { AuthStatus } from '../../store/authStore';
import type { TrialStatus } from './trial';

/**
 * Master switch for restrictions. Off until the sign-in screens exist (Phase 1D): an expired guest could
 * not register, so nothing may lock editing before then. The policy below is computed either way.
 */
export const ACCESS_ENFORCEMENT_ENABLED = false;

/**
 * Master switch for accounts in the running app: sign-in screens, the account menu, notices, session
 * handling and the guest trial. Off until explicitly approved; while off the app behaves exactly as it did
 * before accounts existed, the trial clock never starts and the Supabase client is never created.
 */
export const ACCOUNTS_ENABLED = false;

/**
 * - full: registered (signed in); full manual access.
 * - trial: guest inside the 7 days.
 * - expired: guest after the trial; may view and export, must register to create or edit.
 * - open: accounts unavailable or not yet known (no Supabase config, session still loading, trial cannot be
 *   tracked); never restricted, because the user could not resolve a restriction.
 */
export type AccessLevel = 'full' | 'trial' | 'expired' | 'open';

export interface AccessDecision {
  level: AccessLevel;
  daysLeft: number | null;
  canView: true;
  canExport: true;
  canCreateOrEdit: boolean;
}

export function evaluateAccess(auth: AuthStatus, trial: TrialStatus | null): AccessDecision {
  const decide = (level: AccessLevel, canCreateOrEdit: boolean): AccessDecision => ({
    level,
    daysLeft: level === 'trial' ? (trial?.daysLeft ?? null) : null,
    canView: true,
    canExport: true,
    canCreateOrEdit,
  });
  if (auth === 'signedIn') return decide('full', true);
  if (auth === 'unconfigured' || auth === 'loading' || !trial) return decide('open', true);
  return trial.expired ? decide('expired', false) : decide('trial', true);
}
