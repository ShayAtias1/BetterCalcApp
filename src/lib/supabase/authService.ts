import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_STORAGE_KEY } from './client';

/** The slice of `supabase.auth` this app uses; tests substitute a fake. */
export type AuthApi = Pick<
  SupabaseClient['auth'],
  'signInWithOtp' | 'verifyOtp' | 'signInWithOAuth' | 'signOut' | 'getSession' | 'onAuthStateChange'
>;

export type AuthFailure =
  | 'not-configured'
  | 'invalid-email'
  | 'invalid-code-format'
  | 'wrong-code'
  | 'expired-code'
  | 'rate-limited'
  | 'captcha'
  | 'network'
  | 'unknown';

export type AuthResult = { ok: true } | { ok: false; reason: AuthFailure };

/** What the rest of the app may know about an account: never tokens, never profile contents. */
export interface AuthUser {
  id: string;
  email: string | null;
}

export const OTP_LENGTH = 6;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : null;
}

export function normalizeOtp(raw: string): string | null {
  const code = raw.replace(/\s+/g, '');
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code) ? code : null;
}

/** Maps SDK errors (or thrown fetch failures) to the few outcomes the UI distinguishes. */
export function classifyAuthError(error: unknown): AuthFailure {
  if (!error || typeof error !== 'object') return 'unknown';
  const { name, code, status, message } = error as { name?: string; code?: string; status?: number; message?: string };
  if (name === 'AuthRetryableFetchError' || name === 'TypeError' || status === 0 || /failed to fetch|network/i.test(message ?? '')) {
    return 'network';
  }
  if (code === 'otp_expired') return 'expired-code';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || status === 429) return 'rate-limited';
  if (code === 'validation_failed' && /email/i.test(message ?? '')) return 'invalid-email';
  if (status === 403 || code === 'invalid_credentials' || /invalid|incorrect/i.test(message ?? '')) return 'wrong-code';
  if (/expired/i.test(message ?? '')) return 'expired-code';
  return 'unknown';
}

async function run(call: () => Promise<{ error: unknown }>): Promise<AuthResult> {
  try {
    const { error } = await call();
    return error ? { ok: false, reason: classifyAuthError(error) } : { ok: true };
  } catch (error) {
    return { ok: false, reason: classifyAuthError(error) };
  }
}

/** Sends a one-time code. Creates the account on first use (free registration). */
export function requestEmailCode(auth: AuthApi, rawEmail: string, captchaToken?: string, fullName?: string): Promise<AuthResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return Promise.resolve({ ok: false, reason: 'invalid-email' });
  return run(() => auth.signInWithOtp({ email, options: { shouldCreateUser: true, ...(captchaToken ? { captchaToken } : {}), ...(fullName?.trim() ? { data: { full_name: fullName.trim().slice(0, 80) } } : {}) } }));
}

export function confirmEmailCode(auth: AuthApi, rawEmail: string, rawCode: string): Promise<AuthResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return Promise.resolve({ ok: false, reason: 'invalid-email' });
  const token = normalizeOtp(rawCode);
  if (!token) return Promise.resolve({ ok: false, reason: 'invalid-code-format' });
  return run(() => auth.verifyOtp({ email, token, type: 'email' }));
}

/** Starts the Google redirect (PKCE: the client was created with flowType 'pkce'). Returns to the same page. */
export function startGoogleSignIn(auth: AuthApi, returnTo: string): Promise<AuthResult> {
  return run(() => auth.signInWithOAuth({ provider: 'google', options: { redirectTo: returnTo } }));
}

/**
 * Ends this device's session only (`scope: 'local'`, other devices stay signed in) and then removes the
 * SDK's own storage keys even if the server could not be reached. It never touches IndexedDB projects.
 */
export async function signOutLocally(auth: AuthApi, storage: Pick<Storage, 'removeItem'> | null): Promise<AuthResult> {
  const result = await run(() => auth.signOut({ scope: 'local' }));
  try {
    storage?.removeItem(SUPABASE_STORAGE_KEY);
    storage?.removeItem(`${SUPABASE_STORAGE_KEY}-code-verifier`);
  } catch {
    // storage can be blocked; the SDK already dropped its in-memory session
  }
  // Signing out locally must succeed offline: the session is gone from this device either way.
  return result.ok || result.reason === 'network' ? { ok: true } : result;
}
