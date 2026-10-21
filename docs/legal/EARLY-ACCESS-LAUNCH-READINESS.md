# Early Access legal drafts — owner review required

Historical draft review, superseded by the finalized `ea-2026-10-18-v1` documents
and [the current launch checkpoint](../LAUNCH-2026-10-22.md). The pending-version,
identity/contact and unapplied-migration statements below describe the earlier
review stage, not the current release state. Do not repeat completed migrations.

The Hebrew and English Terms and Privacy Policy in `src/lib/legal/legalContent.ts`
remain drafts, version `pending`. No publication/effective date is assigned. This
review checks repository behavior, not production deployment or provider dashboards.

## Completed

- Described free manual measurement, quantities, visual comparison and local exports/backups;
  optional Google authentication; unavailable AI, purchases and cloud backup; disabled analytics.
- Distinguished local IndexedDB project content from account/provider data, local sessions,
  trial state, consent receipts/history and cached previously verified consent.
- Described pricing as a non-purchasable preview, without granting credits or AI access.
- Disabled billing collection described accurately; existing records are not silently erased.
- Explained account deletion as a request, default seven-day grace period and successful
  maintenance execution, not a guaranteed deletion exactly seven days later.
- Disclosed deletion audit IDs as personal/pseudonymous records with no implemented expiry;
  provider logs/backups and any legacy payment records require retention decisions.
- Removed unsupported VAT-exempt status and Ireland/Netlify assumptions. An Israeli sole
  proprietor is confirmed; tax classification and deployment details are not.
- All development mailbox references have been removed from the document content.
  A marked, real support/privacy contact still requires owner confirmation.
- Kept professional measurement/calibration, independent verification, non-certification,
  data-loss and lawful liability warnings. Removed arbitrary claim-notice deadlines,
  exclusive district choices and continued-use-only acceptance. All nonwaivable liability
  exceptions also apply to business indemnity; judicial review remains explicit.

## Exact blockers before public launch

1. Confirm the registered legal name (owner supplied שי אטיאס, explicitly unverified)
   and a real monitored support/privacy contact. Determine whether identifying/business
   number and postal-address publication apply to this free professional beta before
   requesting or publishing those personal details; they are not assumed universally
   mandatory. Sole proprietor does not establish VAT-exempt status.
2. Production hosting is verified as Netlify and the Supabase database region as Ireland
   (eu-west-1). Confirm other provider processing locations, enabled CAPTCHA and logging settings. Review the
   relevant provider agreements and lawful safeguards for transfers outside Israel.
3. Approve and implement retention/deletion rules for deletion-audit IDs, operational
   logs and any historical billing/payment/event records. Confirm provider backup/log
   retention and deletion limits. These cannot be inferred from source or invented.
4. Verify the deployed account-maintenance worker, scheduler, configured grace period,
   permissions, successful deletion and failure handling. Repository instructions for
   scheduling are not proof it runs. Confirm consent-history migration deployment.
5. Bundled browser software/font/PDFium notices are generated at /licenses/index.html; finish the
   licence review, including fontkit's upstream package without a standalone LICENSE.
6. Obtain owner approval and professional legal review of the final bilingual text.
   Resolve all marked facts, replace the development mailbox, assign a version/effective
   date, retain immutable copies, and coordinate the same version in client and server.
   Keep `pending` until that approval. Recheck consent for both guests and accounts.
7. Verify release settings still disable AI, payments, cloud backup and usage analytics.
   No production settings were inspected or changed for this document edit.

## Professional legal review

- Liability exclusions and fallback, business indemnity, misleading-representation rules,
  consumer/nonwaivable rights, assignment, termination and Hebrew-language precedence.
  A disclaimer is not immunity and enforceability depends on law and circumstances.
- Israeli privacy notification/consent, controller identity, processing purposes, access
  and correction requests, retention necessity, security obligations and international
  transfers; assess any registration/notification duties and whether EU rules apply.
- Whether/when advance notice is required for material changes, alongside the implemented
  explicit renewed acceptance. There is no automated advance e-mail notice mechanism.

Official reference points (review prompts, not an opinion that the draft is enforceable):
- [Privacy Protection Authority: Amendment 13 FAQ](https://www.gov.il/he/pages/tikun13_qa)
- [Privacy Protection Authority: duty to notify](https://www.gov.il/BlobFolder/legalinfo/duty_to_notify/he/notify13.pdf)
- [Ministry of Justice: standard contracts](https://www.gov.il/he/pages/standard-contracts)

## Can wait until commercial launch

AI-provider processing/training/retention disclosures, cloud subscription retention,
checkout currency confirmation, taxes, commercial pricing, renewal, cancellation and
refund terms can be completed before those features become available. They are not
presented as current services or blanket advance consent in these drafts.

## Repository evidence

- `src/lib/access/accessPolicy.ts`: Google-visible accounts; manual enforcement disabled.
- `src/lib/analytics.ts`: `ANALYTICS_ENABLED = false`, disabled-state cleanup.
- `src/components/AccountPage.tsx`: Coming Soon controls, invoice form only with payments enabled.
- `src/lib/supabase/client.ts`, `authService.ts`, `captcha.ts`: sessions, Google, conditional CAPTCHA.
- `src/lib/access/guestAck.ts`, `src/lib/legal/*Consent.ts`, `src/store/accountStore.ts`:
  local/history evidence, explicit consent, version checks and outage handling.
- `supabase/migrations/20261023000000_early_access_legal_consent.sql`: consent history,
  fresh acceptance timestamps and disabled billing writes.
- `supabase/functions/account-maintenance/index.ts`, `_shared/maintenance.ts`,
  `docs/SUPABASE-SETUP.md`: configurable default grace, scheduled deletion and deployment prerequisites.
- `supabase/migrations/20261019000000_commercial.sql`,
  `20261021000000_consent_and_account_deletion.sql`: audit records, cascades and retained payment data.

Current implementation, owner requirements and exact release sequence: `../EARLY-ACCESS-RELEASE.md`.
