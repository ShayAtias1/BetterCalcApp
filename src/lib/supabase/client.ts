import type { SupabaseClient } from '@supabase/supabase-js';
import { readSupabaseConfig, type SupabaseConfig } from './supabaseConfig';

/** Where the SDK keeps its session; one key so sign-out can remove exactly it and nothing else. */
export const SUPABASE_STORAGE_KEY = 'bettercalc.auth';

let configured: SupabaseConfig | null | undefined;
let clientPromise: Promise<SupabaseClient> | null = null;

/** Build-time configuration, read once. A bad configuration is logged and treated as "not configured". */
function config(): SupabaseConfig | null {
  if (configured === undefined) {
    try {
      configured = readSupabaseConfig(import.meta.env);
    } catch (error) {
      console.error('[supabase]', error instanceof Error ? error.message : error);
      configured = null;
    }
  }
  return configured;
}

/** False in dev/tests without env vars: the app is then purely local, as before accounts existed. */
export function isSupabaseConfigured(): boolean {
  return config() !== null;
}

/**
 * The shared client, created on first use. The SDK is loaded lazily so guests who never touch accounts
 * do not download it. Resolves null when Supabase is not configured. The client only talks to the
 * network when something calls it; creating it never reads or writes IndexedDB project data.
 */
export function getSupabase(): Promise<SupabaseClient | null> {
  const settings = config();
  if (!settings) return Promise.resolve(null);
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(settings.url, settings.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: SUPABASE_STORAGE_KEY,
      },
    }),
  );
  return clientPromise;
}
