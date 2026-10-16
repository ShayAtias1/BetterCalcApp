import { create } from 'zustand';
import type { LegalKind } from '../lib/legal/legalDocs';

export type AccountSection = 'profile' | 'subscription' | 'plans' | 'billing';

/** Which account surface is open. Pure view state; nothing here is stored or sent. */
export const useAccountUi = create<{
  pageOpen: boolean;
  section: AccountSection;
  legal: LegalKind | null;
  cloudOpen: boolean;
  aiSoonOpen: boolean;
  setAiSoonOpen(open: boolean): void;
  openPage(section?: AccountSection): void;
  closePage(): void;
  openLegal(kind: LegalKind): void;
  closeLegal(): void;
  setCloudOpen(open: boolean): void;
}>((set) => ({
  pageOpen: false,
  section: 'profile',
  legal: null,
  cloudOpen: false,
  aiSoonOpen: false,
  setAiSoonOpen: (aiSoonOpen) => set({ aiSoonOpen }),
  openPage: (section = 'profile') => set({ pageOpen: true, section }),
  closePage: () => set({ pageOpen: false }),
  openLegal: (legal) => set({ legal }),
  closeLegal: () => set({ legal: null }),
  setCloudOpen: (cloudOpen) => set({ cloudOpen }),
}));

const CONSENT_KEY = 'bettercalc.consent-pending';
/**
 * The registration form's "I agree" is remembered for this tab only, so a Google round trip does not ask again.
 * The server records the agreement only when onboarding completes.
 */
export function markConsentPending(): void {
  try { sessionStorage.setItem(CONSENT_KEY, '1'); } catch { /* storage blocked: the onboarding step asks instead */ }
}
export function takeConsentPending(): boolean {
  try {
    const pending = sessionStorage.getItem(CONSENT_KEY) === '1';
    sessionStorage.removeItem(CONSENT_KEY);
    return pending;
  } catch {
    return false;
  }
}
