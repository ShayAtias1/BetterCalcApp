/**
 * Supabase client configuration from the build environment. Pure: no SDK import, so it is cheap to
 * load and easy to test. Only the project URL and the PUBLISHABLE (anon) key may ever reach the
 * browser; a secret or service-role key in a `VITE_` variable is refused outright, because Vite
 * embeds every `VITE_` value into the public bundle.
 */
export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

export class SupabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseConfigError';
  }
}

/** Role claim of a JWT-format key, or null when the value is not a decodable JWT. */
function jwtRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))) as { role?: unknown };
    return typeof json.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}

/** True for new-style secret keys (`sb_secret_…`) and legacy JWT keys with the service_role role. */
export function isSecretKey(key: string): boolean {
  return key.startsWith('sb_secret_') || jwtRole(key) === 'service_role';
}

/**
 * Returns the configuration, or null when Supabase is not configured (the app then runs exactly as
 * before: local-only). Throws `SupabaseConfigError` for a malformed URL or a secret key.
 */
export function readSupabaseConfig(env: { VITE_SUPABASE_URL?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string }): SupabaseConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  if (isSecretKey(publishableKey)) {
    throw new SupabaseConfigError('VITE_SUPABASE_PUBLISHABLE_KEY holds a secret key. Use the publishable (anon) key; never put secrets in VITE_ variables.');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SupabaseConfigError('VITE_SUPABASE_URL is not a valid URL.');
  }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new SupabaseConfigError('VITE_SUPABASE_URL must use https (http is allowed only for localhost).');
  }
  return { url: parsed.origin, publishableKey };
}
