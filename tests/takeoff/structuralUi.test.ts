import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PLAN_A } from './fixtures.ts';
import { useMeshLayoutPreviewStore } from '../../src/store/meshLayoutPreviewStore.ts';
import { prepareMeshLayoutPreview } from '../../src/lib/meshLayoutPreview.ts';
import { calculateMeshSheetPlacements } from '../../src/lib/meshSheetPlacement.ts';
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
const { MeshLayoutControl, MeshLayoutOverlay, MeshSheetPreviewLayer } = await importUi('MeshLayoutPreview');
const { ProjectRebarTable } = await importUi('ProjectStructuralTables');
const { RebarQuantityTable, ConcreteQuantityTable } = await importUi('StructuralQuantityTables');
// Server rendering reads Zustand's initial snapshot; refresh it before rendering each test view.
const initialAppState = useAppStore.getInitialState();
const initialLanguageState = useLanguageStore.getInitialState();
const initialMeshPreviewState = useMeshLayoutPreviewStore.getInitialState();
const render = (element: ReturnType<typeof createElement>) => {
  Object.assign(initialAppState, useAppStore.getState());
  Object.assign(initialLanguageState, useLanguageStore.getState());
  Object.assign(initialMeshPreviewState, useMeshLayoutPreviewStore.getState());
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


test('Mesh preview controls and overlay: OFF, ON, Top/Bottom selection and Rebar master visibility', () => {
  useLanguageStore.getState().setLanguage('en');
  useMeshLayoutPreviewStore.setState({ views: {} });
  const p = plan();
  useAppStore.getState().setProject(p);
  useAppStore.getState().setSelectedRebarId('mesh');
  const before = structuredClone(useAppStore.getState().project);
  const history = useAppStore.getState().history;
  const calibration = p.pages[1].calibration;
  const control = () => render(createElement(MeshLayoutControl, { planId: p.id, mesh, calibration }));
  const overlay = (selectedId: string | null = 'mesh', pageNumber = 1) => render(createElement(MeshLayoutOverlay, { plan: p, pageNumber, selectedId, zoom: 1, visible: useAppStore.getState().overlayVisible.rebar }));
  useAppStore.getState().setOverlayVisible('rebar', true);
  assert.ok(control().includes('Show mesh layout'));
  assert.ok(!control().includes('checked'));
  assert.equal(overlay(), '');
  useMeshLayoutPreviewStore.getState().setEnabled(p.id, mesh.id, true);
  assert.ok(control().includes('checked'));
  assert.ok(control().includes('Layout viewing level'));
  const bottom = overlay();
  const placements = calculateMeshSheetPlacements(mesh, calibration);
  assert.equal(placements.status, 'ok');
  assert.equal((bottom.match(/<polygon /g) ?? []).length, placements.placementsByLevel.bottom!.length);
  assert.ok(bottom.includes('data-level="bottom"'));
  assert.ok(bottom.includes('pointer-events="none"'));
  assert.ok(!/tabindex|draggable|clip-path|onClick|onPointer|onMouse/i.test(bottom));
  useMeshLayoutPreviewStore.getState().setLevel(p.id, mesh.id, 'top');
  const top = overlay();
  assert.ok(top.includes('data-level="top"'));
  assert.equal((top.match(/<polygon /g) ?? []).length, placements.placementsByLevel.top!.length);
  assert.ok(!top.includes('&quot;bottom&quot;'));
  useAppStore.getState().setOverlayVisible('rebar', false);
  assert.equal(overlay(), '');
  useAppStore.getState().setOverlayVisible('rebar', true);
  assert.equal(overlay(), top);
  assert.equal(overlay('bars'), '');
  assert.equal(overlay(null), '');
  assert.equal(overlay('mesh', 2), '');
  assert.deepEqual(useAppStore.getState().project, before);
  assert.equal(useAppStore.getState().history, history);
  useMeshLayoutPreviewStore.getState().setEnabled(p.id, mesh.id, false);
  assert.equal(overlay(), '');
});

test('Mesh preview single-level fallback, unreadable labels, and unavailable layouts render no sheet targets', () => {
  useLanguageStore.getState().setLanguage('en');
  const onlyTop = { ...mesh, bottom: undefined };
  useMeshLayoutPreviewStore.setState({ views: {} });
  useMeshLayoutPreviewStore.getState().setEnabled('a', mesh.id, true);
  const calibration = plan().pages[1].calibration;
  const control = render(createElement(MeshLayoutControl, { planId: 'a', mesh: onlyTop, calibration }));
  assert.ok(!control.includes('Layout viewing level'));
  const preview = prepareMeshLayoutPreview(onlyTop, calibration);
  const draw = (zoom: number) => render(createElement(MeshSheetPreviewLayer, { preview, level: 'bottom', visible: true, zoom }));
  assert.ok(draw(1).includes('data-level="top"'));
  assert.equal((draw(1).match(/<text /g) ?? []).length, 4);
  assert.equal((draw(0.01).match(/<text /g) ?? []).length, 0);
  assert.equal((draw(0.01).match(/<polygon /g) ?? []).length, 4);
  const unavailable = prepareMeshLayoutPreview({ ...mesh, sheets: { widthM: 0 } }, calibration);
  assert.equal(render(createElement(MeshSheetPreviewLayer, { preview: unavailable, level: 'bottom', visible: true, zoom: 1 })), '');
});

for (const language of ['en', 'he'] as const) {
  test(`Mesh preview messages for irregular polygons, Manual Size and large layouts [${language}]`, () => {
    useLanguageStore.getState().setLanguage(language);
    const t = translatorFor(language);
    useMeshLayoutPreviewStore.setState({ views: {} });
    useMeshLayoutPreviewStore.getState().setEnabled('a', mesh.id, true);
    const calibration = plan().pages[1].calibration;
    const irregular = { ...mesh, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 40, y: 80 }] };
    for (const [item, cal, message] of [
      [irregular, calibration, 'rebar.layout.rectangularOnly'],
      [{ ...irregular, sizeOverride: { lengthM: 10, widthM: 4 } }, calibration, 'rebar.layout.noGeometry'],
      [{ ...mesh, sizeOverride: { lengthM: 10, widthM: 4 } }, null, 'rebar.layout.noGeometry'],
      [{ ...mesh, sizeOverride: { lengthM: 4000, widthM: 4 } }, calibration, 'rebar.layout.tooLarge'],
      [{ ...mesh, sheets: { widthM: 0 } }, calibration, 'rebar.layout.unavailable'],
    ] as const) {
      const html = render(createElement(MeshLayoutControl, { planId: 'a', mesh: item, calibration: cal }));
      assert.ok(text(html).includes(t(message)));
      assert.ok(html.includes('role="status"'));
      assert.ok(html.includes('aria-describedby'));
      assert.equal(render(createElement(MeshLayoutOverlay, { plan: { ...plan(), rebarItems: [item], pages: { 1: { pageNumber: 1, calibration: cal } } }, pageNumber: 1, selectedId: 'mesh', visible: true, zoom: 1 })), '');
    }
    const p = { ...plan(), rebarItems: [{ ...irregular, sizeOverride: { lengthM: 10, widthM: 4 } }] };
    useAppStore.getState().setProject(p);
    useAppStore.getState().setSelectedRebarId('mesh');
    assert.ok(text(render(createElement(RebarPanel))).includes(t('rebar.sheets.total')));
  });
}

for (const language of ['en', 'he'] as const) {
  test(`Mesh editor renders selection/rotation/reset, restores session edits, and gates hit targets [${language}]`, () => {
    useLanguageStore.getState().setLanguage(language);
    const t = translatorFor(language);
    useMeshLayoutPreviewStore.setState({ views: {} });
    const p = plan(), calibration = p.pages[1].calibration;
    useAppStore.getState().setProject(p);
    useAppStore.getState().setOverlayVisible('rebar', true);
    const before = structuredClone(p);
    const history = useAppStore.getState().history;
    const quantities = buildProjectStructural([p]);
    const actions = useMeshLayoutPreviewStore.getState();
    actions.setEnabled(p.id, mesh.id, true);
    const preview = prepareMeshLayoutPreview(mesh, calibration);
    assert.equal(preview.status, 'ready');
    const first = preview.automatic.placementsByLevel.bottom![0];
    const control = () => render(createElement(MeshLayoutControl, { planId: p.id, mesh, calibration }));
    const overlay = (visible = true, interactionAllowed = true) => render(createElement(MeshLayoutOverlay, {
      plan: p, pageNumber: 1, selectedId: mesh.id, zoom: 1, visible, interactionAllowed,
      screenToNative: (x: number, y: number) => ({ x, y }),
    }));
    assert.ok(text(control()).includes(t('rebar.layout.edit')));
    assert.ok(!text(control()).includes(t('rebar.layout.rotate')));
    actions.setEditing(p.id, mesh.id, true, preview, true);
    assert.ok(text(control()).includes(t('rebar.layout.exitEdit')));
    assert.ok(text(control()).includes(t('rebar.layout.quantityNotice')));
    assert.ok(text(control()).includes(t('rebar.layout.sessionNotice')));
    assert.match(control(), /disabled=""[^>]*>[^<]*<\/button>/);
    assert.ok(overlay().includes('pointer-events="auto"'));
    assert.ok(overlay(true, false).includes('pointer-events="none"'));
    actions.select(p.id, mesh.id, first.id);
    assert.ok(text(control()).includes(t('rebar.layout.selectedSheet', { number: 1, count: preview.automatic.sheetsPerLevel })));
    assert.ok(text(control()).includes(t('rebar.layout.rotate')));
    assert.ok(overlay().includes('fill-opacity="0.14"'));
    actions.setOverride(p.id, mesh.id, 'bottom', { placementId: first.id, x: -4, y: 9, rotation: 90 });
    const moved = overlay();
    assert.ok(!control().includes('disabled=""'));
    assert.equal(overlay(false), '');
    useAppStore.getState().setOverlayVisible('rebar', false);
    assert.ok(!text(control()).includes(t('rebar.layout.edit')));
    useAppStore.getState().setOverlayVisible('rebar', true);
    assert.equal(overlay(), moved);
    actions.setLevel(p.id, mesh.id, 'top');
    assert.ok(!text(control()).includes(t('rebar.layout.rotate')));
    assert.ok(control().includes('disabled=""'));
    actions.setLevel(p.id, mesh.id, 'bottom');
    actions.select(p.id, mesh.id, first.id);
    assert.equal(overlay(), moved);
    actions.setEnabled(p.id, mesh.id, false);
    assert.equal(overlay(), '');
    actions.setEnabled(p.id, mesh.id, true);
    assert.ok(overlay().includes('pointer-events="none"'));
    actions.setEditing(p.id, mesh.id, true, preview, true);
    actions.select(p.id, mesh.id, first.id);
    assert.equal(overlay(), moved);
    actions.resetLevel(p.id, mesh.id, 'bottom');
    assert.ok(control().includes('disabled=""'));
    assert.notEqual(overlay(), moved);
    const unavailable = render(createElement(MeshLayoutControl, { planId: p.id, mesh: { ...mesh, sheets: { widthM: 0 } }, calibration }));
    assert.ok(!text(unavailable).includes(t('rebar.layout.edit')));
    assert.deepEqual(p, before);
    assert.deepEqual(useAppStore.getState().project, before);
    assert.equal(useAppStore.getState().history, history);
    assert.deepEqual(buildProjectStructural([p]), quantities);
  });
}
