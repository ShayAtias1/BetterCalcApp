/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** PostHog project API key (public, write-only). Missing → analytics is off. */
  readonly VITE_POSTHOG_KEY?: string;
  /** PostHog ingestion host, e.g. https://eu.i.posthog.com. Missing → analytics is off. */
  readonly VITE_POSTHOG_HOST?: string;
  /** 'true' → log analytics events to the console instead of sending them (works in dev). */
  readonly VITE_ANALYTICS_DEBUG?: string;
  /** Supabase project URL, e.g. https://<ref>.supabase.co. Missing → accounts are off (local-only). */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase PUBLISHABLE (anon) key. Public by design; the secret/service-role key must never be a VITE_ variable. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Cloudflare Turnstile PUBLIC site key (CAPTCHA is inactive until CAPTCHA_ENABLED is set). */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

/** Short git SHA of the build, injected by vite.config.ts (`app_version` in analytics). */
declare const __APP_VERSION__: string;
