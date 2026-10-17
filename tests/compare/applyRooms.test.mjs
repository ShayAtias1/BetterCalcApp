import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, rgb } from 'pdf-lib';
// Renders real PDFs through pdf.js with the optional native canvas; without it the test is skipped.
let canvasLib = null;
try { canvasLib = await import('@napi-rs/canvas'); } catch { /* optional */ }
if (!canvasLib) { test('room re-trace on rendered PDFs', { skip: '@napi-rs/canvas is not installed' }, () => {}); process.exit(0); }
const { createCanvas, DOMMatrix: NDM, Path2D: NP2D, ImageData: NID } = canvasLib;
globalThis.DOMMatrix = NDM; globalThis.Path2D = NP2D; globalThis.ImageData = NID;
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const origCreate = globalThis.document?.createElement;
globalThis.document = { createElement: (n) => n === 'canvas' ? createCanvas(1, 1) : origCreate?.(n) };

const R = new URL('../../src', import.meta.url).pathname;
const saved = new Map();
const key = (s, v, k) => `${s}:${k ?? v.id}`;
const fakeStore = (s) => ({ put: async (v, k) => saved.set(key(s, v, k), structuredClone(v)), get: async (k) => structuredClone(saved.get(`${s}:${k}`)) });
await mock.module('idb', { namedExports: { openDB: async () => ({
  put: async (s, v, k) => saved.set(key(s, v, k), structuredClone(v)),
  get: async (s, k) => { const v = saved.get(`${s}:${k}`); return v instanceof Blob ? v : structuredClone(v); },
  getAll: async (s) => [...saved.entries()].filter(([k]) => k.startsWith(`${s}:`)).map(([, v]) => structuredClone(v)),
  delete: async (s, k) => saved.delete(`${s}:${k}`),
  transaction: () => ({ objectStore: fakeStore, done: Promise.resolve() }),
}) } });

const docs = new Map();
const realPS = await import(`${R}/lib/planSource.ts`);
await mock.module(`${R}/lib/planSource.ts`, { namedExports: { ...realPS, loadPdfPlanSource: async (cacheKey, loadBlob, pageNumber) => {
  let d = docs.get(cacheKey);
  if (!d) { const buf = new Uint8Array(await (await loadBlob()).arrayBuffer()); d = await pdfjs.getDocument({ data: buf, useSystemFonts: true }).promise; docs.set(cacheKey, d); }
  return { source: { pdfPage: await d.getPage(pageNumber) }, numPages: d.numPages };
} } });

const { createEmptyComparison, useCompareStore } = await import(`${R}/store/compareStore.ts`);
const { wallFromLine } = await import(`${R}/lib/revision/changeEdit.ts`);
const { prepareApplication, commitApplication, revertApplication } = await import(`${R}/lib/revision/apply.ts`);
const { traceRoomAtSeeds } = await import(`${R}/lib/roomDetection.ts`);
const { DEFAULT_AREA_KIND_COLORS } = await import(`${R}/types/compare.ts`);
const { loadPlan } = await import(`${R}/db/database.ts`);
const { buildPlanQuantityReport } = await import(`${R}/lib/projectQuantities.ts`);

const W = 400, H = 300;
// Plan: outer walls 6pt, divider at x; optional gaps. y is PDF-up, so flip.
async function makePdf({ divider = 200, gapOuter = false, gapDivider = 0 } = {}) {
  const pdf = await PDFDocument.create(); const p = pdf.addPage([W, H]);
  const line = (x1, y1, x2, y2, th = 6) => p.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness: th, color: rgb(0, 0, 0) });
  line(40, 40, 360, 40); line(40, 260, 360, 260); line(40, 40, 40, 260);
  if (gapOuter) { line(360, 40, 360, 130); line(360, 170, 360, 260); } else line(360, 40, 360, 260);
  if (divider) { if (gapDivider) { line(divider, 40, divider, 130); line(divider, 130 + gapDivider, divider, 260); } else line(divider, 40, divider, 260); }
  return new Blob([await pdf.save()]);
}
const CAL = { pixelDistance: 100, realDistanceMeters: 5, metersPerPixel: 0.05, space: 'original' };
async function render(blob) {
  const d = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise; const page = await d.getPage(1);
  const cv = createCanvas(W * 2, H * 2); const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W * 2, H * 2);
  await page.render({ canvasContext: ctx, canvas: cv, viewport: page.getViewport({ scale: 1 }), transform: [2, 0, 0, 2, 0, 0] }).promise;
  return ctx.getImageData(0, 0, W * 2, H * 2);
}
const wc = (id, walls, extra = {}) => ({ id, pageNumber: 1, kind: 'modified', category: 'wall', significance: 'high', score: 1, evidence: [],
  bbox: { x: 0, y: 0, width: 400, height: 300 }, addedSegments: [], removedSegments: [], walls, doors: [], addedLengthPx: 0, removedLengthPx: 0, status: 'approved', ...extra });

async function scenario(name, revisedOpts, wallsFn, { context = 'design', extra = [] } = {}) {
  const orig = await makePdf(); const rev = await makePdf(revisedOpts);
  const roomA = traceRoomAtSeeds(await render(orig), 2, [{ x: 120, y: 150 }]);
  const roomB = traceRoomAtSeeds(await render(orig), 2, [{ x: 280, y: 150 }]);
  const plan = { id: 'P', projectId: 'proj', name: 'Fl', createdAt: 1, updatedAt: 1000, pdfFileName: 'o.pdf', pages: { 1: { pageNumber: 1, calibration: CAL } },
    rooms: [
      { id: 'A', pageNumber: 1, points: roomA, closed: true, name: 'Room A', apartmentNumber: '1', notes: '', color: '#000', workItems: [{ id: 'w1', type: 'tiling', tilingCategory: 'regular' }] },
      { id: 'B', pageNumber: 1, points: roomB, closed: true, name: 'Room B', apartmentNumber: '1', notes: '', color: '#000', workItems: [{ id: 'w2', type: 'tiling', tilingCategory: 'regular' }] },
    ], measurements: [], markups: [], defaultCladdingHeightM: 1.2, defaultPanelHeightM: 0.1,
    defaultTilingWastePercent: 0, defaultTilingAsWastePercent: 0, defaultCladdingWastePercent: 0, defaultPanelsWastePercent: 0,
    areaKindColors: { ...DEFAULT_AREA_KIND_COLORS }, wallHeightDefaultM: 2.5, revisionApplications: [] };
  const c = createEmptyComparison(name, '', 'o.pdf', ['r.pdf']); c.context = context; c.projectId = 'proj'; c.linkedPlanId = 'P'; c.wallHeightDefaultM = 2.5;
  c.pages[1] = { originalPageNumber: 1, originalCalibration: CAL, revisions: {} };
  c.revisions[0].analysis = { pages: { 1: { pageNumber: 1, inputKey: 'x', changes: [wc('c1', wallsFn()), ...extra], filteredCount: 0 } } };
  useCompareStore.getState().setComparison(c);
  saved.clear(); docs.clear(); saved.set('projects:P', plan); saved.set('pdfFiles:P', orig);
  saved.set(`comparePdfFiles:${c.id}:original`, orig); saved.set(`comparePdfFiles:${c.id}:revision:${c.revisions[0].id}`, rev);
  const prev = await prepareApplication(c, c.revisions[0].id, 'P');
  return { c, prev, rooms: Object.fromEntries(prev.roomUpdates.map((u) => [u.roomId, u])), reviewed: (id) => prev.reviews.some((x) => x.roomId === id) };
}
const move = (from, to) => () => [wallFromLine('removed', { x: from, y: 40 }, { x: from, y: 260 }, 6), wallFromLine('added', { x: to, y: 40 }, { x: to, y: 260 }, 6)];
const tiling = (p) => buildPlanQuantityReport(p).byCategory.tiling_regular.quantityM2;

test('a moved divider grows the room; the room on the wall\'s far side is sent to review, not misread', async () => {
  const { prev, reviewed } = await scenario('S1', { divider: 280 }, move(200, 280));
  assert.ok(reviewed('B'));
  // Room A alone would have been updatable, but the change also affects B: nothing of it is applied.
  assert.equal(prev.roomUpdates.length, 0);
  assert.equal(prev.addedItems.length, 0);
  assert.deepEqual(prev.changes, []);
  assert.deepEqual(prev.unapplied.map((c) => c.id), ['c1']);
  assert.ok(prev.reviews.some((r) => r.changeId === 'c1' && !r.roomId));
  assert.deepEqual(prev.deltas, []);
});

const outside = (id) => wc(id, [wallFromLine('added', { x: 390, y: 60 }, { x: 390, y: 120 }, 6)]);
const insideA = (id) => wc(id, [wallFromLine('added', { x: 100, y: 100 }, { x: 100, y: 120 }, 6)]);

test('a withheld change does not stop an unrelated verified change from applying', async () => {
  const { prev } = await scenario('S1b', { divider: 280 }, move(200, 280), { extra: [outside('free')] });
  assert.deepEqual(prev.changes.map((c) => c.id), ['free']);
  assert.deepEqual(prev.application.changes.map((c) => c.changeId), ['free']);
  assert.equal(prev.addedItems.length, 1);
  assert.equal(prev.addedItems[0].revisionSource.changeId, 'free');
  assert.equal(prev.roomUpdates.length, 0);
  assert.deepEqual(prev.unapplied.map((c) => c.id), ['c1']);
  // Commit and revert keep working on the partial application.
  const before = tiling(await loadPlan('P'));
  await commitApplication(prev, 'R');
  const after = await loadPlan('P');
  assert.equal(tiling(after), before);
  assert.equal(after.measurements.length, 1);
  await revertApplication('P', prev.application.id);
  assert.equal((await loadPlan('P')).measurements.length, 0);
});

test('a room shared by a withheld change and another change withholds both', async () => {
  const { prev } = await scenario('S1c', { divider: 280 }, move(200, 280), { extra: [insideA('shares-A')] });
  assert.equal(prev.roomUpdates.length, 0);
  assert.deepEqual(prev.changes, []);
  assert.deepEqual(prev.unapplied.map((c) => c.id).sort(), ['c1', 'shares-A']);
  assert.equal(prev.addedItems.length, 0);
});

test('every affected room verified: the change applies in full', async () => {
  const { prev, rooms } = await scenario('S5b', { divider: 215 }, move(200, 215), { extra: [outside('free')] });
  assert.deepEqual(prev.changes.map((c) => c.id).sort(), ['c1', 'free']);
  assert.ok(rooms.A && rooms.B);
});

test('a divider removed (rooms merge) updates nothing and asks for review', async () => {
  const { prev, reviewed } = await scenario('S2', { divider: 0 }, () => [wallFromLine('removed', { x: 200, y: 40 }, { x: 200, y: 260 }, 6)]);
  assert.equal(prev.roomUpdates.length, 0);
  assert.ok(reviewed('A') && reviewed('B'));
});

test('a trace that does not overlap the old room is never accepted', async () => {
  const { prev, reviewed } = await scenario('S4', { divider: 100 }, move(200, 100));
  assert.ok(!prev.roomUpdates.some((u) => u.roomId === 'A'));
  assert.ok(reviewed('A'));
});

test('a small move updates both rooms consistently, and apply + revert restores the totals', async () => {
  const { prev, rooms } = await scenario('S5', { divider: 215 }, move(200, 215));
  assert.ok(rooms.A.afterAreaM2 > rooms.A.beforeAreaM2 && rooms.B.afterAreaM2 < rooms.B.beforeAreaM2);
  const before = tiling(await loadPlan('P'));
  await commitApplication(prev, 'R');
  assert.ok(Math.abs(tiling(await loadPlan('P')) - before) < 0.1);
  await revertApplication('P', prev.application.id);
  assert.equal(tiling(await loadPlan('P')), before);
});
