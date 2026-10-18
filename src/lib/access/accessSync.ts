import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import { authStore, type AuthState } from '../../store/authStore';
import { setEditingAllowed } from '../workspaceCapabilities';
import { ACCESS_ENFORCEMENT_ENABLED, ACCOUNTS_ENABLED, evaluateAccess, type AccessDecision } from './accessPolicy';
import { loadTrial, type TrialStorage } from './trial';

export interface AccessSyncDeps {
  auth: Pick<StoreApi<AuthState>, 'getState' | 'subscribe'>;
  storage: TrialStorage | null;
  now: () => number;
  enforce: boolean;
  /** Cancelable clock; tests can advance the seven-day boundary without waiting. */
  schedule?: (callback: () => void, delay: number) => () => void;
  /** Feeds workspaceCapabilities, which the editing surfaces consult. */
  setEditingAllowed: (allowed: boolean) => void;
}

/** What the UI reads (Phase 1D): the decision as computed, whether or not it is being enforced. */
export function createAccessSync(deps: AccessSyncDeps) {
  const store = createStore<AccessDecision>()(() => evaluateAccess('loading', null));

  let inUse = false;
  let running = false;
  let cancelExpiry: (() => void) | undefined;
  const schedule = deps.schedule ?? ((callback: () => void, delay: number) => {
    const timer = setTimeout(callback, delay);
    // Do not keep Node test processes alive; browsers return a numeric timer handle.
    (timer as unknown as { unref?: () => void }).unref?.();
    return () => clearTimeout(timer);
  });
  const refresh = () => {
    cancelExpiry?.();
    cancelExpiry = undefined;
    const auth = deps.auth.getState().status;
    // Merely opening the welcome/legal screens or being signed in does not start a guest trial.
    const trial = deps.enforce && inUse && auth === 'signedOut' ? loadTrial(deps.storage, deps.now()) : null;
    const decision = evaluateAccess(auth, trial);
    store.setState(decision, true);
    deps.setEditingAllowed(deps.enforce ? decision.canCreateOrEdit : true);
    if (running && trial && !trial.expired) {
      cancelExpiry = schedule(refresh, Math.max(1, trial.expiresAt - deps.now()));
    }
  };

  return {
    store,
    /** Called after legal acceptance, when the service workspace becomes available. */
    beginUse() { inUse = true; refresh(); },
    start() {
      running = true;
      refresh();
      const stopAuth = deps.auth.subscribe(refresh);
      const visible = () => { if (document.visibilityState === 'visible') refresh(); };
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visible);
      if (typeof window !== 'undefined') window.addEventListener('storage', refresh);
      return () => {
        running = false;
        inUse = false;
        cancelExpiry?.();
        stopAuth();
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visible);
        if (typeof window !== 'undefined') window.removeEventListener('storage', refresh);
      };
    },
    refresh,
  };
}

/** The app instance: enforcement stays off until the approved activation release. */
export const accessSync = createAccessSync({
  auth: authStore,
  storage: typeof localStorage === 'undefined' ? null : localStorage,
  now: Date.now,
  // Never enforce without sign-in available: a locked user must be able to register.
  enforce: ACCESS_ENFORCEMENT_ENABLED && ACCOUNTS_ENABLED,
  setEditingAllowed,
});
