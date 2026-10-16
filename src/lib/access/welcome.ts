import { create } from 'zustand';
import type { AuthStatus } from '../../store/authStore';

/**
 * The welcome screen is the entrance before the Projects page. It is shown only to someone who is not signed in and has not
 * yet chosen how to start on this browser; afterwards it never comes back during normal navigation. Nothing here reads, moves
 * or deletes local projects, and it has no bearing on the guest trial.
 */
export type WelcomeStep = 'enter' | 'wait' | 'show';

const SEEN_KEY = 'bettercalc.welcome.v1';

export function welcomeStep(input: { accountsEnabled: boolean; authStatus: AuthStatus; seen: boolean }): WelcomeStep {
  const { accountsEnabled, authStatus, seen } = input;
  // Without accounts there is nothing to sign in to: go straight to the projects, as before.
  if (!accountsEnabled || authStatus === 'unconfigured') return 'enter';
  if (authStatus === 'signedIn' || seen) return 'enter';
  // The session is still being read: do not flash the welcome at someone who is about to be recognised.
  if (authStatus === 'loading') return 'wait';
  return 'show';
}

function readSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}

export const welcomeStore = create<{ seen: boolean; markSeen(): void }>((set) => ({
  seen: readSeen(),
  markSeen: () => {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode: the choice then lasts until the page closes */ }
    set({ seen: true });
  },
}));
