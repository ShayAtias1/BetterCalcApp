/**
 * Owner-approved free Early Access legal documents, with shared-browser and deletion
 * disclosures checked against the local implementation. Production publication is separate.
 *
 * Conventions:
 *  - `[[…]]` marks a fact the owner must still supply. Nothing about the operator is invented. While any placeholder
 *    remains the texts are a draft: LEGAL_DOC_VERSION stays 'pending' and the pages say so (see legalDocs.ts and
 *    tests/supabase/legalContent.test.ts, which refuses a published version that still contains one).
 *  - `**…**` is bold.
 *  - Lawyer notes and technical "verify" notes from the review file are not part of the public text.
 */
import type { Language } from '../../i18n';
import { LEGAL_DOC_VERSION, LEGAL_EFFECTIVE_DATE, type LegalKind } from './legalDocs.ts';

export type LegalStatus = 'active' | 'soon';
export type LegalBlock =
  | { kind: 'p'; text: string; num?: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'sub'; items: { label: string; text: string }[] }
  | { kind: 'table'; head: string[]; rows: string[][] };
export interface LegalSection {
  heading: string;
  status?: LegalStatus;
  blocks: LegalBlock[];
}
export interface LegalDocument {
  title: string;
  /** Draft status until the owner approves a publication version and effective date. */
  meta: string;
  /** A prominent notice shown before the sections (the Terms' professional-use notice). */
  notice?: { title: string; points: string[]; closing: string };
  sections: LegalSection[];
}

export const PLACEHOLDER_OPEN = '[[';
export const PLACEHOLDER_CLOSE = ']]';

const p = (text: string, num?: string): LegalBlock => ({ kind: 'p', text, num });
const ul = (...items: string[]): LegalBlock => ({ kind: 'ul', items });
const sub = (...items: [string, string][]): LegalBlock => ({ kind: 'sub', items: items.map(([label, text]) => ({ label, text })) });
const table = (head: string[], ...rows: string[][]): LegalBlock => ({ kind: 'table', head, rows });

// ===================================================================================== Privacy, English
const privacyEn: LegalDocument = {
  title: 'Privacy Policy',
  meta: `Free Early Access · Version: ${LEGAL_DOC_VERSION} · Effective date: ${LEGAL_EFFECTIVE_DATE}`,
  sections: [
    { heading: '1. Who we are', blocks: [p('BetterCalc (“we”, “us”) is operated by שי אטיאס (Shay Atias), an Israeli sole proprietor. Privacy contact: support.bettercalc@gmail.com.')] },
    { heading: '2. The short version', blocks: [ul(
      'Your plans and projects are stored **in your own browser**, on your device. We do not receive them when you work.',
      'An account is optional. If you sign in with Google, we store basic account details (Section 4).',
      'We do not currently collect usage statistics or analytics (Section 5).',
      'AI features, cloud backup and payments are **not available yet**. The plans page is a preview only (Section 8).',
    )] },
    { heading: '3. Data that stays on your device', status: 'active', blocks: [p("Plan PDFs, projects, rooms, measurements, quantities, markups and comparisons are processed locally and saved in this browser’s IndexedDB. Exports and local backup files are saved where you choose on your device. The normal Early Access workflow does not upload project content to our servers. Browser storage may be cleared or lost; keep separate local backups. Signing in and deleting an account do not transfer or erase local projects. Signing out preserves local projects unless you explicitly choose to delete local data in the sign-out dialog. You can remove them through the app or by clearing this site’s browser data. Plans may contain other people’s personal or confidential data; you are responsible for having permission to use it."), p("**Shared browsers.** Local projects are not separated by Google account. Anyone using the same browser profile may access them, including after sign-out or after a different account signs in. Use a separate browser or operating-system profile on a shared device; signing out alone does not protect projects left in that browser."), p("**Optional deletion at sign-out.** Only after you choose to clear local data and confirm the separate warning, the app clears all records in its project database in this browser, including projects and folders, plan PDFs, measurements and markups, comparisons, revision history and any stored processing records. This includes local projects created by guests or other accounts in the same browser profile. It also removes the cached display name, cached verified account consent, pending Google sign-in consent receipt, last-workspace bookmark, and backup reminder history and snooze setting. Export any projects you want to keep first."), p("Language, grid and other interface preferences, welcome-screen state, guest trial state, and guest consent acknowledgement and history remain. This is not a complete clearing of this site’s browser storage. It does not delete downloaded exports or backup files, data on other devices, server account data or server consent history, or sign you out of Google itself. Local deletion happens before the app attempts account sign-out; if sign-out then fails, the account session may remain active even though the local data was cleared. If clearing fails, the app asks whether to retry before proceeding to sign-out.")] },
    { heading: '4. Account data (optional)', status: 'active', blocks: [
      p('If you sign in with Google, we receive and store, through our provider Supabase:'),
      ul(
        'user ID, e-mail address and name, and the basic profile details Google shares with sign-in apps (such as a profile picture link);',
        'the display name you confirm;',
        'the exact document version and server timestamps of each recorded acceptance of the Terms and Privacy Policy, including consent history;',
        'authentication and session records; provider access and security logs may include IP addresses, browser details and request times (these are operational records, separate from product analytics);',
        'account status records (for example an empty credit balance) and, if you request deletion, the deletion request.',
      ),
      p('Purpose: to create and secure your account, keep you signed in, record your acceptance of these documents, and prepare account features. You are not legally required to give us this data; without it you can use BetterCalc as a guest, subject to the trial limits described in the Terms. We never receive your Google password. Your language choice is kept in your browser, not in your account.'),
      p('If you contact support.bettercalc@gmail.com, Google Gmail processes your address, message and any attachments you choose to send, so we can handle your request. The app does not automatically delete support correspondence. Avoid sending plan files or other confidential material unless needed for your request.'),
    ] },
    { heading: '5. Usage statistics', status: 'active', blocks: [
      p('During the Early Access period BetterCalc does not run product analytics. The app does not load an analytics tool, does not send usage events to any analytics provider, and does not create or store an analytics identifier in your browser. Any analytics identifier left in your browser by an earlier version is removed when the app opens.'),
      p('Before analytics is switched on again, we will update this policy and show you what changes.'),
    ] },
    { heading: '6. Browser storage', status: 'active', blocks: [p("We use IndexedDB and local/session storage for projects, sign-in sessions, language and display preferences, guest trial state, guest consent history, a cached account display name and previously verified consent evidence linked to the account and document version. A short-lived agreement receipt in session storage carries your explicit acceptance across a Google sign-in redirect. These are functional records, not advertising identifiers. Clearing storage removes local records and may lose projects or require sign-in and acceptance again. If CAPTCHA is configured, Cloudflare Turnstile processes browser signals for bot protection; it is not product analytics.")] },
    { heading: '7. Who processes data for us', blocks: [table(["Provider", "Role in Early Access", "Processing location"],["Supabase", "Google sign-in integration, account database, sessions and consent records; no project backup uploads", "Database: EU (Ireland), eu-west-1; provider operations may also involve other countries (https://supabase.com/privacy)"],["Google", "Identity provider when you choose Google sign-in; Gmail for support messages you choose to send", "Global processing under Google’s privacy policy (https://policies.google.com/privacy)"],["Netlify", "Website delivery; technical access/security logs may be processed even for guests", "Technical processing may occur outside Israel (https://www.netlify.com/privacy/)"],["Cloudflare (only if CAPTCHA is configured)", "Turnstile bot protection", "See Cloudflare’s processing disclosures (https://www.cloudflare.com/privacypolicy/)"]),p("Account and technical data may be processed outside Israel. The providers publish privacy and data-processing terms describing their processing and transfer safeguards at the addresses above. Database location does not mean all account or technical processing is confined to that country. No project content is sent to these providers by the normal local manual workflow."),p("We do not sell personal data or share it for advertising. We may disclose data where required by law or a competent authority, or where lawfully necessary to protect rights in legal proceedings.")] },
    { heading: '8. Features not available yet', status: 'soon', blocks: [p("AI, payments, subscriptions and cloud backup are **not available yet**. The pricing page is a comparison preview only: prices may change, paid plans cannot be purchased, and preview credits do not grant AI access. Billing-detail collection and editing are disabled; any details stored previously are preserved until account deletion. No payment or AI billing is activated."),p("Before any such feature launches, we will publish the applicable data flows, providers, processing locations, retention and any required consent. Future provider or billing terms are not part of the current Early Access offering.")] },
    { heading: '9. How long we keep data', blocks: [ul("Local projects and browser records remain until you delete them or the browser removes them. Account deletion does not clear browser storage on any device.",
      "Server account data, including the profile and consent history, remains while the account exists. You can request deletion on the account page and cancel while the request is pending. The implemented worker uses a default 7-day waiting period, then removes any stored cloud files before deleting the authentication account and linked profile, consent history, billing details and other linked account records. Completion occurs on a successful maintenance run, not automatically at the end of the waiting period. The maintenance function is deployed and scheduled daily at 03:17 UTC; a failed run may delay completion. Contact support if a deletion request remains pending.",
      "Deletion audit entries retain the internal user ID, action and time; they are not anonymous. The code contains no automatic expiry for these entries. You can contact support about retained account identifiers and your applicable rights.",
      "Account records may also be included in protected operational database backups retained by the Operator for recovery from failures. These copies are not automatically erased when an account is deleted. They do not include the locally stored project files. Provider authentication/security logs and backups may outlive deletion from the active database. Their retention and deletion are subject to the applicable provider policies and legal requirements. Account deletion does not promise immediate erasure from every provider log or backup.",
      "If historical payment records exist, deletion removes their account link but preserves the payment records; payment-event records may also remain. No new payments are collected in Early Access. Paid-service retention terms will be addressed before any payment feature is offered.")] },
    { heading: '10. Your rights', blocks: [p('Under Israeli law you may ask to access the personal data we hold about you and to correct or delete data that is inaccurate, incomplete, unclear or outdated. You can also request account deletion from the account page as described in Section 9, and change your display name. Send requests to support.bettercalc@gmail.com; we will respond within the period required by law. If you are in the EU, you may have additional rights under the GDPR.')] },
    { heading: '11. Security', blocks: [p('The app is configured to use HTTPS for remote account services, per-user database access rules and a content-security policy. These measures reduce risk but do not guarantee security. Plans stay on your device, which also means their security depends on your device and browser. No system is completely secure; if a security incident affects your data, we will act as required by law.')] },
    { heading: '12. Age', blocks: [p('BetterCalc is intended for users aged 18 and over.')] },
    { heading: '13. Changes', blocks: [p("Updated documents will be published with a new version and effective date. When a new version becomes effective, the app requires explicit renewed acceptance from account users and guests before continued service use. A temporary account outage does not create an account acceptance: local use requires current local acknowledgement or previously verified acceptance. We do not currently provide an automated advance e-mail notification process.")] },
  ],
};

// ===================================================================================== Terms, English
const termsEn: LegalDocument = {
  title: 'Terms of Service',
  meta: `Free Early Access · Version: ${LEGAL_DOC_VERSION} · Effective date: ${LEGAL_EFFECTIVE_DATE}`,
  notice: {
    title: 'Professional-use notice. Read before using BetterCalc',
    points: [
      '**BetterCalc is an auxiliary tool only.** It helps you calculate quantities from PDF drawings. It is not a measuring instrument, not a professional service and not a substitute for professional judgment.',
      '**PDF-based measurement is inherently inaccurate.** Drawings may be not to scale, distorted, scanned, outdated or incomplete, and calibration, rendering and rounding introduce errors. **No accuracy, completeness or reliability of any result is guaranteed.**',
      '**You must independently verify ALL measurements, calculations, quantities and reports** before relying on them for any purpose: pricing, tenders, ordering, invoicing, payment certificates or construction.',
      '**BetterCalc is not engineering, architecture, quantity surveying or licensed surveying,** and nothing it produces is a certification, approval or professional opinion.',
      '**The Operator is not liable for financial losses** arising from use of or reliance on BetterCalc, direct or indirect, including pricing mistakes, material orders, construction delays and third-party claims, **to the fullest extent permitted by Israeli law** (Section 12).',
    ],
    closing: 'By using BetterCalc you confirm you have read and accept this notice.',
  },
  sections: [
    { heading: '1. The Operator and acceptance', blocks: [
      p('BetterCalc (“the Service”) is operated by **שי אטיאס (Shay Atias)**, an individual (natural person), operating as an Israeli sole proprietor, e-mail: support.bettercalc@gmail.com (“the Operator”, “we”). The Operator is not a company or other corporate body.', '1.1'),
      p("Before service use, you must explicitly accept these Terms and the Privacy Policy, whether using an account or guest access. If you do not agree, do not use the Service.", '1.2'),
      p('You must be at least 18 and legally competent. If you use the Service for a business, you confirm you may bind that business, and “you” includes it.', '1.3'),
      p('The Service is intended for professional use in the construction field. If you are a consumer under the Consumer Protection Law, 5741-1981, nothing in these Terms limits rights that law gives you and that cannot be waived.', '1.4'),
    ] },
    { heading: '2. Nature of the Service', status: 'active', blocks: [
      p('The Service is **strictly an auxiliary quantity-calculation tool** based on PDF drawings. It runs in your browser and applies calculations to the drawings, scales, calibration, selections and settings that **you** provide.', '2.1'),
      p("Manual measurement, quantity calculation, visual revision comparison and local export/backup tools are **free during Early Access**. The Operator does not review your drawings, inputs or results or provide professional advice. No professional, advisory, agency, employment or fiduciary relationship is created.", '2.2'),
      p("Descriptions and support communications do not replace independent verification of results or professional advice. Nothing in this clause excludes liability for misleading statements or other rights that cannot lawfully be excluded.", '2.3'),
    ] },
    { heading: '3. Inherent inaccuracy; no guarantee', status: 'active', blocks: [
      p('Measurements taken from PDF drawings are **inherently subject to inaccuracy**. Causes include: drawings that are not to scale, distorted, scanned, cropped, outdated or incomplete; incorrect or imprecise calibration; differences in PDF rendering; line thickness and pointer precision; elements drawn, detected or classified incorrectly; settings such as heights, waste, deductions, spacing, cover or lap lengths; rounding; and software errors.', '3.1'),
      p('Accordingly, the Operator **does not guarantee the accuracy, completeness or reliability** of any measurement, calculation, quantity, comparison or report, or that results comply with any standard, measurement method, contract or bill of quantities, or are fit for any purpose.', '3.2'),
      p('Labels in the Service such as “calculated”, “estimate”, “approved” or “calibrated” describe how a figure was calculated or what **you** marked. They are not a statement by the Operator that the figure is correct.', '3.3'),
    ] },
    { heading: '4. Your responsibility to verify everything', status: 'active', blocks: [
      p('**You are solely responsible for independently verifying all measurements, calculations, quantities and reports** before relying on them for any purpose, including pricing, tenders, ordering materials, invoices, payment certificates, change orders, scheduling, financing or construction. Verify them yourself or through a qualified professional.', '4.1'),
      p('At a minimum: confirm each page’s calibration against a second known dimension; confirm you are using the correct and current drawing revision; check quantities against the drawing’s dimensions; and apply the measurement method that governs your contract.', '4.2'),
      p('You are responsible for your inputs and for every decision you make on the basis of the Service.', '4.3'),
    ] },
    { heading: '5. Not engineering or professional certification', status: 'active', blocks: [
      p('The Service does not perform, and its results are not, engineering, structural, architectural, quantity-surveying or licensed land-surveying work. The Operator does not act as an engineer, architect, quantity surveyor or licensed surveyor in providing it.', '5.1'),
      p('Structural quantities (concrete, reinforcement, mesh, stirrups and similar) are estimates only. The Service does not design structures and does not check strength, adequacy, safety, detailing, or compliance with Israeli Standards, building regulations or permits.', '5.2'),
      p('Results are not a certification, approval, professional opinion, measurement certificate or signed document. They must not be presented to any authority, client, lender, appraiser, court or other person as such.', '5.3'),
      p('The Service does not apply any particular official or contractual measurement method (including the measurement rules of the General Specification for Building Works or any bill of quantities), unless a feature states so expressly.', '5.4'),
      p('Plan comparison is a visual aid. It does not guarantee that any or all changes between revisions are found.', '5.5'),
    ] },
    { heading: '6. Reports and third parties', status: 'active', blocks: [
      p('Reports, tables and files you export (“Reports”) are prepared **by you**, using the Service as a tool. You are their author and are responsible for them.', '6.1'),
      p('If you give a Report or any result to another person (a client, contractor, supplier, developer, lender, appraiser, tender committee, authority or anyone else): (a) you do so at your own responsibility; (b) you must not remove, hide or alter the notices on Reports; (c) you must not state or imply that BetterCalc or the Operator prepared, checked, approved or certified it; and (d) you are responsible for that person’s reliance on it.', '6.2'),
      p('The Service is provided to you only. The Operator does not intend anyone else to rely on the Service or on Reports, and to the extent permitted by law accepts no duty or responsibility to any third party.', '6.3'),
    ] },
    { heading: '7. Data stored on your device', status: 'active', blocks: [
      p('In the normal Early Access workflow, drawings and projects are stored in your browser, and exports and local backups are saved to your device. The Operator does not receive or back up project content through this workflow and cannot recover it from an account. Account data is processed separately as described in the Privacy Policy.', '7.1'),
      p('Browser storage can be erased by the browser, by clearing site data, by private browsing, by device failure or replacement, or by software updates. **You are responsible for keeping current backups** using the local export and backup tools provided; cloud backup is unavailable.', '7.2'),
      p('To the extent permitted by law, the Operator is not liable for loss, corruption or unavailability of data stored on your device, including where caused by a software error, except as set out in Section 12.4.', '7.3'),
      p("**Shared browsers.** Local projects are not separated by Google account. Anyone using the same browser profile may access them, including after sign-out or after a different account signs in. Use a separate browser or operating-system profile on a shared device; signing out alone does not protect projects left in that browser. The optional local-deletion scope and retained preferences are explained in Section 3 of the Privacy Policy.", '7.4'),
    ] },
    { heading: '8. Accounts', status: 'active', blocks: [
      p('Google registration is free, requires no payment details and unlocks unlimited manual tools. After trial activation, each guest browser receives seven days starting on its first service use, not the global launch date. After expiry, viewing, local export/backup and project deletion remain available; creating or editing requires registration. The trial is stored locally, is not tamper-proof, and clearing browser data can restart it. Keep your Google account secure; you are responsible for activity under your account.', '8.1'),
      p('You may request account deletion at any time, subject to the waiting period and processing described in the Privacy Policy. Deleting it does not delete data on your devices.', '8.2'),
    ] },
    { heading: '9. Acceptable use', status: 'active', blocks: [p('You must not: interfere with, overload, probe or bypass the Service’s security or limits; access other users’ data; reverse-engineer the Service except as permitted by law; use automated means to abuse it; or use it unlawfully or with content you have no right to use.')] },
    { heading: '10. Your content and the Operator’s intellectual property', status: 'active', blocks: [
      p('You own your drawings, projects, measurements and Reports. The Operator claims no ownership.', '10.1'),
      p('You confirm that you have the rights and permissions needed to use the drawings you load, including under copyright and any confidentiality or tender obligations.', '10.2'),
      p("AI processing and cloud backup are unavailable in Early Access. These Terms do not authorize uploading your project content to a future service; applicable terms and any required consent will be presented before such a feature is enabled.", '10.3'),
      p("The software, design and name “BetterCalc” belong to the Operator or the Operator’s licensors. Open-source components remain subject to their own licences. Notices and licence terms are available at /licenses/index.html. You receive a personal, non-transferable right to use the Service subject to these Terms and applicable law.", '10.4'),
      p("The Operator may use feedback you choose to send to improve the Service. Product usage analytics are disabled during Early Access; the handling of technical account and provider records is described in the Privacy Policy.", '10.5'),
    ] },
    { heading: '11. Service provided “as is”', blocks: [
      p('The Service is provided free of charge, as a general auxiliary tool, on inputs you control, with results you are required to verify. It is therefore provided **“as is” and “as available”**. To the extent permitted by law, the Operator gives no warranty or representation, express or implied, as to accuracy, completeness, reliability, availability, error-free operation or fitness for a particular purpose.', '11.1'),
      p("Early Access features may change, be interrupted or be discontinued. Keep independent local backups. Where reasonably possible, we will give advance notice of discontinuing the whole Service so you can export data; this does not limit mandatory notice obligations under law.", '11.2'),
    ] },
    { heading: '12. Exclusion of liability', blocks: [
      p('**Financial losses.** To the fullest extent permitted by law, the Operator is not liable for any financial loss or damage, **direct or indirect**, arising from or connected with the use of, inability to use, or reliance on the Service or any result or Report, including:', '12.1'),
      sub(['(a)', 'pricing, estimating, bidding or tender mistakes;'], ['(b)', 'quantities ordered, over- or under-ordering, wastage or surplus of materials;'], ['(c)', 'construction delays, rework, acceleration, idle time or remedial work;'], ['(d)', 'loss of profit, revenue, business, contracts, tenders or goodwill;'], ['(e)', 'penalties, damages, compensation or other amounts payable to clients, contractors, suppliers or any other third party, and disputes with them;'], ['(f)', 'loss of data stored on your device.']),
      p('**Third-party claims.** To the fullest extent permitted by law, the Operator is not liable to you for any claim made against you by a third party in connection with a result or Report, and you are responsible for any such claim as between you and the Operator (see also Section 13).', '12.2'),
      p('**Basis.** You acknowledge that: the Service is a free auxiliary tool; PDF-based measurement is inherently imprecise; you, not the Operator, choose the drawings, scales and inputs; you are able and required to verify all results before relying on them; the Operator does not receive your drawings or projects through the normal manual workflow; and the Operator does not charge for, and could not bear, the risk of your business decisions. This Section is a fundamental basis on which the Service is offered free of charge.', '12.3'),
      p('**What is not excluded.** Nothing in these Terms excludes or limits the Operator’s liability: (a) for malice, fraud or deceit; (b) for gross negligence; (c) for death or bodily injury caused by negligence; (d) for any obligation or liability that cannot be excluded or limited under Israeli law, including mandatory duties under privacy and data-protection law; or (e) for any right you have as a consumer that cannot be waived.', '12.4'),
      p('**Fallback if the exclusion is not enforced.** If, despite Section 12.1, the Operator is held liable for a loss, then to the extent permitted by law: (a) liability is limited to direct damage that was reasonably foreseeable when you started using the Service and that you prove; (b) it is reduced in proportion to your own contribution to the loss, including any failure to verify results as required by Section 4; (c) you must take reasonable steps to mitigate the loss; and (d) any restriction on damages remains subject to mandatory law and the court’s powers. These limitations are proposed contractual allocations of risk, not a guarantee of immunity, and remain subject to Section 12.4 and judicial review.', '12.5'),
      p('**Who is protected.** This Section protects the Operator personally and anyone acting on the Operator’s behalf, who may rely on it.', '12.6'),
      p("If you believe you have a claim, please contact the Operator promptly so the issue can be investigated. This request does not shorten any statutory limitation period, waive a remedy or make notice a condition of asserting your rights.", '12.7'),
    ] },
    { heading: '13. Indemnity (business users)', blocks: [p('If you use the Service in the course of a business, you will indemnify the Operator for reasonable costs, losses and legal fees arising from a third-party claim caused by: (a) content you loaded without the right to do so; (b) a Report or result you gave to a third party, or its use by that third party; or (c) your breach of these Terms. The Operator will notify you of the claim promptly and allow you to take part in the defence. This Section does not apply to the extent the claim results from a matter listed in Section 12.4.')] },
    { heading: '14. Features not available yet', status: 'soon', blocks: [p("AI access, cloud backup, paid subscriptions, credit purchases and payments are **disabled during Early Access**. Plans and credit allocations may be compared in a preview only; displayed preview prices may change and are not a purchase or entitlement. No checkout or subscription activation is available. Separate terms and privacy information, including any applicable prices, taxes, renewal, cancellation and refund rules, must be finalized before a commercial launch.")] },
    { heading: '15. Changes to these Terms', blocks: [
      p("Changes will be published in the app with a new document version and effective date. When an updated version becomes effective, continued service use requires explicit renewed acceptance. Any advance notice required by applicable law remains required.", '15.1'),
      p("If you do not agree, you may stop using the Service and request account deletion. Continued use alone does not replace the explicit acceptance step. Changes do not apply retroactively to claims that arose before their effective date.", '15.2'),
    ] },
    { heading: '16. Termination', blocks: [p('You may stop using the Service at any time. The Operator may suspend or end your access if you materially breach these Terms or if the law requires it, with notice where reasonable. Sections 3–7, 10–13 and 17–18 survive termination.')] },
    { heading: '17. Governing law and jurisdiction', blocks: [
      p('These Terms are governed by the laws of the State of Israel.', '17.1'),
      p("Jurisdiction is determined by applicable law in the competent courts in Israel. These Terms do not impose an exclusive district or limit mandatory consumer venue rights.", '17.2'),
    ] },
    { heading: '18. General', blocks: [
      p('**Modification rather than voiding.** If a court finds any provision invalid or unenforceable in whole or in part, including a provision of Section 12, that provision applies to the maximum extent permitted. Section 12.5 and the rest of these Terms remain in force.', '18.1'),
      p('**Assignment.** The Operator may transfer these Terms and the Service to a company the Operator controls, or to a buyer of the Service, with notice to you. You may not transfer your rights without the Operator’s consent.', '18.2'),
      p('**Entire agreement.** These Terms and the Privacy Policy are the entire agreement about the Service.', '18.3'),
      p('**No waiver.** Not enforcing a right is not a waiver of it.', '18.4'),
      p('**Language.** These Terms are published in Hebrew and English. If they conflict, the Hebrew version prevails.', '18.5'),
      p('**Notices.** The Operator may notify you in the app or by your account e-mail. Notices to the Operator: support.bettercalc@gmail.com.', '18.6'),
    ] },
  ],
};

// ===================================================================================== Privacy, Hebrew
const privacyHe: LegalDocument = {
  title: 'מדיניות פרטיות',
  meta: `גישה מוקדמת בחינם · גרסה: ${LEGAL_DOC_VERSION} · תאריך תחולה: ${LEGAL_EFFECTIVE_DATE}`,
  sections: [
    { heading: '1. מי אנחנו', blocks: [p('BetterCalc (“אנחנו”) מופעלת על ידי שי אטיאס, עוסק עצמאי בישראל. פנייה בנושאי פרטיות: support.bettercalc@gmail.com.')] },
    { heading: '2. בקצרה', blocks: [ul(
      'התוכניות והפרויקטים שלכם נשמרים **בדפדפן שלכם**, במכשיר שלכם. איננו מקבלים אותם בזמן העבודה.',
      'חשבון הוא אופציונלי. אם תתחברו עם Google, נשמור פרטי חשבון בסיסיים (סעיף 4).',
      'כיום איננו אוספים סטטיסטיקות שימוש או נתוני אנליטיקה (סעיף 5).',
      'יכולות בינה מלאכותית, גיבוי בענן ותשלומים **אינם זמינים עדיין**. עמוד התוכניות הוא תצוגה מקדימה בלבד (סעיף 8).',
    )] },
    { heading: '3. מידע שנשאר במכשיר שלכם', status: 'active', blocks: [p("קובצי PDF של תוכניות, פרויקטים, חדרים, מדידות, כמויות, סימונים והשוואות מעובדים מקומית ונשמרים ב-IndexedDB בדפדפן הזה. ייצואים וקובצי גיבוי מקומיים נשמרים במכשיר במקום שתבחרו. תהליך העבודה הרגיל בגישה המוקדמת אינו מעלה תוכן פרויקטים לשרתים שלנו. אחסון הדפדפן עלול להימחק או ללכת לאיבוד; יש לשמור גיבויים מקומיים נפרדים. התחברות ומחיקת חשבון אינן מעבירות או מוחקות פרויקטים מקומיים. התנתקות משמרת פרויקטים מקומיים, אלא אם בחרתם במפורש למחוק נתונים מקומיים בחלון ההתנתקות. ניתן למחוק אותם באפליקציה או בניקוי נתוני האתר בדפדפן. תוכניות עשויות לכלול מידע אישי או סודי של אחרים; אתם אחראים להרשאה להשתמש בו."), p("**דפדפן משותף.** פרויקטים מקומיים אינם מופרדים לפי חשבון Google. כל מי שמשתמש באותו פרופיל דפדפן עשוי לגשת אליהם, גם לאחר התנתקות או התחברות בחשבון אחר. במכשיר משותף השתמשו בפרופיל דפדפן או מערכת הפעלה נפרד; התנתקות בלבד אינה מגינה על פרויקטים שנותרו בדפדפן."), p("**מחיקה אופציונלית בעת התנתקות.** רק לאחר בחירה במחיקת נתונים מקומיים ואישור האזהרה הנפרדת, האפליקציה מנקה את כל הרשומות במסד הפרויקטים שלה בדפדפן הזה, לרבות פרויקטים ותיקיות, קובצי PDF של תוכניות, מדידות וסימונים, השוואות, היסטוריית גרסאות ורשומות עיבוד שנשמרו. המחיקה כוללת גם פרויקטים מקומיים שיצרו אורחים או חשבונות אחרים באותו פרופיל דפדפן. בנוסף נמחקים שם התצוגה השמור, מטמון הסכמה מאומתת של החשבון, אישור הסכמה הממתין להפניית Google, סימניית סביבת העבודה האחרונה, והיסטוריית תזכורות הגיבוי והשהייתן. ייצאו תחילה פרויקטים שברצונכם לשמור."), p("העדפות השפה, הרשת ושאר הגדרות הממשק, מצב מסך הפתיחה, מצב הניסיון לאורח ואישור הסכמת האורח וההיסטוריה שלו נשארים. זו אינה מחיקה מלאה של אחסון האתר בדפדפן. הפעולה אינה מוחקת קובצי ייצוא או גיבוי שכבר הורדו, מידע במכשירים אחרים, נתוני חשבון או היסטוריית הסכמות בשרת, ואינה מנתקת אתכם מחשבון Google עצמו. המחיקה המקומית מתבצעת לפני ניסיון ההתנתקות מהאפליקציה; אם ההתנתקות נכשלת לאחר מכן, החיבור לחשבון עשוי להישאר פעיל אף שהנתונים המקומיים נמחקו. אם הניקוי נכשל, האפליקציה שואלת אם לנסות שוב לפני המשך ההתנתקות.")] },
    { heading: '4. נתוני חשבון (אופציונלי)', status: 'active', blocks: [
      p('אם תתחברו עם Google, נקבל ונשמור, באמצעות הספק שלנו Supabase:'),
      ul(
        'מזהה משתמש, כתובת דוא״ל ושם, ופרטי הפרופיל הבסיסיים ש-Google מעבירה לאפליקציות התחברות (כגון קישור לתמונת פרופיל);',
        'שם התצוגה שאישרתם;',
        'גרסת המסמכים המדויקת ומועדי השרת של כל הסכמה מתועדת לתנאי השימוש ולמדיניות הפרטיות, כולל היסטוריית הסכמות;',
        'רשומות אימות וחיבור; יומני גישה ואבטחה אצל הספקים עשויים לכלול כתובות IP, פרטי דפדפן ומועדי בקשות (אלה רשומות תפעוליות הנפרדות מאנליטיקת המוצר);',
        'רשומות מצב חשבון (למשל יתרת קרדיטים ריקה), ואם ביקשתם מחיקה, בקשת המחיקה.',
      ),
      p('מטרה: יצירת החשבון ואבטחתו, שמירת החיבור, תיעוד הסכמתכם למסמכים אלה והכנת יכולות חשבון. אינכם חייבים על פי דין למסור לנו מידע זה; בלעדיו ניתן להשתמש ב-BetterCalc כאורח, בכפוף למגבלות הניסיון המתוארות בתנאי השימוש. איננו מקבלים את סיסמת Google שלכם. בחירת השפה נשמרת בדפדפן שלכם ולא בחשבון.'),
      p('אם תפנו ל־support.bettercalc@gmail.com, שירות Gmail של Google יעבד את כתובתכם, ההודעה והקבצים שתבחרו לשלוח כדי שנוכל לטפל בפנייה. האפליקציה אינה מוחקת התכתבויות תמיכה באופן אוטומטי. הימנעו משליחת תוכניות או חומר סודי אחר אם אינם נחוצים לפנייה.'),
    ] },
    { heading: '5. סטטיסטיקות שימוש', status: 'active', blocks: [
      p('בתקופת הגישה המוקדמת BetterCalc אינה מפעילה אנליטיקת מוצר. האפליקציה אינה טוענת כלי אנליטיקה, אינה שולחת אירועי שימוש לספק אנליטיקה, ואינה יוצרת או שומרת בדפדפן מזהה אנליטיקה. מזהה אנליטיקה שנשאר בדפדפן מגרסה קודמת מוסר עם פתיחת האפליקציה.'),
      p('לפני שהאנליטיקה תופעל מחדש נעדכן מדיניות זו ונציג מה משתנה.'),
    ] },
    { heading: '6. אחסון בדפדפן', status: 'active', blocks: [p("אנו משתמשים ב-IndexedDB ובאחסון מקומי או זמני בדפדפן עבור פרויקטים, חיבור לחשבון, העדפות שפה ותצוגה, מצב תקופת הניסיון לאורחים, היסטוריית הסכמות אורח, שם תצוגה שמור וראיות להסכמה שאומתה בעבר המקושרות לחשבון ולגרסת המסמכים. אישור הסכמה קצר מועד באחסון הזמני מעביר את הסכמתכם המפורשת לאורך ההפניה להתחברות Google. אלה רשומות תפעוליות ולא מזהי פרסום. ניקוי האחסון מסיר רשומות מקומיות ועלול לגרום לאובדן פרויקטים או לצורך בהתחברות ובהסכמה מחדש. אם הוגדר CAPTCHA, ‏Cloudflare Turnstile מעבדת נתוני דפדפן להגנה מבוטים; זו אינה אנליטיקת מוצר.")] },
    { heading: '7. מי מעבד מידע עבורנו', blocks: [table(["ספק", "תפקיד בגישה המוקדמת", "מיקום העיבוד"],["Supabase", "שילוב התחברות Google, מסד נתוני חשבון, חיבורים ורשומות הסכמה; ללא העלאת גיבויי פרויקטים", "מסד הנתונים: האיחוד האירופי (אירלנד), eu-west-1; פעילות הספק עשויה לערב גם מדינות אחרות (https://supabase.com/privacy)"],["Google", "ספק זהות כשבוחרים להתחבר באמצעות Google; Gmail לפניות תמיכה שתבחרו לשלוח", "עיבוד גלובלי לפי מדיניות הפרטיות של Google (https://policies.google.com/privacy)"],["Netlify", "הגשת האתר; ייתכן עיבוד יומני גישה ואבטחה טכניים גם לאורחים", "עיבוד טכני עשוי להתבצע מחוץ לישראל (https://www.netlify.com/privacy/)"],["Cloudflare (רק אם הוגדר CAPTCHA)", "הגנה מבוטים באמצעות Turnstile", "לפי גילויי העיבוד של Cloudflare (https://www.cloudflare.com/privacypolicy/)"]),p("נתוני חשבון ונתונים טכניים עשויים להיות מעובדים מחוץ לישראל. הספקים מפרסמים תנאי פרטיות ועיבוד מידע המתארים את העיבוד והגנות ההעברה בכתובות שלעיל. מיקום מסד הנתונים אינו מבטיח שכל עיבוד נתוני החשבון והמידע הטכני מוגבל לאותה מדינה. תוכן פרויקטים אינו נשלח לספקים אלה בתהליך העבודה הידני המקומי הרגיל."),p("איננו מוכרים מידע אישי או משתפים אותו לצורכי פרסום. ייתכן שנמסור מידע כשנדרש לפי דין או רשות מוסמכת, או כשהדבר נחוץ ומותר בדין להגנה על זכויות בהליך משפטי.")] },
    { heading: '8. יכולות שאינן זמינות עדיין', status: 'soon', blocks: [p("בינה מלאכותית, תשלומים, מנויים וגיבוי בענן **אינם זמינים עדיין**. עמוד התוכניות הוא תצוגה מקדימה להשוואה בלבד: המחירים עשויים להשתנות, לא ניתן לרכוש תוכניות בתשלום, וקרדיטים בתצוגה אינם מעניקים גישה לבינה מלאכותית. איסוף ועריכת פרטי חיוב כבויים; פרטים שנשמרו בעבר נשמרים עד למחיקת החשבון. לא מופעל חיוב כספי או חיוב על שימוש בבינה מלאכותית."),p("לפני השקת יכולת כזו נפרסם את זרימות המידע, הספקים, מיקומי העיבוד, תקופות השמירה וכל הסכמה נדרשת. תנאי ספקים או חיוב עתידיים אינם חלק מההצעה הנוכחית בגישה המוקדמת.")] },
    { heading: '9. משך שמירת המידע', blocks: [ul("פרויקטים ורשומות בדפדפן נשארים עד למחיקתם על ידכם או על ידי הדפדפן. מחיקת החשבון אינה מנקה את אחסון הדפדפן במכשיר כלשהו.",
      "נתוני חשבון בשרת, לרבות פרופיל והיסטוריית הסכמות, נשמרים כל עוד החשבון קיים. ניתן לבקש מחיקה בדף החשבון ולבטל כל עוד הבקשה ממתינה. מנגנון התחזוקה הממומש משתמש כברירת מחדל בתקופת המתנה של 7 ימים, ולאחריה מוחק קובצי ענן שנשמרו, אם ישנם, לפני מחיקת חשבון האימות והפרופיל, היסטוריית ההסכמות, פרטי החיוב ויתר רשומות החשבון המקושרות. ההשלמה מתבצעת בריצת תחזוקה מוצלחת, ולא אוטומטית בסוף ההמתנה. פונקציית התחזוקה פרוסה ומתוזמנת מדי יום ב־03:17 UTC; ריצה שנכשלה עלולה לעכב את ההשלמה. פנו לתמיכה אם בקשת מחיקה נשארת בהמתנה.",
      "רשומות ביקורת על מחיקה שומרות מזהה משתמש פנימי, פעולה ומועד; הן אינן אנונימיות. בקוד אין מחיקה אוטומטית שלהן לאחר תקופה קצובה. אפשר לפנות לתמיכה בנוגע למזהי חשבון שנשמרו ולזכויות החלות עליכם.",
      "רשומות חשבון עשויות להיכלל גם בגיבויים תפעוליים מוגנים של מסד הנתונים שהמפעיל שומר לצורך התאוששות מתקלות. עותקים אלה אינם נמחקים אוטומטית בעת מחיקת חשבון. הם אינם כוללים את קובצי הפרויקטים השמורים מקומית. יומני אימות ואבטחה וגיבויים אצל ספקים עשויים להישמר לאחר המחיקה ממסד הנתונים הפעיל. שמירתם ומחיקתם כפופות למדיניות הספקים החלה ולדרישות הדין. מחיקת החשבון אינה מבטיחה הסרה מיידית מכל יומן או גיבוי של ספק.",
      "אם קיימות רשומות תשלום היסטוריות, המחיקה מסירה את הקישור שלהן לחשבון אך משמרת אותן; גם רשומות אירועי תשלום עשויות להישאר. לא נגבים תשלומים חדשים בגישה המוקדמת. תנאי שמירה הנוגעים לשירות בתשלום יוסדרו לפני שתוצע יכולת תשלום.")] },
    { heading: '10. הזכויות שלכם', blocks: [p('לפי הדין בישראל באפשרותכם לבקש לעיין במידע האישי שאנו מחזיקים עליכם, ולבקש לתקן או למחוק מידע שאינו נכון, שלם, ברור או מעודכן. תוכלו גם לבקש מחיקת חשבון מדף החשבון כמתואר בסעיף 9 ולשנות את שם התצוגה. בקשות יש לשלוח אל support.bettercalc@gmail.com; נשיב בתוך התקופה הקבועה בדין. אם אתם באיחוד האירופי, ייתכן שיש לכם זכויות נוספות לפי ה-GDPR.')] },
    { heading: '11. אבטחת מידע', blocks: [p('האפליקציה מוגדרת להשתמש ב-HTTPS לשירותי חשבון מרוחקים, בכללי גישה לנתוני החשבון לפי משתמש ובמדיניות אבטחת תוכן. אמצעים אלה מפחיתים סיכון אך אינם מבטיחים אבטחה. התוכניות נשארות במכשירכם, ולכן אבטחתן תלויה גם במכשיר ובדפדפן שלכם. אין מערכת מאובטחת לחלוטין; אם אירוע אבטחה ישפיע על המידע שלכם, נפעל כנדרש בדין.')] },
    { heading: '12. גיל', blocks: [p('BetterCalc מיועדת למשתמשים בני 18 ומעלה.')] },
    { heading: '13. שינויים', blocks: [p("מסמכים מעודכנים יפורסמו עם גרסה ומועד תחולה חדשים. כאשר גרסה חדשה נכנסת לתוקף, האפליקציה דורשת הסכמה מפורשת מחודשת ממשתמשי חשבון ומאורחים לפני המשך השימוש בשירות. תקלה זמנית בשירות החשבון אינה יוצרת הסכמה בחשבון: שימוש מקומי מחייב אישור מקומי עדכני או הסכמה שאומתה בעבר. כיום אין מנגנון אוטומטי להודעה מוקדמת בדוא״ל.")] },
  ],
};

// ===================================================================================== Terms, Hebrew
const termsHe: LegalDocument = {
  title: 'תנאי שימוש',
  meta: `גישה מוקדמת בחינם · גרסה: ${LEGAL_DOC_VERSION} · תאריך תחולה: ${LEGAL_EFFECTIVE_DATE}`,
  notice: {
    title: 'הודעה לשימוש מקצועי. יש לקרוא לפני השימוש ב-BetterCalc',
    points: [
      '**BetterCalc היא כלי עזר בלבד** לחישוב כמויות מתוך תוכניות PDF. היא אינה מכשיר מדידה, אינה שירות מקצועי ואינה תחליף לשיקול דעת מקצועי.',
      '**מדידה מתוך PDF כרוכה מטבעה באי-דיוקים.** תוכניות עשויות שלא להיות בקנה מידה, להיות מעוותות, סרוקות, לא מעודכנות או חסרות, וכיול, תצוגה ועיגול גורמים לסטיות. **אין כל התחייבות לדיוק, לשלמות או לאמינות של תוצאה כלשהי.**',
      '**עליכם לאמת באופן עצמאי את כל המדידות, החישובים, הכמויות והדוחות** לפני הסתמכות עליהם לכל מטרה: תמחור, מכרזים, הזמנות, חשבונות, חשבונות חלקיים או ביצוע.',
      '**BetterCalc אינה הנדסה, אדריכלות, כמאות או מדידה מוסמכת**, ושום דבר שהיא מפיקה אינו אישור, היתר או חוות דעת מקצועית.',
      '**המפעיל אינו אחראי לנזקים כספיים**, ישירים או עקיפים, הנובעים מהשימוש ב-BetterCalc או מהסתמכות עליה, לרבות טעויות תמחור, הזמנות חומרים, עיכובי ביצוע ותביעות צד שלישי, **במידה המרבית המותרת לפי הדין בישראל** (סעיף 12).',
    ],
    closing: 'בשימוש ב-BetterCalc אתם מאשרים שקראתם הודעה זו ואתם מקבלים אותה.',
  },
  sections: [
    { heading: '1. המפעיל והסכמה', blocks: [
      p('BetterCalc (“השירות”) מופעלת על ידי **שי אטיאס**, אדם פרטי (יחיד), הפועל כעוסק עצמאי בישראל, דוא״ל: support.bettercalc@gmail.com (“המפעיל”). המפעיל אינו חברה או תאגיד.', '1.1'),
      p("לפני השימוש בשירות נדרשת הסכמה מפורשת לתנאים אלה ולמדיניות הפרטיות, בחשבון או בגישת אורח. אם אינכם מסכימים, אל תשתמשו בשירות.", '1.2'),
      p('עליכם להיות בני 18 לפחות ובעלי כשרות משפטית. אם אתם משתמשים בשירות עבור עסק, אתם מאשרים שאתם מוסמכים לחייב אותו, ו“אתם” כולל אותו.', '1.3'),
      p('השירות מיועד לשימוש מקצועי בתחום הבנייה. אם אתם צרכנים כמשמעותם בחוק הגנת הצרכן, התשמ״א-1981, אין בתנאים אלה כדי לגרוע מזכויות שחוק זה מקנה לכם ושאין לוותר עליהן.', '1.4'),
    ] },
    { heading: '2. מהות השירות', status: 'active', blocks: [
      p('השירות הוא **כלי עזר לחישוב כמויות בלבד**, המבוסס על תוכניות PDF. הוא פועל בדפדפן ומבצע חישובים על בסיס התוכניות, קני המידה, הכיול, הבחירות וההגדרות ש**אתם** מספקים.', '2.1'),
      p("כלי המדידה הידניים, חישוב הכמויות, השוואת הגרסאות החזותית והייצוא והגיבוי המקומיים ניתנים **ללא תשלום בתקופת הגישה המוקדמת**. המפעיל אינו בודק את התוכניות, הנתונים או התוצאות שלכם ואינו מספק ייעוץ מקצועי. לא נוצרים יחסי ייעוץ מקצועי, שליחות, עבודה או נאמנות.", '2.2'),
      p("תיאורים ופניות תמיכה אינם מחליפים אימות עצמאי של התוצאות או ייעוץ מקצועי. אין בסעיף זה כדי לפטור מאחריות למצגים מטעים או לגרוע מזכויות שאין לגרוע מהן לפי דין.", '2.3'),
    ] },
    { heading: '3. אי-דיוק מובנה; אין התחייבות', status: 'active', blocks: [
      p('מדידות מתוך תוכניות PDF **כרוכות מטבען באי-דיוקים**, בין היתר בשל: תוכניות שאינן בקנה מידה, מעוותות, סרוקות, חתוכות, לא מעודכנות או חסרות; כיול שגוי או לא מדויק; הבדלי תצוגת PDF; עובי קווים ודיוק הסמן; רכיבים ששורטטו, זוהו או סווגו באופן שגוי; הגדרות כגון גבהים, פחת, ניכויים, מרווחים, כיסוי או אורכי חפייה; עיגול; ותקלות תוכנה.', '3.1'),
      p('לפיכך המפעיל **אינו מתחייב לדיוק, לשלמות או לאמינות** של מדידה, חישוב, כמות, השוואה או דוח כלשהם, וגם לא להתאמתם לתקן, לאופן מדידה, לחוזה או לכתב כמויות כלשהו, או לכל מטרה שהיא.', '3.2'),
      p('תוויות בשירות כגון “מחושב”, “אומדן”, “אושר” או “מכויל” מתארות את אופן החישוב או את מה ש**אתם** סימנתם, ואין הן הצהרה של המפעיל כי הנתון נכון.', '3.3'),
    ] },
    { heading: '4. האחריות שלכם לאמת הכול', status: 'active', blocks: [
      p('**האחריות הבלעדית לאמת באופן עצמאי את כל המדידות, החישובים, הכמויות והדוחות** לפני הסתמכות עליהם לכל מטרה מוטלת עליכם. הדבר כולל תמחור, מכרזים, הזמנת חומרים, חשבונות, חשבונות חלקיים, הוראות שינוי, תזמון, מימון או ביצוע. את האימות יש לבצע בעצמכם או באמצעות איש מקצוע מוסמך.', '4.1'),
      p('לכל הפחות: אמתו את הכיול של כל גיליון מול מידה ידועה נוספת; ודאו שאתם עובדים על גרסת התוכנית הנכונה והעדכנית; בדקו כמויות מול מידות התוכנית; וישמו את אופן המדידה החל על החוזה שלכם.', '4.2'),
      p('אתם אחראים לנתונים שאתם מזינים ולכל החלטה שאתם מקבלים על בסיס השירות.', '4.3'),
    ] },
    { heading: '5. אין מדובר בהנדסה או באישור מקצועי', status: 'active', blocks: [
      p('השירות אינו מבצע, ותוצאותיו אינן, עבודת הנדסה, קונסטרוקציה, אדריכלות, כמאות או מדידה מוסמכת. המפעיל אינו פועל במתן השירות כמהנדס, אדריכל, כמאי או מודד מוסמך.', '5.1'),
      p('כמויות שלד (בטון, זיון, רשתות, חישוקים וכדומה) הן אומדן בלבד. השירות אינו מתכנן מבנים ואינו בודק חוזק, התאמה, בטיחות, פרטי זיון או עמידה בתקנים ישראליים, בתקנות בנייה או בהיתרים.', '5.2'),
      p('התוצאות אינן אישור, היתר, חוות דעת מקצועית, תעודת מדידה או מסמך חתום. אין להציגן ככאלה לרשות, ללקוח, למלווה, לשמאי, לבית משפט או לכל אדם אחר.', '5.3'),
      p('השירות אינו מיישם אופן מדידה רשמי או חוזי מסוים (לרבות אופני המדידה של המפרט הכללי לעבודות בנייה או של כתב כמויות כלשהו), אלא אם יכולת מסוימת מציינת זאת במפורש.', '5.4'),
      p('השוואת תוכניות היא כלי עזר חזותי, ואין התחייבות שיאותרו בה שינוי כלשהו או כל השינויים בין גרסאות.', '5.5'),
    ] },
    { heading: '6. דוחות וצדדים שלישיים', status: 'active', blocks: [
      p('דוחות, טבלאות וקבצים שאתם מייצאים (“דוחות”) מוכנים **על ידיכם**, תוך שימוש בשירות ככלי. אתם המחברים שלהם ואחראים להם.', '6.1'),
      p('אם אתם מוסרים דוח או תוצאה לאחר (לקוח, קבלן, ספק, יזם, מלווה, שמאי, ועדת מכרזים, רשות או כל אדם אחר): (א) הדבר באחריותכם בלבד; (ב) אסור להסיר, להסתיר או לשנות את ההודעות שבדוחות; (ג) אסור לציין או לרמוז כי BetterCalc או המפעיל הכינו, בדקו, אישרו או אימתו אותו; ו-(ד) אתם אחראים להסתמכות של אותו אדם.', '6.2'),
      p('השירות ניתן לכם בלבד. המפעיל אינו מתכוון שאדם אחר יסתמך על השירות או על הדוחות, ובמידה שהדין מתיר אינו נוטל כל חובה או אחריות כלפי צד שלישי.', '6.3'),
    ] },
    { heading: '7. מידע השמור במכשירכם', status: 'active', blocks: [
      p('בתהליך העבודה הרגיל בגישה המוקדמת, תוכניות ופרויקטים נשמרים בדפדפן, וייצואים וגיבויים מקומיים נשמרים במכשיר. המפעיל אינו מקבל או מגבה תוכן פרויקטים בתהליך זה ואינו יכול לשחזרו מתוך חשבון. נתוני חשבון מעובדים בנפרד כמתואר במדיניות הפרטיות.', '7.1'),
      p('אחסון הדפדפן עלול להימחק על ידי הדפדפן, בניקוי נתוני אתר, בגלישה פרטית, בתקלה או בהחלפת מכשיר, או בעדכוני תוכנה. **האחריות לשמירת גיבויים עדכניים** באמצעות כלי הייצוא והגיבוי המקומיים שבשירות היא שלכם; גיבוי בענן אינו זמין.', '7.2'),
      p('במידה שהדין מתיר, המפעיל אינו אחראי לאובדן, לשיבוש או לאי-זמינות של מידע השמור במכשירכם, לרבות כתוצאה מתקלת תוכנה, למעט כאמור בסעיף 12.4.', '7.3'),
      p("**דפדפן משותף.** פרויקטים מקומיים אינם מופרדים לפי חשבון Google. כל מי שמשתמש באותו פרופיל דפדפן עשוי לגשת אליהם, גם לאחר התנתקות או התחברות בחשבון אחר. במכשיר משותף השתמשו בפרופיל דפדפן או מערכת הפעלה נפרד; התנתקות בלבד אינה מגינה על פרויקטים שנותרו בדפדפן. היקף המחיקה המקומית האופציונלית וההעדפות הנשמרות מוסברים בסעיף 3 למדיניות הפרטיות.", '7.4'),
    ] },
    { heading: '8. חשבונות', status: 'active', blocks: [
      p('הרשמה ב־Google היא חינמית, ללא פרטי תשלום, ופותחת שימוש בלתי מוגבל בכלים הידניים. לאחר הפעלת הניסיון, כל דפדפן אורח מקבל שבעה ימים מהשימוש הראשון שלו בשירות, ולא ממועד ההשקה הכללי. לאחר סיום הניסיון, צפייה, ייצוא וגיבוי מקומיים ומחיקת פרויקטים זמינים; יצירה ועריכה מחייבות הרשמה. הניסיון נשמר מקומית, אינו מוגן לחלוטין משינוי, וניקוי נתוני הדפדפן עשוי להתחילו מחדש. שמרו על אבטחת חשבון Google שלכם; אתם אחראים לפעילות בחשבונכם.', '8.1'),
      p('ניתן לבקש מחיקת חשבון בכל עת, בכפוף לתקופת ההמתנה ולעיבוד המתוארים במדיניות הפרטיות. מחיקתו אינה מוחקת מידע במכשיריכם.', '8.2'),
    ] },
    { heading: '9. שימוש מותר', status: 'active', blocks: [p('אסור: לשבש, להעמיס, לבחון או לעקוף את האבטחה או המגבלות של השירות; לגשת למידע של משתמשים אחרים; לבצע הנדסה לאחור אלא במידה שהדין מתיר; להשתמש באמצעים אוטומטיים לניצול לרעה; או להשתמש בשירות שלא כדין או עם תוכן שאין לכם זכות להשתמש בו.')] },
    { heading: '10. התוכן שלכם והקניין הרוחני של המפעיל', status: 'active', blocks: [
      p('התוכניות, הפרויקטים, המדידות והדוחות שלכם שייכים לכם. המפעיל אינו טוען לבעלות עליהם.', '10.1'),
      p('אתם מצהירים שיש לכם הזכויות וההרשאות הנדרשות לשימוש בתוכניות שאתם טוענים, לרבות לפי דיני זכויות יוצרים וחובות סודיות או מכרז.', '10.2'),
      p("עיבוד בבינה מלאכותית וגיבוי בענן אינם זמינים בגישה המוקדמת. תנאים אלה אינם מתירים העלאת תוכן הפרויקטים שלכם לשירות עתידי; תנאים חלים וכל הסכמה נדרשת יוצגו לפני הפעלת יכולת כזו.", '10.3'),
      p("התוכנה, העיצוב והשם “BetterCalc” שייכים למפעיל או לנותני הרישיון שלו. רכיבי קוד פתוח כפופים לרישיונותיהם. הודעות הרישיון ותנאיהן זמינות בכתובת /licenses/index.html. ניתנת לכם זכות אישית שאינה ניתנת להעברה להשתמש בשירות בכפוף לתנאים אלה ולדין החל.", '10.4'),
      p("המפעיל רשאי להשתמש במשוב שתבחרו לשלוח כדי לשפר את השירות. אנליטיקת השימוש במוצר כבויה בגישה המוקדמת; הטיפול ברשומות חשבון טכניות וברשומות ספקים מתואר במדיניות הפרטיות.", '10.5'),
    ] },
    { heading: '11. השירות ניתן “כמות שהוא” (AS IS)', blocks: [
      p('השירות ניתן ללא תשלום, ככלי עזר כללי, על בסיס נתונים שבשליטתכם ועם תוצאות שעליכם לאמת. לכן הוא ניתן **“כמות שהוא” (AS IS) ו“כפי שהוא זמין”**. במידה שהדין מתיר, המפעיל אינו נותן כל מצג או התחייבות, מפורשים או משתמעים, בדבר דיוק, שלמות, אמינות, זמינות, פעולה ללא תקלות או התאמה למטרה מסוימת.', '11.1'),
      p("יכולות הגישה המוקדמת עשויות להשתנות, להיפסק זמנית או להיסגר. יש לשמור גיבויים מקומיים עצמאיים. ככל שניתן באופן סביר, נמסור הודעה מוקדמת על סגירת השירות כולו כדי לאפשר ייצוא; אין בכך לגרוע מחובות הודעה מחייבות לפי דין.", '11.2'),
    ] },
    { heading: '12. פטור מאחריות', blocks: [
      p('**נזקים כספיים.** במידה המרבית שהדין מתיר, המפעיל אינו אחראי לכל הפסד או נזק כספי, **ישיר או עקיף**, הנובע מהשימוש בשירות, מאי-היכולת להשתמש בו או מהסתמכות עליו או על תוצאה או דוח כלשהם, או הקשור לכך, לרבות:', '12.1'),
      sub(['(א)', 'טעויות בתמחור, באומדן, בהצעות מחיר או במכרזים;'], ['(ב)', 'כמויות שהוזמנו, הזמנה ביתר או בחסר, פחת או עודפי חומרים;'], ['(ג)', 'עיכובי ביצוע, עבודה חוזרת, האצה, זמן השבתה או עבודות תיקון;'], ['(ד)', 'אובדן רווח, הכנסה, עסקים, חוזים, מכרזים או מוניטין;'], ['(ה)', 'קנסות, פיצויים, תשלומים או סכומים אחרים שיש לשלם ללקוחות, לקבלנים, לספקים או לכל צד שלישי אחר, ומחלוקות עמם;'], ['(ו)', 'אובדן מידע השמור במכשירכם.']),
      p('**תביעות צד שלישי.** במידה המרבית שהדין מתיר, המפעיל אינו אחראי כלפיכם לכל תביעה שתוגש נגדכם על ידי צד שלישי בקשר לתוצאה או לדוח. ביחסים בינכם לבין המפעיל, האחריות לכל תביעה כזו היא שלכם (ראו גם סעיף 13).', '12.2'),
      p('**הבסיס לפטור.** אתם מאשרים כי: השירות הוא כלי עזר חינמי; מדידה מתוך PDF אינה מדויקת מטבעה; אתם, ולא המפעיל, בוחרים את התוכניות, קני המידה והנתונים; ביכולתכם ועליכם לאמת את כל התוצאות לפני הסתמכות עליהן; המפעיל אינו מקבל את התוכניות או הפרויקטים שלכם בתהליך העבודה הידני הרגיל; והמפעיל אינו גובה תמורה בעבור הסיכון של החלטותיכם העסקיות ואינו יכול לשאת בו. סעיף זה הוא בסיס יסודי שעליו השירות מוצע ללא תשלום.', '12.3'),
      p('**מה אינו מוחרג.** אין בתנאים אלה כדי לפטור או להגביל את אחריות המפעיל: (א) לזדון, תרמית או הטעיה; (ב) לרשלנות רבתי; (ג) למוות או לנזק גוף שנגרמו ברשלנות; (ד) לכל חובה או אחריות שאין לפטור ממנה או להגבילה לפי הדין בישראל, לרבות חובות מחייבות לפי דיני הגנת הפרטיות; או (ה) לכל זכות שלכם כצרכנים שאין לוותר עליה.', '12.4'),
      p('**הוראת גיבוי אם הפטור לא יאוכף.** אם, על אף האמור בסעיף 12.1, ייקבע כי המפעיל אחראי לנזק, אזי במידה שהדין מתיר: (א) האחריות תוגבל לנזק ישיר שהיה צפוי באופן סביר בעת שהתחלתם להשתמש בשירות ושהוכח על ידיכם; (ב) היא תופחת בהתאם לחלקכם בגרימת הנזק, לרבות אי-אימות התוצאות כנדרש בסעיף 4; (ג) עליכם לנקוט צעדים סבירים להקטנת הנזק; ו-(ד) כל הגבלה על פיצויים כפופה לדין המחייב ולסמכויות בית המשפט. הגבלות אלה הן חלוקת סיכונים חוזית מוצעת, ולא הבטחה לחסינות, והן כפופות לסעיף 12.4 ולביקורת שיפוטית.', '12.5'),
      p('**על מי חלה ההגנה.** סעיף זה מגן על המפעיל באופן אישי ועל כל מי שפועל מטעמו, הרשאים להסתמך עליו.', '12.6'),
      p("אם לדעתכם קמה לכם טענה, אנא פנו למפעיל בהקדם כדי שניתן יהיה לבדוק את העניין. בקשה זו אינה מקצרת תקופת התיישנות, אינה ויתור על סעד ואינה מתנה את מימוש זכויותיכם במתן הודעה.", '12.7'),
    ] },
    { heading: '13. שיפוי (משתמשים עסקיים)', blocks: [p('אם אתם משתמשים בשירות במסגרת עסק, תשפו את המפעיל בגין עלויות, הפסדים ושכר טרחה סבירים הנובעים מתביעת צד שלישי שנגרמה בשל: (א) תוכן שטענתם ללא זכות; (ב) דוח או תוצאה שמסרתם לצד שלישי, או השימוש שעשה בהם; או (ג) הפרת תנאים אלה. המפעיל יודיע לכם על התביעה בהקדם ויאפשר לכם להשתתף בהגנה. סעיף זה לא יחול במידה שהתביעה נובעת מעניין המנוי בסעיף 12.4.')] },
    { heading: '14. יכולות שאינן זמינות עדיין', status: 'soon', blocks: [p("גישה לבינה מלאכותית, גיבוי בענן, מנויים בתשלום, רכישת קרדיטים ותשלומים **כבויים בתקופת הגישה המוקדמת**. אפשר להשוות תוכניות והקצאות קרדיטים בתצוגה מקדימה בלבד; מחירי התצוגה עשויים להשתנות ואינם רכישה או זכאות. אין אפשרות לתשלום או להפעלת מנוי. לפני השקה מסחרית יש להשלים תנאים ומידע על פרטיות, לרבות מחירים, מיסים, חידוש, ביטול והחזרים החלים, ככל שרלוונטי.")] },
    { heading: '15. שינויים בתנאים', blocks: [
      p("שינויים יפורסמו באפליקציה עם גרסת מסמכים ומועד תחולה חדשים. כאשר גרסה מעודכנת נכנסת לתוקף, המשך השימוש מחייב הסכמה מפורשת מחודשת. חובת הודעה מוקדמת לפי הדין החל נשמרת.", '15.1'),
      p("אם אינכם מסכימים, תוכלו להפסיק את השימוש ולבקש מחיקת חשבון. המשך שימוש כשלעצמו אינו מחליף את שלב ההסכמה המפורשת. שינויים אינם חלים למפרע על טענות שקמו לפני מועד תחולתם.", '15.2'),
    ] },
    { heading: '16. סיום', blocks: [p('אתם רשאים להפסיק להשתמש בשירות בכל עת. המפעיל רשאי להשעות או להפסיק את גישתכם אם הפרתם תנאים אלה הפרה מהותית או אם הדין מחייב זאת, בהודעה מראש במקום שהדבר סביר. סעיפים 3–7, 10–13 ו-17–18 יחולו גם לאחר הסיום.')] },
    { heading: '17. דין חל וסמכות שיפוט', blocks: [
      p('על תנאים אלה יחולו דיני מדינת ישראל.', '17.1'),
      p("סמכות השיפוט תיקבע לפי הדין החל בבתי המשפט המוסמכים בישראל. תנאים אלה אינם קובעים מחוז בלעדי ואינם גורעים מזכויות צרכנים מחייבות בעניין מקום השיפוט.", '17.2'),
    ] },
    { heading: '18. כללי', blocks: [
      p('**שינוי במקום ביטול.** אם בית משפט יקבע שהוראה כלשהי, לרבות הוראה בסעיף 12, בטלה או אינה ניתנת לאכיפה, כולה או חלקה, היא תחול במידה המרבית המותרת. סעיף 12.5 ויתר התנאים יעמדו בתוקפם.', '18.1'),
      p('**המחאה.** המפעיל רשאי להעביר תנאים אלה ואת השירות לחברה שבשליטתו או לרוכש השירות, בהודעה לכם. אינכם רשאים להעביר את זכויותיכם ללא הסכמת המפעיל.', '18.2'),
      p('**הסכם מלא.** תנאים אלה ומדיניות הפרטיות הם ההסכם המלא בנוגע לשירות.', '18.3'),
      p('**אי-ויתור.** אי-אכיפה של זכות אינה ויתור עליה.', '18.4'),
      p('**שפה.** התנאים מתפרסמים בעברית ובאנגלית. במקרה של סתירה, הנוסח העברי גובר.', '18.5'),
      p('**הודעות.** המפעיל רשאי להודיע לכם באפליקציה או בדוא״ל של חשבונכם. הודעות למפעיל: support.bettercalc@gmail.com.', '18.6'),
    ] },
  ],
};

export const LEGAL_CONTENT: Record<LegalKind, Record<Language, LegalDocument>> = {
  privacy: { en: privacyEn, he: privacyHe },
  terms: { en: termsEn, he: termsHe },
};

/** Every text of a document as plain strings, for checks and counting. */
export function legalDocumentStrings(doc: LegalDocument): string[] {
  const out = [doc.title, doc.meta];
  if (doc.notice) out.push(doc.notice.title, ...doc.notice.points, doc.notice.closing);
  for (const s of doc.sections) {
    out.push(s.heading);
    for (const b of s.blocks) {
      if (b.kind === 'p') out.push(b.text);
      else if (b.kind === 'ul') out.push(...b.items);
      else if (b.kind === 'sub') out.push(...b.items.map((i) => i.text));
      else out.push(...b.head, ...b.rows.flat());
    }
  }
  return out;
}

/** The distinct placeholders a document still contains. */
export function legalPlaceholders(doc: LegalDocument): string[] {
  const found = new Set<string>();
  for (const text of legalDocumentStrings(doc)) for (const m of text.matchAll(/\[\[(.+?)\]\]/g)) found.add(m[1]);
  return [...found];
}
