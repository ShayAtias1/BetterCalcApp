import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PLAN_A } from './fixtures.ts';
import { buildProjectStructural, buildRebarLevelRows } from '../../src/lib/structuralQuantities.ts';
import { useLanguageStore, translatorFor, formatNumber } from '../../src/i18n/index.ts';
import type { Plan } from '../../src/types/index.ts';
import type { RebarMesh, RebarBars } from '../../src/types/structural.ts';

// Render the actual TSX components in Node without a browser or a new test dependency.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if ((specifier.startsWith('.') || specifier.startsWith('/')) && !specifier.endsWith('.tsx')) return nextResolve(`${specifier}.tsx`, context);
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx')) return nextLoad(url, context);
    return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText };
  },
});
Object.assign(globalThis, { DOMMatrix: class {}, DOMPoint: class {}, DOMRect: class {}, Path2D: class {} });
const { useAppStore } = await import('../../src/store/appStore.ts');
const importUi = (name: string) => import(`../../src/components/${name}.tsx`);
const { default: RebarPanel } = await importUi('RebarPanel');
const { default: ConcretePanel } = await importUi('ConcretePanel');
const { ProjectRebarTable } = await importUi('ProjectStructuralTables');
const { RebarQuantityTable, ConcreteQuantityTable } = await importUi('StructuralQuantityTables');
// Server rendering reads Zustand's initial snapshot; refresh it before rendering each test view.
const initialAppState = useAppStore.getInitialState();
const initialLanguageState = useLanguageStore.getInitialState();
const render = (element: ReturnType<typeof createElement>) => {
  Object.assign(initialAppState, useAppStore.getState());
  Object.assign(initialLanguageState, useLanguageStore.getState());
  return renderToStaticMarkup(element);
};
after(() => useAppStore.getState().setProject(null));

const mesh: RebarMesh = {
  id: 'mesh', kind: 'mesh', autoNumber: 1, mark: '', pageNumber: 1, wastePercent: 10,
  points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 400 }, { x: 0, y: 400 }],
  bottom: { mode: 'uniform', spec: { diameterMm: 12, spacingM: 0.2 } },
  top: { mode: 'uniform', spec: { diameterMm: 10, spacingM: 0.15 } },
};
const bars: RebarBars = { id: 'bars', kind: 'bars', autoNumber: 1, mark: '', pageNumber: 1, wastePercent: 20, diameterMm: 16, count: 10, lengthM: 6 };
const plan = (id = 'a'): Plan => ({ ...structuredClone(PLAN_A), id, name: `Plan ${id}`, pages: { 1: { pageNumber: 1, calibration: { pixelDistance: 100, realDistanceMeters: 1, metersPerPixel: 0.01 } } }, concreteElements: [{ id: 'slab', kind: 'slab', pageNumber: 1, mark: '', autoNumber: 1, points: structuredClone(mesh.points), depthM: 0.2, wastePercent: 0 }], rebarItems: [structuredClone(mesh), structuredClone(bars)] });
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

for (const language of ['en', 'he'] as const) {
  test(`Mesh detail hides reinforcement lengths, keeps sheet breakdown and weights; Bars keeps lengths [${language}]`, () => {
    useLanguageStore.getState().setLanguage(language);
    const t = translatorFor(language);
    useAppStore.getState().setProject(plan());
    useAppStore.getState().setSelectedRebarId('mesh');
    const html = render(createElement(RebarPanel));
    const printed = text(html);
    assert.ok(!printed.includes(t('rebar.totalLength')));
    assert.ok(!printed.includes(t('rebar.summary.title')));
    assert.ok(!html.includes('rebar-level-total'));
    assert.ok(!html.includes('rebar-order-length'));
    assert.ok(printed.includes(`${t('rebar.levelBottom')}: ${t('quantitiesPanel.sheetsQty', { count: 4 })}`));
    assert.ok(printed.includes(`${t('rebar.levelTop')}: ${t('quantitiesPanel.sheetsQty', { count: 4 })}`));
    assert.ok(printed.includes(`${t('rebar.sheets.total')}: ${t('quantitiesPanel.sheetsQty', { count: 8 })}`));
    assert.ok(printed.includes(t('quantitiesPanel.cols.netWeight')));
    assert.ok(printed.includes(t('rebar.order')));
    useAppStore.getState().setSelectedRebarId('bars');
    const barHtml = render(createElement(RebarPanel));
    assert.ok(text(barHtml).includes(t('rebar.totalLength')));
    assert.ok(text(barHtml).includes(t('rebar.barCount')));
    assert.ok(text(barHtml).includes(t('rebar.barLength')));
    assert.ok(barHtml.includes('rebar-order-length'));
    useAppStore.getState().setSelectedRebarId(null);
    assert.ok(!text(render(createElement(RebarPanel))).includes(t('rebar.summary.title')));
    useAppStore.getState().setSelectedConcreteId(null);
    assert.ok(!text(render(createElement(ConcretePanel))).includes(t('concrete.summary.title')));
    const concreteId = useAppStore.getState().project!.concreteElements?.[0]?.id;
    if (concreteId) {
      useAppStore.getState().setSelectedConcreteId(concreteId);
      assert.ok(!text(render(createElement(ConcretePanel))).includes(t('concrete.summary.title')));
    }
    assert.ok(render(createElement(RebarQuantityTable, { plan: plan() })).includes('<table'));
    assert.ok(render(createElement(ConcreteQuantityTable, { plan: plan() })).includes('<table'));
    const irregular = plan();
    irregular.rebarItems = [{ ...mesh, points: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 600 }] }];
    useAppStore.getState().setProject(irregular);
    useAppStore.getState().setSelectedRebarId('mesh');
    const estimate = text(render(createElement(RebarPanel)));
    assert.ok(estimate.includes(t('rebar.estimate')) && estimate.includes('≈'));
    assert.ok(!estimate.includes(t('rebar.totalLength')));
    irregular.rebarItems = [{ ...mesh, bottom: { mode: 'uniform', spec: { diameterMm: 0, spacingM: 0 } }, top: undefined }];
    useAppStore.getState().setProject(irregular);
    useAppStore.getState().setSelectedRebarId('mesh');
    const missing = text(render(createElement(RebarPanel)));
    assert.ok(missing.includes(t('rebar.invalidInput')));
    assert.ok(!missing.includes(t('rebar.totalLength')));
  });

  test(`Project Rebar shows actual Mesh levels and Bars lengths, with weights-only total [${language}]`, () => {
    useLanguageStore.getState().setLanguage(language);
    const t = translatorFor(language);
    const a = plan();
    const b = plan('b'); // Same item IDs and marks on another plan must remain distinct.
    b.rebarItems = [{ ...mesh, top: undefined, points: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 600 }] }, { ...bars, diameterMm: 0 }];
    const plans = [a, b];
    const summary = buildProjectStructural(plans).rebar!;
    const html = render(createElement(ProjectRebarTable, { rebar: summary, plans }));
    const body = html.match(/<tbody>(.*?)<\/tbody>/s)![1];
    const rows = [...body.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)].map((m) => text(m[1]));
    assert.equal(rows.length, plans.flatMap((p) => buildRebarLevelRows(p)).length);
    assert.ok(rows[0].includes('Plan a') && rows[1].includes('Plan a') && rows[3].includes('Plan b'));
    assert.ok(rows[0].includes(t('rebar.levelBottom')) && rows[1].includes(t('rebar.levelTop')));
    assert.ok(rows[0].includes('Ø12 @ 20') && rows[0].includes(t('exports.structural.sheetsQty', { count: 4 })));
    assert.ok(!rows[0].includes(t('rebar.totalLength')) && !rows[1].includes(t('rebar.barLength')));
    assert.ok(rows[2].includes(t('exports.structural.barsQty', { count: 10 })));
    assert.ok(rows[2].includes(`${t('rebar.barLength')}: 6`) && rows[2].includes(`${t('rebar.totalLength')}: 60`));
    assert.ok(rows[3].includes(t('exports.structural.basis.estimate')) && rows[3].includes('≈'));
    assert.ok(rows[4].includes(t('exports.structural.status.invalidInput')));
    const footer = text(html.match(/<tfoot>(.*?)<\/tfoot>/s)![1]);
    assert.ok(footer.includes(formatNumber(summary.weightKg)) && footer.includes(formatNumber(summary.orderWeightKg)));
    assert.ok(footer.includes(t('exports.structural.basis.includesEstimate')));
    assert.ok(footer.includes(t('exports.structural.missingShort', { count: 1 })));
    assert.ok(!footer.includes(t('rebar.totalLength')) && !footer.includes(t('exports.structural.sheetsQty', { count: 8 })));
    const missing = { ...a, rebarItems: [{ ...mesh, bottom: { mode: 'uniform' as const, spec: { diameterMm: 0, spacingM: 0 } }, top: undefined }] };
    const missingHtml = render(createElement(ProjectRebarTable, { rebar: buildProjectStructural([missing]).rebar!, plans: [missing] }));
    assert.ok(text(missingHtml).includes(t('exports.structural.missingShort', { count: 1 })));
    assert.ok(missingHtml.match(/<tfoot>(.*?)<\/tfoot>/s)![1].includes('>-<'));
  });
}
