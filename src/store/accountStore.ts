import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import { getSupabase } from '../lib/supabase/client';
import { cacheVerifiedConsent, clearVerifiedConsent, readVerifiedConsent } from '../lib/legal/verifiedConsent';
import { LEGAL_DOC_VERSION } from '../lib/legal/legalDocs';
import { clearPendingConsent, consentSessionStorage, hasPendingConsent } from '../lib/legal/pendingConsent';
import { authStore, type AuthState } from './authStore';
import {
  completeOnboarding,
  FLAGS_OFF,
  getAccountOverview,
  getCommercialFlags,
  getProfile,
  writeCachedName,
  listPublicPlans,
  type PlanSummary,
  updateDisplayName,
  normalizeDisplayName,
  type AccountClient,
  type AccountOverview,
  type CommercialFlags,
  type Profile,
} from '../lib/account/accountApi';

/** Used as the accepted version until the terms and privacy texts are published (the server's own placeholder). */
export const LEGAL_VERSION_PENDING = 'pending';

/**
 * Whether this account has accepted the version the server currently announces. A new version (set in Supabase when the
 * texts are published) asks everyone again; the same completion step records it, with the server's own clock.
 */
export function hasAcceptedCurrentTerms(profile: Pick<Profile, 'onboardingCompleted' | 'termsVersion' | 'termsAcceptedAt' | 'privacyAcceptedAt'> | null, flags: Pick<CommercialFlags, 'legalVersion'>, documentVersion = LEGAL_DOC_VERSION): boolean {
  return !!profile?.onboardingCompleted && profile.termsAcceptedAt != null && Number.isFinite(profile.termsAcceptedAt)
    && profile.privacyAcceptedAt != null && Number.isFinite(profile.privacyAcceptedAt) && profile.termsVersion === documentVersion
    && (flags.legalVersion ?? LEGAL_VERSION_PENDING) === documentVersion;
}

/**
 * The signed-in user's account data and the server's commercial switches. Loaded after sign-in, cleared on
 * sign-out. A failed verification preserves all local project data; the legal gate offers retry or guest access.
 */
export interface AccountState {
  flags: CommercialFlags;
  profile: Profile | null;
  overview: AccountOverview | null;
  /** The published plans, to show a subscription's name instead of its code. Empty until plans are published. */
  plans: PlanSummary[];
  /** Signed in, profile loaded, and the name/consent step is not done yet. */
  needsOnboarding: boolean;
  /** Registration is complete but no display name was ever saved: the user is asked to add it. */
  needsName: boolean;
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

const storage = () => (typeof localStorage === 'undefined' ? null : localStorage);

export function createAccountStore(deps: AccountDeps) {
  let loadId = 0;
  let inFlight: { identity: string; promise: Promise<void> } | null = null;

  const store = createStore<AccountState>()((set, get) => ({
    flags: FLAGS_OFF,
    profile: null,
    overview: null,
    plans: [],
    needsOnboarding: false,
    needsName: false,
    loading: false,
    loadFailed: false,

    refresh() {
      const session = deps.auth.getState();
      const signedIn = session.status === 'signedIn';
      const userId = signedIn ? session.user?.id ?? '' : '';
      const identity = `${session.status}:${userId}`;
      if (inFlight?.identity === identity) return inFlight.promise;
      const id = ++loadId;
      const current = () => id === loadId && `${deps.auth.getState().status}:${deps.auth.getState().status === 'signedIn' ? deps.auth.getState().user?.id ?? '' : ''}` === identity;
      const cached = signedIn && !get().profile ? readVerifiedConsent(storage(), userId, LEGAL_DOC_VERSION) : null;
      set({ loading: true, ...(cached ? { profile: cached, flags: { ...FLAGS_OFF, legalVersion: LEGAL_DOC_VERSION } } : {}) });
      let stage = 'client';
      const promise = (async () => {
        try {
          const client = await deps.loadClient();
          if (!current()) return;
          if (!client) throw new Error('account_unavailable');
          stage = 'legal-version';
          const flags = await getCommercialFlags(client, signedIn);
          if (!current()) return;
          if (!signedIn) { set({ flags, loading: false, loadFailed: false }); return; }
          // Retain a successfully fetched new effective version even if the profile request fails.
          set({ flags });
          stage = 'profile';
          let profile = await getProfile(client);
          if (!current()) return;
          if (!profile) throw new Error('profile_missing');
          // Successful evidence remains valid even if recording a new OAuth receipt fails.
          const previouslyAccepted = hasAcceptedCurrentTerms(profile, flags);
          if (previouslyAccepted) cacheVerifiedConsent(storage(), userId, profile);
          else clearVerifiedConsent(storage(), userId);
          set({ profile, needsOnboarding: !previouslyAccepted, needsName: previouslyAccepted && !profile.displayName });
          if (profile.displayName && normalizeDisplayName(profile.displayName)
            && (flags.legalVersion ?? LEGAL_VERSION_PENDING) === LEGAL_DOC_VERSION
            && hasPendingConsent(consentSessionStorage(), LEGAL_DOC_VERSION, Date.now())) {
            stage = 'record-consent';
            await completeOnboarding(client, profile.displayName, LEGAL_DOC_VERSION);
            if (!current()) return;
            clearPendingConsent(consentSessionStorage());
            profile = await getProfile(client);
            if (!current()) return;
            if (!profile) throw new Error('profile_missing');
          }
          const accepted = hasAcceptedCurrentTerms(profile, flags);
          if (accepted) cacheVerifiedConsent(storage(), userId, profile);
          else clearVerifiedConsent(storage(), userId);
          writeCachedName(storage(), userId, profile.displayName);
          set({ flags, profile, needsOnboarding: !accepted, needsName: accepted && !profile.displayName, loading: false, loadFailed: false });
          // Billing/credit/catalogue availability is independent of legal verification.
          const [overview, plans] = await Promise.allSettled([getAccountOverview(client), listPublicPlans(client)]);
          if (!current()) return;
          set({ ...(overview.status === 'fulfilled' ? { overview: overview.value } : {}), ...(plans.status === 'fulfilled' ? { plans: plans.value } : {}) });
        } catch (error) {
          if (current()) {
            set({ loading: false, loadFailed: true });
            // No names, tokens, payloads or raw server messages in diagnostic logs.
            console.warn('[account] verification unavailable', { stage, kind: error instanceof Error ? error.name : 'unknown' });
          }
        }
      })().finally(() => { if (inFlight?.promise === promise) inFlight = null; });
      inFlight = { identity, promise };
      return promise;
    },

    async submitOnboarding(name) {
      const client = await deps.loadClient();
      if (!client) throw new Error('account_unavailable');
      if ((get().flags.legalVersion ?? LEGAL_VERSION_PENDING) !== LEGAL_DOC_VERSION) throw new Error('legal_version_mismatch');
      await completeOnboarding(client, name, LEGAL_DOC_VERSION);
      clearPendingConsent(consentSessionStorage());
      await get().refresh();
    },

    async saveName(name) {
      const client = await deps.loadClient();
      const user = deps.auth.getState().user;
      if (!client || !user) return;
      const saved = await updateDisplayName(client, user.id, name);
      writeCachedName(storage(), user.id, saved);
      const profile = get().profile;
      if (profile) set({ profile: { ...profile, displayName: saved }, needsName: false });
    },
  }));

  return {
    store,
    /** Follows sign-in state: loads on sign-in, clears on sign-out. Returns a stop function. */
    start() {
      let last: string | null = null;
      const sync = () => {
        const status = deps.auth.getState().status;
        const identity = `${status}:${deps.auth.getState().user?.id ?? ''}`;
        if (identity === last) return;
        last = identity;
        loadId += 1;
        inFlight = null;
        store.setState({ profile: null, overview: null, plans: [], needsOnboarding: false, needsName: false, loadFailed: false, loading: false });
        if (status === 'signedIn') void store.getState().refresh();
        else {
          loadId += 1;
          if (status === 'signedOut') writeCachedName(storage(), '', null);
          store.setState({ profile: null, overview: null, plans: [], needsOnboarding: false, needsName: false, loadFailed: false, loading: false });
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
