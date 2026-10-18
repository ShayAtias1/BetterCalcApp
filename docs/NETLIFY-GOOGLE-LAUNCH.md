# Netlify and Google OAuth — launch checkpoint

Updated 18 October 2026. Safe configuration preparation was authorized by the owner.
No push, deployment, OAuth publication, trial activation or production migration.
A free read-only logical backup and isolated SQL restore are now verified; see the
recovery checkpoint below. No production recovery or migration was executed.

## Completed on the service dashboards

### Netlify / bettercalcapp

- Imported the existing validated production Supabase URL and browser publishable
  key, VITE_AI_DEV_TOOLS=false, EARLY_ACCESS_STAGE=policies.
- Production context only. All scopes: this plan disables the specific-scopes
  selector behind an upgrade. No server/database/Google client secret was uploaded.
- Cleared VITE_POSTHOG_HOST and VITE_POSTHOG_KEY. Both now show **0 values in 0 deploy
  contexts**; empty variable definitions remain, avoiding irreversible deletion.
  The release preflight ignores empty values, so no tracking configuration remains.
- Saved configuration only; no build/deploy was triggered. The old live bundle is
  unchanged and may still contain its old compiled analytics configuration.
- Private source file, 0600 outside Git:
  /Users/ADMIN/BetterCalc-Launch-Preparation/netlify-policies.env
- Existing committed Netlify config already prepares Node 24, dist, release preflight,
  SPA fallback and security headers. Those files need an approved deployment to
  affect the live site. Automatic publication on main means no push yet.

### Google Cloud / bettercalc

- Saved exactly three non-sensitive sign-in scopes: openid,
  https://www.googleapis.com/auth/userinfo.email,
  https://www.googleapis.com/auth/userinfo.profile.
- Saved Privacy URL https://bettercalcapp.netlify.app/privacy and Terms URL
  https://bettercalcapp.netlify.app/terms. Homepage/name remain BetterCalc and
  https://bettercalcapp.netlify.app. No public legal documents were deployed.
- Added the owner-supplied support.bettercalc@gmail.com to developer notifications;
  the existing owner contact is retained. The owner has confirmed the address and
  it is now signed into the browser. Its Google Cloud terms were accepted with
  explicit owner approval. The earlier account-not-found message is resolved.
- Public User Support Email is now **support.bettercalc@gmail.com**, saved and
  verified by the Branding success message. The owner explicitly approved the
  OAuth Config Editor (roles/oauthconfig.editor) grant to that same account;
  IAM confirmed Policy updated. No Owner/Editor project-wide role was granted.
- Existing authorized domains and client origin/callback were preserved. No new
  logo was uploaded and the OAuth app remains in Testing.

## Finalized legal documents

Owner confirmed שי אטיאס is the registered sole proprietor; BetterCalc is the brand.
Both documents use that identity and the now-owner-confirmed contact.
The Gmail inbox was opened and existing incoming mail verified; no outbound test
message was sent. The owner approved the wording as the release basis, subject to
the final privacy clarifications now completed. All four documents use version
ea-2026-10-18-v1 and effective date 2026-10-18. Final copies are outside Git in
/Users/ADMIN/BetterCalc-Launch-Preparation/legal-final/ea-2026-10-18-v1/.
The matching Supabase SQL is prepared in scripts/sql/early-access-legal-release.sql
but NOT executed. No new version has been published to users.
Provider disclosures now state known processing/location facts and reference their
published policies, without asserting unverified transfer agreements or invented
retention periods. Audit identifiers have no automatic expiry; provider-log erasure
has no promised uniform deadline. The text also covers Gmail support correspondence
and the existing optional local-data deletion during sign-out.

The owner approved the release basis and requested clarifications; this is not a
claim of legal compliance. The previously identified legal review
must cover international-transfer arrangements, proportional audit/support retention,
any operator disclosures required by applicable law, and liability enforceability.
Published provider policies do not by themselves establish the operator's legal basis.

## Blocking prerequisites

1. Google support-email configuration is complete. No further mailbox, IAM or
   domain purchase action is needed for that field. OAuth remains in Testing.
2. Final bilingual text/version preparation is complete; obtain consolidated release
   approval before publication. Shared-browser and exact local-clearing disclosures
   are added; liability/indemnity and retention match the approved basis. The
   previously stated legal-review risks remain; no immunity or fixed deletion-success
   deadline is promised.
3. SQL backup and isolated recovery passed (checkpoint below). Before migrations
   23/24, confirm the approved affected-object recovery procedure and refresh the
   checkpoint if production data changed. No permanent password reset or migration
   was performed; the owner explicitly approved a temporary read-only CLI login.
4. Obtain one consolidated final release approval before migrations (only after
   recovery), push/deploy, OAuth publication and public trial activation.


## Verified free database recovery checkpoint

- Owner approved temporary CLI read access. Management API requested read_only=true;
  300-second password TTL. Explicit SET ROLE supabase_read_only_user was necessary.
  Verified TLS using the certificate downloaded from Supabase Database Settings.
  No permanent password change, purchase, migration or production data write.
- Private bundle outside Git:
  /Users/ADMIN/BetterCalc-Backups/production-20261018T094625Z/verified-recovery.tar.gz
  (189,611 bytes); database.dump is 494,910 bytes before bundle compression.
- Isolated PostgreSQL 17.11 restore succeeded; network none, no published ports,
  cron execution disabled. Container stopped after verification. All 60 tables
  match counts and complete-row digests, including users, consent evidence and
  migration history. An extension-managed transient HTTP response was preserved
  with an additional binary COPY supplement.
- All 21 RLS policies, 225 constraints and 155 function definitions match. App,
  auth and storage object owners/grants match after ACL ordering normalization.
  Own/other profile RLS, auth.uid and uniqueness smoke tests passed locally.
- Local bootstrap adaptations are documented in private RECOVERY.md: role grantor
  metadata and managed extension installers differ from hosted Supabase; original
  metadata and role exports are retained. No hosted service-level restore tested.
- Limits: no PITR or off-device duplicate; Vault's external root encryption key,
  OAuth/hosting configuration, function deployments/secrets, Storage file bytes
  and client IndexedDB are not supplied by this SQL archive. Same-project recovery
  retains external configuration. New-project recovery requires reconfiguration.
  Ephemeral .pgpass was removed. See private RECOVERY.md and verification JSON.

## Prepared release sequence — requires future production approval

1. Resolve blockers above. Run production release preflight with the actual hosting
   variables and finalized immutable legal version; keep commercial flags false.
2. Apply 23 then 24 transactionally through normal migration tooling only after
   recovery verification and explicit authority. Coordinate backend/client version.
3. Deploy policies-stage build with guest enforcement off. Verify current HTTPS,
   legal routes, headers and absence of analytics network requests on that new build.
4. Finish Google's support-email/brand/domain requirements and publish only with
   approval. Smoke-test permitted safe registration and existing account login;
   local projects must remain intact.
5. Activate individual guest trial in the separately reviewed activation build,
   remove EARLY_ACCESS_STAGE=policies and verify the new live build. No AI, payment,
   cloud backup or tracking activation is included.

## References and evidence

- Supabase sign-in scopes: https://supabase.com/docs/guides/auth/social-login/auth-google
- Google branding/support-email eligibility: https://support.google.com/cloud/answer/15549049
- Provider privacy: https://supabase.com/privacy ; https://policies.google.com/privacy ;
  https://www.netlify.com/privacy/ ; https://www.cloudflare.com/privacypolicy/
- Local ignored screenshots: output/launch-preparation/.

Final local verification: all 991 tests passed, separate TypeScript check passed,
lint completed with no errors (existing warnings remain), and TypeScript + Vite
build passed (existing chunk-size warning). The policies-stage release preflight
passed with ea-2026-10-18-v1. The active trial stage remains unactivated. No
production access or configuration change was part of this local commit step.
Source preparation is committed locally only; future push, migration, deployment,
OAuth publication and trial activation require explicit owner approval. Before a
later release, re-confirm the effective date and refresh recovery if data changed.
