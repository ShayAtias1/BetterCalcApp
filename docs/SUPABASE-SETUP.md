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
4. Periodically (a scheduled job, later) run `select public.cleanup_stale_cloud_backups();` and remove
   anything listed by `select * from public.cloud_orphan_objects();` through the Storage API (service role).
   Do not delete rows in `storage.objects` directly.
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
- **Account deletion:** `select * from public.pending_account_deletions();` lists requests. To process one: remove the
  user's files through the Storage API (`cloud-backups/<uid>/`), then delete the auth user (Dashboard or Admin API), which
  cascades to all rows; payments keep their record without the user link. Local projects are never touched.
  No waiting period is enforced by the database; that is an operations decision.
- **Webhooks (when a provider is chosen):** a server handler verifies the provider's signature, maps the payload to
  `NormalizedBillingEvent` (`src/lib/billing/paymentProvider.ts`), records it with `record_payment_event` (idempotent),
  and applies it with `apply_subscription_state` / `credit_purchase`. Both refuse while their switch is off.
- **Plans and prices:** insert into `plans`, `prices`, `credit_packs` once decided. Nothing is seeded.
- **Terms and privacy texts:** fill `src/lib/legal/legalDocs.ts` (after legal review), then set `legal_version`.


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
- `tests/supabase/supabaseConfig.test.ts` also asserts that no frontend source references a secret key
  and that `.env.example` has no secret `VITE_` variable.

## Local development

Leave both variables unset: `isSupabaseConfigured()` is `false`, `getSupabase()` resolves `null`, and
the SDK is never downloaded. A malformed URL or a secret key in the variables is logged to the console
and treated as "not configured" instead of starting the client.
