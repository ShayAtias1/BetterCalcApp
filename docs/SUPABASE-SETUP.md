# Supabase setup (Phase 1A: foundation)

Phase 1A adds only the foundation: the client configuration and the `profiles` table with its
security rules. There is **no sign-in UI, no guest trial, no cloud storage, no credits and no
payments** yet. BetterCalc stays local-first: with no Supabase variables the app behaves exactly as
before, and nothing here reads or writes the IndexedDB projects.

## What is in the repository

| Path | Purpose |
|---|---|
| `src/lib/supabase/supabaseConfig.ts` | Reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`; returns `null` when unset; **refuses** secret or `service_role` keys and insecure URLs. Pure. |
| `src/lib/supabase/client.ts` | `isSupabaseConfigured()` and `getSupabase()`: a lazily-loaded shared client (PKCE, session in `localStorage` under `bettercalc.auth`). Nothing calls it yet. |
| `supabase/migrations/20261016000000_profiles.sql` | `profiles` table, RLS, grants, profile-creation trigger, backfill. |
| `tests/supabase/*.test.ts` | Security tests (see below). |

## Security model of `profiles`

- One row per `auth.users` row (`id` = the auth user id, deleted with the user).
- RLS is enabled. Two policies only, both for `authenticated` and owner-scoped (`id = auth.uid()`):
  `SELECT` and `UPDATE`. There is **no insert or delete policy**: rows are created by the
  `on_auth_user_created` trigger and removed by the cascade.
- Column grants: clients may update **only `locale`**. `terms_accepted_at`, `created_at`, `updated_at`
  and `id` cannot be written by the client (consent will be recorded by a server-side function later).
- `anon` has no access at all. The trigger functions are `SECURITY DEFINER`/pinned `search_path`
  and cannot be executed by API roles.
- Only the **publishable** key is ever used in the browser. The secret / `service_role` key is for
  server-side code (future Edge Functions and the AI worker) and must never be a `VITE_` variable:
  Vite embeds every `VITE_` value in the public bundle.

## Manual configuration you must do in Supabase

None of this can be done from the repository.

1. **Create the project** at supabase.com. Region: **EU (Frankfurt)** (audit recommendation).
   Free is enough for development; use **Pro** before real users (daily backups).
2. **Note the project URL** (`https://<ref>.supabase.co`) and the **publishable key** (Project
   Settings → API Keys; the older "anon" key also works). Do not copy the secret / service_role key
   into any file in this repository.
3. **Apply the migration.** The CLI is a dev dependency (`npx supabase`). Business decisions live in
   `docs/COMMERCIAL-ROADMAP-HANDOFF.md`. Always dry-run first:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push --dry-run
   npx supabase db push
   ```
   Alternatively paste `supabase/migrations/20261016000000_profiles.sql` into the dashboard SQL
   editor once. After applying, in Table Editor confirm `profiles` shows **RLS enabled**.
4. **Authentication → URL Configuration** (needed from Phase 1B, harmless now): set the Site URL to the
   production domain and add Redirect URLs for `http://localhost:5173` and the production domain.
   *The production domain is not recorded in this repository; decide it before Phase 1B.*
5. **Authentication → Providers** (Phase 1B): enable **Email** (OTP) and **Google** (create an OAuth
   client in Google Cloud Console; its authorised redirect URI is
   `https://<ref>.supabase.co/auth/v1/callback`).
6. **Authentication → SMTP** (Phase 1B): configure a custom SMTP sender with SPF/DKIM. The built-in
   Supabase mailer is heavily rate-limited and not for production. Set the OTP to 6 digits with a short
   expiry (about 10 minutes).
7. **Authentication → Attack Protection** (Phase 1B): enable CAPTCHA (Cloudflare Turnstile).
8. **Environment variables.** Copy `.env.example` to `.env.local` (git-ignored) for development, and
   set the same two variables in the hosting provider's build environment:
   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
   ```

## Verifying

- `npm test` runs `tests/supabase/`: the real migration SQL is executed in an in-process Postgres
  ([PGlite](https://pglite.dev)) with a stand-in for Supabase's `auth` schema and roles. It checks the
  trigger, backfill, owner-only reads/updates, denied writes to protected columns, denied insert/delete,
  anonymous denial, function privileges and the pinned `search_path`. It does **not** replace a check
  on the real project: after step 3, sign up a test user (from Phase 1B) and confirm one `profiles`
  row appears and another user cannot read it.
- `tests/supabase/supabaseConfig.test.ts` also asserts that no frontend source references a secret key
  and that `.env.example` has no secret `VITE_` variable.

## Local development

Leave both variables unset: `isSupabaseConfigured()` is `false`, `getSupabase()` resolves `null`, and
the SDK is never downloaded. A malformed URL or a secret key in the variables is logged to the console
and treated as "not configured" instead of starting the client.
