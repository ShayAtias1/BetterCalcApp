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
  /** Feeds workspaceCapabilities, which the editing surfaces consult. */
  setEditingAllowed: (allowed: boolean) => void;
}

/** What the UI reads (Phase 1D): the decision as computed, whether or not it is being enforced. */
export function createAccessSync(deps: AccessSyncDeps) {
  const store = createStore<AccessDecision>()(() => evaluateAccess('loading', null));

  const refresh = () => {
    // The trial clock starts only once restrictions are enforced; until then nothing is read or written.
    const trial = deps.enforce ? loadTrial(deps.storage, deps.now()) : null;
    const decision = evaluateAccess(deps.auth.getState().status, trial);
    store.setState(decision, true);
    deps.setEditingAllowed(deps.enforce ? decision.canCreateOrEdit : true);
  };

  return {
    store,
    /** Starts tracking: starts the trial clock on first call and follows sign-in state. Returns a stop function. */
    start() {
      refresh();
      return deps.auth.subscribe(refresh);
    },
    refresh,
  };
}

/** The app's instance. Nothing starts it yet: Phase 1D calls `accessSync.start()` once sign-in screens exist. */
export const accessSync = createAccessSync({
  auth: authStore,
  storage: typeof localStorage === 'undefined' ? null : localStorage,
  now: Date.now,
  // Never enforce without sign-in available: a locked user must be able to register.
  enforce: ACCESS_ENFORCEMENT_ENABLED && ACCOUNTS_ENABLED,
  setEditingAllowed,
});
