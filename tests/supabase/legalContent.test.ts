import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGAL_CONTENT, legalDocumentStrings, legalPlaceholders } from '../../src/lib/legal/legalContent.ts';
import { LEGAL_DOC_VERSION, LEGAL_DOC_VERSION_PENDING, LEGAL_EFFECTIVE_DATE, LEGAL_IS_DRAFT } from '../../src/lib/legal/legalDocs.ts';

const KINDS = ['privacy', 'terms'] as const;
const LANGS = ['he', 'en'] as const;
const shape = (doc: (typeof LEGAL_CONTENT)['terms']['he']) => doc.sections.map((s) => [s.status, s.blocks.map((b) => b.kind + (b.kind === 'p' ? b.num ?? '' : b.kind === 'ul' ? b.items.length : b.kind === 'sub' ? b.items.length : b.rows.length)).join(',')]);

test('Hebrew and English versions have the same structure', () => {
  for (const kind of KINDS) {
    assert.deepEqual(shape(LEGAL_CONTENT[kind].he), shape(LEGAL_CONTENT[kind].en), kind);
    assert.equal(!!LEGAL_CONTENT[kind].he.notice, !!LEGAL_CONTENT[kind].en.notice);
  }
});

test('the placeholders are the same facts in both languages (counted per document)', () => {
  for (const kind of KINDS) {
    const count = (lang: (typeof LANGS)[number]) => legalDocumentStrings(LEGAL_CONTENT[kind][lang]).join('\n').split('[[').length - 1;
    assert.equal(count('he'), count('en'), kind);
  }
});

test('placeholders and bold markers are balanced; no internal review notes leak into public text', () => {
  for (const kind of KINDS) for (const lang of LANGS) {
    for (const text of legalDocumentStrings(LEGAL_CONTENT[kind][lang])) {
      assert.equal(text.split('[[').length, text.split(']]').length, text);
      assert.equal((text.match(/\*\*/g) ?? []).length % 2, 0, text);
      assert.ok(!/⚖|🔎|LAWYER|COUNSEL|עו"ד/.test(text), text);
    }
  }
});

test('the agreed liability position: no monetary cap, the lawful exclusions stay, the fallback has no amount', () => {
  const terms = legalDocumentStrings(LEGAL_CONTENT.terms.en).join('\n');
  assert.ok(!/₪|NIS|\bshekel/i.test(terms));
  assert.ok(!/shall not exceed|total liability|limited to .*(amount|fees)/i.test(terms));
  assert.match(terms, /direct or indirect/);
  assert.match(terms, /gross negligence/);
  assert.match(terms, /Fallback if the exclusion is not enforced/);
  const he = legalDocumentStrings(LEGAL_CONTENT.terms.he).join('\n');
  assert.ok(!/₪|ש״ח/.test(he));
  assert.match(he, /רשלנות רבתי/);
});

test('upcoming AI, subscriptions and payments are marked "soon"; AI and payments are described as off', () => {
  for (const kind of KINDS) for (const lang of LANGS) {
    assert.ok(LEGAL_CONTENT[kind][lang].sections.some((s) => s.status === 'soon'), `${kind}/${lang}`);
  }
  assert.match(legalDocumentStrings(LEGAL_CONTENT.privacy.en).join('\n'), /not available yet/);
});

test('the texts match the app: Google sign-in, language kept in the browser, 7-day deletion wait, no password', () => {
  const privacy = legalDocumentStrings(LEGAL_CONTENT.privacy.en).join('\n');
  assert.match(privacy, /Google password/);
  assert.match(privacy, /language choice is kept in your browser/);
  assert.match(privacy, /7-day waiting period/);
  assert.match(privacy, /does not run product analytics/);
  assert.match(privacy, /not anonymous/, 'internal deletion IDs must not be described as anonymised');
  assert.match(privacy, /successful maintenance run/);
});

test('a published version has no placeholder left; until then the version stays "pending"', () => {
  const remaining = KINDS.flatMap((k) => LANGS.flatMap((l) => legalPlaceholders(LEGAL_CONTENT[k][l])));
  if (LEGAL_DOC_VERSION !== LEGAL_DOC_VERSION_PENDING) assert.deepEqual(remaining, [], 'cannot publish with placeholders');
  assert.equal(LEGAL_IS_DRAFT, LEGAL_DOC_VERSION === LEGAL_DOC_VERSION_PENDING);
  assert.ok(remaining.length > 0 ? LEGAL_IS_DRAFT : true);
});


test('final Early Access documents share the approved version, effective date and identity/contact', () => {
  assert.equal(LEGAL_DOC_VERSION, 'ea-2026-10-18-v1');
  assert.equal(LEGAL_EFFECTIVE_DATE, '2026-10-18');
  assert.equal(LEGAL_IS_DRAFT, false);
  for (const kind of KINDS) for (const lang of LANGS) {
    const doc = LEGAL_CONTENT[kind][lang];
    const text = legalDocumentStrings(doc).join('\n');
    assert.ok(doc.meta.includes(LEGAL_DOC_VERSION));
    assert.ok(doc.meta.includes(LEGAL_EFFECTIVE_DATE));
    assert.doesNotMatch(doc.meta, /pending|draft|טיוטת/);
    assert.doesNotMatch(text, /support@bettercalc\.invalid/);
    assert.match(text, /support\.bettercalc@gmail\.com/);
    assert.match(text, /שי אטיאס/);
    assert.doesNotMatch(text, /confirm registered legal name|לאימות השם המשפטי הרשום/);
    assert.doesNotMatch(text, /VAT-exempt|עוסק פטור/);
  }
});

test('publishing also requires removal of the development-only contact placeholder', () => {
  if (LEGAL_IS_DRAFT) return;
  for (const kind of KINDS) for (const lang of LANGS) {
    assert.doesNotMatch(legalDocumentStrings(LEGAL_CONTENT[kind][lang]).join('\n'), /support@bettercalc\.invalid/);
  }
});

test('privacy describes optional local-data deletion during sign-out in both languages', () => {
  assert.match(legalDocumentStrings(LEGAL_CONTENT.privacy.en).join(' '), /unless you explicitly choose to delete local data/);
  assert.match(legalDocumentStrings(LEGAL_CONTENT.privacy.he).join(' '), /אלא אם בחרתם במפורש למחוק נתונים מקומיים/);
});


test('shared-browser and exact local clearing disclosures stay paired in Hebrew and English', () => {
  const en = legalDocumentStrings(LEGAL_CONTENT.privacy.en).join(' ');
  const he = legalDocumentStrings(LEGAL_CONTENT.privacy.he).join(' ');
  for (const term of ['not separated by Google account', 'other accounts', 'Language, grid', 'guest trial state', 'guest consent acknowledgement and history remain', 'before the app attempts account sign-out', 'not automatically erased', 'not anonymous']) assert.ok(en.includes(term), term);
  for (const term of ['אינם מופרדים לפי חשבון Google', 'חשבונות אחרים', 'העדפות השפה, הרשת', 'מצב הניסיון לאורח', 'אישור הסכמת האורח וההיסטוריה שלו נשארים', 'לפני ניסיון ההתנתקות', 'אינם נמחקים אוטומטית', 'אינן אנונימיות']) assert.ok(he.includes(term), term);
});

test('prepared Supabase legal release matches the client without touching consent history', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync('scripts/sql/early-access-legal-release.sql', 'utf8');
  assert.ok(sql.includes(`('legal_version', to_jsonb('${LEGAL_DOC_VERSION}'::text))`));
  assert.ok(sql.includes(`('legal_effective_date', to_jsonb('${LEGAL_EFFECTIVE_DATE}'::text))`));
  assert.doesNotMatch(sql, /(?:update|delete from|insert into) public\.(?:profiles|legal_consents)\b/i);
});
