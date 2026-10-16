import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import { getSupabase } from '../lib/supabase/client';
import { authStore, type AuthState } from './authStore';
import {
  completeOnboarding,
  FLAGS_OFF,
  getAccountOverview,
  getCommercialFlags,
  getProfile,
  listPublicPlans,
  type PlanSummary,
  updateDisplayName,
  type AccountClient,
  type AccountOverview,
  type CommercialFlags,
  type Profile,
} from '../lib/account/accountApi';

/** Used as the accepted version until the terms and privacy texts are published. */
export const LEGAL_VERSION_PENDING = 'pending';

/**
 * The signed-in user's account data and the server's commercial switches. Loaded after sign-in, cleared on
 * sign-out; a failed or offline load leaves the app fully usable (nothing here gates local work).
 */
export interface AccountState {
  flags: CommercialFlags;
  profile: Profile | null;
  overview: AccountOverview | null;
  /** The published plans, to show a subscription's name instead of its code. Empty until plans are published. */
  plans: PlanSummary[];
  /** Signed in, profile loaded, and the name/consent step is not done yet. */
  needsOnboarding: boolean;
  loading: boolean;
  /** The last load failed (offline or server error). */
  loadFailed: boolean;
  refresh(): Promise<void>;
  submitOnboarding(name: string): Promise<void>;
  saveName(name: string): Promise<void>;
}

export interface AccountDeps {
  auth: Pick<StoreApi<AuthState>, 'getState' | 'subscribe'>;
  loadClient: () => Promise<AccountClient | null>;
}

export function createAccountStore(deps: AccountDeps) {
  let loadId = 0;

  const store = createStore<AccountState>()((set, get) => ({
    flags: FLAGS_OFF,
    profile: null,
    overview: null,
    plans: [],
    needsOnboarding: false,
    loading: false,
    loadFailed: false,

    async refresh() {
      const client = await deps.loadClient();
      if (!client) return;
      const id = ++loadId;
      set({ loading: true });
      const signedIn = deps.auth.getState().status === 'signedIn';
      try {
        const flags = await getCommercialFlags(client);
        if (id !== loadId) return;
        if (!signedIn) return set({ flags, profile: null, overview: null, needsOnboarding: false, loading: false, loadFailed: false });
        const [profile, overview, plans] = await Promise.all([getProfile(client), getAccountOverview(client), listPublicPlans(client).catch(() => [] as PlanSummary[])]);
        if (id !== loadId) return;
        set({ flags, profile, overview, plans, needsOnboarding: !!profile && !profile.onboardingCompleted, loading: false, loadFailed: false });
      } catch {
        if (id === loadId) set({ loading: false, loadFailed: true });
      }
    },

    async submitOnboarding(name) {
      const client = await deps.loadClient();
      if (!client) return;
      await completeOnboarding(client, name, get().flags.legalVersion ?? LEGAL_VERSION_PENDING);
      await get().refresh();
    },

    async saveName(name) {
      const client = await deps.loadClient();
      const user = deps.auth.getState().user;
      if (!client || !user) return;
      const saved = await updateDisplayName(client, user.id, name);
      const profile = get().profile;
      if (profile) set({ profile: { ...profile, displayName: saved } });
    },
  }));

  return {
    store,
    /** Follows sign-in state: loads on sign-in, clears on sign-out. Returns a stop function. */
    start() {
      let last: string | null = null;
      const sync = () => {
        const status = deps.auth.getState().status;
        if (status === last) return;
        last = status;
        if (status === 'signedIn') void store.getState().refresh();
        else {
          loadId += 1;
          store.setState({ profile: null, overview: null, plans: [], needsOnboarding: false, loadFailed: false, loading: false });
          if (status === 'signedOut') void store.getState().refresh(); // flags only, for the Coming Soon states
        }
      };
      sync();
      return deps.auth.subscribe(sync);
    },
  };
}

export const accountSync = createAccountStore({
  auth: authStore,
  loadClient: async () => (await getSupabase()) as AccountClient | null,
});
export const accountStore = accountSync.store;
