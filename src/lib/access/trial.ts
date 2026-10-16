/**
 * Guest trial: 7 days of manual work without registering, tracked only in this browser (see the
 * Commercial Roadmap HANDOFF, decision 1). Clearing site data restarts it; that risk is accepted and no
 * device fingerprinting is attempted. The record lives under its own key so signing in or out never
 * touches it, and nothing here reads or writes project data.
 */
export const TRIAL_STORAGE_KEY = 'bettercalc.trial';
export const TRIAL_DAYS = 7;
/** Record format. Records of any other version (written during development, before launch) are ignored. */
export const TRIAL_RECORD_VERSION = 2;
/**
 * Launch time (ms since epoch) once known. A record that starts earlier is pre-launch usage and never
 * counts: it is replaced by a fresh clock on the first visit. Null until the launch moment is fixed;
 * set it in the same change that enables enforcement.
 */
export const TRIAL_NOT_BEFORE: number | null = null;
const DAY_MS = 24 * 60 * 60 * 1000;

export type TrialStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface TrialStatus {
  startedAt: number;
  expiresAt: number;
  expired: boolean;
  /** Whole days left, rounded up; 0 once expired. */
  daysLeft: number;
}

export function trialStatus(startedAt: number, now: number): TrialStatus {
  const expiresAt = startedAt + TRIAL_DAYS * DAY_MS;
  const expired = now >= expiresAt;
  return { startedAt, expiresAt, expired, daysLeft: expired ? 0 : Math.ceil((expiresAt - now) / DAY_MS) };
}

function readStart(storage: TrialStorage, notBefore: number | null): number | null {
  try {
    const parsed = JSON.parse(storage.getItem(TRIAL_STORAGE_KEY) ?? 'null') as { v?: unknown; startedAt?: unknown } | null;
    const startedAt = parsed?.startedAt;
    if (parsed?.v !== TRIAL_RECORD_VERSION) return null;
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) || startedAt <= 0) return null;
    return notBefore !== null && startedAt < notBefore ? null : startedAt;
  } catch {
    return null;
  }
}

/**
 * The trial status, starting the clock on first call. Returns null when the browser will not let us
 * remember anything: with no record we cannot prove the trial ended, so the caller must not restrict.
 */
export function loadTrial(storage: TrialStorage | null, now: number, notBefore: number | null = TRIAL_NOT_BEFORE): TrialStatus | null {
  if (!storage) return null;
  const existing = readStart(storage, notBefore);
  if (existing !== null) return trialStatus(existing, now);
  try {
    storage.setItem(TRIAL_STORAGE_KEY, JSON.stringify({ v: TRIAL_RECORD_VERSION, startedAt: now }));
    return readStart(storage, notBefore) === null ? null : trialStatus(now, now);
  } catch {
    return null;
  }
}
