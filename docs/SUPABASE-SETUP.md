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
7. **Authentication → Attack Protection**: CAPTCHA with Cloudflare Turnstile. Order matters, or sign-in breaks:
   (a) create a Turnstile widget (Cloudflare dashboard) for the production domain; (b) set its **site key** as
   `VITE_TURNSTILE_SITE_KEY` in the hosting build environment and redeploy (the app then sends a token with every
   sign-in code request; Supabase ignores it while CAPTCHA is off); (c) only then enable CAPTCHA here with the
   Turnstile **secret key**. The secret key never goes into any `VITE_` variable or this repository.
   Also review **Authentication → Rate Limits** (emails sent per hour, sign-ups/sign-ins per IP) and keep
   **anonymous sign-ins off**.
8. **Environment variables.** Copy `.env.example` to `.env.local` (git-ignored) for development, and
   set the same two variables in the hosting provider's build environment:
   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
   ```

## Cloud backup (Phase 2)

Migration `20261017000000_cloud_backups.sql` adds `entitlements`, `cloud_backups`, a private
`cloud-backups` bucket and the functions the app calls. **It has not been applied to the remote project**:
run `npx supabase db push --dry-run`, review, then `npx supabase db push` once approved.

How it is enforced (all on the server, nothing trusts the browser):

- Only users with an `entitlements` row (`active` or `grace`) may reserve space, upload or delete. An
  `ended` subscription can list and download for 90 days. Everyone else gets nothing.
- Quota is per entitlement (`storage_quota_bytes`, default 1 GB = the HANDOFF limit). `reserve_cloud_backup`
  checks it under a row lock and reserves the exact object path. Storage policies allow an upload only to
  that path, once; there is no update policy, so a file is never overwritten.
- `complete_cloud_backup` checks the stored size against the reservation before a backup shows up or counts.
- Per-file ceiling 320 MB (the app's 300 MB backup limit plus manifest); at most 5 unfinished uploads.

**Manual configuration:**

1. Apply the migration (above) and confirm in Storage that the `cloud-backups` bucket exists and is **private**.
2. **Storage → Settings → global file size limit**: the Free plan caps files at 50 MB regardless of the
   bucket setting; raise it to at least 320 MB (needs Pro) or large backups will fail to upload.
3. **Temporary test entitlement** (until billing exists; run in the SQL editor, which runs as an admin):
   ```sql
   insert into public.entitlements (user_id, status, source)
   select id, 'active', 'test' from auth.users where email = 'you@example.com'
   on conflict (user_id) do update set status = 'active', ended_at = null;
   -- to test the read-only state:
   -- update public.entitlements set status = 'ended', ended_at = now() where user_id = '<uuid>';
   ```
   Only `source = 'test'` rows should exist before billing; the billing webhook will write `'billing'` rows.
4. Abandoned and refused uploads are removed by the **account-maintenance** Edge Function (see
   "Scheduled maintenance" below). Until it runs they count against the user's own quota at their real size
   (migration `20261022000000_cloud_backup_hardening.sql`). Never delete rows in `storage.objects` directly.
5. Supabase database backups do **not** include Storage files. Backups are immutable (never overwritten),
   but a deleted file is gone; consider a periodic bucket copy before launch.

## Accounts, consent, commercial model (Phase 3 foundation)

Migrations `20261018000000_identity_consent_settings.sql` and `20261019000000_commercial.sql` add, on top of the
two above: profile name and consent (`complete_onboarding`), account deletion requests, server-side switches
(`commercial_settings`), plans/prices/credit packs (empty), subscriptions, credit wallets with a ledger, AI usage
records, payments, webhook events, invoice details and an audit log. **Neither has been applied remotely.** Review
with `npx supabase db push --dry-run`, then apply on approval.

Switched off in the database until you turn them on (SQL editor, admin only):

```sql
update public.commercial_settings set value = 'true' where key = 'ai_enabled';              -- AI usage functions
update public.commercial_settings set value = 'true' where key = 'payments_enabled';        -- subscription webhooks
update public.commercial_settings set value = 'true' where key = 'credit_purchases_enabled';
update public.commercial_settings set value = '["monthly","purchased"]' where key = 'credit_spend_order'; -- NOT decided yet
update public.commercial_settings set value = '"v1"' where key = 'legal_version';           -- once the texts are published
```

Operations that are server-only (service role, never the browser):

- **Manual credits:** `select public.credit_admin_grant('<user uuid>', 'purchased', 50, 'reason', '<your uuid>');` (logged in `audit_log`).
- **Account deletion:** carried out by the **account-maintenance** Edge Function (below) once a request is older than
  `ACCOUNT_DELETION_GRACE_DAYS` (default 7; the user can cancel until then). It removes the user's files through the
  Storage API, deletes the auth user (which cascades to all rows; payments keep their record without the user link) and
  writes `account_deletion_started` / `account_deleted` entries to `audit_log`. Local projects are never touched.
  `select * from public.pending_account_deletions();` still lists open requests.
- **Consent:** `complete_onboarding` accepts only the version in `commercial_settings.legal_version` (the app's
  placeholder `pending` until it is set), so set `legal_version` in the same release that publishes the texts.
- **Webhooks (when a provider is chosen):** a server handler verifies the provider's signature, maps the payload to
  `NormalizedBillingEvent` (`src/lib/billing/paymentProvider.ts`), records it with `record_payment_event` (idempotent),
  and applies it with `apply_subscription_state` / `credit_purchase`. Both refuse while their switch is off.
- **Plans and prices:** insert into `plans`, `prices`, `credit_packs` once decided. Nothing is seeded.
- **Terms and privacy texts:** fill `src/lib/legal/legalDocs.ts` (after legal review), then set `legal_version`.


## Scheduled maintenance (account-maintenance Edge Function)

`supabase/functions/account-maintenance` removes abandoned/refused cloud uploads and carries out account deletion
requests (logic in `supabase/functions/_shared/maintenance.ts`, tested in `tests/supabase/maintenance.test.ts`). It runs
only when called with the `x-maintenance-secret` header; it does not use user JWTs. Nothing runs until you deploy and
schedule it:

1. Apply migrations `20261021000000_consent_and_account_deletion.sql` and `20261022000000_cloud_backup_hardening.sql`
   (`npx supabase db push --dry-run`, review, then `npx supabase db push`).
2. Generate a secret of at least 32 characters (`openssl rand -hex 32`) and store it as a function secret:
   ```bash
   npx supabase secrets set MAINTENANCE_SECRET=<secret> ACCOUNT_DELETION_GRACE_DAYS=7
   npx supabase functions deploy account-maintenance --no-verify-jwt
   ```
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge Functions automatically.
3. Schedule it (Database → Extensions: enable `pg_cron` and `pg_net`; then in the SQL editor). Keep the secret in Vault,
   not in the job text:
   ```sql
   select vault.create_secret('<secret>', 'maintenance_secret');
   select cron.schedule('account-maintenance', '17 3 * * *', $$
     select net.http_post(
       url := 'https://<ref>.supabase.co/functions/v1/account-maintenance',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-maintenance-secret',
         (select decrypted_secret from vault.decrypted_secrets where name = 'maintenance_secret')),
       body := '{}'::jsonb);
   $$);
   ```
4. Check the function logs after the first run: they contain counts and user ids only.

## Verifying

- `npm test` runs `tests/supabase/`: the real migration SQL is executed in an in-process Postgres
  ([PGlite](https://pglite.dev)) with a stand-in for Supabase's `auth` schema and roles. It checks the
  trigger, backfill, owner-only reads/updates, denied writes to protected columns, denied insert/delete,
  anonymous denial, function privileges and the pinned `search_path`. It does **not** replace a check
  on the real project: after step 3, sign up a test user (from Phase 1B) and confirm one `profiles`
  row appears and another user cannot read it.
- `tests/supabase/cloudBackups.test.ts` does the same for Phase 2: entitlement rules, the 1 GB quota,
  reserved-path-only uploads, no overwrite, owner isolation, the read-only period after a subscription ends,
  and function privileges. `cloudClient.test.ts` covers the browser side against a fake client.
- `tests/supabase/schemaGuard.test.ts` fails if any `public` table lacks row-level security, if an API role can
  call a function that is not on its allowlist, or if new tables are exposed without an explicit grant.
- `tests/supabase/supabaseConfig.test.ts` also asserts that no frontend source references a secret key
  and that `.env.example` has no secret `VITE_` variable.

## Local development

Leave both variables unset: `isSupabaseConfigured()` is `false`, `getSupabase()` resolves `null`, and
the SDK is never downloaded. A malformed URL or a secret key in the variables is logged to the console
and treated as "not configured" instead of starting the client.
