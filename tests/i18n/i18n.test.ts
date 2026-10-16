// The language layer: both dictionaries have the same keys and placeholders, English plurals and
// units read right, the language can be switched, and exports ignore the UI language.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  formatDate,
  formatNumber,
  isLanguage,
  t,
  translatorFor,
  translate,
  useLanguageStore,
  type Language,
  type TranslateFn,
} from '../../src/i18n/index.ts';
import { he } from '../../src/i18n/he.ts';
import { en } from '../../src/i18n/en.ts';
import { formatAreaM2, formatLengthM, measurementLabel, withMeasurementValues } from '../../src/lib/measurementValues.ts';
import { labelDirection } from '../../src/lib/textDirection.ts';
import { openingCountsText, buildRoomSummaries } from '../../src/lib/quantities.ts';
import { buildQuantitiesWorkbook } from '../../src/lib/exportExcel.ts';
import { buildProjectWorkbook } from '../../src/lib/exportProjectExcel.ts';
import { PLAN_A, PLAN_B } from '../takeoff/fixtures.ts';
import type { Project } from '../../src/types/index.ts';

const tEn: TranslateFn = (key, ...args) => translate('en', key, ...args);

afterEach(() => useLanguageStore.setState({ language: DEFAULT_LANGUAGE }));

/** Dotted path → string for every leaf of a dictionary. */
function flatten(node: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [p, v] of flatten(value, path)) out.set(p, v);
  }
  return out;
}

/** `{name}` and `{name|one|other}` placeholders of a string, by name. */
const placeholders = (text: string) => [...new Set([...text.matchAll(/\{(\w+)(?:\|[^|}]*\|[^}]*)?\}/g)].map((m) => m[1]))].sort();

test('English has exactly the Hebrew keys, none empty', () => {
  const heKeys = flatten(he);
  const enKeys = flatten(en);
  assert.deepEqual([...enKeys.keys()].sort(), [...heKeys.keys()].sort());
  for (const [key, text] of enKeys) assert.ok(text.trim().length > 0, `en ${key} is empty`);
});

test('every English text keeps the placeholders of the Hebrew one', () => {
  const enKeys = flatten(en);
  for (const [key, heText] of flatten(he)) {
    assert.deepEqual(placeholders(enKeys.get(key)!), placeholders(heText), `placeholders of ${key}`);
  }
});

test('English uses no Hebrew, and no key is left as in Hebrew', () => {
  for (const [key, text] of flatten(en)) assert.ok(!/[֐-׿]/.test(text), `en ${key} contains Hebrew: ${text}`);
});

test('language metadata: Hebrew is RTL and the default, English is LTR', () => {
  assert.equal(DEFAULT_LANGUAGE, 'he');
  assert.deepEqual([LANGUAGES.he.code, LANGUAGES.he.dir], ['he', 'rtl']);
  assert.deepEqual([LANGUAGES.en.code, LANGUAGES.en.dir], ['en', 'ltr']);
  assert.ok(isLanguage('en') && isLanguage('he') && !isLanguage('fr') && !isLanguage(undefined));
});

test('interpolation, and English plurals chosen by count', () => {
  assert.equal(translate('he', 'defaultNames.room', { number: 3 }), 'חדר 3');
  assert.equal(translate('en', 'defaultNames.room', { number: 3 }), 'Room 3');
  assert.equal(translate('en', 'startScreen.meta.rooms', { count: 1 }), '1 room');
  assert.equal(translate('en', 'startScreen.meta.rooms', { count: 4 }), '4 rooms');
  assert.equal(translate('en', 'projectOverview.uncalibratedRooms', { count: 1 }), '1 room on uncalibrated sheets is not included in the summary.');
  assert.equal(translate('en', 'projectOverview.uncalibratedRooms', { count: 3 }), '3 rooms on uncalibrated sheets are not included in the summary.');
  // Hebrew has no plural syntax: its text is exactly what it was.
  assert.equal(translate('he', 'startScreen.meta.rooms', { count: 1 }), '1 חדרים');
  // A placeholder that is not supplied stays visible rather than vanishing.
  assert.equal((translate as (l: Language, k: string, p: object) => string)('en', 'defaultNames.copy', {}), '{name} (copy)');
});

test('the language can be switched, and t() follows it', () => {
  assert.equal(t('common.cancel'), 'ביטול');
  useLanguageStore.setState({ language: 'en' });
  assert.equal(t('common.cancel'), 'Cancel');
  useLanguageStore.getState().setLanguage('he');
  assert.equal(t('common.cancel'), 'ביטול');
});

test('units: English shows m, m², lm, cm; Hebrew keeps its units; the numbers do not change', () => {
  assert.deepEqual(['m', 'm2', 'lm', 'cm'].map((u) => translate('en', `units.${u}` as 'units.m')), ['m', 'm²', 'lm', 'cm']);
  assert.equal(formatLengthM(3.2449, tEn), '3.24 m');
  assert.equal(formatAreaM2(13.42, tEn), '13.42 m²');
  assert.equal(formatLengthM(3.2449), "3.24 מ'");
  assert.equal(measurementLabel({ tool: 'area', areaM2: 4.1 }, tEn), '4.1 m²');
  // A measurement saved by an old build with only a Hebrew label still reads its number.
  const [legacy] = withMeasurementValues([{ tool: 'distance', label: "2.5 מ'" }]);
  assert.equal(measurementLabel(legacy, tEn), '2.5 m');
});

test('English opening counts', () => {
  assert.equal(
    openingCountsText(
      [
        { id: 'a', type: 'door', widthM: 0.9, heightM: 2.1, quantity: 2 },
        { id: 'b', type: 'window', widthM: 1, heightM: 1, quantity: 1 },
      ],
      tEn
    ),
    '2 Doors · Window'
  );
});

test('dates and numbers: Hebrew is as before, English is unambiguous; stored values untouched', () => {
  const d = new Date(2026, 9, 2);
  assert.equal(formatDate(d, 'he'), d.toLocaleDateString('he-IL'));
  assert.equal(formatDate(d, 'en'), '2 Oct 2026');
  assert.equal(formatNumber(1234.5678, 'en'), '1,234.57');
  assert.equal(formatNumber(1234.5678, 'he'), (1234.5678).toLocaleString('he-IL', { maximumFractionDigits: 2 }));
});

test('on-plan label direction: Hebrew UI unchanged, English follows the text', () => {
  assert.equal(labelDirection('8.9 מ׳', 'he'), 'rtl');
  assert.equal(labelDirection('Room (copy)', 'he'), 'rtl');
  assert.equal(labelDirection('8.9 m', 'en'), 'ltr');
  assert.equal(labelDirection('12.5', 'en'), 'ltr');
  assert.equal(labelDirection('סלון (עותק)', 'en'), 'rtl');
  assert.equal(labelDirection('A1 סלון', 'en'), 'ltr');
});

test('an export is written in the language it is given, whatever the UI language is', async () => {
  useLanguageStore.setState({ language: 'en' });
  assert.equal(t('workTypes.tiling'), 'Floor Tiling');
  assert.equal(translatorFor('he')('workTypes.tiling'), 'ריצוף');
  assert.equal(translatorFor('en')('workTypes.tiling'), 'Floor Tiling');

  const project: Project = { id: 'p', name: 'פרויקט', createdAt: 0, updatedAt: 0, planIds: ['plan-a', 'plan-b'] };
  const dump = async (wb: ExcelJS.Workbook) => {
    const reread = new ExcelJS.Workbook();
    await reread.xlsx.load(await wb.xlsx.writeBuffer());
    return reread.worksheets.map((s) => {
      const cells: unknown[] = [];
      s.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c) => cells.push([c.address, c.value])));
      return { name: s.name, cells };
    });
  };
  const build = async (language: Language) => [
    await dump(buildQuantitiesWorkbook(buildRoomSummaries(PLAN_A), [], language)),
    await dump(buildProjectWorkbook(project, [PLAN_A, PLAN_B], language)),
  ];
  // The same language gives the same workbook under either UI language ...
  useLanguageStore.setState({ language: 'he' });
  const heUnderHe = await build('he');
  const enUnderHe = await build('en');
  useLanguageStore.setState({ language: 'en' });
  assert.deepEqual(await build('he'), heUnderHe);
  assert.deepEqual(await build('en'), enUnderHe);
  // ... and the two languages really do differ.
  assert.notDeepEqual(heUnderHe, enUnderHe);
});

test('cloud backup counts agree with their nouns in both languages', () => {
  assert.equal(translate('he', 'cloud.done', { count: 1 }), '1 פרויקט גובה בענן.');
  assert.equal(translate('he', 'cloud.done', { count: 3 }), '3 פרויקטים גובו בענן.');
  assert.match(translate('he', 'cloud.confirm', { count: 1, names: 'x' }), /^לגבות לענן 1 פרויקט\?/);
  assert.match(translate('he', 'cloud.confirm', { count: 2, names: 'x' }), /^לגבות לענן 2 פרויקטים\?/);
  assert.equal(translate('en', 'cloud.done', { count: 1 }), 'Backed up 1 project to the cloud.');
  assert.equal(translate('en', 'cloud.done', { count: 2 }), 'Backed up 2 projects to the cloud.');
  assert.match(translate('en', 'cloud.confirm', { count: 1, names: 'x' }), /^Back up 1 project to the cloud\?/);
  assert.equal(translate('en', 'acct.plans.credits', { count: 1 }), '1 credit per month');
  assert.equal(translate('he', 'acct.plans.credits', { count: 1 }), '1 קרדיט בחודש');
});
