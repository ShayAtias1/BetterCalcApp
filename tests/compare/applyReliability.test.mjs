import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const R = new URL('../../src', import.meta.url).pathname;
const saved = new Map();
const key = (store, value, k) => `${store}:${k ?? value.id}`;
const fakeStore = (store) => ({
  put: async (value, k) => saved.set(key(store, value, k), structuredClone(value)),
  get: async (k) => structuredClone(saved.get(`${store}:${k}`)),
});
await mock.module('idb', { namedExports: { openDB: async () => ({
  put: async (store, value, k) => saved.set(key(store, value, k), structuredClone(value)),
  get: async (store, k) => { const v = saved.get(`${store}:${k}`); return v instanceof Blob ? v : structuredClone(v); },
  getAll: async (store) => [...saved.entries()].filter(([k]) => k.startsWith(`${store}:`)).map(([, v]) => structuredClone(v)),
  delete: async (store, k) => saved.delete(`${store}:${k}`),
  transaction: () => ({ objectStore: fakeStore, done: Promise.resolve() }),
}) } });

const { createEmptyComparison, useCompareStore } = await import(`${R}/store/compareStore.ts`);
const { wallFromLine } = await import(`${R}/lib/revision/changeEdit.ts`);
const { prepareApplication, commitApplication, revertApplication } = await import(`${R}/lib/revision/apply.ts`);
const { DEFAULT_AREA_KIND_COLORS } = await import(`${R}/types/compare.ts`);
const { buildPlanQuantityReport } = await import(`${R}/lib/projectQuantities.ts`);
const { loadPlan } = await import(`${R}/db/database.ts`);

const CAL = { pixelDistance: 100, realDistanceMeters: 1, metersPerPixel: 0.01, space: 'original' };
const wc = (id, side, a, b, extra = {}) => ({
  id, pageNumber: 1, kind: side, category: 'wall', significance: 'high', score: 1, evidence: [],
  bbox: { x: 0, y: 0, width: 20, height: 400 }, addedSegments: [], removedSegments: [],
  walls: [wallFromLine(side, a, b, 10)], doors: [], addedLengthPx: 0, removedLengthPx: 0, status: 'approved', ...extra,
});
const tally = (p, kind) => (p.measurements ?? []).filter((m) => m.areaKind === kind).reduce((s, m) => s + m.areaM2, 0);
const sum = (p) => ({ construction: tally(p, 'construction'), demolition: tally(p, 'demolition'), n: p.measurements.length, openings: (p.openings ?? []).length, applications: p.revisionApplications.length });

function mkPlan(applications = []) {
  return {
    id: 'P', projectId: 'proj', name: 'Floor 1', createdAt: 1, updatedAt: 1000, pdfFileName: 'original.pdf',
    pages: { 1: { pageNumber: 1, calibration: { metersPerPixel: 0.01, pixelDistance: 100, realDistanceMeters: 1 } } },
    rooms: [], markups: [], defaultCladdingHeightM: 1.2, defaultPanelHeightM: 0.1,
    defaultTilingWastePercent: 0, defaultTilingAsWastePercent: 0, defaultCladdingWastePercent: 0, defaultPanelsWastePercent: 0,
    areaKindColors: { ...DEFAULT_AREA_KIND_COLORS }, wallHeightDefaultM: 2.5, revisionApplications: applications,
    measurements: [
      // user-measured demolition (not tracked by any revision)
      { id: 'manual-demo', pageNumber: 1, tool: 'area', areaKind: 'demolition', areaM2: 8, points: [{x:0,y:0},{x:1,y:0},{x:1,y:1}] },
      // construction wall previously tracked from an earlier revision at x=500 (0..400)
      { id: 'tracked', pageNumber: 1, tool: 'area', areaKind: 'construction', areaM2: 10, calcMode: 'wall', wallLengthM: 4, wallHeightM: 2.5,
        points: [{x:495,y:0},{x:505,y:0},{x:505,y:400},{x:495,y:400}], centerline: [{x:500,y:0},{x:500,y:400}],
        revisionSource: { comparisonId: 'old', revisionId: 'old', changeId: 'old', applicationId: 'old' } },
    ],
  };
}

function setup(context, changes) {
  const c = createEmptyComparison('Workflow', '', 'original.pdf', ['revised.pdf']);
  c.context = context; c.projectId = 'proj'; c.wallHeightDefaultM = 3; c.linkedPlanId = 'P';
  c.pages[1] = { originalPageNumber: 1, originalCalibration: CAL, revisions: {} };
  c.revisions[0].analysis = { pages: { 1: { pageNumber: 1, inputKey: 'x', changes, filteredCount: 0 } } };
  useCompareStore.getState().setComparison(c);
  const pdf = new Blob(['%PDF same']);
  saved.clear();
  saved.set('projects:P', mkPlan());
  saved.set('pdfFiles:P', pdf);
  saved.set(`comparePdfFiles:${c.id}:original`, pdf);
  return c;
}


const door = (x0, x1) => ({ side: 'added', hinge: { x: x0, y: 200 }, jamb: { x: x1, y: 200 }, radiusPx: 90, heightM: 2, wallThicknessPx: 20, impactVerified: true });
const doorChange = (id, x0, x1) => ({ ...wc(id, 'added', { x: 0, y: 0 }, { x: 0, y: 1 }), category: 'door', walls: [], doors: [door(x0, x1)], bbox: { x: x0, y: 180, width: 100, height: 40 } });

test('preview deltas include construction and demolition areas', async () => {
  const c = setup('construction', [wc('add', 'added', { x: 100, y: 0 }, { x: 100, y: 400 }), wc('rem', 'removed', { x: 300, y: 0 }, { x: 300, y: 400 })]);
  const prev = await prepareApplication(c, c.revisions[0].id, 'P');
  const by = Object.fromEntries(prev.deltas.map((d) => [d.column, d]));
  assert.deepEqual([by['area:construction'].before, by['area:construction'].after], [10, 22]);
  assert.deepEqual([by['area:demolition'].before, by['area:demolition'].after], [8, 20]);
});

test('a door in a wall item of the same update is not counted twice, nor the same door in two changes', async () => {
  const c = setup('construction', [wc('wall', 'removed', { x: 100, y: 200 }, { x: 500, y: 200 }), doorChange('d1', 150, 240), doorChange('d1dup', 150, 240), doorChange('d2', 700, 790)]);
  const prev = await prepareApplication(c, c.revisions[0].id, 'P');
  assert.deepEqual(prev.addedItems.filter((m) => m.areaKind === 'demolition').map((m) => m.areaM2), [12, 1.8]);
  assert.ok(prev.reviews.some((r) => r.changeId === 'd1'));
});

test('a door already recorded by an earlier application is not counted again', async () => {
  const c = setup('construction', [doorChange('first', 700, 790)]);
  await commitApplication(await prepareApplication(c, c.revisions[0].id, 'P'), 'R');
  c.revisions[0].analysis.pages[1].changes = [doorChange('first', 700, 790), doorChange('later', 700, 790)];
  const p2 = await prepareApplication(c, c.revisions[0].id, 'P');
  assert.equal(p2.addedItems.length, 0);
  assert.deepEqual(p2.duplicates.map((x) => x.id), ['first']);
});

test('apply, then revert, restores areas and keeps the snapshot', async () => {
  const c = setup('construction', [wc('add', 'added', { x: 100, y: 0 }, { x: 100, y: 400 })]);
  const prev = await prepareApplication(c, c.revisions[0].id, 'P');
  await commitApplication(prev, 'R');
  assert.equal(tally(await loadPlan('P'), 'construction'), 22);
  assert.ok(saved.get(`planVersions:${prev.application.versionId}`));
  await revertApplication('P', prev.application.id);
  assert.equal(tally(await loadPlan('P'), 'construction'), 10);
});
