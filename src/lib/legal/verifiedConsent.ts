import type { Profile } from '../account/accountApi';

export const VERIFIED_CONSENT_KEY = 'bettercalc.verifiedConsent.v1';
type ConsentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Only evidence returned by a successful account verification is written here. */
export function cacheVerifiedConsent(storage: ConsentStorage | null, userId: string, profile: Profile): void {
  try {
    storage?.setItem(VERIFIED_CONSENT_KEY, JSON.stringify({ userId, version: profile.termsVersion, termsAt: profile.termsAcceptedAt, privacyAt: profile.privacyAcceptedAt }));
  } catch { /* storage unavailable: in-memory verification still works */ }
}

export function readVerifiedConsent(storage: ConsentStorage | null, userId: string, version: string): Profile | null {
  try {
    const value = JSON.parse(storage?.getItem(VERIFIED_CONSENT_KEY) ?? 'null');
    if (!userId || value?.userId !== userId || value.version !== version
      || !Number.isFinite(value.termsAt) || !Number.isFinite(value.privacyAt)
      || value.termsAt <= 0 || value.privacyAt <= 0) return null;
    return { displayName: null, locale: null, termsVersion: value.version, termsAcceptedAt: value.termsAt, privacyAcceptedAt: value.privacyAt, onboardingCompleted: true };
  } catch { return null; }
}

export function clearVerifiedConsent(storage: ConsentStorage | null, userId: string): void {
  try {
    if (JSON.parse(storage?.getItem(VERIFIED_CONSENT_KEY) ?? 'null')?.userId === userId) storage?.removeItem(VERIFIED_CONSENT_KEY);
  } catch { /* unreadable evidence is never used */ }
}
