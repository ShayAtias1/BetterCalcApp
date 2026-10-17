import type { AuthStatus } from '../../store/authStore';

/**
 * A guest has no account to record acceptance on, so the acknowledgement of the Terms (and the verify-your-results notice
 * above all) is kept in this browser: the version of the texts and the time. It never touches project data, and a new
 * version of the texts (LEGAL_DOC_VERSION) asks again.
 */
export const GUEST_ACK_KEY = 'bettercalc.guestAck';

export interface GuestAck { version: string; at: number }
export type AckStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readGuestAck(storage: AckStorage | null): GuestAck | null {
  try {
    const raw = storage?.getItem(GUEST_ACK_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<GuestAck>;
    return typeof value.version === 'string' && typeof value.at === 'number' ? { version: value.version, at: value.at } : null;
  } catch {
    return null;
  }
}

export function writeGuestAck(storage: AckStorage | null, version: string, now: number): GuestAck {
  const ack = { version, at: now };
  try { storage?.setItem(GUEST_ACK_KEY, JSON.stringify(ack)); } catch { /* private mode: asked again next visit */ }
  return ack;
}

/** Asked of a signed-out visitor who has passed the welcome screen and has not acknowledged the current version. */
export function guestNeedsAck(input: { accountsEnabled: boolean; authStatus: AuthStatus; welcomeSeen: boolean; ack: GuestAck | null; version: string }): boolean {
  const { accountsEnabled, authStatus, welcomeSeen, ack, version } = input;
  return accountsEnabled && authStatus === 'signedOut' && welcomeSeen && ack?.version !== version;
}
