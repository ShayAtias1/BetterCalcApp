# BetterCalc — Legal & Privacy Compliance Review and Draft Documents

**Status: DRAFT FOR LAWYER REVIEW. Not legal advice. Not published, not wired into the app.**
Prepared 2026-10-17 (Terms revised to v0.3 the same day) from the code in `/Users/ADMIN/Documents/BetterCalc/app` (branch `main`, incl. uncommitted work).

Conventions used below:
- `[[…]]` = a fact the owner must supply. Nothing about the company was invented.
- **⚖ LAWYER** = a clause or conclusion that needs approval from an Israeli lawyer before publication.
- **🔎 VERIFY** = a technical fact to confirm against the production configuration (I could only read code/docs).

---

## Part 1 — What the application actually does (data-flow inventory)

| # | Flow | Where data goes | Personal data? | Live in production? |
|---|---|---|---|---|
| 1 | Plans (PDF), projects, rooms, measurements, quantities, comparisons, markups | Browser IndexedDB only (`projects`, `takeoffProjects`) | Usually no, but plans can contain names/addresses of owners, architects, site addresses | Yes |
| 2 | Exports (PDF/Excel/backup archive) | Generated in browser, downloaded to the device | Same as above | Yes |
| 3 | Usage analytics | PostHog Cloud (`*.posthog.com`), lazily loaded, allowlisted props only, random `device_id` in `localStorage`, no person profiles, UTMs stripped from URL | **Pseudonymous** identifier + browser/OS metadata; IP reaches PostHog in transit | Only if `VITE_POSTHOG_KEY/HOST` set at build 🔎 |
| 4 | Google sign-in (OAuth/PKCE via Supabase) | Google → Supabase Auth | E-mail, name, Google profile metadata (e.g. avatar URL, provider ID) stored in `auth.users` | Yes (email-OTP hidden behind flag) |
| 5 | Account profile | Supabase `profiles`: display name, locale, `terms_version`, `terms_accepted_at`, `privacy_accepted_at`, `onboarding_completed_at` | Yes | Yes |
| 6 | Auto-created per-user rows | `entitlements`, `credit_wallets` (via `handle_new_user`) | Linked to user ID | Yes (empty/default) |
| 7 | Account deletion | `account_deletion_requests` → Edge Function `account-maintenance` (pg_cron), grace `ACCOUNT_DELETION_GRACE_DAYS` default 7 | Yes | Yes 🔎 (cron scheduled?) |
| 8 | Audit log | `audit_log` (actor, action, target_user UUID, details) — not FK-linked, **survives account deletion** (e.g. `account_deleted`) | UUIDs, possibly details | Yes |
| 9 | Cloud backup | Supabase Storage bucket `cloud-backups` (private, per-user RLS), read access for 90 days after entitlement ends | **Full plan PDFs and project data** | Built; gated by entitlement — "soon" |
| 10 | AI detection (spaces, openings, multi-plan, revisions) | `server/ai-server.mjs` → **OpenAI Responses API (US)**; `ai_usage` + credits ledger | Plan page images/content | **No** — UI only in `import.meta.env.DEV` with `VITE_AI_DEV_TOOLS`; production shows locked rows |
| 11 | Payments/subscriptions/credits | Tables `plans`, `prices`, `subscriptions`, `payments` (kept with user link nulled after deletion "for tax records"), `billing_profiles` (invoice name, **tax ID**, address), `payment_events` | Yes | **No** — `credit_purchases_enabled=false`, `paymentProvider.ts` placeholder |
| 12 | CAPTCHA | Cloudflare Turnstile script, only if `VITE_TURNSTILE_SITE_KEY` set | Device/browser signals to Cloudflare | Optional 🔎 |
| 13 | Hosting | Netlify (`public/_headers`, `_redirects`) | Access logs incl. IP | Yes 🔎 |
| 14 | Guest trial | `localStorage` key `bettercalc.trial`, 7 days, **not enforced** | No | Built, not enforced |

Notable facts that shape the documents:
- **Local-first is real**: no code path uploads plans during normal work. This is the product's strongest privacy position and the documents lean on it.
- **"Anonymous" is the wrong word for analytics.** A persistent random device ID + device metadata is very likely "information" about an identifiable person under the expanded definitions of Amendment 13 (and is "personal data" under GDPR). Use "pseudonymous / not linked to your name or e-mail". The existing draft and the home-screen note (`he.ts:567`, `en.ts:569`) say "anonymous". ⚖ LAWYER
- **Region conflict** 🔎: `docs/SUPABASE-SETUP.md:35` says EU (Frankfurt); the existing in-repo draft says EU (Ireland, eu-west-1). Check the dashboard.
- There is already an in-repo draft (`src/lib/legal/legalContent.ts`, uncommitted). It is accurate on facts but leaves liability, law and rights blank. The drafts below are a fuller replacement for review; I did not modify that file.
- `LEGAL_TEXTS` is `null` and `commercial_settings.legal_version` is `'null'`, so consent is currently recorded against a placeholder version.
- **Exports carry no disclaimer.** PDF/Excel reports that leave the app and reach clients, suppliers or tenders say nothing about verification. This is the biggest professional-reliance gap (see Part 2).

---

## Part 2 — Risks specific to construction quantity takeoff and professional reliance

1. **Reliance on quantities for pricing, tenders and ordering.** Contractors price bids and order materials (tiles, plaster, concrete, rebar) from these numbers. An error (wrong calibration, wrong page scale, stale revision, missed room) can cause losses far larger than any subscription fee. Claims would most likely be framed in contract or negligence (Torts Ordinance). → Accuracy/verification clause, financial-loss exclusion (no monetary cap per owner, see Part 12), export disclaimer, in-app calibration warnings.
2. **Measurement method mismatch.** Israeli works are usually measured under the contract's measurement rules (e.g. the General Specification for Building Works — "המפרט הכללי", inter-ministerial, and its "אופני מדידה" chapters) or a specific bill of quantities. App rules (opening deductions, waste %, skirting lengths, thresholds) may not match the governing method. → Terms must say the app does not apply any particular official measurement method unless it says so explicitly. ⚖ LAWYER (and a domain expert to confirm the wording)
3. **Structural quantities (rebar, mesh, stirrups, concrete).** The app computes structural quantities from drawings. A user might treat this as engineering verification. → Explicit statement: not structural design, does not check adequacy or code compliance, does not replace a licensed engineer (Engineers and Architects Law, 1958).
4. **Revision comparison may miss changes.** Overlay/blink/alignment is a visual aid; `diffEngine.ts` is a stub. Users may sign off a change order believing all differences were found. → "Comparison is a visual aid; it does not guarantee detection of all changes."
5. **Data loss from browser storage.** IndexedDB can be evicted or cleared; losing a project mid-tender is a realistic harm. → User backup responsibility, no liability for local data loss; the app already has backup reminders (good evidence of reasonable care).
6. **Third-party plans and copyright.** Plans are typically copyright works of architects/engineers (Copyright Act, 2007) and may be confidential under tender NDAs. Local-only processing keeps the operator out of the chain today; cloud backup and AI change that (operator stores/transmits the plans). → User warranty of rights + confidentiality; for future features, a narrow processing licence.
7. **Future AI.** AI-detected rooms/openings are probabilistic. Sending plans to OpenAI (US) adds cross-border transfer, confidentiality and copyright questions, and the PPA's guidance on AI systems is relevant. → AI section kept as "not available"; separate AI addendum before launch.
8. **Professional users vs. consumers.** Most users are businesses, but sole contractors ("עוסק פטור/מורשה") and private renovators may be consumers under the Consumer Protection Law, 1981. Liability caps and cancellation terms must work for both. ⚖ LAWYER

---

## Part 3 — Applicable Israeli law (summary for counsel; verify each point)

> These are my understanding of the framework, written to orient the lawyer — not conclusions to rely on. ⚖ LAWYER for all of Part 3.

**Privacy Protection Law, 5741-1981, as amended by Amendment 13 (in force August 2025)**
- Broader definitions of "information" and "identifying" data; "highly sensitive information" category (BetterCalc does not knowingly process it, except potentially tax ID/billing data later, which is not in that category as I understand it — confirm).
- Database registration is now limited mainly to certain public bodies and data brokers; BetterCalc likely does **not** need to register — confirm.
- DPO (ממונה הגנת פרטיות) obligation applies to specific categories (public bodies, data brokers, large-scale systematic monitoring or large-scale sensitive data). Likely not required at launch — confirm, and re-check when AI/cloud scale.
- Section 11 notice duty: when collecting data, tell the person whether they must provide it, the purpose, to whom it will be given, and their rights. The Privacy Policy + the sign-in screen must satisfy this.
- Rights of access (s.13) and correction/deletion of inaccurate data (s.14), with response time limits in the regulations. Israeli law has no general GDPR-style erasure right, but the app offers deletion anyway — good.
- Strengthened PPA enforcement: administrative fines, investigative powers, and statutory damages without proof of harm in certain cases. Inaccurate statements in a privacy policy are themselves a risk — which is why "anonymous" must be fixed.

**Privacy Protection (Data Security) Regulations, 5777-2017**
- The account database (Supabase) is likely a "basic" security-level database (non-sensitive data, operator-managed). Requires at minimum: a database definition document, a security procedure, inventory of systems, access control and authorised-person list, documentation of security incidents, secure outsourcing (reg. 15: written terms with processors), backups. Higher levels apply with more data subjects/authorised users or sensitive data. Notification of severe incidents to the PPA applies at certain levels — confirm which.
- Cloud backup (full plans) and billing (tax IDs) may change the classification. Re-assess before enabling.

**Privacy Protection (Transfer of Data to Databases Abroad) Regulations, 5761-2001**
- Supabase/PostHog in the EU: EU is a permitted destination. Google (US), Netlify (global CDN, US company), Cloudflare (if Turnstile on), and future OpenAI (US) need a lawful basis (e.g. consent, or the recipient's undertaking to comply with Israeli-equivalent safeguards). Draft relies on disclosure + contract terms; counsel to confirm basis.
- If EU residents use the service, GDPR may apply (Art. 3(2)); Israel's adequacy decision matters for EU→IL flows. Launch is Israel-only, so the drafts mention GDPR only as "if applicable".

**Standard Contracts Law, 5743-1982**
- Online terms are a standard contract. Section 4 lists presumptively restrictive terms, including: full or unreasonable exemption from liability; unilateral right to change terms; waiver of rights; and terms giving the supplier the right to choose the forum. Courts (and the Standard Contracts Tribunal) can void them.
- Consequences for drafting: the liability exclusion stops at what the law will not allow to be excluded (malice, fraud, gross negligence, bodily injury, mandatory duties), with a non-monetary fallback; the owner chose no monetary cap (risk analysed in Part 12); changes require advance notice and allow the user to leave; jurisdiction clause is flagged.

**Consumer Protection Law, 5741-1981 (for paid features, future)**
- Distance-sale disclosures and cancellation right (s.14C) — 14-day cancellation for distance transactions, cancellation fee limits; digital-service specifics to be checked.
- Continuing transactions: easy online cancellation and notice requirements for renewals/price changes (s.13D and related amendments).
- Applies only to consumers, but the operator usually cannot reliably separate them → design for compliance.

**Other**
- Equal Rights for Persons with Disabilities (Service Accessibility Adjustments) Regulations, 2013 → website accessibility to Israeli Standard 5568 (WCAG 2.0 AA based) and an **accessibility statement**. This is a frequent source of class actions in Israel. Not covered by Privacy/Terms — separate gap.
- Communications Law (Telecommunications and Broadcasting), s.30A ("spam law") → no marketing e-mail/SMS without prior opt-in consent. Currently the app sends none; keep it that way until an opt-in exists.
- Legal Capacity and Guardianship Law → set minimum age 18 (professional tool; minors' contracts are voidable).
- Tax/invoicing (future): VAT-inclusive consumer pricing, tax invoices, and the Israel Invoices model (allocation numbers) for B2B invoices above the threshold — counsel/accountant.
- Copyright Act, 2007 → user content rights, open-source notices (PDFium licences already in `public/licenses`; fonts under OFL — confirm attribution page).

---

## Part 4 — Draft Privacy Policy (English)

> **BetterCalc Privacy Policy** — DRAFT v0.1
> Last updated: [[date]] · Version: [[version id, must match `legal_version`]]

**1. Who we are**
BetterCalc ("we", "us") is operated by [[owner's full legal name]], a VAT-exempt sole proprietor (עוסק פטור), ID / business no. [[number]], [[address]]. Privacy contact: [[privacy e-mail]]. ⚖ LAWYER (who is the database owner/controller)

**2. The short version**
- Your plans and projects are stored **in your own browser**, on your device. We do not receive them when you work.
- An account is optional. If you sign in with Google, we store basic account details (Section 4).
- If enabled, we collect pseudonymous usage statistics that never include plan content (Section 5).
- AI features, cloud backup and payments are **not available yet**. Nothing described in Section 8 happens today.

**3. Data that stays on your device (live)**
Plans (PDF files), projects, rooms, measurements, quantities, markups, comparisons and exports are stored in your browser's storage (IndexedDB) and saved to your device when you export. We cannot see, access, recover or delete this data. Your browser may delete it if storage runs low or you clear site data. Signing in, signing out or deleting your account does not read, move or delete it. Plans may contain information about other people (for example owners' names or site addresses); you control that information and are responsible for using it lawfully.

**4. Account data (live, optional)**
If you sign in with Google, we receive and store, through our provider Supabase:
- user ID, e-mail address and name, and the basic profile details Google shares with sign-in apps (such as a profile picture link);
- the display name you confirm and your language setting;
- the date, time and version of the Terms and Privacy Policy you accepted;
- technical records created by the authentication service, such as sign-in times and the IP address and browser used to sign in 🔎;
- account status records (for example your plan/entitlement and an empty credit balance) and, if you request deletion, the deletion request.
Purpose: to create and secure your account, keep you signed in, record your acceptance of these documents, and prepare account features. You are not legally required to give us this data; without it you can still use BetterCalc as a guest. We never receive your Google password.

**5. Usage statistics (live if enabled 🔎)**
To understand how BetterCalc is used and improve it, we send usage events to PostHog (EU cloud 🔎). An event records that something happened (for example "a plan was opened" or "an export finished") with counts, categories, durations, app version, device type, browser and operating system, and campaign tags from the link you used to arrive.
- Events are linked to a random identifier stored in your browser, not to your name, e-mail or account. We do not create user profiles in the analytics tool.
- **Never sent:** plan content or images, project, plan, room or file names, notes, labels, exact quantities, measurements, coordinates.
- No session recording, no automatic click capture, no advertising or cross-site tracking.
- We have configured the tool to discard IP addresses 🔎 and to keep events for [[retention period]].
- To stop statistics on a browser: [[opt-out mechanism — does not exist yet, see Gap G4]]. ⚖ LAWYER (consent vs. notice)

**6. Browser storage**
We use your browser's local storage and IndexedDB (not advertising cookies) for: your projects, your sign-in session, language and display preferences, the analytics identifier, and a local record of the free guest period. If CAPTCHA protection is enabled, Cloudflare Turnstile may process browser signals to detect bots 🔎.

**7. Who processes data for us**
| Provider | Role | Location |
|---|---|---|
| Supabase | Authentication, database, file storage | EU ([[Frankfurt / Ireland]] 🔎) |
| Google | Sign-in | [[global / US]] |
| PostHog | Usage statistics (if enabled) | EU |
| Netlify | Website hosting and delivery | [[global CDN / US]] 🔎 |
| Cloudflare | CAPTCHA (only if enabled) | [[global]] |
Some providers operate outside Israel. We transfer data to them under [[legal basis — consent / contractual undertakings]]. ⚖ LAWYER
We do not sell personal data and do not share it for advertising. We may disclose data if required by law or a competent authority, or to protect our rights in a legal proceeding. ⚖ LAWYER

**8. Features not available yet (future)**
The following exist in the code but are **switched off**. Before any of them is enabled, we will update this policy, show you what changes, and ask for your agreement where required.
- **Cloud backup:** an optional copy of your projects (including plan files) stored in your account in private storage. [[Retention, and what happens after a subscription ends — the system currently keeps read access for 90 days]].
- **AI assistance** (for example suggesting rooms, openings or revision changes): would send selected plan pages to an AI provider [[provider, location, retention, training use]]. Nothing is sent to any AI service today.
- **Payments and subscriptions:** would be handled by a payment provider [[name]]; we would store billing details for invoices (name, tax ID, address) and payment records, which we may have to keep for [[period under tax law]] even after account deletion. No payment details are collected today.

**9. How long we keep data**
- Account data: until you delete your account. After a deletion request, a [[7]]-day waiting period applies (you can cancel); then account data and any cloud files are deleted.
- A minimal record that an account was deleted (internal IDs, no name or e-mail) is kept in our security log for [[period]]. ⚖ LAWYER 🔎
- Backups kept by our providers may persist for up to [[period]] before being overwritten. 🔎
- Usage statistics: [[retention period]].

**10. Your rights**
Under Israeli law you may ask to access the personal data we hold about you and to correct or delete data that is inaccurate, incomplete, unclear or outdated. You can also delete your account yourself from the account page, and change your name or language at any time. Send requests to [[privacy e-mail]]; we will respond within the period required by law. If you are in the EU, you may have additional rights under the GDPR. ⚖ LAWYER (exact rights, timelines, PPA complaint mention)

**11. Security**
We use encrypted connections, per-user access rules on account data, private storage, restricted administrative access and a strict content-security policy. Plans stay on your device, which also means their security depends on your device and browser. No system is completely secure; if a security incident affects your data, we will act as required by law. ⚖ LAWYER (do not promise more than this)

**12. Age**
BetterCalc is intended for users aged 18 and over. ⚖ LAWYER

**13. Changes**
We will publish changes on this page with a new date and version. For material changes we will notify signed-in users in the app [[or by e-mail]] before they take effect and, where required, ask for renewed consent.

---

## Part 5 — Draft Terms of Service (English) — REVISED v0.3

> **Owner's position applied in v0.3:** BetterCalc is strictly an auxiliary calculation tool working from PDF drawings. There is no guarantee of accuracy, completeness or reliability. The user verifies everything. Financial liability, direct and indirect, is excluded as far as the law allows. **There is no monetary cap.** The operator is an individual sole proprietor.
> **Enforceability approach:** the exclusion is broad but **stops exactly where Israeli law stops it**: malice, fraud, gross negligence, bodily injury, and non-waivable statutory and consumer rights. It is supported by (a) a prominent professional-use notice the user must accept, (b) a stated rationale, (c) a **non-monetary fallback** (§12.5) that applies only if a court refuses the exclusion, and (d) a modification-not-voiding clause. Removing the cap has a cost, analysed in Part 12. ⚖ COUNSEL for the overall structure.

> **BetterCalc Terms of Service** — DRAFT v0.3
> Last updated: [[date]] · Version: [[version id, must match `legal_version`]]

> ### ⚠ PROFESSIONAL-USE NOTICE — READ BEFORE USING BETTERCALC
> **1. BetterCalc is an auxiliary tool only.** It helps you calculate quantities from PDF drawings. It is not a measuring instrument, not a professional service and not a substitute for professional judgment.
> **2. PDF-based measurement is inherently inaccurate.** Drawings may be not to scale, distorted, scanned, outdated or incomplete, and calibration, rendering and rounding introduce errors. **No accuracy, completeness or reliability of any result is guaranteed.**
> **3. You must independently verify ALL measurements, calculations, quantities and reports** before relying on them for any purpose: pricing, tenders, ordering, invoicing, payment certificates or construction.
> **4. BetterCalc is not engineering, architecture, quantity surveying or licensed surveying,** and nothing it produces is a certification, approval or professional opinion.
> **5. The Operator is not liable for financial losses** arising from use of or reliance on BetterCalc, direct or indirect — including pricing mistakes, material orders, construction delays and third-party claims — **to the fullest extent permitted by Israeli law** (Section 12).
> By using BetterCalc you confirm you have read and accept this notice. ⚖ COUNSEL (wording; whether a checkbox acceptance is required, see Part 11 §A)

### 1. The Operator and acceptance
1.1 BetterCalc ("the Service") is operated by **[[owner's full legal name]]**, an individual (natural person) residing in Israel, doing business as a VAT-exempt sole proprietor (עוסק פטור), ID / business no. [[number]], address for notices: [[address]], e-mail: [[e-mail]] ("the Operator", "we"). The Operator is not a company or other corporate body.
1.2 By using the Service, with or without an account, you agree to these Terms and to the Privacy Policy. If you do not agree, do not use the Service.
1.3 You must be at least 18 and legally competent. If you use the Service for a business, you confirm you may bind that business, and "you" includes it.
1.4 The Service is intended for professional use in the construction field. If you are a consumer under the Consumer Protection Law, 5741-1981, nothing in these Terms limits rights that law gives you and that cannot be waived. ⚖ COUNSEL

### 2. Nature of the Service
2.1 The Service is **strictly an auxiliary quantity-calculation tool** based on PDF drawings. It runs in your browser and applies calculations to the drawings, scales, calibration, selections and settings that **you** provide.
2.2 The Service is provided **free of charge** [[during an initial / beta period]]. The Operator does not review your drawings, inputs or results, does not advise you, and no professional, advisory, agency, employment or fiduciary relationship arises between you and the Operator.
2.3 No statement on the website, in marketing, in the Service or in support communications is a promise or warranty of accuracy, unless it is made in a written document signed by the Operator.

### 3. Inherent inaccuracy; no guarantee
3.1 Measurements taken from PDF drawings are **inherently subject to inaccuracy**. Causes include: drawings that are not to scale, distorted, scanned, cropped, outdated or incomplete; incorrect or imprecise calibration; differences in PDF rendering; line thickness and pointer precision; elements drawn, detected or classified incorrectly; settings such as heights, waste, deductions, spacing, cover or lap lengths; rounding; and software errors.
3.2 Accordingly, the Operator **does not guarantee the accuracy, completeness or reliability** of any measurement, calculation, quantity, comparison or report, or that results comply with any standard, measurement method, contract or bill of quantities, or are fit for any purpose.
3.3 Labels in the Service such as "exact", "estimate", "approved" or "calibrated" describe how a figure was calculated or what **you** marked. They are not a statement by the Operator that the figure is correct. ⚖ COUNSEL (also fix the labels in the UI, Part 11 §K)

### 4. Your responsibility to verify everything
4.1 **You are solely responsible for independently verifying all measurements, calculations, quantities and reports** before relying on them for any purpose, including pricing, tenders, ordering materials, invoices, payment certificates (חשבונות חלקיים), change orders, scheduling, financing or construction. Verify them yourself or through a qualified professional.
4.2 At a minimum: confirm each page's calibration against a second known dimension; confirm you are using the correct and current drawing revision; check quantities against the drawing's dimensions; and apply the measurement method that governs your contract.
4.3 You are responsible for your inputs and for every decision you make on the basis of the Service.

### 5. Not engineering or professional certification
5.1 The Service does not perform, and its results are not, engineering, structural, architectural, quantity-surveying (כמאות) or licensed land-surveying (מדידה מוסמכת) work. The Operator does not act as an engineer, architect, quantity surveyor or licensed surveyor in providing it.
5.2 Structural quantities (concrete, reinforcement, mesh, stirrups and similar) are estimates only. The Service does not design structures and does not check strength, adequacy, safety, detailing, or compliance with Israeli Standards (תקנים), building regulations or permits.
5.3 Results are not a certification, approval, professional opinion, measurement certificate or signed document. They must not be presented to any authority, client, lender, appraiser, court or other person as such.
5.4 The Service does not apply any particular official or contractual measurement method (including the measurement rules of the General Specification for Building Works (המפרט הכללי) or any bill of quantities), unless a feature states so expressly. ⚖ COUNSEL + domain review
5.5 Plan comparison is a visual aid. It does not guarantee that any or all changes between revisions are found.

### 6. Reports and third parties
6.1 Reports, tables and files you export ("Reports") are prepared **by you**, using the Service as a tool. You are their author and are responsible for them.
6.2 If you give a Report or any result to another person (a client, contractor, supplier, developer, lender, appraiser, tender committee, authority or anyone else): (a) you do so at your own responsibility; (b) you must not remove, hide or alter the notices on Reports; (c) you must not state or imply that BetterCalc or the Operator prepared, checked, approved or certified it; and (d) you are responsible for that person's reliance on it.
6.3 The Service is provided to you only. The Operator does not intend anyone else to rely on the Service or on Reports, and to the extent permitted by law accepts no duty or responsibility to any third party. ⚖ COUNSEL (third parties are not bound by these Terms; the export notices in Part 11 are the main protection)

### 7. Data stored on your device
7.1 Drawings, projects and Reports are stored only in your browser storage and on your device. The Operator does not receive, hold or back them up, and cannot access, restore or recover them.
7.2 Browser storage can be erased by the browser, by clearing site data, by private browsing, by device failure or replacement, or by software updates. **You are responsible for keeping current backups** using the export and backup tools provided.
7.3 To the extent permitted by law, the Operator is not liable for loss, corruption or unavailability of data stored on your device, including where caused by a software error, except as set out in Section 12.4. ⚖ COUNSEL

### 8. Accounts
8.1 Accounts are optional and created through Google sign-in. Keep your Google account secure; you are responsible for activity under your account.
8.2 You may delete your account at any time, as described in the Privacy Policy. Deleting it does not delete data on your devices.

### 9. Acceptable use
You must not: interfere with, overload, probe or bypass the Service's security or limits; access other users' data; reverse-engineer the Service except as permitted by law; use automated means to abuse it; or use it unlawfully or with content you have no right to use.

### 10. Your content and the Operator's intellectual property
10.1 You own your drawings, projects, measurements and Reports. The Operator claims no ownership.
10.2 You confirm that you have the rights and permissions needed to use the drawings you load, including under copyright and any confidentiality or tender obligations.
10.3 If a future feature you choose requires the Operator to store or process your content (such as cloud backup or AI), you grant the Operator a limited, non-exclusive licence to do so solely to provide that feature to you.
10.4 The software, design and name "BetterCalc" belong to the Operator or the Operator's licensors. Open-source components are licensed under their own terms, listed at [[licences page]]. You receive a personal, non-transferable, revocable right to use the Service under these Terms.
10.5 The Operator may use feedback you send without obligation, and may use aggregated statistics that do not contain your content.

### 11. Service provided "as is"
11.1 The Service is provided free of charge, as a general auxiliary tool, on inputs you control, with results you are required to verify. It is therefore provided **"as is" and "as available"**. To the extent permitted by law, the Operator gives no warranty or representation, express or implied, as to accuracy, completeness, reliability, availability, error-free operation or fitness for a particular purpose.
11.2 The Operator may change, suspend or discontinue any feature. If the Service as a whole is discontinued, the Operator will try to give at least [[30]] days' notice so that you can export your data. ⚖ COUNSEL

### 12. Exclusion of liability ⚖ COUNSEL — core clause
12.1 **Financial losses.** To the fullest extent permitted by law, the Operator is not liable for any financial loss or damage, **direct or indirect**, arising from or connected with the use of, inability to use, or reliance on the Service or any result or Report, including:
 (a) pricing, estimating, bidding or tender mistakes;
 (b) quantities ordered, over- or under-ordering, wastage or surplus of materials;
 (c) construction delays, rework, acceleration, idle time or remedial work;
 (d) loss of profit, revenue, business, contracts, tenders or goodwill;
 (e) penalties, damages, compensation or other amounts payable to clients, contractors, suppliers or any other third party, and disputes with them;
 (f) loss of data stored on your device.
12.2 **Third-party claims.** To the fullest extent permitted by law, the Operator is not liable to you for any claim made against you by a third party in connection with a result or Report, and you are responsible for any such claim as between you and the Operator (see also Section 13).
12.3 **Basis.** You acknowledge that: the Service is a free auxiliary tool; PDF-based measurement is inherently imprecise; you, not the Operator, choose the drawings, scales and inputs; you are able and required to verify all results before relying on them; the Operator has no access to your drawings or projects; and the Operator does not charge for, and could not bear, the risk of your business decisions. This Section is a fundamental basis on which the Service is offered free of charge.
12.4 **What is not excluded.** Nothing in these Terms excludes or limits the Operator's liability: (a) for malice, fraud or deceit; (b) for gross negligence; (c) for death or bodily injury caused by negligence; (d) for any obligation or liability that cannot be excluded or limited under Israeli law, including mandatory duties under privacy and data-protection law; or (e) for any right you have as a consumer that cannot be waived.
12.5 **Fallback if the exclusion is not enforced.** If, despite Section 12.1, the Operator is held liable for a loss, then to the extent permitted by law: (a) liability is limited to direct damage that was reasonably foreseeable when you started using the Service and that you prove; (b) it is reduced in proportion to your own contribution to the loss, including any failure to verify results as required by Section 4; (c) you must take reasonable steps to mitigate the loss; and (d) no punitive or exemplary damages apply. ⚖ COUNSEL (non-monetary fallback; restates principles of the Contracts (Remedies for Breach of Contract) Law, 5731-1970, and contributory fault — confirm)
12.6 **Who is protected.** This Section protects the Operator personally and anyone acting on the Operator's behalf, who may rely on it. ⚖ COUNSEL (third-party beneficiary, Contracts (General Part) Law s.34)
12.7 **Notice of claims (optional).** If you believe you have a claim, please notify the Operator in writing at [[e-mail]] promptly, and in any case within [[6/12]] months of becoming aware of it, so that the problem can be investigated and, where possible, fixed. ⚖ COUNSEL (Prescription Law, 5718-1958, s.19; may be restrictive)

### 13. Indemnity (business users) ⚖ COUNSEL
If you use the Service in the course of a business, you will indemnify the Operator for reasonable costs, losses and legal fees arising from a third-party claim caused by: (a) content you loaded without the right to do so; (b) a Report or result you gave to a third party, or its use by that third party; or (c) your breach of these Terms. The Operator will notify you of the claim promptly and allow you to take part in the defence. This Section does not apply to the extent the claim results from a matter listed in Section 12.4(a)–(c).

### 14. Features not available yet
AI assistance, cloud backup, paid plans, credits and payments are **not offered today**, and nothing is charged. Before any of them becomes available, the Operator will publish its specific terms, which you must accept before using it: price, billing, renewal, cancellation and refunds, and for AI, the provider and how outputs must be reviewed. The Operator is a VAT-exempt dealer (עוסק פטור), so prices will not include VAT. The exclusions in Section 12 will be reviewed for paid features before launch. ⚖ COUNSEL + accountant

### 15. Changes to these Terms
15.1 Changes will be published with a new date and version. For material changes, signed-in users will be notified in the app [[and by e-mail]] at least [[14/30]] days before the changes take effect. Changes required by law or for security may take effect sooner.
15.2 If you do not agree, you may stop using the Service and delete your account. Continued use after the effective date means acceptance. Changes do not apply to claims that arose before they took effect.

### 16. Termination
You may stop using the Service at any time. The Operator may suspend or end your access if you materially breach these Terms or if the law requires it, with notice where reasonable. Sections 3–7, 10–13 and 17–18 survive termination.

### 17. Governing law and jurisdiction ⚖ COUNSEL
17.1 These Terms are governed by the laws of the State of Israel.
17.2 The competent courts in Israel have jurisdiction. [[Option for business users only: the competent courts in [district] have exclusive jurisdiction.]] No exclusive forum is imposed on consumers.

### 18. General
18.1 **Modification rather than voiding.** If a court finds any provision invalid or unenforceable in whole or in part, including a provision of Section 12, that provision applies to the maximum extent permitted. Section 12.5 and the rest of these Terms remain in force. ⚖ COUNSEL (cf. Standard Contracts Law s.19)
18.2 **Assignment.** The Operator may transfer these Terms and the Service to a company the Operator controls, or to a buyer of the Service, with notice to you. You may not transfer your rights without the Operator's consent.
18.3 **Entire agreement.** These Terms and the Privacy Policy are the entire agreement about the Service.
18.4 **No waiver.** Not enforcing a right is not a waiver of it.
18.5 **Language.** These Terms are published in Hebrew and English. If they conflict, the Hebrew version prevails. ⚖ COUNSEL
18.6 **Notices.** The Operator may notify you in the app or by your account e-mail. Notices to the Operator: [[e-mail]] / [[address]].

---

## חלק 6 — טיוטת מדיניות פרטיות (עברית)

> **מדיניות הפרטיות של BetterCalc** — טיוטה 0.1
> עדכון אחרון: [[תאריך]] · גרסה: [[מזהה גרסה]]

**1. מי אנחנו**
BetterCalc ("אנחנו") מופעלת על ידי [[שם משפטי מלא של הבעלים]], עוסק פטור, ת.ז. / מס' עוסק [[מספר]], [[כתובת]]. פנייה בנושאי פרטיות: [[דוא"ל פרטיות]]. ⚖ עו"ד

**2. בקצרה**
- התוכניות והפרויקטים שלכם נשמרים **בדפדפן שלכם**, במכשיר שלכם. איננו מקבלים אותם בזמן העבודה.
- חשבון הוא אופציונלי. אם תתחברו עם Google, נשמור פרטי חשבון בסיסיים (סעיף 4).
- אם הדבר מופעל, נאסוף סטטיסטיקות שימוש בכינוי (פסאודונימיות) שלעולם אינן כוללות את תוכן התוכניות (סעיף 5).
- יכולות בינה מלאכותית, גיבוי בענן ותשלומים **אינם זמינים עדיין**. דבר ממה שמתואר בסעיף 8 אינו מתבצע היום.

**3. מידע שנשאר במכשיר שלכם (פעיל)**
תוכניות (קובצי PDF), פרויקטים, חדרים, מדידות, כמויות, סימונים, השוואות וייצואים נשמרים באחסון הדפדפן (IndexedDB) ובמכשיר שלכם כשאתם מייצאים. איננו יכולים לראות, לגשת, לשחזר או למחוק מידע זה. הדפדפן עשוי למחוק אותו כשהאחסון מתמלא או כשמנקים נתוני אתר. התחברות, התנתקות או מחיקת חשבון אינן קוראות, מעבירות או מוחקות אותו. תוכניות עשויות לכלול מידע על אחרים (למשל שמות בעלים או כתובות אתרים); המידע הזה בשליטתכם ואתם אחראים לשימוש חוקי בו.

**4. נתוני חשבון (פעיל, אופציונלי)**
אם תתחברו עם Google, נקבל ונשמור, באמצעות הספק שלנו Supabase:
- מזהה משתמש, כתובת דוא"ל ושם, ופרטי הפרופיל הבסיסיים ש-Google מעבירה לאפליקציות התחברות (כגון קישור לתמונת פרופיל);
- שם התצוגה שאישרתם והגדרת השפה;
- המועד והגרסה של תנאי השימוש ומדיניות הפרטיות שאישרתם;
- רשומות טכניות של שירות האימות, כגון מועדי התחברות וכתובת IP ודפדפן ששימשו להתחברות 🔎;
- רשומות מצב חשבון (למשל סוג התוכנית ויתרת קרדיטים ריקה), ואם ביקשתם מחיקה — בקשת המחיקה.
מטרה: יצירת החשבון ואבטחתו, שמירת החיבור, תיעוד הסכמתכם למסמכים אלה והכנת יכולות חשבון. אינכם חייבים על פי דין למסור לנו מידע זה; בלעדיו ניתן להמשיך להשתמש ב-BetterCalc כאורח. איננו מקבלים את סיסמת Google שלכם.

**5. סטטיסטיקות שימוש (פעיל אם הופעל 🔎)**
כדי להבין כיצד משתמשים ב-BetterCalc ולשפר אותה, אנו שולחים אירועי שימוש ל-PostHog (ענן אירופי 🔎). אירוע מתעד שמשהו קרה (למשל "נפתחה תוכנית" או "הסתיים ייצוא") עם ספירות, קטגוריות, משכי זמן, גרסת האפליקציה, סוג המכשיר, הדפדפן ומערכת ההפעלה, ותגיות קמפיין מהקישור שדרכו הגעתם.
- האירועים מקושרים למזהה אקראי השמור בדפדפן, ולא לשם, לדוא"ל או לחשבון שלכם. איננו יוצרים פרופילי משתמשים בכלי הסטטיסטיקה.
- **לעולם לא נשלחים:** תוכן או תמונות של תוכניות, שמות פרויקטים, תוכניות, חדרים או קבצים, הערות, תוויות, כמויות מדויקות, מידות, קואורדינטות.
- אין הקלטת מסך, אין לכידה אוטומטית של לחיצות, אין מעקב פרסומי או מעקב בין אתרים.
- הגדרנו את הכלי להשמיט כתובות IP 🔎 ולשמור אירועים למשך [[תקופה]].
- להפסקת הסטטיסטיקה בדפדפן: [[מנגנון ביטול — לא קיים עדיין, ראו פער G4]]. ⚖ עו"ד

**6. אחסון בדפדפן**
אנו משתמשים באחסון המקומי וב-IndexedDB של הדפדפן (לא בעוגיות פרסום) עבור: הפרויקטים, חיבור המשתמש, העדפות שפה ותצוגה, מזהה הסטטיסטיקה, ותיעוד מקומי של תקופת האורח. אם מופעלת הגנת CAPTCHA, ‏Cloudflare Turnstile עשויה לעבד נתוני דפדפן לזיהוי בוטים 🔎.

**7. מי מעבד מידע עבורנו**
| ספק | תפקיד | מיקום |
|---|---|---|
| Supabase | אימות, מסד נתונים, אחסון קבצים | האיחוד האירופי ([[פרנקפורט / אירלנד]] 🔎) |
| Google | התחברות | [[עולמי / ארה"ב]] |
| PostHog | סטטיסטיקת שימוש (אם הופעלה) | האיחוד האירופי |
| Netlify | אחסון והגשת האתר | [[CDN עולמי / ארה"ב]] 🔎 |
| Cloudflare | CAPTCHA (רק אם הופעל) | [[עולמי]] |
חלק מהספקים פועלים מחוץ לישראל. העברת המידע אליהם נעשית על בסיס [[בסיס משפטי — הסכמה / התחייבות חוזית]]. ⚖ עו"ד
איננו מוכרים מידע אישי ואיננו משתפים אותו לצורכי פרסום. ייתכן שנמסור מידע אם הדין או רשות מוסמכת יחייבו זאת, או כדי להגן על זכויותינו בהליך משפטי. ⚖ עו"ד

**8. יכולות שאינן זמינות עדיין (עתידי)**
היכולות הבאות קיימות בקוד אך **כבויות**. לפני הפעלת כל אחת מהן נעדכן מדיניות זו, נציג מה משתנה ונבקש את הסכמתכם במקום שנדרש.
- **גיבוי בענן:** עותק אופציונלי של הפרויקטים (כולל קובצי התוכניות) בחשבונכם, באחסון פרטי. [[תקופת שמירה ומה קורה בסיום מנוי — המערכת שומרת כיום הרשאת קריאה ל-90 יום]].
- **סיוע בינה מלאכותית** (למשל הצעת חדרים, פתחים או שינויים בין גרסאות): ישלח עמודי תוכנית נבחרים לספק בינה מלאכותית [[ספק, מיקום, תקופת שמירה, שימוש לאימון]]. היום שום דבר אינו נשלח לשירות בינה מלאכותית.
- **תשלומים ומנויים:** יטופלו על ידי ספק סליקה [[שם]]; נשמור פרטי חיוב לחשבוניות (שם, מספר עוסק/ח.פ., כתובת) ורשומות תשלום, שייתכן שנידרש לשמור למשך [[תקופה לפי דיני המס]] גם לאחר מחיקת החשבון. היום לא נאספים פרטי תשלום.

**9. משך שמירת המידע**
- נתוני חשבון: עד למחיקת החשבון. לאחר בקשת מחיקה חלה תקופת המתנה של [[7]] ימים (שבה ניתן לבטל); לאחר מכן נמחקים נתוני החשבון וקובצי הענן.
- רשומה מינימלית על כך שחשבון נמחק (מזהים פנימיים, ללא שם או דוא"ל) נשמרת ביומן האבטחה למשך [[תקופה]]. ⚖ עו"ד 🔎
- גיבויים אצל הספקים עשויים להישמר עד [[תקופה]] לפני שיידרסו. 🔎
- סטטיסטיקות שימוש: [[תקופה]].

**10. הזכויות שלכם**
לפי הדין בישראל באפשרותכם לבקש לעיין במידע האישי שאנו מחזיקים עליכם, ולבקש לתקן או למחוק מידע שאינו נכון, שלם, ברור או מעודכן. תוכלו גם למחוק את החשבון בעצמכם מדף החשבון ולשנות שם או שפה בכל עת. בקשות יש לשלוח אל [[דוא"ל פרטיות]]; נשיב בתוך התקופה הקבועה בדין. ⚖ עו"ד

**11. אבטחת מידע**
אנו משתמשים בחיבורים מוצפנים, בכללי גישה פרטניים לכל משתמש על נתוני החשבון, באחסון פרטי, בהגבלת גישה ניהולית ובמדיניות אבטחת תוכן מחמירה. התוכניות נשארות במכשירכם, ולכן אבטחתן תלויה גם במכשיר ובדפדפן שלכם. אין מערכת מאובטחת לחלוטין; אם אירוע אבטחה ישפיע על המידע שלכם, נפעל כנדרש בדין. ⚖ עו"ד

**12. גיל**
BetterCalc מיועדת למשתמשים בני 18 ומעלה. ⚖ עו"ד

**13. שינויים**
שינויים יפורסמו בדף זה עם תאריך וגרסה חדשים. על שינויים מהותיים נודיע למשתמשים מחוברים באפליקציה [[או בדוא"ל]] לפני כניסתם לתוקף, ונבקש הסכמה מחודשת במקום שנדרש.

---

## חלק 7 — טיוטת תנאי שימוש (עברית) — גרסה מתוקנת 0.3

> **תנאי השימוש של BetterCalc** — טיוטה 0.3
> עדכון אחרון: [[תאריך]] · גרסה: [[מזהה גרסה, תואם ל-`legal_version`]]

> ### ⚠ הודעה לשימוש מקצועי — יש לקרוא לפני השימוש ב-BetterCalc
> **1. BetterCalc היא כלי עזר בלבד** לחישוב כמויות מתוך תוכניות PDF. היא אינה מכשיר מדידה, אינה שירות מקצועי ואינה תחליף לשיקול דעת מקצועי.
> **2. מדידה מתוך PDF כרוכה מטבעה באי-דיוקים.** תוכניות עשויות שלא להיות בקנה מידה, להיות מעוותות, סרוקות, לא מעודכנות או חסרות, וכיול, תצוגה ועיגול גורמים לסטיות. **אין כל התחייבות לדיוק, לשלמות או לאמינות של תוצאה כלשהי.**
> **3. עליכם לאמת באופן עצמאי את כל המדידות, החישובים, הכמויות והדוחות** לפני הסתמכות עליהם לכל מטרה — תמחור, מכרזים, הזמנות, חשבונות, חשבונות חלקיים או ביצוע.
> **4. BetterCalc אינה הנדסה, אדריכלות, כמאות או מדידה מוסמכת**, ושום דבר שהיא מפיקה אינו אישור, היתר או חוות דעת מקצועית.
> **5. המפעיל אינו אחראי לנזקים כספיים**, ישירים או עקיפים, הנובעים מהשימוש ב-BetterCalc או מהסתמכות עליה — לרבות טעויות תמחור, הזמנות חומרים, עיכובי ביצוע ותביעות צד שלישי — **במידה המרבית המותרת לפי הדין בישראל** (סעיף 12).
> בשימוש ב-BetterCalc אתם מאשרים שקראתם הודעה זו ואתם מקבלים אותה. ⚖ עו"ד

### 1. המפעיל והסכמה
1.1 BetterCalc ("השירות") מופעלת על ידי **[[שם משפטי מלא של הבעלים]]**, אדם פרטי (יחיד) תושב ישראל, הפועל כעוסק פטור, ת.ז. / מס' עוסק [[מספר]], מען להודעות: [[כתובת]], דוא"ל: [[דוא"ל]] ("המפעיל"). המפעיל אינו חברה או תאגיד.
1.2 בשימוש בשירות, עם חשבון או בלעדיו, אתם מסכימים לתנאים אלה ולמדיניות הפרטיות. אם אינכם מסכימים, אל תשתמשו בשירות.
1.3 עליכם להיות בני 18 לפחות ובעלי כשרות משפטית. אם אתם משתמשים בשירות עבור עסק, אתם מאשרים שאתם מוסמכים לחייב אותו, ו"אתם" כולל אותו.
1.4 השירות מיועד לשימוש מקצועי בתחום הבנייה. אם אתם צרכנים כמשמעותם בחוק הגנת הצרכן, התשמ"א-1981, אין בתנאים אלה כדי לגרוע מזכויות שחוק זה מקנה לכם ושאין לוותר עליהן. ⚖ עו"ד

### 2. מהות השירות
2.1 השירות הוא **כלי עזר לחישוב כמויות בלבד**, המבוסס על תוכניות PDF. הוא פועל בדפדפן ומבצע חישובים על בסיס התוכניות, קני המידה, הכיול, הבחירות וההגדרות ש**אתם** מספקים.
2.2 השירות ניתן **ללא תשלום** [[בתקופת השקה / בטא]]. המפעיל אינו בודק את התוכניות, הנתונים או התוצאות שלכם ואינו מייעץ לכם, ולא נוצרים בינכם לבין המפעיל יחסי ייעוץ מקצועי, שליחות, עבודה או נאמנות.
2.3 שום אמירה באתר, בשיווק, בשירות או בתמיכה אינה התחייבות או מצג לדיוק, אלא אם נעשתה במסמך בכתב חתום על ידי המפעיל.

### 3. אי-דיוק מובנה; אין התחייבות
3.1 מדידות מתוך תוכניות PDF **כרוכות מטבען באי-דיוקים**, בין היתר בשל: תוכניות שאינן בקנה מידה, מעוותות, סרוקות, חתוכות, לא מעודכנות או חסרות; כיול שגוי או לא מדויק; הבדלי תצוגת PDF; עובי קווים ודיוק הסמן; רכיבים ששורטטו, זוהו או סווגו באופן שגוי; הגדרות כגון גבהים, פחת, ניכויים, מרווחים, כיסוי או אורכי חפייה; עיגול; ותקלות תוכנה.
3.2 לפיכך המפעיל **אינו מתחייב לדיוק, לשלמות או לאמינות** של מדידה, חישוב, כמות, השוואה או דוח כלשהם, וגם לא להתאמתם לתקן, לאופן מדידה, לחוזה או לכתב כמויות כלשהו, או לכל מטרה שהיא.
3.3 תוויות בשירות כגון "מדויק", "אומדן", "מאושר" או "מכויל" מתארות את אופן החישוב או את מה ש**אתם** סימנתם, ואין הן הצהרה של המפעיל כי הנתון נכון. ⚖ עו"ד (ראו גם חלק 11 סעיף K)

### 4. האחריות שלכם לאמת הכול
4.1 **האחריות הבלעדית לאמת באופן עצמאי את כל המדידות, החישובים, הכמויות והדוחות** לפני הסתמכות עליהם לכל מטרה מוטלת עליכם. הדבר כולל תמחור, מכרזים, הזמנת חומרים, חשבונות, חשבונות חלקיים, הוראות שינוי, תזמון, מימון או ביצוע. את האימות יש לבצע בעצמכם או באמצעות איש מקצוע מוסמך.
4.2 לכל הפחות: אמתו את הכיול של כל גיליון מול מידה ידועה נוספת; ודאו שאתם עובדים על גרסת התוכנית הנכונה והעדכנית; בדקו כמויות מול מידות התוכנית; וישמו את אופן המדידה החל על החוזה שלכם.
4.3 אתם אחראים לנתונים שאתם מזינים ולכל החלטה שאתם מקבלים על בסיס השירות.

### 5. אין מדובר בהנדסה או באישור מקצועי
5.1 השירות אינו מבצע, ותוצאותיו אינן, עבודת הנדסה, קונסטרוקציה, אדריכלות, כמאות או מדידה מוסמכת. המפעיל אינו פועל במתן השירות כמהנדס, אדריכל, כמאי או מודד מוסמך.
5.2 כמויות שלד (בטון, זיון, רשתות, חישוקים וכדומה) הן אומדן בלבד. השירות אינו מתכנן מבנים ואינו בודק חוזק, התאמה, בטיחות, פרטי זיון או עמידה בתקנים ישראליים, בתקנות בנייה או בהיתרים.
5.3 התוצאות אינן אישור, היתר, חוות דעת מקצועית, תעודת מדידה או מסמך חתום. אין להציגן ככאלה לרשות, ללקוח, למלווה, לשמאי, לבית משפט או לכל אדם אחר.
5.4 השירות אינו מיישם אופן מדידה רשמי או חוזי מסוים (לרבות אופני המדידה של המפרט הכללי לעבודות בנייה או של כתב כמויות כלשהו), אלא אם יכולת מסוימת מציינת זאת במפורש. ⚖ עו"ד + בדיקה מקצועית
5.5 השוואת תוכניות היא כלי עזר חזותי, ואין התחייבות שיאותרו בה שינוי כלשהו או כל השינויים בין גרסאות.

### 6. דוחות וצדדים שלישיים
6.1 דוחות, טבלאות וקבצים שאתם מייצאים ("דוחות") מוכנים **על ידיכם**, תוך שימוש בשירות ככלי. אתם המחברים שלהם ואחראים להם.
6.2 אם אתם מוסרים דוח או תוצאה לאחר (לקוח, קבלן, ספק, יזם, מלווה, שמאי, ועדת מכרזים, רשות או כל אדם אחר): (א) הדבר באחריותכם בלבד; (ב) אסור להסיר, להסתיר או לשנות את ההודעות שבדוחות; (ג) אסור לציין או לרמוז כי BetterCalc או המפעיל הכינו, בדקו, אישרו או אימתו אותו; ו-(ד) אתם אחראים להסתמכות של אותו אדם.
6.3 השירות ניתן לכם בלבד. המפעיל אינו מתכוון שאדם אחר יסתמך על השירות או על הדוחות, ובמידה שהדין מתיר אינו נוטל כל חובה או אחריות כלפי צד שלישי. ⚖ עו"ד

### 7. מידע השמור במכשירכם
7.1 תוכניות, פרויקטים ודוחות נשמרים רק באחסון הדפדפן ובמכשיר שלכם. המפעיל אינו מקבל, מחזיק או מגבה אותם, ואינו יכול לגשת אליהם, לשחזר או לשקם אותם.
7.2 אחסון הדפדפן עלול להימחק על ידי הדפדפן, בניקוי נתוני אתר, בגלישה פרטית, בתקלה או בהחלפת מכשיר, או בעדכוני תוכנה. **האחריות לשמירת גיבויים עדכניים** באמצעות כלי הייצוא והגיבוי שבשירות היא שלכם.
7.3 במידה שהדין מתיר, המפעיל אינו אחראי לאובדן, לשיבוש או לאי-זמינות של מידע השמור במכשירכם, לרבות כתוצאה מתקלת תוכנה, למעט כאמור בסעיף 12.4. ⚖ עו"ד

### 8. חשבונות
8.1 חשבון הוא אופציונלי ונפתח בהתחברות עם Google. שמרו על אבטחת חשבון Google שלכם; אתם אחראים לפעילות בחשבונכם.
8.2 ניתן למחוק את החשבון בכל עת כמתואר במדיניות הפרטיות. מחיקתו אינה מוחקת מידע במכשיריכם.

### 9. שימוש מותר
אסור: לשבש, להעמיס, לבחון או לעקוף את האבטחה או המגבלות של השירות; לגשת למידע של משתמשים אחרים; לבצע הנדסה לאחור אלא במידה שהדין מתיר; להשתמש באמצעים אוטומטיים לניצול לרעה; או להשתמש בשירות שלא כדין או עם תוכן שאין לכם זכות להשתמש בו.

### 10. התוכן שלכם והקניין הרוחני של המפעיל
10.1 התוכניות, הפרויקטים, המדידות והדוחות שלכם שייכים לכם. המפעיל אינו טוען לבעלות עליהם.
10.2 אתם מצהירים שיש לכם הזכויות וההרשאות הנדרשות לשימוש בתוכניות שאתם טוענים, לרבות לפי דיני זכויות יוצרים וחובות סודיות או מכרז.
10.3 אם יכולת עתידית שתבחרו (כגון גיבוי בענן או בינה מלאכותית) תחייב את המפעיל לשמור או לעבד את התוכן שלכם, אתם מעניקים למפעיל רישיון מוגבל ולא בלעדי לעשות זאת אך ורק לשם מתן אותה יכולת לכם.
10.4 התוכנה, העיצוב והשם "BetterCalc" שייכים למפעיל או למעניקי הרישיון שלו. רכיבי קוד פתוח כפופים לרישיונותיהם, המפורטים ב-[[דף רישיונות]]. אתם מקבלים זכות אישית, שאינה ניתנת להעברה וניתנת לביטול, להשתמש בשירות לפי תנאים אלה.
10.5 המפעיל רשאי להשתמש במשוב שתשלחו ללא התחייבות, ובסטטיסטיקות מצטברות שאינן כוללות את התוכן שלכם.

### 11. השירות ניתן "כמות שהוא" (AS IS)
11.1 השירות ניתן ללא תשלום, ככלי עזר כללי, על בסיס נתונים שבשליטתכם ועם תוצאות שעליכם לאמת. לכן הוא ניתן **"כמות שהוא" (AS IS) ו"כפי שהוא זמין"**. במידה שהדין מתיר, המפעיל אינו נותן כל מצג או התחייבות, מפורשים או משתמעים, בדבר דיוק, שלמות, אמינות, זמינות, פעולה ללא תקלות או התאמה למטרה מסוימת.
11.2 המפעיל רשאי לשנות, להשעות או להפסיק יכולת כלשהי. אם השירות כולו יופסק, המפעיל ישתדל לתת הודעה של [[30]] ימים לפחות כדי שתוכלו לייצא את המידע. ⚖ עו"ד

### 12. פטור מאחריות ⚖ עו"ד — סעיף ליבה
12.1 **נזקים כספיים.** במידה המרבית שהדין מתיר, המפעיל אינו אחראי לכל הפסד או נזק כספי, **ישיר או עקיף**, הנובע מהשימוש בשירות, מאי-היכולת להשתמש בו או מהסתמכות עליו או על תוצאה או דוח כלשהם, או הקשור לכך, לרבות:
 (א) טעויות בתמחור, באומדן, בהצעות מחיר או במכרזים;
 (ב) כמויות שהוזמנו, הזמנה ביתר או בחסר, פחת או עודפי חומרים;
 (ג) עיכובי ביצוע, עבודה חוזרת, האצה, זמן השבתה או עבודות תיקון;
 (ד) אובדן רווח, הכנסה, עסקים, חוזים, מכרזים או מוניטין;
 (ה) קנסות, פיצויים, תשלומים או סכומים אחרים שיש לשלם ללקוחות, לקבלנים, לספקים או לכל צד שלישי אחר, ומחלוקות עמם;
 (ו) אובדן מידע השמור במכשירכם.
12.2 **תביעות צד שלישי.** במידה המרבית שהדין מתיר, המפעיל אינו אחראי כלפיכם לכל תביעה שתוגש נגדכם על ידי צד שלישי בקשר לתוצאה או לדוח. ביחסים בינכם לבין המפעיל, האחריות לכל תביעה כזו היא שלכם (ראו גם סעיף 13).
12.3 **הבסיס לפטור.** אתם מאשרים כי: השירות הוא כלי עזר חינמי; מדידה מתוך PDF אינה מדויקת מטבעה; אתם, ולא המפעיל, בוחרים את התוכניות, קני המידה והנתונים; ביכולתכם ועליכם לאמת את כל התוצאות לפני הסתמכות עליהן; למפעיל אין גישה לתוכניות או לפרויקטים שלכם; והמפעיל אינו גובה תמורה בעבור הסיכון של החלטותיכם העסקיות ואינו יכול לשאת בו. סעיף זה הוא בסיס יסודי שעליו השירות מוצע ללא תשלום.
12.4 **מה אינו מוחרג.** אין בתנאים אלה כדי לפטור או להגביל את אחריות המפעיל: (א) לזדון, תרמית או הטעיה; (ב) לרשלנות רבתי; (ג) למוות או לנזק גוף שנגרמו ברשלנות; (ד) לכל חובה או אחריות שאין לפטור ממנה או להגבילה לפי הדין בישראל, לרבות חובות מחייבות לפי דיני הגנת הפרטיות; או (ה) לכל זכות שלכם כצרכנים שאין לוותר עליה.
12.5 **הוראת גיבוי אם הפטור לא יאוכף.** אם, על אף האמור בסעיף 12.1, ייקבע כי המפעיל אחראי לנזק, אזי במידה שהדין מתיר: (א) האחריות תוגבל לנזק ישיר שהיה צפוי באופן סביר בעת שהתחלתם להשתמש בשירות ושהוכח על ידיכם; (ב) היא תופחת בהתאם לחלקכם בגרימת הנזק, לרבות אי-אימות התוצאות כנדרש בסעיף 4; (ג) עליכם לנקוט צעדים סבירים להקטנת הנזק; ו-(ד) לא יחולו פיצויים עונשיים. ⚖ עו"ד
12.6 **על מי חלה ההגנה.** סעיף זה מגן על המפעיל באופן אישי ועל כל מי שפועל מטעמו, הרשאים להסתמך עליו. ⚖ עו"ד
12.7 **הודעה על טענה (אופציונלי).** אם לדעתכם קמה לכם טענה, אנא הודיעו למפעיל בכתב ב-[[דוא"ל]] בהקדם, ובכל מקרה בתוך [[6/12]] חודשים מהיום שנודע לכם עליה, כדי שניתן יהיה לבדוק את הבעיה ובמידת האפשר לתקנה. ⚖ עו"ד

### 13. שיפוי (משתמשים עסקיים) ⚖ עו"ד
אם אתם משתמשים בשירות במסגרת עסק, תשפו את המפעיל בגין עלויות, הפסדים ושכר טרחה סבירים הנובעים מתביעת צד שלישי שנגרמה בשל: (א) תוכן שטענתם ללא זכות; (ב) דוח או תוצאה שמסרתם לצד שלישי, או השימוש שעשה בהם; או (ג) הפרת תנאים אלה. המפעיל יודיע לכם על התביעה בהקדם ויאפשר לכם להשתתף בהגנה. סעיף זה לא יחול במידה שהתביעה נובעת מעניין המנוי בסעיף 12.4(א)–(ג).

### 14. יכולות שאינן זמינות עדיין
סיוע בינה מלאכותית, גיבוי בענן, תוכניות בתשלום, קרדיטים ותשלומים **אינם מוצעים היום**, ושום סכום אינו מחויב. לפני שאחת מהן תהיה זמינה, המפעיל יפרסם את התנאים הספציפיים שלה, ותידרשו לאשר אותם לפני השימוש. התנאים יכללו מחיר, חיוב, חידוש, ביטול והחזרים, ולגבי בינה מלאכותית — את הספק ואת אופן בדיקת התוצאות. המפעיל הוא עוסק פטור, ולכן מחיריו לא יכללו מע"מ. הפטורים שבסעיף 12 ייבחנו מחדש לגבי יכולות בתשלום לפני השקתן. ⚖ עו"ד + רואה חשבון

### 15. שינויים בתנאים
15.1 שינויים יפורסמו עם תאריך וגרסה חדשים. על שינויים מהותיים תימסר הודעה למשתמשים מחוברים באפליקציה [[ובדוא"ל]] לפחות [[14/30]] ימים לפני כניסתם לתוקף. שינויים הנדרשים לפי דין או מטעמי אבטחה עשויים להיכנס לתוקף מוקדם יותר.
15.2 אם אינכם מסכימים, תוכלו להפסיק את השימוש ולמחוק את החשבון. המשך שימוש לאחר מועד התחולה מהווה הסכמה. שינויים לא יחולו על טענות שקמו לפני כניסתם לתוקף.

### 16. סיום
אתם רשאים להפסיק להשתמש בשירות בכל עת. המפעיל רשאי להשעות או להפסיק את גישתכם אם הפרתם תנאים אלה הפרה מהותית או אם הדין מחייב זאת, בהודעה מראש במקום שהדבר סביר. סעיפים 3–7, 10–13 ו-17–18 יחולו גם לאחר הסיום.

### 17. דין חל וסמכות שיפוט ⚖ עו"ד
17.1 על תנאים אלה יחולו דיני מדינת ישראל.
17.2 הסמכות נתונה לבתי המשפט המוסמכים בישראל. [[אפשרות למשתמשים עסקיים בלבד: סמכות ייחודית לבתי המשפט המוסמכים במחוז …]] לא תיכפה סמכות ייחודית על צרכנים.

### 18. כללי
18.1 **שינוי במקום ביטול.** אם בית משפט יקבע שהוראה כלשהי, לרבות הוראה בסעיף 12, בטלה או אינה ניתנת לאכיפה, כולה או חלקה, היא תחול במידה המרבית המותרת. סעיף 12.5 ויתר התנאים יעמדו בתוקפם. ⚖ עו"ד
18.2 **המחאה.** המפעיל רשאי להעביר תנאים אלה ואת השירות לחברה שבשליטתו או לרוכש השירות, בהודעה לכם. אינכם רשאים להעביר את זכויותיכם ללא הסכמת המפעיל.
18.3 **הסכם מלא.** תנאים אלה ומדיניות הפרטיות הם ההסכם המלא בנוגע לשירות.
18.4 **אי-ויתור.** אי-אכיפה של זכות אינה ויתור עליה.
18.5 **שפה.** התנאים מתפרסמים בעברית ובאנגלית. במקרה של סתירה, הנוסח העברי גובר. ⚖ עו"ד
18.6 **הודעות.** המפעיל רשאי להודיע לכם באפליקציה או בדוא"ל של חשבונכם. הודעות למפעיל: [[דוא"ל]] / [[כתובת]].

---

## Part 8 — Compliance gaps the documents cannot fix

**Must resolve before publishing the documents**
- **G1 Operator identity.** Confirmed as an individual עוסק פטור; still needed: full legal name, ID/business number, address for notices, privacy e-mail. Note the owner's name and address become public in the documents.
- **G2 Supabase region.** Docs say Frankfurt, existing draft says Ireland. Confirm in the dashboard; update the processor table.
- **G3 PostHog production settings.** Confirm analytics is live, "Discard client IP data" is on, data retention is set, the host is EU, and Session replay/Autocapture/Heatmaps/Surveys are off in the project (per `docs/ANALYTICS.md`).
- **G4 Analytics wording and choice.** Replace "anonymous" with accurate wording in the home-screen note (`src/i18n/he.ts:567`, `en.ts:569`) and the in-repo draft. Decide (with counsel) whether to add an opt-out toggle or a consent prompt; the policy currently has nowhere to point users.
- **G5 Consent versioning.** `LEGAL_TEXTS` is `null` and `legal_version` is `'null'`. Publish the texts with a real version, record acceptance against it, and require re-acceptance on material changes. Guests accept nothing today — consider a one-time guest acknowledgement of the accuracy/responsibility clause, since the professional-reliance protection matters most and browsewrap is weak.
- **G6 Export disclaimer.** Add a short verification notice to PDF/Excel exports (and the project-totals report). This is the most effective professional-reliance mitigation, and the Terms cannot do it alone because exports reach third parties who never accepted the Terms.

**Data-security regulations (operational)**
- **G7** Write a database definition document and a security procedure; list who has Supabase/PostHog/Netlify/Google Cloud admin access; enforce MFA on those accounts; keep an incident log and a breach-response plan, including whether and when to notify the PPA.
- **G8** Sign or accept DPAs with Supabase, PostHog, Netlify, Google (OAuth) and Cloudflare (if Turnstile is on), covering the outsourcing requirements of reg. 15. Keep copies.
- **G9** Confirm the pg_cron schedule for `account-maintenance` actually runs in production, so deletion requests are carried out as the policy promises.
- **G10** Decide retention for `audit_log` (survives deletion), Supabase auth logs, provider backups. The policy needs real numbers.
- **G11** A written process and template replies for access/correction requests within the statutory deadline.

**Other launch requirements**
- **G12 Accessibility.** An Israeli Standard 5568 / WCAG AA review and an accessibility statement with a named accessibility contact. Separate from Privacy/Terms and a common litigation target.
- **G13 Google OAuth consent screen.** Google requires a privacy policy URL, homepage and authorised domains, and may require verification. Publish the policy on the same domain first.
- **G14 Marketing e-mail.** No opt-in exists, so send no marketing e-mails (spam law s.30A) until one is built.
- **G15 Open-source notices.** Licences exist for PDFium in `public/licenses`; confirm the full list (pdf.js, fonts under OFL, ExcelJS, etc.) and link it from the Terms.
- **G16 Insurance and trademark.** Consider professional liability/cyber insurance, and a trademark search for "BetterCalc" in Israel. These are business decisions; the documents don't cover them.

**Before enabling future features (each needs its own legal review)**
- **G17 AI:** provider DPA; data location (OpenAI is US-based → cross-border transfer basis); retention and no-training terms; a privacy impact assessment for sending client plans abroad; PPA guidance on AI systems; confidentiality/tender-NDA implications; UI showing that AI output is a suggestion (the review/approval flow already supports this); explicit per-use consent before upload.
- **G18 Cloud backup:** the operator then holds full plans → re-assess security level, copyright/confidentiality exposure, encryption at rest, the 90-day post-subscription access window, and what happens on deletion.
- **G19 Payments:** Israeli payment provider, consumer-protection disclosures, a 14-day cancellation policy, easy online cancellation, renewal notices, VAT-inclusive pricing, tax invoices (including allocation numbers), credit expiry rules, and storing tax IDs in `billing_profiles` securely.

---

## Part 9 — Index of clauses requiring Israeli counsel approval (updated for Terms v0.3)

| Doc | Clause | Why |
|---|---|---|
| Privacy §1 | Controller identity (owner as an individual sole proprietor, not a company) | Statutory notice duty; owner's personal name is public |
| Privacy §5 | Analytics as notice-only vs. consent; opt-out | Amendment 13 definitions; accuracy of "pseudonymous" |
| Privacy §7 | Cross-border transfer basis; disclosure to authorities | Transfer regulations |
| Privacy §9 | Audit-log and backup retention | Must match reality |
| Privacy §10–11 | Rights, deadlines, breach wording | Amendment 13 |
| Terms Summary + §1.4 | Up-front summary; professional-user presumption with consumer carve-out | Whether the summary is conspicuous enough; consumer status of small contractors |
| Terms §2.3 | Only signed written statements are promises of accuracy | Interaction with marketing claims and Consumer Protection Law s.2 |
| Terms §3.2 | Labels like "exact"/"approved" are not representations | Better fixed in the UI (Part 11 §K) than in the contract |
| Terms §5.4 | Measurement-method disclaimer | Needs domain-expert wording too |
| Terms §6.3 | No duty to third parties | Third parties are not bound; only partly effective |
| Terms §7.3 | Exclusion for local data loss, including software errors, except malice/gross negligence | Reasonableness under Standard Contracts Law s.4(1) |
| Terms §11 | "As is" and the discontinuation notice period | Implied-term doctrines; reasonableness |
| **Terms — Professional-Use Notice** | Prominent notice at the top, accepted on use | Conspicuousness; whether checkbox acceptance is needed for guests |
| **Terms §12.1** | Exclusion of **direct and indirect** financial loss | Most exposed clause under Standard Contracts Law s.4(1); may be modified by a court |
| Terms §12.2 | No liability for third-party claims against the user | Works between the parties only; third parties are not bound |
| Terms §12.4 | Carve-outs (malice, fraud, gross negligence, bodily injury, mandatory duties, consumer rights) | Confirm the list is complete under Israeli law |
| **Terms §12.5** | Non-monetary fallback (direct, foreseeable, contributory share, mitigation) | Confirm it is consistent with the Remedies Law and survives independently |
| **No monetary cap** | Owner's decision; see Part 12 | Backstop lost if §12.1 falls; consider the conditional-cap option |
| Terms §12.6 | Protection of persons acting for the Operator | Third-party beneficiary rule (Contracts (General Part) Law s.34) |
| Terms §12.7 | Notice-of-claim period | Prescription Law s.19; may be restrictive |
| Terms §13 | Indemnity limited to business users | Restrictive-term risk |
| Terms §14 | VAT-exempt pricing statement | Accountant to confirm wording and the עוסק פטור ceiling |
| Terms §15 | Unilateral changes | Standard Contracts Law s.4(2) |
| Terms §17 | Forum: competent courts in Israel; exclusive forum only for businesses | s.4(9) presumption |
| Terms §18.1–18.2 | Modification-not-voiding; assignment to the owner's future company | Effect of s.19; continuity on incorporation |
| Terms §18.5 | Hebrew version prevails | Choice of prevailing language |
| Both | Whether to seek advance approval of the Terms from the Standard Contracts Tribunal | See Part 10, item N3 |

---

## Part 10 — Obligations and liabilities the Terms cannot waive or exclude

> These are my understanding, to brief counsel. ⚖ COUNSEL for the whole Part. The Terms are drafted so that none of these is purportedly excluded, because an attempt to exclude them weakens the whole clause before a court.

**Contract law**
1. **Good faith** in performing and enforcing the contract (Contracts (General Part) Law, 5733-1973, ss.12, 39). It can't be excluded, and courts use it to narrow harsh limitation clauses.
2. **Deceit / fraud** (s.15) and **malice**: liability can't be excluded in advance.
3. **Gross negligence**: an exemption is very likely to be found restrictive or contrary to public policy (s.30). It's carved out.
4. **Standard Contracts Law, 5743-1982**: the court may void or modify a restrictive term (s.19). This is a legal control, not an obligation, but it means every limitation must be defensible as reasonable.

**Tort law**
5. **Liability to third parties** (Civil Wrongs Ordinance), e.g. a client or lender who relied on a report: the Terms don't bind non-users. The protection comes from report notices (Part 11) and the user's obligations and indemnity (Terms §6, §13), not from an exclusion.
6. **Bodily injury or death caused by negligence**: not reasonably excludable. This is unlikely for software, but it's carved out.

**Consumer law** (for users who are consumers)
7. **No misleading statements** (Consumer Protection Law s.2), including in marketing, the app and the website. A disclaimer doesn't cure a misleading claim such as "accurate quantities".
8. **Consumer rights can't be waived** (s.36 / general principle). For paid features later this covers distance-sale disclosure, the cancellation right (s.14C), easy cancellation of continuing transactions, and renewal notices.

**Privacy and data security**
9. **Privacy Protection Law duties**: notice on collection (s.11), access (s.13), correction (s.14), the security duty, and the Data Security Regulations, including incident documentation and reporting where it applies. A user can't waive these, and Amendment 13 adds fines and statutory damages.
10. **Cross-border transfer conditions** (2001 Regulations).

**Other statutory duties**
11. **Accessibility** of the website/service (Equal Rights for Persons with Disabilities Law and the 2013 Service Accessibility Regulations; IS 5568).
12. **Spam law** (Communications Law s.30A): prior consent for marketing messages, and statutory damages per message.
13. **Tax as עוסק פטור**: issue receipts for every payment, keep books as required, stay under the annual turnover ceiling, and register as עוסק מורשה (charging VAT) if you exceed it. Paid launch may trigger this. Confirm with an accountant.
14. **Copyright**: no liability shield for the operator's own infringement. Hosting user plans later (cloud/AI) brings notice-and-takedown questions.

**Structural limits specific to a sole proprietor**
- **Unlimited personal liability.** A עוסק פטור is not a separate legal person, so any judgment is against the owner personally and their personal assets. The Terms reduce contractual exposure but can't create a shield. The available tools are:
  - **N1** Incorporate (חברה בע"מ) before paid features or meaningful scale, then assign the service under §18.2. This is the only real separation of personal assets, subject to piercing-the-veil rules.
  - **N2** Professional/technology E&O insurance (ביטוח אחריות מקצועית — טכנולוגיה) and cyber insurance. Insurers usually price cover against a contractual cap; with no cap (v0.3), check availability and cost.
  - **N3** Optional **advance approval of the Terms by the Standard Contracts Tribunal** (בית הדין לחוזים אחידים). An approved term can't be voided as restrictive for the approval period. It costs time and money, so it's worth considering before paid launch, not now.
  - **N4** Keep business activity, bank account and records separate from personal ones (evidence and tax hygiene).

---

## Part 11 — Recommended in-app and export disclaimers (proposals only; not implemented)

> Why these matter more than contract text: the Terms bind only users and only to the extent they were brought to their attention. Notices at the moment of use, and on the reports that reach third parties, are the main evidence of fair warning and the only protection that travels with a report. Keep them short and consistent with Terms §3–6. ⚖ COUNSEL to approve final wording.

**A. First-use acknowledgement (guests and accounts)**
A one-time screen before the first project, with a required checkbox. Record the text version and time: locally for guests, and in `profiles` for accounts (the consent fields already exist).
- EN: "BetterCalc is a calculation aid. Results depend on your plans, scales and settings and may contain errors. I will verify all results before relying on them. BetterCalc is not engineering, quantity-surveying or measurement certification. I have read the [Terms]."
- HE: "BetterCalc היא כלי עזר לחישוב. התוצאות תלויות בתוכניות, בקני המידה ובהגדרות שלי ועלולות לכלול טעויות. אבדוק את כל התוצאות לפני הסתמכות עליהן. BetterCalc אינה הנדסה, כמאות או מדידה מוסמכת. קראתי את [תנאי השימוש]."

**B. Calibration**
- A persistent badge on uncalibrated pages (areas are already zero there).
- After calibrating, prompt the user to check a second known dimension: "Check the scale against another known dimension before relying on quantities." / "בדקו את קנה המידה מול מידה ידועה נוספת לפני הסתמכות על הכמויות."

**C. Before export (first export per plan or session)**
A short confirmation: "Exported quantities have not been checked by BetterCalc. Verify before use or sharing." / "הכמויות המיוצאות לא נבדקו על ידי BetterCalc. יש לבדוק לפני שימוש או העברה לאחרים."

**D. PDF report footer (every page) — concise**
- EN: "Prepared by the user with BetterCalc, an auxiliary calculation tool. PDF-based measurements may be inaccurate. Verify all quantities independently before use. Not engineering or quantity-surveying certification. · [date] · v[version] · p. x/y"
- HE: "הוכן על ידי המשתמש באמצעות BetterCalc, כלי עזר לחישוב. מדידות מתוך PDF עלולות להיות לא מדויקות. יש לאמת את כל הכמויות באופן עצמאי לפני שימוש. אינו אישור הנדסי או כמאות. · [תאריך] · גרסה [גרסה] · עמ' x/y"
- First page or cover, one bold line above the tables: "Auxiliary calculation only — verify before use" / "חישוב עזר בלבד — יש לאמת לפני שימוש".
- Hebrew text goes through `pdfText.ts` (embedded Noto Sans Hebrew), like the rest of the report.

**E. Excel exports — concise**
- Row 1 of every sheet (merged, bold): EN "Auxiliary calculation by the user with BetterCalc. PDF-based measurements may be inaccurate — verify independently before use. Not engineering certification. Values may have been edited after export." / HE "חישוב עזר שבוצע על ידי המשתמש ב-BetterCalc. מדידות מתוך PDF עלולות להיות לא מדויקות — יש לאמת באופן עצמאי לפני שימוש. אינו אישור הנדסי. ייתכן שהערכים שונו לאחר הייצוא."
- A "Notes / הערות" sheet listing the inputs: source file and page, calibration/scale per page, revision, waste %, deduction and height settings, and export date/version. This ties every result to the user's own inputs.

**F. "Prepared by" field**
An optional field on reports for the user's own name/company, printed as the preparer. It reinforces that the user is the author (Terms §6.1).

**G. Compare view and Compare exports**
"Visual comparison aid — may not show all changes between revisions." / "כלי עזר להשוואה חזותית — ייתכן שלא כל השינויים בין הגרסאות מוצגים."

**H. Structural module and structural exports**
"Quantity estimate only — not structural design or engineering approval. Bar counts in non-rectangular zones are estimated." / "אומדן כמויות בלבד — אינו תכנון קונסטרוקטיבי או אישור הנדסי. מספר המוטות באזורים שאינם מלבניים מוערך." The second sentence builds on the existing `estimateHint` text.

**I. Local data**
- The backup reminders already exist. Add one line to the reminder and to the home screen: "Projects are stored only in this browser. BetterCalc cannot recover them." / "הפרויקטים נשמרים רק בדפדפן זה. BetterCalc אינה יכולה לשחזר אותם."
- Keep requesting persistent storage (`storagePersistence.ts`), and tell the user when the browser refuses it.

**J. Future AI**
- Label AI output "AI suggestion — review required" until the user approves each item. Exclude unapproved items from exports, or mark them.
- Require an explicit per-upload consent naming the provider and country.

**K. Wording audit (contradictions undermine every disclaimer)**
- The structural quantity basis label is **"Exact" / "מדויק"** (`src/i18n/en.ts:953`, `:1904`; `he.ts:952`, `:1911`). In a report it reads as a promise of accuracy. Suggest "Calculated / מחושב" or "Measured geometry / לפי גיאומטריה" versus "Estimate / אומדן".
- **"Approved" / "מאושר"** marks the user's own review of rooms and changes. In exports, prefer "Approved by user / אושר על ידי המשתמש" so it can't be read as certification.
- Marketing, website, app-store and social copy should avoid "accurate", "precise", "guaranteed", "certified", "מדויק", "מובטח", "מאושר", and "replaces a quantity surveyor". Prefer "faster takeoff", "helps you measure", "reduce manual work".

**L. Evidence trail**
- Store the acknowledgement versions (A, C) with timestamps. For accounts, the server-side `complete_onboarding` already records legal versions; extend it, don't duplicate it.
- Keep a dated archive of every published Terms and Privacy version.

---

## Part 12 — Removing the monetary cap: exposure analysis (for the owner and counsel)

> Per the owner's instruction, v0.3 has **no monetary cap**. This Part explains, separately, what that choice costs. ⚖ COUNSEL to confirm the analysis.

**Short answer: yes, removing the cap can create greater exposure than keeping one.** That is not because a cap adds protection in the normal case; the exclusion in §12.1 is broader. It is because a cap is the **backstop** if a court refuses to enforce the exclusion.

**Why**
1. **Single point of failure.** Under the Standard Contracts Law, a term that exempts the supplier "wholly or partly" from liability is presumed restrictive (s.4(1)), and the court may void or modify it (s.19). Excluding *direct* financial loss is the part most likely to be challenged. With a cap, if the exclusion falls, the cap may still stand as a separate clause. Without a cap, if the exclusion falls, the fallback is the default law: full proven damages, with no ceiling.
2. **Personal assets.** The Operator is an individual עוסק פטור. An uncapped judgment is enforceable against the owner's personal assets. Quantity errors in construction can be large: one wrong tile or concrete order, or one lost tender, can exceed any plausible subscription revenue by orders of magnitude.
3. **Courts favour allocation over abdication.** A cap reads as a reasoned risk allocation. A total exclusion with no remedy at all is more likely to be seen as giving the supplier an unfair advantage (s.3). Keeping a cap therefore also makes the exclusion itself *more* likely to survive.
4. **Insurance.** Professional/technology liability insurers normally price cover against a contractual cap. With no cap, cover may be costlier or harder to get, and an insurance limit is the practical ceiling on what the owner can pay without personal funds.
5. **Consumers.** For users who are consumers, a full exclusion is weaker still. Without a cap there is nothing left to apply to them if the exclusion is cut back.

**What v0.3 does instead (non-monetary mitigation)**
- §12.5 is a **fallback that names no amount**. If the exclusion is not enforced, liability is limited to *direct, foreseeable, proven* damage, reduced by the user's own share (including failure to verify) and by the duty to mitigate. These largely restate default law, so they are unlikely to be struck out, and they meaningfully reduce any award, because the user's failure to verify will usually be a major cause of the loss.
- §18.1 asks the court to modify rather than void the clause, and keeps §12.5 standing independently.
- The prominent Professional-Use Notice, the stated basis (§12.3) and acceptance recording (Part 11 §A, §L) support a finding that the exclusion was fair and was brought to the user's attention.

**Residual risk:** even with all of this, there is no ceiling if a court applies default law. Only a cap, incorporation (Part 10 N1) or insurance (N2) creates one.

**Option for the owner (not in the draft):** a cap that applies *only if* the exclusion is held unenforceable:
> "If, despite Section 12.1, the Operator is held liable, the Operator's total liability shall not exceed [₪ amount]."

This keeps the owner's position (no cap in normal operation; full exclusion is the primary rule) while restoring the backstop. Recommended for counsel's consideration, especially before paid features launch.

---

## Part 13 — Implementation status (added after integration; the texts above were not changed)

**In the app (not committed):** Terms and Privacy Policy (Hebrew and English) at `/terms` and `/privacy`, public, RTL/LTR/mobile (`src/lib/legal/legalContent.ts`, `src/components/LegalPage.tsx`); links on the Welcome screen, the registration and onboarding checkbox, and the account page; guest acknowledgement (`GuestAckDialog`, kept in `localStorage` as `bettercalc.guestAck` with version and time); signed-in acceptance via the existing `complete_onboarding` with re-acceptance when the announced version changes; disclaimers on PDF (strip under every page) and Excel (note below the last row of each sheet); "Exact"/"מדויק" in structural exports changed to "Calculated"/"מחושב"; the home-screen note says "pseudonymous" instead of "anonymous".

**Corrections to the review text made in the app version** (the review file is unchanged):
1. Privacy §4/§10: the language setting is **not** stored in the account (the column exists but nothing writes it), so it is described as kept in the browser.
2. Privacy §4: only an empty credit wallet is created automatically; no entitlement row is, so "plan/entitlement" was removed.
3. Privacy §5: the claim that IP addresses are discarded and the retention period are unverified settings, so they are placeholders, not statements.
4. Privacy §7: Supabase region filled in as Ireland (eu-west-1, read from the linked project).
5. Terms §3.3 labels: "calculated" replaces "exact", matching the UI change.
6. Privacy §9: the 7-day deletion wait is stated as fact (the maintenance function and its schedule are live); the deletion record is kept in the audit log.

**Not done by design:** notes sheet listing inputs (Part 11 E), first-use screen before the first project beyond the guest checkbox, calibration/export confirmations (B, C), "Prepared by" field (F), module-specific notices for Compare and Structural exports (G, H), opt-out for statistics (G4). "Approved"/"מאושר" labels are the user's own review states in the UI and do not appear in exports, so they were left as they are.

**To publish:** fill every `[[placeholder]]`, set `LEGAL_DOC_VERSION` in `src/lib/legal/legalDocs.ts`, and set `legal_version` in Supabase to the same value in the same release. A test refuses a real version while placeholders remain.
