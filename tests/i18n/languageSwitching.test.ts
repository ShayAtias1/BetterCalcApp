// Switching the UI language at run time: the saved preference, Hebrew as the default, <html lang/dir>
// and the title following the setting, subscribers being told, and every export call site handing the
// export the language the UI shows when it runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const KEY = 'bettercalc.uiLanguage';

/** A browser stand-in; `throwing` makes storage fail like a blocked-storage browser. */
function installBrowser(saved?: string, throwing = false) {
  const store = new Map<string, string>(saved === undefined ? [] : [[KEY, saved]]);
  const html = { lang: 'he', dir: 'rtl' };
  const doc = { documentElement: html, title: '' };
  Object.assign(globalThis, {
    window: {
      localStorage: {
        getItem: (k: string) => {
          if (throwing) throw new Error('blocked');
          return store.get(k) ?? null;
        },
        setItem: (k: string, v: string) => {
          if (throwing) throw new Error('blocked');
          store.set(k, v);
        },
      },
    },
    document: doc,
  });
  return { store, html, doc };
}

/** A fresh copy of the i18n module, so its initial state is read from the stand-in storage. */
let n = 0;
const freshI18n = () => import(`../../src/i18n/index.ts?run=${n++}`) as Promise<typeof import('../../src/i18n/index.ts')>;

test('no saved preference opens in Hebrew; a saved valid one is used; junk and blocked storage fall back to Hebrew', async () => {
  installBrowser();
  assert.equal((await freshI18n()).useLanguageStore.getState().language, 'he');
  installBrowser('en');
  assert.equal((await freshI18n()).useLanguageStore.getState().language, 'en');
  installBrowser('fr');
  assert.equal((await freshI18n()).useLanguageStore.getState().language, 'he');
  installBrowser('en', true);
  assert.equal((await freshI18n()).useLanguageStore.getState().language, 'he');
});

test('choosing a language saves it under bettercalc.uiLanguage — and still switches when storage is blocked', async () => {
  const { store } = installBrowser();
  const i18n = await freshI18n();
  i18n.useLanguageStore.getState().setLanguage('en');
  assert.equal(store.get(KEY), 'en');
  i18n.useLanguageStore.getState().setLanguage('he');
  assert.equal(store.get(KEY), 'he');
  installBrowser(undefined, true);
  const blocked = await freshI18n();
  blocked.useLanguageStore.getState().setLanguage('en');
  assert.equal(blocked.useLanguageStore.getState().language, 'en');
});

test('HE → EN → HE at run time: t(), subscribers, <html lang/dir> and the title all follow, with no reload', async () => {
  const { html, doc } = installBrowser();
  const i18n = await freshI18n();
  i18n.syncDocumentLanguage();
  assert.deepEqual([html.lang, html.dir, doc.title], ['he', 'rtl', i18n.translate('he', 'app.documentTitle')]);
  const seen: string[] = [];
  const unsubscribe = i18n.useLanguageStore.subscribe((s) => seen.push(s.language));

  const heText = i18n.t('common.export');
  i18n.useLanguageStore.getState().setLanguage('en');
  assert.deepEqual([html.lang, html.dir, doc.title], ['en', 'ltr', i18n.translate('en', 'app.documentTitle')]);
  assert.equal(i18n.t('common.export'), i18n.translate('en', 'common.export'));
  assert.notEqual(i18n.t('common.export'), heText);

  i18n.useLanguageStore.getState().setLanguage('he');
  assert.deepEqual([html.lang, html.dir, doc.title], ['he', 'rtl', i18n.translate('he', 'app.documentTitle')]);
  assert.equal(i18n.t('common.export'), heText);
  assert.deepEqual(seen, ['en', 'he']);
  unsubscribe();
});

test('a dev ?dir override pins the direction through language switches; the language still follows', async () => {
  const { html } = installBrowser();
  const i18n = await freshI18n();
  i18n.syncDocumentLanguage('ltr');
  i18n.useLanguageStore.getState().setLanguage('en');
  i18n.useLanguageStore.getState().setLanguage('he');
  assert.deepEqual([html.lang, html.dir], ['he', 'ltr']);
});

test('translatorFor stays on its language while the UI language changes (an export is not stale or hijacked)', async () => {
  installBrowser();
  const i18n = await freshI18n();
  const toHebrew = i18n.translatorFor('he');
  i18n.useLanguageStore.getState().setLanguage('en');
  assert.equal(toHebrew('common.export'), i18n.translate('he', 'common.export'));
  assert.equal(i18n.t('common.export'), i18n.translate('en', 'common.export'));
});

test('every export is handed the UI language read at the moment the component renders (useLanguage), never a constant', () => {
  const sites: [string, RegExp[]][] = [
    ['src/components/QuantityExportDialogs.tsx', [/exportQuantitiesToExcel\([^\n]*, language\)/, /exportQuantitiesToPdf\([^\n]*, language\)/]],
    ['src/components/TopBar.tsx', [/exportPlanPageToPdf\([^\n]*, language\)/, /exportAllPlanPagesToPdf\([^\n]*, language\)/]],
    ['src/components/ProjectOverview.tsx', [/exportProjectToExcel\([^\n]*, language\)/, /exportProjectToPdf\([^\n]*, language\)/]],
    ['src/components/compare/CompareWorkspace.tsx', [/exportComposite\(language\)/, /exportCompositesAsPdf\([^\n]*, language\)/]],
  ];
  for (const [file, patterns] of sites) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /const language = useLanguage\(\)/, `${file} reads the language reactively`);
    for (const p of patterns) assert.match(source, p, `${file}: ${p}`);
  }
});
