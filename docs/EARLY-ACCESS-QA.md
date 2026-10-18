# Early Access local QA — 18 October 2026

Local-only preparation; no production changes, migrations, OAuth publication, push or deployment.

## Automated

- Full suite: 975 passed, zero failed.
- TypeScript, oxlint and production build passed. Existing lint/build warnings remain.
- Public release preflight deliberately blocked: pending legal version/facts and unapproved trial activation.
- Migration regression tests use local PostgreSQL-compatible fixtures, not the production database.

## Real Chrome

Disposable origin `127.0.0.1:5174` used a temporary outside-repository Vite helper to enable trial enforcement, move its clock exactly seven days and simulate Supabase fetch failures. Production/source enforcement remains off. Synthetic PDF was loaded through the real store/import path; no personal plans were uploaded.

| Flow | Result |
| --- | --- |
| Guest welcome/explicit legal checkbox | PASS; unchecked Continue disabled; owner approved local acceptance |
| First actual use starts personal trial | PASS; no trial record on welcome/legal screen |
| Refresh, close/reopen tab, language change | PASS; same trial start and local PDF retained |
| Exact seven-day expiry | PASS; edit attempt opens registration; plan unchanged |
| Expired view/export | PASS; PDF reopened and PDF export downloaded and signature verified |
| Expired delete | PASS; owner explicitly approved deletion of the sole synthetic QA project; empty list confirmed |
| Guest Supabase failure + refresh | PASS; local PDF remained available, no repeated dialogs |
| Existing signed-in account | PASS for existing session, project compatibility and unrestricted UI; user project contents not edited |
| Signed-in request outage + refresh/recovery | PASS; Chrome request blocking produced one dismissible account-unavailable state; 36 existing rooms remained visible; rules removed and account restored on refresh |
| Google new registration/fresh OAuth login | NEEDS VERIFICATION after public policies/Google publication; no production account created |
| Consent updates/history/account isolation | Automated regression PASS; final effective-version production acceptance awaits release prerequisites |
| Pricing Hebrew/English, desktop/320px | PASS; correct currencies, allocations, Coming Soon, no purchase controls |
| AI and cloud backup | PASS; locked/Coming Soon, cloud modal has no upload/restore controls |
| /terms and /privacy | PASS locally; pending draft clearly labelled |
| /licenses/index.html | PASS; bilingual page and notice links. Explicit file path also works in Vite dev |

Screenshots and exported synthetic PDF are in ignored `output/early-access-qa/`; they are local QA artifacts, not production evidence. Pricing screenshots include the temporary QA control strip. Mobile pricing is readable; the unrelated dense plan workspace showed cramped controls with a long synthetic title at 320px, so full mobile workspace polish is not claimed.

Actual browser restart (rather than tab reopen), fresh-account manual editing and live post-release OAuth/legal flows remain smoke-test items. No production data was deleted. Guest local enforcement can be reset by clearing browser storage and is not tamper-proof.
