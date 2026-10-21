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
  /** Stop blocking local use while the SDK retries an unavailable session refresh. */
  initTimeoutMs?: number;
}

const metaNameOf = (session: Session): string | null => {
  const meta = session.user.user_metadata as { full_name?: unknown; name?: unknown } | undefined;
  const raw = typeof meta?.full_name === 'string' ? meta.full_name : typeof meta?.name === 'string' ? meta.name : '';
  return raw.trim() || null;
};

const toUser = (session: Session | null): AuthUser | null =>
  session ? { id: session.user.id, email: session.user.email ?? null, metaName: metaNameOf(session) } : null;

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
        let authRevision = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const restore = (async () => {
          try {
            const auth = await deps.loadAuth();
            if (!auth) return set({ status: 'unconfigured', networkIssue: false });
            // Callbacks only set state: calling the SDK from inside one can deadlock it.
            auth.onAuthStateChange((event, session) => {
              if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !session)) {
                authRevision++;
                const wasSignedIn = get().status === 'signedIn';
                set({ status: 'signedOut', user: null, sessionExpired: wasSignedIn && !signingOut });
              } else if (session) {
                authRevision++;
                set({ status: 'signedIn', user: toUser(session), sessionExpired: false, networkIssue: false });
              }
            });
            const revision = authRevision;
            const { data, error } = await auth.getSession();
            // A newer auth event wins over a delayed initial session read.
            if (revision !== authRevision) return;
            if (data.session) set({ status: 'signedIn', user: toUser(data.session), networkIssue: false });
            else set({ status: 'signedOut', user: null, networkIssue: !!error && classifyAuthError(error) === 'network' });
          } catch (error) {
            if (get().status === 'loading') {
              set({ status: 'signedOut', user: null, networkIssue: classifyAuthError(error) === 'network' });
            }
          }
        })();
        // Keep the SDK/session intact: a late verified session can still restore account access.
        // Until then the existing guest/local consent and entitlement checks remain in force.
        try {
          await Promise.race([
            restore,
            new Promise<void>((resolve) => {
              timer = setTimeout(() => {
                if (get().status === 'loading') set({ status: 'signedOut', user: null, networkIssue: true });
                resolve();
              }, deps.initTimeoutMs ?? 5_000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
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
