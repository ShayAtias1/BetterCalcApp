/**
 * The Terms of Service and Privacy Policy (Hebrew and English), from the legal review v0.3
 * (docs/legal/BetterCalc-legal-review-v0.3.md), checked against what the application does.
 *
 * Conventions:
 *  - `[[…]]` marks a fact the owner must still supply. Nothing about the operator is invented. While any placeholder
 *    remains the texts are a draft: LEGAL_DOC_VERSION stays 'pending' and the pages say so (see legalDocs.ts and
 *    tests/supabase/legalContent.test.ts, which refuses a published version that still contains one).
 *  - `**…**` is bold.
 *  - Lawyer notes and technical "verify" notes from the review file are not part of the public text.
 */
import type { Language } from '../../i18n';
import type { LegalKind } from './legalDocs';

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
  /** "Last updated / Version" line; placeholders until published. */
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
  meta: 'Last updated: [[date]] · Version: [[version]]',
  sections: [
    { heading: '1. Who we are', blocks: [p('BetterCalc (“we”, “us”) is operated by [[owner’s full legal name]], a VAT-exempt sole proprietor (עוסק פטור), ID / business no. [[number]], [[address]]. Privacy contact: [[privacy e-mail]].')] },
    { heading: '2. The short version', blocks: [ul(
      'Your plans and projects are stored **in your own browser**, on your device. We do not receive them when you work.',
      'An account is optional. If you sign in with Google, we store basic account details (Section 4).',
      'We do not currently collect usage statistics or analytics (Section 5).',
      'AI features, cloud backup and payments are **not available yet**. Nothing described in Section 8 happens today.',
    )] },
    { heading: '3. Data that stays on your device', status: 'active', blocks: [p('Plans (PDF files), projects, rooms, measurements, quantities, markups, comparisons and exports are stored in your browser’s storage (IndexedDB) and saved to your device when you export. We cannot see, access, recover or delete this data. Your browser may delete it if storage runs low or you clear site data. Signing in, signing out or deleting your account does not read, move or delete it. Plans may contain information about other people (for example owners’ names or site addresses); you control that information and are responsible for using it lawfully.')] },
    { heading: '4. Account data (optional)', status: 'active', blocks: [
      p('If you sign in with Google, we receive and store, through our provider Supabase:'),
      ul(
        'user ID, e-mail address and name, and the basic profile details Google shares with sign-in apps (such as a profile picture link);',
        'the display name you confirm;',
        'the date, time and version of the Terms and Privacy Policy you accepted;',
        'technical records created by the authentication service, such as sign-in times and the IP address and browser used to sign in;',
        'account status records (for example an empty credit balance) and, if you request deletion, the deletion request.',
      ),
      p('Purpose: to create and secure your account, keep you signed in, record your acceptance of these documents, and prepare account features. You are not legally required to give us this data; without it you can still use BetterCalc as a guest. We never receive your Google password. Your language choice is kept in your browser, not in your account.'),
    ] },
    { heading: '5. Usage statistics', status: 'active', blocks: [
      p('During the Early Access period BetterCalc does not run product analytics. The app does not load an analytics tool, does not send usage events to any analytics provider, and does not create or store an analytics identifier in your browser. Any analytics identifier left in your browser by an earlier version is removed when the app opens.'),
      p('Before analytics is switched on again, we will update this policy and show you what changes.'),
    ] },
    { heading: '6. Browser storage', status: 'active', blocks: [p('We use your browser’s local storage and IndexedDB (not advertising cookies) for: your projects, your sign-in session, language and display preferences, and a local record of your acknowledgement of the Terms. If CAPTCHA protection is enabled, Cloudflare Turnstile may process browser signals to detect bots.')] },
    { heading: '7. Who processes data for us', blocks: [
      table(['Provider', 'Role', 'Location'],
        ['Supabase', 'Authentication, database, file storage', 'EU (Ireland)'],
        ['Google', 'Sign-in', '[[global / US]]'],
        ['Netlify', 'Website hosting and delivery', '[[global CDN / US]]'],
        ['Cloudflare', 'CAPTCHA (only if enabled)', '[[global]]']),
      p('Some providers operate outside Israel. We transfer data to them under [[legal basis: consent / contractual undertakings]].'),
      p('We do not sell personal data and do not share it for advertising. We may disclose data if required by law or a competent authority, or to protect our rights in a legal proceeding.'),
    ] },
    { heading: '8. Features not available yet', status: 'soon', blocks: [
      p('The following exist in the code but are **switched off**. Before any of them is enabled, we will update this policy, show you what changes, and ask for your agreement where required.'),
      ul(
        '**Cloud backup:** an optional copy of your projects (including plan files) stored in your account in private storage. [[Retention, and what happens after a subscription ends]].',
        '**AI assistance** (for example suggesting rooms, openings or revision changes): would send selected plan pages to an AI provider [[provider, location, retention, training use]]. Nothing is sent to any AI service today.',
        '**Payments and subscriptions:** would be handled by a payment provider [[name]]; we would store billing details for invoices (name, tax ID, address) and payment records, which we may have to keep for [[period under tax law]] even after account deletion. No payment details are collected today.',
      ),
    ] },
    { heading: '9. How long we keep data', blocks: [ul(
      'Account data: until you delete your account. After a deletion request, a 7-day waiting period applies (you can cancel); then account data and any cloud files are deleted.',
      'A minimal record that an account was deleted (internal IDs, no name or e-mail) is kept in our security log for [[period]].',
      'Backups kept by our providers may persist for up to [[period]] before being overwritten.',
    )] },
    { heading: '10. Your rights', blocks: [p('Under Israeli law you may ask to access the personal data we hold about you and to correct or delete data that is inaccurate, incomplete, unclear or outdated. You can also delete your account yourself from the account page, and change your display name at any time. Send requests to [[privacy e-mail]]; we will respond within the period required by law. If you are in the EU, you may have additional rights under the GDPR.')] },
    { heading: '11. Security', blocks: [p('We use encrypted connections, per-user access rules on account data, private storage, restricted administrative access and a strict content-security policy. Plans stay on your device, which also means their security depends on your device and browser. No system is completely secure; if a security incident affects your data, we will act as required by law.')] },
    { heading: '12. Age', blocks: [p('BetterCalc is intended for users aged 18 and over.')] },
    { heading: '13. Changes', blocks: [p('We will publish changes on this page with a new date and version. For material changes we will notify signed-in users in the app [[or by e-mail]] before they take effect and, where required, ask for renewed consent.')] },
  ],
};

// ===================================================================================== Terms, English
const termsEn: LegalDocument = {
  title: 'Terms of Service',
  meta: 'Last updated: [[date]] · Version: [[version]]',
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
      p('BetterCalc (“the Service”) is operated by **[[owner’s full legal name]]**, an individual (natural person) residing in Israel, doing business as a VAT-exempt sole proprietor (עוסק פטור), ID / business no. [[number]], address for notices: [[address]], e-mail: [[e-mail]] (“the Operator”, “we”). The Operator is not a company or other corporate body.', '1.1'),
      p('By using the Service, with or without an account, you agree to these Terms and to the Privacy Policy. If you do not agree, do not use the Service.', '1.2'),
      p('You must be at least 18 and legally competent. If you use the Service for a business, you confirm you may bind that business, and “you” includes it.', '1.3'),
      p('The Service is intended for professional use in the construction field. If you are a consumer under the Consumer Protection Law, 5741-1981, nothing in these Terms limits rights that law gives you and that cannot be waived.', '1.4'),
    ] },
    { heading: '2. Nature of the Service', status: 'active', blocks: [
      p('The Service is **strictly an auxiliary quantity-calculation tool** based on PDF drawings. It runs in your browser and applies calculations to the drawings, scales, calibration, selections and settings that **you** provide.', '2.1'),
      p('The Service is provided **free of charge** [[during an initial / beta period]]. The Operator does not review your drawings, inputs or results, does not advise you, and no professional, advisory, agency, employment or fiduciary relationship arises between you and the Operator.', '2.2'),
      p('No statement on the website, in marketing, in the Service or in support communications is a promise or warranty of accuracy, unless it is made in a written document signed by the Operator.', '2.3'),
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
      p('Drawings, projects and Reports are stored only in your browser storage and on your device. The Operator does not receive, hold or back them up, and cannot access, restore or recover them.', '7.1'),
      p('Browser storage can be erased by the browser, by clearing site data, by private browsing, by device failure or replacement, or by software updates. **You are responsible for keeping current backups** using the export and backup tools provided.', '7.2'),
      p('To the extent permitted by law, the Operator is not liable for loss, corruption or unavailability of data stored on your device, including where caused by a software error, except as set out in Section 12.4.', '7.3'),
    ] },
    { heading: '8. Accounts', status: 'active', blocks: [
      p('Accounts are optional and created through Google sign-in. Keep your Google account secure; you are responsible for activity under your account.', '8.1'),
      p('You may delete your account at any time, as described in the Privacy Policy. Deleting it does not delete data on your devices.', '8.2'),
    ] },
    { heading: '9. Acceptable use', status: 'active', blocks: [p('You must not: interfere with, overload, probe or bypass the Service’s security or limits; access other users’ data; reverse-engineer the Service except as permitted by law; use automated means to abuse it; or use it unlawfully or with content you have no right to use.')] },
    { heading: '10. Your content and the Operator’s intellectual property', status: 'active', blocks: [
      p('You own your drawings, projects, measurements and Reports. The Operator claims no ownership.', '10.1'),
      p('You confirm that you have the rights and permissions needed to use the drawings you load, including under copyright and any confidentiality or tender obligations.', '10.2'),
      p('If a future feature you choose requires the Operator to store or process your content (such as cloud backup or AI), you grant the Operator a limited, non-exclusive licence to do so solely to provide that feature to you.', '10.3'),
      p('The software, design and name “BetterCalc” belong to the Operator or the Operator’s licensors. Open-source components are licensed under their own terms, listed at [[licences page]]. You receive a personal, non-transferable, revocable right to use the Service under these Terms.', '10.4'),
      p('The Operator may use feedback you send without obligation, and may use aggregated statistics that do not contain your content.', '10.5'),
    ] },
    { heading: '11. Service provided “as is”', blocks: [
      p('The Service is provided free of charge, as a general auxiliary tool, on inputs you control, with results you are required to verify. It is therefore provided **“as is” and “as available”**. To the extent permitted by law, the Operator gives no warranty or representation, express or implied, as to accuracy, completeness, reliability, availability, error-free operation or fitness for a particular purpose.', '11.1'),
      p('The Operator may change, suspend or discontinue any feature. If the Service as a whole is discontinued, the Operator will try to give at least [[30]] days’ notice so that you can export your data.', '11.2'),
    ] },
    { heading: '12. Exclusion of liability', blocks: [
      p('**Financial losses.** To the fullest extent permitted by law, the Operator is not liable for any financial loss or damage, **direct or indirect**, arising from or connected with the use of, inability to use, or reliance on the Service or any result or Report, including:', '12.1'),
      sub(['(a)', 'pricing, estimating, bidding or tender mistakes;'], ['(b)', 'quantities ordered, over- or under-ordering, wastage or surplus of materials;'], ['(c)', 'construction delays, rework, acceleration, idle time or remedial work;'], ['(d)', 'loss of profit, revenue, business, contracts, tenders or goodwill;'], ['(e)', 'penalties, damages, compensation or other amounts payable to clients, contractors, suppliers or any other third party, and disputes with them;'], ['(f)', 'loss of data stored on your device.']),
      p('**Third-party claims.** To the fullest extent permitted by law, the Operator is not liable to you for any claim made against you by a third party in connection with a result or Report, and you are responsible for any such claim as between you and the Operator (see also Section 13).', '12.2'),
      p('**Basis.** You acknowledge that: the Service is a free auxiliary tool; PDF-based measurement is inherently imprecise; you, not the Operator, choose the drawings, scales and inputs; you are able and required to verify all results before relying on them; the Operator has no access to your drawings or projects; and the Operator does not charge for, and could not bear, the risk of your business decisions. This Section is a fundamental basis on which the Service is offered free of charge.', '12.3'),
      p('**What is not excluded.** Nothing in these Terms excludes or limits the Operator’s liability: (a) for malice, fraud or deceit; (b) for gross negligence; (c) for death or bodily injury caused by negligence; (d) for any obligation or liability that cannot be excluded or limited under Israeli law, including mandatory duties under privacy and data-protection law; or (e) for any right you have as a consumer that cannot be waived.', '12.4'),
      p('**Fallback if the exclusion is not enforced.** If, despite Section 12.1, the Operator is held liable for a loss, then to the extent permitted by law: (a) liability is limited to direct damage that was reasonably foreseeable when you started using the Service and that you prove; (b) it is reduced in proportion to your own contribution to the loss, including any failure to verify results as required by Section 4; (c) you must take reasonable steps to mitigate the loss; and (d) no punitive or exemplary damages apply.', '12.5'),
      p('**Who is protected.** This Section protects the Operator personally and anyone acting on the Operator’s behalf, who may rely on it.', '12.6'),
      p('**Notice of claims.** If you believe you have a claim, please notify the Operator in writing at [[e-mail]] promptly, and in any case within [[6/12]] months of becoming aware of it, so that the problem can be investigated and, where possible, fixed.', '12.7'),
    ] },
    { heading: '13. Indemnity (business users)', blocks: [p('If you use the Service in the course of a business, you will indemnify the Operator for reasonable costs, losses and legal fees arising from a third-party claim caused by: (a) content you loaded without the right to do so; (b) a Report or result you gave to a third party, or its use by that third party; or (c) your breach of these Terms. The Operator will notify you of the claim promptly and allow you to take part in the defence. This Section does not apply to the extent the claim results from a matter listed in Section 12.4(a)–(c).')] },
    { heading: '14. Features not available yet', status: 'soon', blocks: [p('AI assistance, cloud backup, paid plans, credits and payments are **not offered today**, and nothing is charged. Before any of them becomes available, the Operator will publish its specific terms, which you must accept before using it: price, billing, renewal, cancellation and refunds, and for AI, the provider and how outputs must be reviewed. The Operator is a VAT-exempt dealer (עוסק פטור), so prices will not include VAT. The exclusions in Section 12 will be reviewed for paid features before launch.')] },
    { heading: '15. Changes to these Terms', blocks: [
      p('Changes will be published with a new date and version. For material changes, signed-in users will be notified in the app [[and by e-mail]] at least [[14/30]] days before the changes take effect. Changes required by law or for security may take effect sooner.', '15.1'),
      p('If you do not agree, you may stop using the Service and delete your account. Continued use after the effective date means acceptance. Changes do not apply to claims that arose before they took effect.', '15.2'),
    ] },
    { heading: '16. Termination', blocks: [p('You may stop using the Service at any time. The Operator may suspend or end your access if you materially breach these Terms or if the law requires it, with notice where reasonable. Sections 3–7, 10–13 and 17–18 survive termination.')] },
    { heading: '17. Governing law and jurisdiction', blocks: [
      p('These Terms are governed by the laws of the State of Israel.', '17.1'),
      p('The competent courts in Israel have jurisdiction. [[Option for business users only: the competent courts in the [district] district have exclusive jurisdiction.]] No exclusive forum is imposed on consumers.', '17.2'),
    ] },
    { heading: '18. General', blocks: [
      p('**Modification rather than voiding.** If a court finds any provision invalid or unenforceable in whole or in part, including a provision of Section 12, that provision applies to the maximum extent permitted. Section 12.5 and the rest of these Terms remain in force.', '18.1'),
      p('**Assignment.** The Operator may transfer these Terms and the Service to a company the Operator controls, or to a buyer of the Service, with notice to you. You may not transfer your rights without the Operator’s consent.', '18.2'),
      p('**Entire agreement.** These Terms and the Privacy Policy are the entire agreement about the Service.', '18.3'),
      p('**No waiver.** Not enforcing a right is not a waiver of it.', '18.4'),
      p('**Language.** These Terms are published in Hebrew and English. If they conflict, the Hebrew version prevails.', '18.5'),
      p('**Notices.** The Operator may notify you in the app or by your account e-mail. Notices to the Operator: [[e-mail]] / [[address]].', '18.6'),
    ] },
  ],
};

// ===================================================================================== Privacy, Hebrew
const privacyHe: LegalDocument = {
  title: 'מדיניות פרטיות',
  meta: 'עדכון אחרון: [[תאריך]] · גרסה: [[גרסה]]',
  sections: [
    { heading: '1. מי אנחנו', blocks: [p('BetterCalc (“אנחנו”) מופעלת על ידי [[שם משפטי מלא של הבעלים]], עוסק פטור, ת.ז. / מס’ עוסק [[מספר]], [[כתובת]]. פנייה בנושאי פרטיות: [[דוא״ל פרטיות]].')] },
    { heading: '2. בקצרה', blocks: [ul(
      'התוכניות והפרויקטים שלכם נשמרים **בדפדפן שלכם**, במכשיר שלכם. איננו מקבלים אותם בזמן העבודה.',
      'חשבון הוא אופציונלי. אם תתחברו עם Google, נשמור פרטי חשבון בסיסיים (סעיף 4).',
      'כיום איננו אוספים סטטיסטיקות שימוש או נתוני אנליטיקה (סעיף 5).',
      'יכולות בינה מלאכותית, גיבוי בענן ותשלומים **אינם זמינים עדיין**. דבר ממה שמתואר בסעיף 8 אינו מתבצע היום.',
    )] },
    { heading: '3. מידע שנשאר במכשיר שלכם', status: 'active', blocks: [p('תוכניות (קובצי PDF), פרויקטים, חדרים, מדידות, כמויות, סימונים, השוואות וייצואים נשמרים באחסון הדפדפן (IndexedDB) ובמכשיר שלכם כשאתם מייצאים. איננו יכולים לראות, לגשת, לשחזר או למחוק מידע זה. הדפדפן עשוי למחוק אותו כשהאחסון מתמלא או כשמנקים נתוני אתר. התחברות, התנתקות או מחיקת חשבון אינן קוראות, מעבירות או מוחקות אותו. תוכניות עשויות לכלול מידע על אחרים (למשל שמות בעלים או כתובות אתרים); המידע הזה בשליטתכם ואתם אחראים לשימוש חוקי בו.')] },
    { heading: '4. נתוני חשבון (אופציונלי)', status: 'active', blocks: [
      p('אם תתחברו עם Google, נקבל ונשמור, באמצעות הספק שלנו Supabase:'),
      ul(
        'מזהה משתמש, כתובת דוא״ל ושם, ופרטי הפרופיל הבסיסיים ש-Google מעבירה לאפליקציות התחברות (כגון קישור לתמונת פרופיל);',
        'שם התצוגה שאישרתם;',
        'המועד והגרסה של תנאי השימוש ומדיניות הפרטיות שאישרתם;',
        'רשומות טכניות של שירות האימות, כגון מועדי התחברות וכתובת IP ודפדפן ששימשו להתחברות;',
        'רשומות מצב חשבון (למשל יתרת קרדיטים ריקה), ואם ביקשתם מחיקה, בקשת המחיקה.',
      ),
      p('מטרה: יצירת החשבון ואבטחתו, שמירת החיבור, תיעוד הסכמתכם למסמכים אלה והכנת יכולות חשבון. אינכם חייבים על פי דין למסור לנו מידע זה; בלעדיו ניתן להמשיך להשתמש ב-BetterCalc כאורח. איננו מקבלים את סיסמת Google שלכם. בחירת השפה נשמרת בדפדפן שלכם ולא בחשבון.'),
    ] },
    { heading: '5. סטטיסטיקות שימוש', status: 'active', blocks: [
      p('בתקופת הגישה המוקדמת BetterCalc אינה מפעילה אנליטיקת מוצר. האפליקציה אינה טוענת כלי אנליטיקה, אינה שולחת אירועי שימוש לספק אנליטיקה, ואינה יוצרת או שומרת בדפדפן מזהה אנליטיקה. מזהה אנליטיקה שנשאר בדפדפן מגרסה קודמת מוסר עם פתיחת האפליקציה.'),
      p('לפני שהאנליטיקה תופעל מחדש נעדכן מדיניות זו ונציג מה משתנה.'),
    ] },
    { heading: '6. אחסון בדפדפן', status: 'active', blocks: [p('אנו משתמשים באחסון המקומי וב-IndexedDB של הדפדפן (לא בעוגיות פרסום) עבור: הפרויקטים, חיבור המשתמש, העדפות שפה ותצוגה, ותיעוד מקומי של אישורכם את תנאי השימוש. אם מופעלת הגנת CAPTCHA, ‏Cloudflare Turnstile עשויה לעבד נתוני דפדפן לזיהוי בוטים.')] },
    { heading: '7. מי מעבד מידע עבורנו', blocks: [
      table(['ספק', 'תפקיד', 'מיקום'],
        ['Supabase', 'אימות, מסד נתונים, אחסון קבצים', 'האיחוד האירופי (אירלנד)'],
        ['Google', 'התחברות', '[[עולמי / ארה״ב]]'],
        ['Netlify', 'אחסון והגשת האתר', '[[CDN עולמי / ארה״ב]]'],
        ['Cloudflare', 'CAPTCHA (רק אם הופעל)', '[[עולמי]]']),
      p('חלק מהספקים פועלים מחוץ לישראל. העברת המידע אליהם נעשית על בסיס [[בסיס משפטי: הסכמה / התחייבות חוזית]].'),
      p('איננו מוכרים מידע אישי ואיננו משתפים אותו לצורכי פרסום. ייתכן שנמסור מידע אם הדין או רשות מוסמכת יחייבו זאת, או כדי להגן על זכויותינו בהליך משפטי.'),
    ] },
    { heading: '8. יכולות שאינן זמינות עדיין', status: 'soon', blocks: [
      p('היכולות הבאות קיימות בקוד אך **כבויות**. לפני הפעלת כל אחת מהן נעדכן מדיניות זו, נציג מה משתנה ונבקש את הסכמתכם במקום שנדרש.'),
      ul(
        '**גיבוי בענן:** עותק אופציונלי של הפרויקטים (כולל קובצי התוכניות) בחשבונכם, באחסון פרטי. [[תקופת שמירה ומה קורה בסיום מנוי]].',
        '**סיוע בינה מלאכותית** (למשל הצעת חדרים, פתחים או שינויים בין גרסאות): ישלח עמודי תוכנית נבחרים לספק בינה מלאכותית [[ספק, מיקום, תקופת שמירה, שימוש לאימון]]. היום שום דבר אינו נשלח לשירות בינה מלאכותית.',
        '**תשלומים ומנויים:** יטופלו על ידי ספק סליקה [[שם]]; נשמור פרטי חיוב לחשבוניות (שם, מספר עוסק/ח.פ., כתובת) ורשומות תשלום, שייתכן שנידרש לשמור למשך [[תקופה לפי דיני המס]] גם לאחר מחיקת החשבון. היום לא נאספים פרטי תשלום.',
      ),
    ] },
    { heading: '9. משך שמירת המידע', blocks: [ul(
      'נתוני חשבון: עד למחיקת החשבון. לאחר בקשת מחיקה חלה תקופת המתנה של 7 ימים (שבה ניתן לבטל); לאחר מכן נמחקים נתוני החשבון וקובצי הענן.',
      'רשומה מינימלית על כך שחשבון נמחק (מזהים פנימיים, ללא שם או דוא״ל) נשמרת ביומן האבטחה למשך [[תקופה]].',
      'גיבויים אצל הספקים עשויים להישמר עד [[תקופה]] לפני שיידרסו.',
    )] },
    { heading: '10. הזכויות שלכם', blocks: [p('לפי הדין בישראל באפשרותכם לבקש לעיין במידע האישי שאנו מחזיקים עליכם, ולבקש לתקן או למחוק מידע שאינו נכון, שלם, ברור או מעודכן. תוכלו גם למחוק את החשבון בעצמכם מדף החשבון ולשנות את שם התצוגה בכל עת. בקשות יש לשלוח אל [[דוא״ל פרטיות]]; נשיב בתוך התקופה הקבועה בדין. אם אתם באיחוד האירופי, ייתכן שיש לכם זכויות נוספות לפי ה-GDPR.')] },
    { heading: '11. אבטחת מידע', blocks: [p('אנו משתמשים בחיבורים מוצפנים, בכללי גישה פרטניים לכל משתמש על נתוני החשבון, באחסון פרטי, בהגבלת גישה ניהולית ובמדיניות אבטחת תוכן מחמירה. התוכניות נשארות במכשירכם, ולכן אבטחתן תלויה גם במכשיר ובדפדפן שלכם. אין מערכת מאובטחת לחלוטין; אם אירוע אבטחה ישפיע על המידע שלכם, נפעל כנדרש בדין.')] },
    { heading: '12. גיל', blocks: [p('BetterCalc מיועדת למשתמשים בני 18 ומעלה.')] },
    { heading: '13. שינויים', blocks: [p('שינויים יפורסמו בדף זה עם תאריך וגרסה חדשים. על שינויים מהותיים נודיע למשתמשים מחוברים באפליקציה [[או בדוא״ל]] לפני כניסתם לתוקף, ונבקש הסכמה מחודשת במקום שנדרש.')] },
  ],
};

// ===================================================================================== Terms, Hebrew
const termsHe: LegalDocument = {
  title: 'תנאי שימוש',
  meta: 'עדכון אחרון: [[תאריך]] · גרסה: [[גרסה]]',
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
      p('BetterCalc (“השירות”) מופעלת על ידי **[[שם משפטי מלא של הבעלים]]**, אדם פרטי (יחיד) תושב ישראל, הפועל כעוסק פטור, ת.ז. / מס’ עוסק [[מספר]], מען להודעות: [[כתובת]], דוא״ל: [[דוא״ל]] (“המפעיל”). המפעיל אינו חברה או תאגיד.', '1.1'),
      p('בשימוש בשירות, עם חשבון או בלעדיו, אתם מסכימים לתנאים אלה ולמדיניות הפרטיות. אם אינכם מסכימים, אל תשתמשו בשירות.', '1.2'),
      p('עליכם להיות בני 18 לפחות ובעלי כשרות משפטית. אם אתם משתמשים בשירות עבור עסק, אתם מאשרים שאתם מוסמכים לחייב אותו, ו“אתם” כולל אותו.', '1.3'),
      p('השירות מיועד לשימוש מקצועי בתחום הבנייה. אם אתם צרכנים כמשמעותם בחוק הגנת הצרכן, התשמ״א-1981, אין בתנאים אלה כדי לגרוע מזכויות שחוק זה מקנה לכם ושאין לוותר עליהן.', '1.4'),
    ] },
    { heading: '2. מהות השירות', status: 'active', blocks: [
      p('השירות הוא **כלי עזר לחישוב כמויות בלבד**, המבוסס על תוכניות PDF. הוא פועל בדפדפן ומבצע חישובים על בסיס התוכניות, קני המידה, הכיול, הבחירות וההגדרות ש**אתם** מספקים.', '2.1'),
      p('השירות ניתן **ללא תשלום** [[בתקופת השקה / בטא]]. המפעיל אינו בודק את התוכניות, הנתונים או התוצאות שלכם ואינו מייעץ לכם, ולא נוצרים בינכם לבין המפעיל יחסי ייעוץ מקצועי, שליחות, עבודה או נאמנות.', '2.2'),
      p('שום אמירה באתר, בשיווק, בשירות או בתמיכה אינה התחייבות או מצג לדיוק, אלא אם נעשתה במסמך בכתב חתום על ידי המפעיל.', '2.3'),
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
      p('תוכניות, פרויקטים ודוחות נשמרים רק באחסון הדפדפן ובמכשיר שלכם. המפעיל אינו מקבל, מחזיק או מגבה אותם, ואינו יכול לגשת אליהם, לשחזר או לשקם אותם.', '7.1'),
      p('אחסון הדפדפן עלול להימחק על ידי הדפדפן, בניקוי נתוני אתר, בגלישה פרטית, בתקלה או בהחלפת מכשיר, או בעדכוני תוכנה. **האחריות לשמירת גיבויים עדכניים** באמצעות כלי הייצוא והגיבוי שבשירות היא שלכם.', '7.2'),
      p('במידה שהדין מתיר, המפעיל אינו אחראי לאובדן, לשיבוש או לאי-זמינות של מידע השמור במכשירכם, לרבות כתוצאה מתקלת תוכנה, למעט כאמור בסעיף 12.4.', '7.3'),
    ] },
    { heading: '8. חשבונות', status: 'active', blocks: [
      p('חשבון הוא אופציונלי ונפתח בהתחברות עם Google. שמרו על אבטחת חשבון Google שלכם; אתם אחראים לפעילות בחשבונכם.', '8.1'),
      p('ניתן למחוק את החשבון בכל עת כמתואר במדיניות הפרטיות. מחיקתו אינה מוחקת מידע במכשיריכם.', '8.2'),
    ] },
    { heading: '9. שימוש מותר', status: 'active', blocks: [p('אסור: לשבש, להעמיס, לבחון או לעקוף את האבטחה או המגבלות של השירות; לגשת למידע של משתמשים אחרים; לבצע הנדסה לאחור אלא במידה שהדין מתיר; להשתמש באמצעים אוטומטיים לניצול לרעה; או להשתמש בשירות שלא כדין או עם תוכן שאין לכם זכות להשתמש בו.')] },
    { heading: '10. התוכן שלכם והקניין הרוחני של המפעיל', status: 'active', blocks: [
      p('התוכניות, הפרויקטים, המדידות והדוחות שלכם שייכים לכם. המפעיל אינו טוען לבעלות עליהם.', '10.1'),
      p('אתם מצהירים שיש לכם הזכויות וההרשאות הנדרשות לשימוש בתוכניות שאתם טוענים, לרבות לפי דיני זכויות יוצרים וחובות סודיות או מכרז.', '10.2'),
      p('אם יכולת עתידית שתבחרו (כגון גיבוי בענן או בינה מלאכותית) תחייב את המפעיל לשמור או לעבד את התוכן שלכם, אתם מעניקים למפעיל רישיון מוגבל ולא בלעדי לעשות זאת אך ורק לשם מתן אותה יכולת לכם.', '10.3'),
      p('התוכנה, העיצוב והשם “BetterCalc” שייכים למפעיל או למעניקי הרישיון שלו. רכיבי קוד פתוח כפופים לרישיונותיהם, המפורטים ב-[[דף רישיונות]]. אתם מקבלים זכות אישית, שאינה ניתנת להעברה וניתנת לביטול, להשתמש בשירות לפי תנאים אלה.', '10.4'),
      p('המפעיל רשאי להשתמש במשוב שתשלחו ללא התחייבות, ובסטטיסטיקות מצטברות שאינן כוללות את התוכן שלכם.', '10.5'),
    ] },
    { heading: '11. השירות ניתן “כמות שהוא” (AS IS)', blocks: [
      p('השירות ניתן ללא תשלום, ככלי עזר כללי, על בסיס נתונים שבשליטתכם ועם תוצאות שעליכם לאמת. לכן הוא ניתן **“כמות שהוא” (AS IS) ו“כפי שהוא זמין”**. במידה שהדין מתיר, המפעיל אינו נותן כל מצג או התחייבות, מפורשים או משתמעים, בדבר דיוק, שלמות, אמינות, זמינות, פעולה ללא תקלות או התאמה למטרה מסוימת.', '11.1'),
      p('המפעיל רשאי לשנות, להשעות או להפסיק יכולת כלשהי. אם השירות כולו יופסק, המפעיל ישתדל לתת הודעה של [[30]] ימים לפחות כדי שתוכלו לייצא את המידע.', '11.2'),
    ] },
    { heading: '12. פטור מאחריות', blocks: [
      p('**נזקים כספיים.** במידה המרבית שהדין מתיר, המפעיל אינו אחראי לכל הפסד או נזק כספי, **ישיר או עקיף**, הנובע מהשימוש בשירות, מאי-היכולת להשתמש בו או מהסתמכות עליו או על תוצאה או דוח כלשהם, או הקשור לכך, לרבות:', '12.1'),
      sub(['(א)', 'טעויות בתמחור, באומדן, בהצעות מחיר או במכרזים;'], ['(ב)', 'כמויות שהוזמנו, הזמנה ביתר או בחסר, פחת או עודפי חומרים;'], ['(ג)', 'עיכובי ביצוע, עבודה חוזרת, האצה, זמן השבתה או עבודות תיקון;'], ['(ד)', 'אובדן רווח, הכנסה, עסקים, חוזים, מכרזים או מוניטין;'], ['(ה)', 'קנסות, פיצויים, תשלומים או סכומים אחרים שיש לשלם ללקוחות, לקבלנים, לספקים או לכל צד שלישי אחר, ומחלוקות עמם;'], ['(ו)', 'אובדן מידע השמור במכשירכם.']),
      p('**תביעות צד שלישי.** במידה המרבית שהדין מתיר, המפעיל אינו אחראי כלפיכם לכל תביעה שתוגש נגדכם על ידי צד שלישי בקשר לתוצאה או לדוח. ביחסים בינכם לבין המפעיל, האחריות לכל תביעה כזו היא שלכם (ראו גם סעיף 13).', '12.2'),
      p('**הבסיס לפטור.** אתם מאשרים כי: השירות הוא כלי עזר חינמי; מדידה מתוך PDF אינה מדויקת מטבעה; אתם, ולא המפעיל, בוחרים את התוכניות, קני המידה והנתונים; ביכולתכם ועליכם לאמת את כל התוצאות לפני הסתמכות עליהן; למפעיל אין גישה לתוכניות או לפרויקטים שלכם; והמפעיל אינו גובה תמורה בעבור הסיכון של החלטותיכם העסקיות ואינו יכול לשאת בו. סעיף זה הוא בסיס יסודי שעליו השירות מוצע ללא תשלום.', '12.3'),
      p('**מה אינו מוחרג.** אין בתנאים אלה כדי לפטור או להגביל את אחריות המפעיל: (א) לזדון, תרמית או הטעיה; (ב) לרשלנות רבתי; (ג) למוות או לנזק גוף שנגרמו ברשלנות; (ד) לכל חובה או אחריות שאין לפטור ממנה או להגבילה לפי הדין בישראל, לרבות חובות מחייבות לפי דיני הגנת הפרטיות; או (ה) לכל זכות שלכם כצרכנים שאין לוותר עליה.', '12.4'),
      p('**הוראת גיבוי אם הפטור לא יאוכף.** אם, על אף האמור בסעיף 12.1, ייקבע כי המפעיל אחראי לנזק, אזי במידה שהדין מתיר: (א) האחריות תוגבל לנזק ישיר שהיה צפוי באופן סביר בעת שהתחלתם להשתמש בשירות ושהוכח על ידיכם; (ב) היא תופחת בהתאם לחלקכם בגרימת הנזק, לרבות אי-אימות התוצאות כנדרש בסעיף 4; (ג) עליכם לנקוט צעדים סבירים להקטנת הנזק; ו-(ד) לא יחולו פיצויים עונשיים.', '12.5'),
      p('**על מי חלה ההגנה.** סעיף זה מגן על המפעיל באופן אישי ועל כל מי שפועל מטעמו, הרשאים להסתמך עליו.', '12.6'),
      p('**הודעה על טענה.** אם לדעתכם קמה לכם טענה, אנא הודיעו למפעיל בכתב ב-[[דוא״ל]] בהקדם, ובכל מקרה בתוך [[6/12]] חודשים מהיום שנודע לכם עליה, כדי שניתן יהיה לבדוק את הבעיה ובמידת האפשר לתקנה.', '12.7'),
    ] },
    { heading: '13. שיפוי (משתמשים עסקיים)', blocks: [p('אם אתם משתמשים בשירות במסגרת עסק, תשפו את המפעיל בגין עלויות, הפסדים ושכר טרחה סבירים הנובעים מתביעת צד שלישי שנגרמה בשל: (א) תוכן שטענתם ללא זכות; (ב) דוח או תוצאה שמסרתם לצד שלישי, או השימוש שעשה בהם; או (ג) הפרת תנאים אלה. המפעיל יודיע לכם על התביעה בהקדם ויאפשר לכם להשתתף בהגנה. סעיף זה לא יחול במידה שהתביעה נובעת מעניין המנוי בסעיף 12.4(א)–(ג).')] },
    { heading: '14. יכולות שאינן זמינות עדיין', status: 'soon', blocks: [p('סיוע בינה מלאכותית, גיבוי בענן, תוכניות בתשלום, קרדיטים ותשלומים **אינם מוצעים היום**, ושום סכום אינו מחויב. לפני שאחת מהן תהיה זמינה, המפעיל יפרסם את התנאים הספציפיים שלה, ותידרשו לאשר אותם לפני השימוש. התנאים יכללו מחיר, חיוב, חידוש, ביטול והחזרים, ולגבי בינה מלאכותית את הספק ואת אופן בדיקת התוצאות. המפעיל הוא עוסק פטור, ולכן מחיריו לא יכללו מע״מ. הפטורים שבסעיף 12 ייבחנו מחדש לגבי יכולות בתשלום לפני השקתן.')] },
    { heading: '15. שינויים בתנאים', blocks: [
      p('שינויים יפורסמו עם תאריך וגרסה חדשים. על שינויים מהותיים תימסר הודעה למשתמשים מחוברים באפליקציה [[ובדוא״ל]] לפחות [[14/30]] ימים לפני כניסתם לתוקף. שינויים הנדרשים לפי דין או מטעמי אבטחה עשויים להיכנס לתוקף מוקדם יותר.', '15.1'),
      p('אם אינכם מסכימים, תוכלו להפסיק את השימוש ולמחוק את החשבון. המשך שימוש לאחר מועד התחולה מהווה הסכמה. שינויים לא יחולו על טענות שקמו לפני כניסתם לתוקף.', '15.2'),
    ] },
    { heading: '16. סיום', blocks: [p('אתם רשאים להפסיק להשתמש בשירות בכל עת. המפעיל רשאי להשעות או להפסיק את גישתכם אם הפרתם תנאים אלה הפרה מהותית או אם הדין מחייב זאת, בהודעה מראש במקום שהדבר סביר. סעיפים 3–7, 10–13 ו-17–18 יחולו גם לאחר הסיום.')] },
    { heading: '17. דין חל וסמכות שיפוט', blocks: [
      p('על תנאים אלה יחולו דיני מדינת ישראל.', '17.1'),
      p('הסמכות נתונה לבתי המשפט המוסמכים בישראל. [[אפשרות למשתמשים עסקיים בלבד: סמכות ייחודית לבתי המשפט המוסמכים במחוז …]] לא תיכפה סמכות ייחודית על צרכנים.', '17.2'),
    ] },
    { heading: '18. כללי', blocks: [
      p('**שינוי במקום ביטול.** אם בית משפט יקבע שהוראה כלשהי, לרבות הוראה בסעיף 12, בטלה או אינה ניתנת לאכיפה, כולה או חלקה, היא תחול במידה המרבית המותרת. סעיף 12.5 ויתר התנאים יעמדו בתוקפם.', '18.1'),
      p('**המחאה.** המפעיל רשאי להעביר תנאים אלה ואת השירות לחברה שבשליטתו או לרוכש השירות, בהודעה לכם. אינכם רשאים להעביר את זכויותיכם ללא הסכמת המפעיל.', '18.2'),
      p('**הסכם מלא.** תנאים אלה ומדיניות הפרטיות הם ההסכם המלא בנוגע לשירות.', '18.3'),
      p('**אי-ויתור.** אי-אכיפה של זכות אינה ויתור עליה.', '18.4'),
      p('**שפה.** התנאים מתפרסמים בעברית ובאנגלית. במקרה של סתירה, הנוסח העברי גובר.', '18.5'),
      p('**הודעות.** המפעיל רשאי להודיע לכם באפליקציה או בדוא״ל של חשבונכם. הודעות למפעיל: [[דוא״ל]] / [[כתובת]].', '18.6'),
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
