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

// Geometry of the acceptance plan: 640x420 pt page, outer walls 6 pt thick (inner faces 43..557 x 43..357),
// one divider at x. Rooms are drawn by hand a little inside the faces, as a user would.
const W = 640, H = 420, MPP = 0.02509269356597601;
async function makePdf(divider) {
  const pdf = await PDFDocument.create(); const p = pdf.addPage([W, H]);
  const line = (x1, y1, x2, y2) => p.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness: 6, color: rgb(0, 0, 0) });
  line(40, 40, 560, 40); line(40, 360, 560, 360); line(40, 40, 40, 360); line(560, 40, 560, 360); line(divider, 40, divider, 360);
  return new Blob([await pdf.save()]);
}
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const area = (pts) => { let a = 0; pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }); return Math.abs(a) / 2; };
const m2 = (pts) => area(pts) * MPP * MPP;
const CAL = { pixelDistance: 518.08, realDistanceMeters: 13, metersPerPixel: MPP, space: 'original' };

async function run(roomA, roomB, revisedDivider = 330) {
  const orig = await makePdf(300), rev = await makePdf(revisedDivider);
  const plan = { id: 'P', projectId: 'proj', name: 'Fl', createdAt: 1, updatedAt: 1000, pdfFileName: 'o.pdf', pages: { 1: { pageNumber: 1, calibration: CAL } },
    rooms: [
      { id: 'A', pageNumber: 1, points: roomA, closed: true, name: 'Room 1', apartmentNumber: '', notes: '', color: '#000', workItems: [{ id: 'w1', type: 'tiling', tilingCategory: 'regular' }] },
      { id: 'B', pageNumber: 1, points: roomB, closed: true, name: 'Room 2', apartmentNumber: '', notes: '', color: '#000', workItems: [{ id: 'w2', type: 'tiling', tilingCategory: 'regular' }] },
    ], measurements: [], markups: [], defaultCladdingHeightM: 1.2, defaultPanelHeightM: 0.1,
    defaultTilingWastePercent: 0, defaultTilingAsWastePercent: 0, defaultCladdingWastePercent: 0, defaultPanelsWastePercent: 0,
    areaKindColors: { ...DEFAULT_AREA_KIND_COLORS }, wallHeightDefaultM: 2.5, revisionApplications: [] };
  const change = { id: 'c1', pageNumber: 1, kind: 'modified', category: 'wall', significance: 'high', score: 1, evidence: [], bbox: { x: 0, y: 0, width: 640, height: 420 },
    addedSegments: [], removedSegments: [], walls: [wallFromLine('removed', { x: 300, y: 40 }, { x: 300, y: 360 }, 6), wallFromLine('added', { x: revisedDivider, y: 40 }, { x: revisedDivider, y: 360 }, 6)],
    doors: [], addedLengthPx: 0, removedLengthPx: 0, status: 'approved' };
  const c = createEmptyComparison('Acc', '', 'o.pdf', ['r.pdf']); c.context = 'design'; c.projectId = 'proj'; c.linkedPlanId = 'P'; c.wallHeightDefaultM = 2.5;
  c.pages[1] = { originalPageNumber: 1, originalCalibration: CAL, revisions: {} };
  c.revisions[0].analysis = { pages: { 1: { pageNumber: 1, inputKey: 'x', changes: [change], filteredCount: 0 } } };
  useCompareStore.getState().setComparison(c);
  saved.clear(); docs.clear(); saved.set('projects:P', plan); saved.set('pdfFiles:P', orig);
  saved.set(`comparePdfFiles:${c.id}:original`, orig); saved.set(`comparePdfFiles:${c.id}:revision:${c.revisions[0].id}`, rev);
  return { plan, prev: await prepareApplication(c, c.revisions[0].id, 'P') };
}
const tiling = (p) => buildPlanQuantityReport(p).byCategory.tiling_regular.quantityM2;

test('a relocated divider moves area between the rooms and leaves the total unchanged (hand-drawn boundaries)', async () => {
  // As drawn in the acceptance test: inner faces are 43..297 | 303..557 x 43..357.
  const A = [...rect(44.75, 44.69, 295.48, 356.33), { x: 46.33, y: 354.75 }], B = rect(304.97, 44.69, 554.12, 356.33);
  const { plan, prev } = await run(A, B);
  const moved = (327 - 297) * (357 - 43) * MPP * MPP; // exact geometry: the divider face moves 30 pt over 314 pt
  const a = prev.roomUpdates.find((u) => u.roomId === 'A'), b = prev.roomUpdates.find((u) => u.roomId === 'B');
  const near = (x, y, tol) => assert.ok(Math.abs(x - y) <= tol, `${x} vs ${y} (tol ${tol})`);
  near(a.afterAreaM2 - a.beforeAreaM2, moved, moved * 0.02);
  near(b.beforeAreaM2 - b.afterAreaM2, moved, moved * 0.02);
  near(a.afterAreaM2 + b.afterAreaM2, a.beforeAreaM2 + b.beforeAreaM2, 0.15);
  // The exterior edges stay where the user drew them.
  const xs = (u) => u.points.map((p) => p.x), ys = (u) => u.points.map((p) => p.y);
  near(Math.min(...xs(a)), 44.75, 1); near(Math.max(...xs(b)), 554.12, 1);
  near(Math.min(...ys(a)), 44.69, 1); near(Math.max(...ys(a)), 356.33, 1.5);
  const next = prev.nextPlan;
  near(tiling(next) - tiling(plan), 0, 0.15);
  near(m2(next.rooms[0].points), m2(plan.rooms[0].points) + moved, moved * 0.02);
});

test('a room drawn too far from the wall faces for its boundary convention to be trusted goes to manual review', async () => {
  const { prev } = await run(rect(51, 51, 289, 349), rect(304.97, 44.69, 554.12, 356.33)); // Room 1 about 0.2 m inside the faces
  assert.equal(prev.roomUpdates.length, 0);
  assert.deepEqual(prev.changes, []);
  assert.ok(prev.reviews.some((r) => r.roomId === 'A'));
});
