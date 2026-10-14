import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// IndexedDB stand-in with the transaction shape the plan/version writes use.
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

const { createEmptyComparison, useCompareStore } = await import('../../src/store/compareStore.ts');
const { addElement, hasUnplacedLines, setElementLine, wallFromLine } = await import('../../src/lib/revision/changeEdit.ts');
const { changeItems } = await import('../../src/lib/revision/changeItems.ts');
const { sameChange } = await import('../../src/lib/revision/changeMatch.ts');
const { analysisInputKey } = await import('../../src/lib/revision/detect.ts');
const { prepareApplication, revertApplication } = await import('../../src/lib/revision/apply.ts');
const { DEFAULT_AREA_KIND_COLORS } = await import('../../src/types/compare.ts');

const CAL = { pixelDistance: 100, realDistanceMeters: 1, metersPerPixel: 0.01, space: 'original' };
const store = () => useCompareStore.getState();
const current = () => store().comparison;
const pageChanges = () => current().revisions[0].analysis.pages[1].changes;

function wallChange(id, overrides = {}) {
  return {
    id, pageNumber: 1, kind: 'added', category: 'wall', significance: 'high', score: 1, evidence: [],
    bbox: { x: 0, y: 0, width: 20, height: 120 }, addedSegments: [], removedSegments: [],
    walls: [wallFromLine('added', { x: 10, y: 0 }, { x: 10, y: 100 }, 10)], doors: [],
    addedLengthPx: 0, removedLengthPx: 0, status: 'pending', ...overrides,
  };
}

function fixture({ calibrated = true, changes = [wallChange('w')], context = 'construction' } = {}) {
  const c = createEmptyComparison('Fixes', '', 'original.pdf', ['revision.pdf']);
  c.context = context;
  c.pages[1] = { originalPageNumber: 1, originalCalibration: calibrated ? CAL : null, revisions: {} };
  c.revisions[0].analysis = { pages: { 1: { pageNumber: 1, inputKey: 'x', changes, filteredCount: 0 } } };
  store().setComparison(c);
  return c;
}

// ---------- 1. placeholder geometry ----------

test('manual walls require completed footprints; relocated walls require both versions before saving', () => {
  fixture({ changes: [] });
  const before = [{x:300,y:300},{x:400,y:300},{x:400,y:320},{x:300,y:320}];
  const after = [{x:300,y:350},{x:500,y:350},{x:500,y:380},{x:300,y:380}];
  const snapshot = store().captureEditSnapshot();
  assert.equal(store().addManualRevisionChange(1, 'wall-added', before[0]), null);
  assert.equal(store().addManualRevisionChange(1, 'wall-relocated', before[0], [before]), null);
  assert.equal(store().addManualRevisionChange(1, 'wall-added', before[0], [[before[0],before[1],before[1],before[0]]]), null);
  assert.equal(current(), snapshot.comparison);
  assert.equal(store().history, snapshot.history);
  assert.equal(pageChanges().length, 0);
  assert.equal(current().revisions[0].measurements.length, 0);
  const id = store().addManualRevisionChange(1, 'wall-relocated', before[0], [before,after]);
  const change = pageChanges().find((c) => c.id === id);
  assert.equal(hasUnplacedLines(change), false);
  assert.deepEqual(change.walls.map(w=>w.footprint), [before,after]);
  assert.deepEqual(change.walls.map(w=>w.side), ['removed','added']);
  assert.equal(change.relocation.beforeLengthPx, 100);
  assert.equal(change.relocation.afterLengthPx, 200);
  assert.equal(current().revisions[0].measurements.length, 0, 'items still require approval');
  store().reviewRevisionChange(1, id, 'approved');
  assert.equal(pageChanges().find((c) => c.id === id).status, 'approved');
  assert.equal(current().revisions[0].measurements.length, 2);
  assert.deepEqual(current().revisions[0].measurements.map(m=>m.areaM2), [2.5,5]);
  store().undo();
  store().undo();
  assert.equal(pageChanges().length, 0);
  store().redo();
  assert.deepEqual(pageChanges()[0].walls.map(w=>w.footprint), [before,after]);
});

test('adding a new line to an approved change withdraws its approval until the line is placed', () => {
  fixture();
  store().reviewRevisionChange(1, 'w', 'approved');
  assert.equal(current().revisions[0].measurements.length, 1);
  store().editRevisionChange(1, 'w', (c) => addElement(c, 'added', 0.01));
  assert.equal(pageChanges()[0].status, 'pending');
  assert.equal(current().revisions[0].measurements.length, 0);
});

// ---------- 3/4. undo history and paid AI results ----------

test('undo cannot reach back across an application to the plan', () => {
  fixture();
  store().reviewRevisionChange(1, 'w', 'approved');
  store().setRevisionChangesStatus(current().revisions[0].id, ['w'], 'applied');
  store().undo();
  assert.equal(pageChanges()[0].status, 'applied');
  assert.equal(store().history.length, 0);
});

test('undo keeps an in-flight AI run, and an arrived AI result cannot be undone away', () => {
  fixture({ changes: [wallChange('manual', { manual: true })] });
  const revisionId = current().revisions[0].id;
  const run = { task: 'page', requestId: 'revision-1', status: 'PROCESSING', changeIds: [], submittedAt: 1, updatedAt: 1 };
  const meta = { pageNumber: 1, inputKey: 'x', method: 'raster', baseRevisionId: null, createdAt: 1,
    alignment: { status: 'good', residualPx: 0, residualMm: null, inlierRatio: 1, tolerancePx: 1, correction: { dx: 0, dy: 0, rotationDeg: 0 } },
    usedAlignment: { offsetX: 0, offsetY: 0, rotationDeg: 0, scale: 1 } };
  store().beginRevisionAiAnalysis(revisionId, meta, null, run);
  assert.equal(store().history.length, 0);
  store().reviewRevisionChange(1, 'manual', 'approved');
  store().undo();
  assert.equal(current().revisions[0].analysis.pages[1].ai.requestId, 'revision-1');
  // The result still lands on the page after the undo.
  store().mergeRevisionAiChanges(revisionId, 1, 'revision-1', [wallChange('ai', { bbox: { x: 900, y: 900, width: 10, height: 10 } })]);
  assert.ok(pageChanges().some((c) => c.id === 'ai'));
  store().undo();
  assert.ok(pageChanges().some((c) => c.id === 'ai'), 'paid result survives undo');
  assert.equal(current().revisions[0].analysis.pages[1].ai.status, 'COMPLETED');
});

test('a failed free pre-check keeps the page\'s existing proposals', () => {
  fixture({ changes: [wallChange('paid')] });
  const revisionId = current().revisions[0].id;
  const meta = { pageNumber: 1, inputKey: 'other-inputs', method: 'raster', baseRevisionId: null, createdAt: 2,
    alignment: { status: 'poor', residualPx: 9, residualMm: null, inlierRatio: 0.1, tolerancePx: 1, correction: { dx: 0, dy: 0, rotationDeg: 0 } },
    usedAlignment: { offsetX: 0, offsetY: 0, rotationDeg: 0, scale: 1 } };
  store().beginRevisionAiAnalysis(revisionId, meta, null, { task: 'page', requestId: '', status: 'FAILED', changeIds: [], submittedAt: 2, updatedAt: 2, error: 'poor' });
  const page = current().revisions[0].analysis.pages[1];
  assert.deepEqual(page.changes.map((c) => c.id), ['paid']);
  assert.equal(page.inputKey, 'x');
  assert.equal(page.alignment.status, 'poor');
});

// ---------- 6. calibration ----------

function calibrate(meters) {
  store().startCalibration('original');
  store().addCalibrationPoint({ x: 0, y: 0 });
  store().addCalibrationPoint({ x: 100, y: 0 });
  store().applyCalibration(meters);
}

test('a change approved before calibration gains its items when the sheet is calibrated', () => {
  fixture({ calibrated: false });
  store().reviewRevisionChange(1, 'w', 'approved');
  assert.equal(current().revisions[0].measurements.length, 0);
  calibrate(1);
  assert.equal(pageChanges()[0].measurementIds.length, 1);
  assert.equal(current().revisions[0].measurements[0].wallLengthM, 1);
});

test('recalibrating keeps a full-plan AI result current instead of locking it as stale', () => {
  const c = fixture();
  const revisionId = c.revisions[0].id;
  const page = c.revisions[0].analysis.pages[1];
  c.revisions[0].analysis.pages[1] = { ...page, inputKey: analysisInputKey(c, revisionId, 1), ai: { task: 'page', requestId: 'revision-2', status: 'COMPLETED', changeIds: [], submittedAt: 1, updatedAt: 1 } };
  store().setComparison(c);
  calibrate(2);
  const after = current();
  assert.equal(after.revisions[0].analysis.pages[1].inputKey, analysisInputKey(after, revisionId, 1));
});

test('changing the default wall height updates the approved items the preview was built from', () => {
  fixture();
  store().reviewRevisionChange(1, 'w', 'approved');
  store().updateComparisonMeta({ wallHeightDefaultM: 3 });
  const item = current().revisions[0].measurements[0];
  assert.equal(item.wallHeightM, 3);
  assert.equal(item.areaM2, 3);
});

// ---------- 7. duplicates ----------

test('an added element next to a removed one is a different change', () => {
  const a = wallChange('a');
  assert.equal(sameChange(a, { ...a, id: 'b', kind: 'removed' }), false);
  assert.equal(sameChange(a, { ...a, id: 'b' }), true);
});

// ---------- 2/5/6/7. applying to the linked plan ----------

function plan(id, metersPerPixel, applications = []) {
  return {
    id, projectId: 'p', name: 'Plan', createdAt: 1, updatedAt: 1, pdfFileName: 'original.pdf',
    pages: metersPerPixel ? { 1: { pageNumber: 1, calibration: { metersPerPixel, pixelDistance: 100, realDistanceMeters: 100 * metersPerPixel } } } : {},
    rooms: [], measurements: [], markups: [], defaultCladdingHeightM: 1.2, defaultPanelHeightM: 0.1,
    defaultTilingWastePercent: 0, defaultTilingAsWastePercent: 0, defaultCladdingWastePercent: 0, defaultPanelsWastePercent: 0,
    areaKindColors: { ...DEFAULT_AREA_KIND_COLORS }, wallHeightDefaultM: 2.5, revisionApplications: applications,
  };
}

async function linked(planValue, changes = [wallChange('w', { status: 'approved' })]) {
  const c = fixture({ changes });
  c.wallHeightDefaultM = 3;
  const pdf = new Blob(['%PDF same file']);
  saved.set(`projects:${planValue.id}`, planValue);
  saved.set(`pdfFiles:${planValue.id}`, pdf);
  saved.set(`comparePdfFiles:${c.id}:original`, pdf);
  return c;
}

test('an uncalibrated plan receives nothing, and nothing is marked applied', async () => {
  const c = await linked(plan('uncal', 0));
  const preview = await prepareApplication(c, c.revisions[0].id, 'uncal');
  assert.equal(preview.changes.length, 0);
  assert.deepEqual(preview.unapplied.map((x) => x.id), ['w']);
  assert.equal(preview.application.changes.length, 0);
  assert.equal(preview.reviews.length, 1);
});

test('a plan calibrated differently from the comparison is not updated with other quantities', async () => {
  const c = await linked(plan('mismatch', 0.02));
  const preview = await prepareApplication(c, c.revisions[0].id, 'mismatch');
  assert.equal(preview.changes.length, 0);
  assert.equal(preview.addedItems.length, 0);
  assert.match(preview.reviews[0].reason, /50/);
});

test('a matching plan gets the previewed quantities (comparison wall height), recorded as applied', async () => {
  const c = await linked(plan('match', 0.01));
  const preview = await prepareApplication(c, c.revisions[0].id, 'match');
  assert.deepEqual(preview.changes.map((x) => x.id), ['w']);
  assert.equal(preview.addedItems[0].areaM2, 3);
  assert.deepEqual(preview.application.changes.map((x) => x.changeId), ['w']);
});

test('a different change at the location of an applied one is applied, not skipped as a duplicate', async () => {
  const c = await linked(plan('dup', 0.01), [wallChange('w', { status: 'approved' }), wallChange('earlier', { status: 'approved' })]);
  const prior = { id: 'app1', comparisonId: c.id, revisionId: c.revisions[0].id, baseRevisionId: null, context: 'construction', appliedAt: 1, status: 'applied', versionId: 'v1',
    changes: [{ changeId: 'earlier', pageNumber: 1, kind: 'added', category: 'wall', bbox: { x: 0, y: 0, width: 20, height: 120 } }],
    measurementIds: [], openingIds: [], roomIds: [], reviews: [] };
  saved.set('projects:dup', plan('dup', 0.01, [prior]));
  const preview = await prepareApplication(c, c.revisions[0].id, 'dup');
  assert.deepEqual(preview.changes.map((x) => x.id), ['w'], 'same bbox, different change: applied');
  assert.deepEqual(preview.duplicates.map((x) => x.id), ['earlier'], 'same id: already in the ledger');
});

test('reverting an application that a later comparison built on is refused', async () => {
  const app = (id, comparisonId) => ({ id, comparisonId, revisionId: 'r', baseRevisionId: null, context: 'design', appliedAt: 1, status: 'applied', versionId: `v-${id}`, changes: [], measurementIds: [], openingIds: [], roomIds: [], reviews: [] });
  saved.set('projects:multi', plan('multi', 0.01, [app('A', 'comparison-a'), app('B', 'comparison-b')]));
  saved.set('planVersions:v-A', { id: 'v-A', planId: 'multi', createdAt: 1, reason: 'revision-apply', label: 'A', plan: plan('multi', 0.01) });
  await assert.rejects(revertApplication('multi', 'A'), /revert-not-latest/);
  saved.set('planVersions:v-B', { id: 'v-B', planId: 'multi', createdAt: 1, reason: 'revision-apply', label: 'B', plan: plan('multi', 0.01, [app('A', 'comparison-a')]) });
  const reverted = await revertApplication('multi', 'B');
  assert.equal(reverted.id, 'B');
});

// ---------- UI/UX round: approved walls as ordinary items, change notes, notices ----------

const { itemEditable } = await import('../../src/store/compareStore.ts');
const { changeNoteKey } = await import('../../src/lib/revision/changeEdit.ts');
const { noticeDuration } = await import('../../src/lib/appDialogs.ts');

test('an approved wall is edited directly as an item: geometry and height go to its change, the item keeps its id', () => {
  fixture();
  store().reviewRevisionChange(1, 'w', 'approved');
  const item = current().revisions[0].measurements[0];
  assert.deepEqual(item.revisionElement, { list: 'walls', index: 0 });
  assert.equal(itemEditable(current(), item), true);
  const moved = item.points.map((p) => ({ x: p.x + 50, y: p.y }));
  store().updateMeasurement(item.id, { points: moved }, true);
  store().updateMeasurement(item.id, {});
  let after = current().revisions[0].measurements[0];
  assert.equal(after.id, item.id, 'selection and drag target survive the edit');
  assert.equal(pageChanges()[0].walls[0].centerline[0].x, 60);
  assert.equal(pageChanges()[0].status, 'approved');
  store().updateMeasurement(item.id, { wallHeightM: 3 });
  after = current().revisions[0].measurements[0];
  assert.equal(pageChanges()[0].walls[0].heightM, 3);
  assert.equal(after.areaM2, 3);
  store().undo();
  assert.equal(current().revisions[0].measurements[0].areaM2, 2.5);
});

test('items of applied changes stay read-only', () => {
  fixture();
  store().reviewRevisionChange(1, 'w', 'approved');
  store().setRevisionChangesStatus(current().revisions[0].id, ['w'], 'applied');
  const item = current().revisions[0].measurements[0];
  assert.equal(itemEditable(current(), item), false);
  store().updateMeasurement(item.id, { points: item.points.map((p) => ({ x: p.x + 5, y: p.y })) });
  assert.equal(pageChanges()[0].walls[0].centerline[0].x, 10);
});

test('plan notes describe the change in a few words, from existing change data', () => {
  const door = (side, w) => ({ side, hinge: { x: 0, y: 0 }, jamb: { x: w, y: 0 }, radiusPx: w });
  const opening = { ...wallChange('o'), walls: [], kind: 'modified', category: 'opening', userType: 'opening-modified', doors: [door('removed', 80), door('added', 100)] };
  assert.equal(changeNoteKey(opening), 'revisionAi.note.openingWidened');
  assert.equal(changeNoteKey({ ...opening, doors: [door('removed', 100), door('added', 80)] }), 'revisionAi.note.openingNarrowed');
  assert.equal(changeNoteKey({ ...wallChange('r'), userType: 'wall-relocated' }), 'revisionAi.note.wall-relocated');
  assert.equal(changeNoteKey({ ...wallChange('d'), walls: [], category: 'opening', doors: [door('added', 90)] }), 'revisionAi.note.door-added');
});

test('notices dismiss themselves after a readable time', () => {
  assert.equal(noticeDuration('short'), 4250);
  assert.equal(noticeDuration('x'.repeat(1000)), 12000);
});
