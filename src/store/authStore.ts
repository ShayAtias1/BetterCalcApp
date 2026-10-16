import { createStore } from 'zustand/vanilla';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from '../lib/supabase/client';
import { getCaptchaToken } from '../lib/supabase/captcha';
import {
  classifyAuthError,
  confirmEmailCode,
  requestEmailCode,
  signOutLocally,
  startGoogleSignIn,
  type AuthApi,
  type AuthResult,
  type AuthUser,
} from '../lib/supabase/authService';

/**
 * Account state only. It never reads or writes the project database: signing in, signing out or losing a
 * session changes this store and the SDK's own storage key, nothing else.
 * - unconfigured: no Supabase env vars; the app is purely local.
 * - loading: the stored session has not been read yet.
 */
export type AuthStatus = 'unconfigured' | 'loading' | 'signedOut' | 'signedIn';

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** The session ended without the user asking (expired, revoked, or signed out in another tab). */
  sessionExpired: boolean;
  /** The last account operation or session read failed because the network was unreachable. */
  networkIssue: boolean;
  init(): Promise<void>;
  /** `fullName` is used only when this creates a new account (registration). */
  requestEmailCode(email: string, fullName?: string): Promise<AuthResult>;
  confirmEmailCode(email: string, code: string): Promise<AuthResult>;
  signInWithGoogle(): Promise<AuthResult>;
  signOut(): Promise<AuthResult>;
  dismissSessionExpired(): void;
}

export interface AuthDeps {
  loadAuth: () => Promise<AuthApi | null>;
  storage: () => Pick<Storage, 'removeItem'> | null;
  returnUrl: () => string;
  /** A CAPTCHA token for the code request, or undefined while CAPTCHA is inactive. */
  captchaToken?: () => Promise<string | undefined>;
}

const toUser = (session: Session | null): AuthUser | null =>
  session ? { id: session.user.id, email: session.user.email ?? null } : null;

export function createAuthStore(deps: AuthDeps) {
  let initialized: Promise<void> | null = null;
  let signingOut = false;

  const withAuth = async (operation: (auth: AuthApi) => Promise<AuthResult>): Promise<AuthResult> => {
    const auth = await deps.loadAuth();
    if (!auth) return { ok: false, reason: 'not-configured' };
    const result = await operation(auth);
    store.setState({ networkIssue: !result.ok && result.reason === 'network' });
    return result;
  };

  const store = createStore<AuthState>()((set, get) => ({
    status: 'loading',
    user: null,
    sessionExpired: false,
    networkIssue: false,

    init() {
      initialized ??= (async () => {
        const auth = await deps.loadAuth();
        if (!auth) return set({ status: 'unconfigured' });
        // Callbacks only set state: calling the SDK from inside one can deadlock it.
        auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_OUT') {
            const wasSignedIn = get().status === 'signedIn';
            set({ status: 'signedOut', user: null, sessionExpired: wasSignedIn && !signingOut });
          } else if (session) {
            set({ status: 'signedIn', user: toUser(session), sessionExpired: false, networkIssue: false });
          }
        });
        try {
          // Reads the persisted session; works offline while the access token or refresh can still be honoured.
          const { data, error } = await auth.getSession();
          if (data.session) set({ status: 'signedIn', user: toUser(data.session) });
          else set({ status: 'signedOut', user: null, networkIssue: !!error && classifyAuthError(error) === 'network' });
        } catch (error) {
          set({ status: 'signedOut', user: null, networkIssue: classifyAuthError(error) === 'network' });
        }
      })();
      return initialized;
    },

    requestEmailCode: (email, fullName) =>
      withAuth(async (auth) => {
        let token: string | undefined;
        try {
          token = await deps.captchaToken?.();
        } catch {
          return { ok: false, reason: 'captcha' };
        }
        return requestEmailCode(auth, email, token, fullName);
      }),
    confirmEmailCode: (email, code) => withAuth((auth) => confirmEmailCode(auth, email, code)),
    signInWithGoogle: () => withAuth((auth) => startGoogleSignIn(auth, deps.returnUrl())),

    async signOut() {
      signingOut = true;
      try {
        const result = await withAuth((auth) => signOutLocally(auth, deps.storage()));
        if (result.ok) set({ status: 'signedOut', user: null, sessionExpired: false, networkIssue: false });
        return result;
      } finally {
        signingOut = false;
      }
    },

    dismissSessionExpired: () => set({ sessionExpired: false }),
  }));

  return store;
}

export const authStore = createAuthStore({
  loadAuth: async () => (await getSupabase())?.auth ?? null,
  storage: () => (typeof localStorage === 'undefined' ? null : localStorage),
  returnUrl: () => `${location.origin}${location.pathname}`,
  captchaToken: () => getCaptchaToken(),
});
