import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGAL_CONTENT, legalDocumentStrings, legalPlaceholders } from '../../src/lib/legal/legalContent.ts';
import { LEGAL_DOC_VERSION, LEGAL_DOC_VERSION_PENDING, LEGAL_IS_DRAFT } from '../../src/lib/legal/legalDocs.ts';

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


test('Early Access drafts require a real contact, do not publish a fake mailbox and retain pending status', () => {
  assert.equal(LEGAL_DOC_VERSION, 'pending');
  for (const kind of KINDS) for (const lang of LANGS) {
    const doc = LEGAL_CONTENT[kind][lang];
    const text = legalDocumentStrings(doc).join('\n');
    assert.match(doc.meta, /pending/);
    assert.doesNotMatch(text, /support@bettercalc\.invalid/);
    assert.match(text, lang === 'en' ? /active support and privacy contact/ : /כתובת פעילה לתמיכה ולפרטיות/);
    assert.doesNotMatch(text, /VAT-exempt|עוסק פטור/);
  }
});

test('publishing also requires removal of the development-only contact placeholder', () => {
  if (LEGAL_IS_DRAFT) return;
  for (const kind of KINDS) for (const lang of LANGS) {
    assert.doesNotMatch(legalDocumentStrings(LEGAL_CONTENT[kind][lang]).join('\n'), /support@bettercalc\.invalid/);
  }
});
