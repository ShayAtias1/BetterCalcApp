import type { AuthStatus } from '../../store/authStore';

/**
 * A guest has no account to record acceptance on, so the acknowledgement of the Terms (and the verify-your-results notice
 * above all) is kept in this browser: the version of the texts and the time. It never touches project data, and a new
 * version of the texts (LEGAL_DOC_VERSION) asks again.
 */
export const GUEST_ACK_KEY = 'bettercalc.guestAck';
export const GUEST_ACK_HISTORY_KEY = 'bettercalc.guestAckHistory';

export interface GuestAck { version: string; at: number }
export type AckStorage = Pick<Storage, 'getItem' | 'setItem'>;

function validAck(value: unknown): value is GuestAck {
  const ack = value as Partial<GuestAck> | null;
  return !!ack && typeof ack.version === 'string' && ack.version.trim().length > 0
    && typeof ack.at === 'number' && Number.isFinite(ack.at) && ack.at >= 0;
}

export function readGuestAckHistory(storage: AckStorage | null): GuestAck[] {
  try {
    const history: unknown = JSON.parse(storage?.getItem(GUEST_ACK_HISTORY_KEY) ?? '[]');
    return Array.isArray(history) ? history.filter(validAck) : [];
  } catch { return []; }
}

export function readGuestAck(storage: AckStorage | null): GuestAck | null {
  try {
    const raw = storage?.getItem(GUEST_ACK_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<GuestAck>;
    return validAck(value) ? { version: value.version, at: value.at } : null;
  } catch {
    return null;
  }
}

export function writeGuestAck(storage: AckStorage | null, version: string, now: number): GuestAck {
  const ack = { version, at: now };
  if (!validAck(ack)) throw new Error('invalid_guest_consent');
  try {
    const history = readGuestAckHistory(storage);
    const previous = readGuestAck(storage);
    // Preserve the legacy single record before replacing it with the new acceptance.
    if (previous && !history.some((entry) => entry.version === previous.version && entry.at === previous.at)) history.push(previous);
    history.push(ack);
    storage?.setItem(GUEST_ACK_HISTORY_KEY, JSON.stringify(history));
    storage?.setItem(GUEST_ACK_KEY, JSON.stringify(ack));
  } catch { /* private mode: the in-memory acceptance lasts for this page only */ }
  return ack;
}

/** Asked of a signed-out visitor who has passed the welcome screen and has not acknowledged the current version. */
export function guestNeedsAck(input: { accountsEnabled: boolean; authStatus: AuthStatus; welcomeSeen: boolean; ack: GuestAck | null; version: string }): boolean {
  const { accountsEnabled, authStatus, welcomeSeen, ack, version } = input;
  return authStatus !== 'signedIn' && authStatus !== 'loading'
    && (welcomeSeen || authStatus === 'unconfigured' || !accountsEnabled) && ack?.version !== version;
}
