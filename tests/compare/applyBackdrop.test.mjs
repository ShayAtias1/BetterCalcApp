import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, rgb } from 'pdf-lib';
// Renders real PDFs through pdf.js with the optional native canvas; without it the test is skipped.
let canvasLib = null;
try { canvasLib = await import('@napi-rs/canvas'); } catch { /* optional */ }
if (!canvasLib) { test('revision backdrop on rendered PDFs', { skip: '@napi-rs/canvas is not installed' }, () => {}); process.exit(0); }
const { createCanvas, DOMMatrix: NDM, Path2D: NP2D, ImageData: NID } = canvasLib;
globalThis.DOMMatrix = NDM; globalThis.Path2D = NP2D; globalThis.ImageData = NID;
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

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

// pdf.js documents by cache key, as the app's own caches do.
const docs = new Map();
const open = async (cacheKey, loadBlob) => {
  if (!docs.has(cacheKey)) {
    const blob = await loadBlob();
    if (!blob) throw new Error('PDF file not found in local storage');
    docs.set(cacheKey, pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true }).promise);
  }
  return docs.get(cacheKey);
};
const realCache = await import(`${R}/lib/pdfCache.ts`);
await mock.module(`${R}/lib/pdfCache.ts`, { namedExports: { ...realCache, getPdfDocumentByKey: (k, l) => { const p = open(k, l); p.catch(() => docs.delete(k)); return p; }, clearPdfCache: (k) => docs.delete(k) } });
const realPS = await import(`${R}/lib/planSource.ts`);
await mock.module(`${R}/lib/planSource.ts`, { namedExports: { ...realPS, loadPdfPlanSource: async (k, l, n) => {
  const page = await (await open(k, l)).getPage(n);
  const vp = page.getViewport({ scale: 1 });
  const render = (canvas, scale) => {
    const v = page.getViewport({ scale }); canvas.width = v.width; canvas.height = v.height;
    const task = page.render({ canvasContext: canvas.getContext('2d'), viewport: v, canvas });
    return { promise: task.promise.then(() => undefined), cancel: () => task.cancel() };
  };
  return { source: { pdfPage: page, render, getNativeSize: () => ({ width: vp.width, height: vp.height }), getTextItems: async () => [] }, numPages: 1 };
} } });

const { createEmptyComparison, useCompareStore } = await import(`${R}/store/compareStore.ts`);
const { wallFromLine } = await import(`${R}/lib/revision/changeEdit.ts`);
const { prepareApplication, commitApplication, revertApplication } = await import(`${R}/lib/revision/apply.ts`);
const { AlignedRevisionPage, loadRevisionDrawing, loadPlanDrawing, setDrawingChoice, revisionCoverage, exportCoverageWarning } = await import(`${R}/lib/revision/backdrop.ts`);
const { applyAlignment } = await import(`${R}/lib/alignment.ts`);
const { DEFAULT_AREA_KIND_COLORS, IDENTITY_TRANSFORM } = await import(`${R}/types/compare.ts`);
const { loadPlan, plansUsingRevision } = await import(`${R}/db/database.ts`);

const W = 640, H = 420, SIZE = { width: W, height: H };
async function makePdf(dividerX) {
  const pdf = await PDFDocument.create(); const p = pdf.addPage([W, H]);
  p.drawLine({ start: { x: dividerX, y: 0 }, end: { x: dividerX, y: H }, thickness: 6, color: rgb(0, 0, 0) });
  return new Blob([await pdf.save()]);
}
/** x of the dark column crossing row y of a rendered canvas, in canvas pixels. */
function darkX(canvas, y) {
  const row = canvas.getContext('2d').getImageData(0, y, canvas.width, 1).data;
  const xs = []; for (let x = 0; x < canvas.width; x++) if (row[x * 4] < 128 && row[x * 4 + 3] > 128) xs.push(x);
  return xs.length ? (xs[0] + xs[xs.length - 1] + 1) / 2 : null;
}
async function page(blob, n = 1) { return (await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise).getPage(n); }
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b} (tol ${tol})`);

const ALIGN = { offsetX: -30, offsetY: 0, rotationDeg: 0, scale: 1 };
const PIVOT = { x: W / 2, y: H / 2 };

test('the revised sheet is drawn through its alignment into the plan page space (whole page and region)', async () => {
  const revised = await page(await makePdf(330));
  const plain = new AlignedRevisionPage(revised, IDENTITY_TRANSFORM, SIZE, async () => []);
  const c0 = createCanvas(1, 1); await plain.render(c0, 1).promise;
  assert.deepEqual([c0.width, c0.height], [W, H]);
  near(darkX(c0, 200), 330, 1);

  const shifted = new AlignedRevisionPage(revised, ALIGN, SIZE, async () => []);
  const expected = applyAlignment({ x: 330, y: 200 }, ALIGN, PIVOT).x; // the transform the comparison used
  const c1 = createCanvas(1, 1); await shifted.render(c1, 1).promise;
  near(darkX(c1, 200), expected, 1);
  near(expected, 300, 0.001);

  const c2 = createCanvas(1, 1); await shifted.renderRegion(c2, 2, { x: 250, y: 100, width: 100, height: 100 }).promise;
  assert.deepEqual([c2.width, c2.height], [200, 200]);
  near(darkX(c2, 100), (expected - 250) * 2, 2);
});

test('a missing revised file is reported, not thrown, and loads once it is restored', async () => {
  saved.clear(); docs.clear();
  const plan = { revisionBackdrop: { comparisonId: 'c', revisionId: 'r', applicationId: 'a', pages: { 1: { revisedPageNumber: 1, alignment: ALIGN } } } };
  assert.equal((await loadRevisionDrawing(plan, 1)).status, 'missing');
  assert.equal((await loadRevisionDrawing(plan, 2)).status, 'none');
  assert.equal((await loadRevisionDrawing({}, 1)).status, 'none');
  saved.set('comparePdfFiles:c:revision:r', await makePdf(330));
  assert.equal((await loadRevisionDrawing(plan, 1)).status, 'ok');
});

test('exports use the revised drawing while the plan shows it, the original when it is switched back, and fall back safely', async () => {
  saved.clear(); docs.clear();
  saved.set('pdfFiles:P', await makePdf(300));
  saved.set('comparePdfFiles:c:revision:r', await makePdf(330));
  const plan = { id: 'P', revisionBackdrop: { comparisonId: 'c', revisionId: 'r', applicationId: 'a', pages: { 1: { revisedPageNumber: 1, alignment: IDENTITY_TRANSFORM } } } };
  const dark = async (source) => { const c = createCanvas(1, 1); await source.render(c, 1).promise; return darkX(c, 200); };
  setDrawingChoice('P', 'revised');
  near(await dark(await loadPlanDrawing(plan, 1)), 330, 1);
  setDrawingChoice('P', 'original');
  near(await dark(await loadPlanDrawing(plan, 1)), 300, 1);
  setDrawingChoice('P', 'revised');
  saved.delete('comparePdfFiles:c:revision:r'); docs.clear();
  // revised file gone: never the original behind updated quantities
  await assert.rejects(loadPlanDrawing(plan, 1), (e) => e.code === 'revision-drawing-missing');
  setDrawingChoice('P', 'original'); // the user's explicit choice still exports the original
  near(await dark(await loadPlanDrawing(plan, 1)), 300, 1);
  setDrawingChoice('P', 'revised');
  assert.equal((await loadPlanDrawing({ id: 'P' }, 1)) instanceof AlignedRevisionPage, false);
});

// ---------- apply / revert keep the backdrop with the plan ----------
const CAL = { pixelDistance: 100, realDistanceMeters: 2.5, metersPerPixel: 0.025, space: 'original' };
function mkPlan() {
  return { id: 'P', projectId: 'proj', name: 'Fl', createdAt: 1, updatedAt: 1000, pdfFileName: 'o.pdf', pages: { 1: { pageNumber: 1, calibration: CAL } },
    rooms: [], measurements: [], markups: [], defaultCladdingHeightM: 1.2, defaultPanelHeightM: 0.1,
    defaultTilingWastePercent: 0, defaultTilingAsWastePercent: 0, defaultCladdingWastePercent: 0, defaultPanelsWastePercent: 0,
    areaKindColors: { ...DEFAULT_AREA_KIND_COLORS }, wallHeightDefaultM: 2.5, revisionApplications: [] };
}
function comparison(alignment, changeId) {
  const c = createEmptyComparison('Bd', '', 'o.pdf', ['r.pdf']); c.context = 'design'; c.projectId = 'proj'; c.linkedPlanId = 'P'; c.wallHeightDefaultM = 2.5;
  const rev = c.revisions[0].id;
  c.pages[1] = { originalPageNumber: 1, originalCalibration: CAL, revisions: { [rev]: { revisedPageNumber: 1, revisedCalibration: null, alignment, alignmentPoints: [] } } };
  const change = { id: changeId, pageNumber: 1, kind: 'added', category: 'wall', significance: 'high', score: 1, evidence: [], bbox: { x: 0, y: 0, width: 20, height: 100 },
    addedSegments: [], removedSegments: [], walls: [wallFromLine('added', { x: 10, y: 0 }, { x: 10, y: 100 }, 6)], doors: [], addedLengthPx: 0, removedLengthPx: 0, status: 'approved' };
  c.revisions[0].analysis = { pages: { 1: { pageNumber: 1, inputKey: 'x', changes: [change], filteredCount: 0 } } };
  const pdf = new Blob(['%PDF same']);
  saved.set(`comparePdfFiles:${c.id}:original`, pdf); saved.set('pdfFiles:P', pdf);
  return { c, rev };
}

test('applying records the revision drawing with its alignment; reverting restores the previous drawing; a later revision replaces and unwinds in order', async () => {
  saved.clear();
  saved.set('projects:P', mkPlan());
  const first = comparison(ALIGN, 'w1'); useCompareStore.getState().setComparison(first.c);
  const p1 = await prepareApplication(first.c, first.rev, 'P');
  assert.deepEqual(p1.nextPlan.revisionBackdrop, { comparisonId: first.c.id, revisionId: first.rev, applicationId: p1.application.id, coverage: { applied: 1, total: 1 }, pages: { 1: { revisedPageNumber: 1, alignment: ALIGN } } });
  assert.equal(p1.plan.revisionBackdrop, undefined, 'the preview does not touch the stored plan');
  await commitApplication(p1, 'R1');
  assert.equal((await loadPlan('P')).revisionBackdrop.applicationId, p1.application.id);

  const later = comparison({ ...ALIGN, offsetX: 12 }, 'w2'); useCompareStore.getState().setComparison(later.c);
  const p2 = await prepareApplication(later.c, later.rev, 'P');
  await commitApplication(p2, 'R2');
  const stored = await loadPlan('P');
  assert.equal(stored.revisionBackdrop.applicationId, p2.application.id);
  assert.equal(stored.revisionBackdrop.pages[1].alignment.offsetX, 12);
  assert.equal(stored.measurements.length, 2);

  await revertApplication('P', p2.application.id);
  assert.equal((await loadPlan('P')).revisionBackdrop.applicationId, p1.application.id, 'back to the first revision drawing');
  await revertApplication('P', p1.application.id);
  const original = await loadPlan('P');
  assert.equal(original.revisionBackdrop, undefined, 'back to the original drawing');
  assert.equal(original.measurements.length, 0);
});

test('a comparison with no per-page record, and a multi-page plan, still get a backdrop: same-numbered sheets, unaligned', async () => {
  saved.clear();
  const plan = mkPlan(); plan.pages[2] = { pageNumber: 2, calibration: CAL };
  saved.set('projects:P', plan);
  const { c, rev } = comparison(ALIGN, 'w1');
  c.pages[1].revisions = {}; // never aligned: no record
  useCompareStore.getState().setComparison(c);
  const preview = await prepareApplication(c, rev, 'P');
  assert.deepEqual(preview.nextPlan.revisionBackdrop.pages, {
    1: { revisedPageNumber: 1, alignment: IDENTITY_TRANSFORM },
    2: { revisedPageNumber: 2, alignment: IDENTITY_TRANSFORM },
  });
});

test('a partial application keeps the revised drawing, records and warns about what the quantities leave out, and changes no approval', async () => {
  saved.clear();
  saved.set('projects:P', mkPlan());
  const { c, rev } = comparison(ALIGN, 'w1');
  const extra = { ...c.revisions[0].analysis.pages[1].changes[0], id: 'w2', status: 'pending' };
  const rejected = { ...extra, id: 'w3', status: 'rejected' };
  c.revisions[0].analysis.pages[1].changes.push(extra, rejected);
  useCompareStore.getState().setComparison(c);
  const preview = await prepareApplication(c, rev, 'P');
  assert.deepEqual(preview.nextPlan.revisionBackdrop.coverage, { applied: 1, total: 3 });
  assert.deepEqual(revisionCoverage(preview.nextPlan), { applied: 1, total: 3 });
  assert.deepEqual(c.revisions[0].analysis.pages[1].changes.map((x) => x.status), ['approved', 'pending', 'rejected'], 'approval states untouched');
  await commitApplication(preview, 'R');
  const stored = await loadPlan('P');
  assert.equal(stored.measurements.length, 1, 'only the approved change is in the quantities');

  setDrawingChoice('P', 'revised');
  assert.deepEqual(exportCoverageWarning(stored, 1), { applied: 1, total: 3 });
  setDrawingChoice('P', 'original');
  assert.equal(exportCoverageWarning(stored, 1), null, 'the original drawing carries no revision warning');
  setDrawingChoice('P', 'revised');
  assert.equal(exportCoverageWarning(stored, 2), null, 'a page without a revised sheet');

  // approving the rest and applying again covers everything: the warning goes away; reverting brings it back
  extra.status = 'approved'; rejected.status = 'approved';
  const second = await prepareApplication(c, rev, 'P');
  await commitApplication(second, 'R2');
  const full = await loadPlan('P');
  assert.deepEqual(full.revisionBackdrop.coverage, { applied: 3, total: 3 });
  assert.equal(revisionCoverage(full), null);
  assert.equal(exportCoverageWarning(full, 1), null);
  await revertApplication('P', second.application.id);
  assert.deepEqual(revisionCoverage(await loadPlan('P')), { applied: 1, total: 3 });
});

test('a plan older than coverage tracking, or a fully applied one, shows no partial warning', () => {
  const backdrop = (coverage) => ({ revisionBackdrop: { comparisonId: 'c', revisionId: 'r', applicationId: 'a', coverage, pages: {} } });
  assert.equal(revisionCoverage(backdrop(undefined)), null);
  assert.equal(revisionCoverage(backdrop({ applied: 2, total: 2 })), null);
  assert.equal(revisionCoverage({}), null);
  assert.deepEqual(revisionCoverage(backdrop({ applied: 1, total: 2 })), { applied: 1, total: 2 });
});

test('a revision that a plan shows is reported as in use; others, and a reverted plan, are not', async () => {
  saved.clear();
  const shows = (id, name, comparisonId, revisionId) => saved.set(`projects:${id}`, { id, name, revisionBackdrop: { comparisonId, revisionId, applicationId: 'a', pages: {} } });
  shows('P1', 'Floor 1', 'cmp', 'r1');
  shows('P2', 'Floor 2', 'cmp', 'r2');
  saved.set('projects:P3', { id: 'P3', name: 'Floor 3' });
  assert.deepEqual((await plansUsingRevision('cmp')).sort(), ['Floor 1', 'Floor 2']);
  assert.deepEqual(await plansUsingRevision('cmp', 'r1'), ['Floor 1']);
  assert.deepEqual(await plansUsingRevision('cmp', 'r3'), []);
  assert.deepEqual(await plansUsingRevision('other'), []);
});
