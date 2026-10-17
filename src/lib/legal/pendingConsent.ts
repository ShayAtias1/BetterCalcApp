/** An explicit pre-OAuth agreement, carried only across this tab's auth redirect. */
export const PENDING_CONSENT_KEY = 'bettercalc.consent-pending';
type ConsentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const MAX_AGE_MS = 60 * 60 * 1000;
export function consentSessionStorage(): ConsentStorage | null {
  try { return sessionStorage; } catch { return null; }
}
export function markPendingConsent(storage: ConsentStorage | null, version: string, now: number): void {
  try { storage?.setItem(PENDING_CONSENT_KEY, JSON.stringify({ version, at: now })); } catch { /* onboarding asks again */ }
}
export function clearPendingConsent(storage: ConsentStorage | null): void {
  try { storage?.removeItem(PENDING_CONSENT_KEY); } catch { /* no persisted receipt */ }
}
export function hasPendingConsent(storage: ConsentStorage | null, version: string, now: number): boolean {
  try {
    const receipt = JSON.parse(storage?.getItem(PENDING_CONSENT_KEY) ?? 'null');
    return receipt?.version === version && typeof receipt.at === 'number' && Number.isFinite(receipt.at)
      && receipt.at <= now && now - receipt.at <= MAX_AGE_MS;
  } catch { return false; }
}
