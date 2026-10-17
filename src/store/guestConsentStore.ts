import { create } from 'zustand';
import { readGuestAck, writeGuestAck, type GuestAck } from '../lib/access/guestAck';

const storage = (): Storage | null => { try { return window.localStorage; } catch { return null; } };

/** Shared with the access gate so private-mode acceptance also unlocks this session. */
export const useGuestConsent = create<{ ack: GuestAck | null; accept(version: string): void }>((set) => ({
  ack: readGuestAck(storage()),
  accept: (version) => set({ ack: writeGuestAck(storage(), version, Date.now()) }),
}));
