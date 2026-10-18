# BetterCalc Early Access — release checkpoint

Status: **prepared locally, not approved or deployed**. No production action below
is authorized until the owner explicitly approves the final release sequence.
Never print secrets, invoke production deletion for a smoke test, or edit user projects.

## What is prepared

- Personal seven-day browser trial: starts only after entering the service following
  legal acceptance, not at global launch. Record v3 + `early-access-1` ignores all
  prelaunch formats. Reload, language, project changes and reopening retain it.
  A timer and visibility/storage refresh enforce expiry without requiring a reload.
- Enforcement remains **false**. The cloud backup UI is separately gated off before any
  account/project requests or upload/restore controls are mounted. Registered users have unrestricted manual access;
  expired guests keep view, export/local backup and project deletion. Browser-only
  enforcement is intentionally not tamper-proof. Do not reset the activation ID later.
- Consent history, immutable API access, fresh acceptance timestamps, billing write
  restrictions and offline/race fixes are in commit `0cbcfb6`; production migration
  `20261023000000_early_access_legal_consent.sql` is still pending.
- Netlify configuration pins Node 24, builds `dist`, and runs `release:check` before
  building. It intentionally rejects pending legal documents, unresolved facts,
  development contacts, tracking variables, unsafe public keys and unapproved trial
  activation. `npm run build` remains available for local draft QA.
- `_redirects` supplies SPA fallback; `_headers` supplies CSP, HTTPS-related and
  browser security headers. PostHog is disabled in code, its CSP destination removed.
- `/licenses/index.html` links original bundled-package, font and PDFium notices. Vite generates
  notices from the actual emitted browser module graph, not all Node-only dependencies.
  `npm run licenses:generate` refreshes the dev/public copy. Fontkit ships no standalone
  LICENSE: its declared MIT terms, package attribution and embedded legal comments
  are retained. Include this upstream packaging caveat in final licence review.

## Verified production baseline (read-only audit, 18 October 2026)

- Google: External/Testing; one test user; publication blocked by incomplete Branding;
  public policy links empty. Origins: localhost:5173 and bettercalcapp.netlify.app.
  Callback: `https://wnzmanczyskxnfzwibjp.supabase.co/auth/v1/callback`.
- Supabase: Google/new signups enabled; Site URL is the Netlify site; localhost and
  Netlify redirect patterns are present. Database region verified: eu-west-1, Ireland.
  Seven migrations through 20261022000000; 20261023000000 absent from migration history.
  AI/payments/credit purchases false, legal version null; cloud entitlements zero.
  Private cloud bucket with authenticated owner/reservation policies.
- `account-maintenance` is deployed. Cron active: `17 3 * * *` (03:17 UTC daily).
  At audit time no run had occurred. A scheduled HTTP call being queued does not
  prove deletion completed. Verify function response and logs after a natural run.
- Netlify: current published commit `667b4f5`, old build; /terms and /privacy return
  404; current root response lacks the repository security headers except HSTS.
  Old bundle contains active PostHog send/init path. Project env lists PostHog only,
  missing Supabase build variables. Build settings: npm run build, dist, Node 24,
  main, automatic publication on. No dashboard values were changed.

## Minimum owner/legal decisions — free beta, not paid checkout

The owner supplied “שי אטיאס” but expressly requires verification of the registered
legal name. Do not publish it as confirmed yet. A real monitored support/privacy
contact remains essential; no `.invalid` address remains in the document content.

The Privacy Protection Authority's Section 11 guidance requires controller name and
contact, processing purposes, whether providing information is mandatory and the
consequences of refusal, recipients/purposes, and access/correction rights. The duty
concerns personal-data collection; the free price does not remove that privacy duty.
Source: https://www.gov.il/BlobFolder/generalpage/manager_duties/he/InfoDuties_new.pdf

Do **not** assume a personal ID/business number and residential address must be
published merely because an account is offered. The consumer authority's remote-sale
guidance requires identifying/address details for transactions in its scope, but does
not determine the classification of this completely free professional beta. Obtain
confirmation of applicability and a suitable notices address before publishing those
personal details. They are removed from the draft's public identity fields pending
that determination, rather than fabricated or demanded as universally mandatory.
Source: https://www.gov.il/BlobFolder/generalpage/information-olim-consumerism/he/smart-consumerism-he.pdf

Other unresolved facts: provider non-database processing/log locations and agreements,
transfer safeguards; provider log/backup deletion limits; audit-record retention and
implementation (no automatic audit expiry exists); any legacy payment/event records.
The actual production host is Netlify and database region is verified, not placeholders.
Owner/legal review must decide the minimum truthful retention commitments; this
preparation does not invent durations or silently delete historical data.

Final bilingual approval must cover measurement and independent verification warnings,
mandatory-law exceptions, liability/indemnity enforceability and any applicable
consumer rules. No commercial terms, tax status or AI-provider details are needed
until those unavailable features are offered. All documents remain version `pending`.

## Ordered release procedure — only after explicit final approval

1. Resolve/approve final identity/contact, provider and retention facts. Finalize
   both legal texts, assign one immutable version and effective date, retain copies.
   Review licences. Change only `LEGAL_DOC_VERSION` to that approved version.
2. Verify Google Branding requirements, authorized origins and callback. Prepare
   home `/`, privacy `/privacy`, terms `/terms` URLs for bettercalcapp.netlify.app.
   Public URLs must work before completing OAuth publication. Do not use fake contact.
3. Confirm database backup/recovery arrangements. Review migration diff and dependencies
   (existing 20261016–22 schema, billing policies, profile/consent RPC). Run local SQL
   regression tests. With approved release authority, apply **only** pending 20261023
   through the normal migration process. It adds/backfills history without fabricating
   missing legacy evidence, preserves invoice data and original onboarding timestamp,
   and does not enable AI, payments, credit purchases or cloud entitlements.
4. Coordinate the effective backend `commercial_settings.legal_version` with the
   approved client version. This setting is a JSON string, not a bare SQL identifier.
   Avoid a prolonged mismatch; current clients require matching displayed text.
   Run `scripts/sql/early-access-production-audit.sql` read-only after migration.
   Verify account profile trigger, own-only RLS, flags false, no cloud entitlements.
   Never expose service-role credentials in a browser build or SQL output.
5. In Netlify production Builds scope, set `VITE_SUPABASE_URL` and the matching
   **publishable/anon** key using the existing approved project configuration.
   Remove VITE_POSTHOG_KEY/HOST and unused analytics/debug variables. Set no AI-dev
   override. Only set a Turnstile public key if the corresponding Supabase CAPTCHA
   configuration is verified; never put its secret in a VITE variable.
6. First approved public deploy: keep trial enforcement false and set the non-secret
   build stage `EARLY_ACCESS_STAGE=policies`. Run tests/type/lint/build locally first.
   `release:check` must pass with finalized documents and production environment.
   Commit/review, then push only under release approval; main auto-publishes.
   Verify HTTPS, 200 responses for /terms, /privacy and /licenses/, all security
   headers, correct language, and no PostHog initialisation/network activity.
7. Finish Google Branding with the now-public approved policies and real contact.
   Publish OAuth only under approval; complete any Google-required verification/domain
   ownership steps. Verify a permitted safe account can register/sign in; a new
   registration is a real production account and must not be created/deleted casually.
8. Only once free public sign-in works, make the approved activation change:
   `ACCESS_ENFORCEMENT_ENABLED=true`, preserving trial v3 and `early-access-1`.
   Remove `EARLY_ACCESS_STAGE=policies` (default active gate). Run full checks and
   release under the same explicitly approved sequence. Everyone starts their own
   trial on first service use after this activation, with existing projects retained.
9. Smoke-test guest persistence/expiry via safe local fixtures; test production normal
   sign-in/manual access, flags, consent version, legal routes and data persistence.
   Observe the natural maintenance run and HTTP result without triggering deletions.
   Stop activation/revert the client if any hard prerequisite fails. Keep all
   commercial switches off and do not grant cloud entitlements.

Rollback: restore the prior safe client, keeping trial enforcement off. Do not drop
consent history or restore stale legal timestamps. Coordinate backend legal version
with the displayed client if rolling back text. A failed public preflight must not be
bypassed; the old public deployment currently has analytics, so it is not a suitable
long-term fallback for an announced analytics-free launch.

## Registration counts without new tracking

Supabase → Authentication → Users shows registered accounts, provider and creation
information; Table Editor → profiles shows profile rows. Existing users stay in these
records. The supplied read-only SQL reports total/Google registrations, registrations
by day and accounts missing a profile, using aggregates without plan content.
Registration counts **are not active-user counts**; no new event tracking is added.
Do not infer meaningful usage from registration or token refresh alone.
