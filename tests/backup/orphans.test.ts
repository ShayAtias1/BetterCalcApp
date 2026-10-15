import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { openDB } from 'idb';
import { deletePlan, deleteProject, deleteOrphans, listProjects, scanOrphans } from '../../src/db/database';
import { detectOrphans, totalCleanable, type OrphanSnapshot } from '../../src/lib/orphans';

const STORES = [
  'takeoffProjects', 'projects', 'pdfFiles', 'comparisons', 'comparePdfFiles', 'planVersions',
  'aiReviews', 'openingsAiReviews', 'aiJobs', 'openingsAiJobs', 'aiBatches',
] as const;
const pdf = (t: string) => new Blob([`%PDF ${t}`], { type: 'application/pdf' });

async function raw() {
  await listProjects();
  return openDB('bettercalc-qto');
}
async function clearAll() {
  const db = await raw();
  const tx = db.transaction([...STORES], 'readwrite');
  for (const s of STORES) await tx.objectStore(s).clear();
  await tx.done;
  db.close();
}
async function dump() {
  const db = await raw();
  const out: Record<string, [IDBValidKey, unknown][]> = {};
  for (const s of STORES) {
    const keys = await db.getAllKeys(s);
    const values = await db.getAll(s);
    out[s] = await Promise.all(keys.map(async (k, i) => [k, values[i] instanceof Blob ? `blob:${await values[i].text()}` : values[i]] as [IDBValidKey, unknown]));
  }
  db.close();
  return out;
}
const keysOf = (d: Awaited<ReturnType<typeof dump>>, s: string) => d[s].map(([k]) => String(k)).sort();

const plan = (id: string, projectId?: string) => ({
  id, ...(projectId ? { projectId } : {}), name: id, createdAt: 1, updatedAt: 1, pdfFileName: `${id}.pdf`, pages: {}, rooms: [],
  measurements: [], markups: [], defaultCladdingHeightM: 2.5, defaultTilingWastePercent: 5, defaultCladdingWastePercent: 5,
  defaultPanelsWastePercent: 5, areaKindColors: {}, wallHeightDefaultM: 2.6,
});
const version = (id: string, planId: string) => ({ id, planId, createdAt: 1, reason: 'revision-apply', label: 'v', plan: plan(planId) });
const review = (key: string, planId: string) => ({ key, planId, pageNumber: 1, sourceHash: 'h', candidates: [], resolvedIds: [], updatedAt: 1 });
const opening = (key: string, planId: string) => ({ task: 'openings-v1', key, planId, pageNumber: 1, sourceHash: 'h', importId: 'i', candidates: [], deferred: [], coverageNotes: [] });
const comparison = (id: string, projectId: string, revisions: string[] | null) => ({
  id, projectId, name: id, apartmentNumber: '', notes: '', createdAt: 1, updatedAt: 1, originalFileName: 'o', originalOpacity: 1,
  originalVisible: true, originalColorTint: '#000', originalUseSourceColors: false, pages: {},
  ...(revisions ? { revisions: revisions.map((r) => ({ id: r, label: r, fileName: r, opacity: 1, visible: true, colorTint: '#f00', useSourceColors: false, markups: [], measurements: [] })), activeRevisionId: revisions[0] } : {}),
  areaKindColors: {}, wallHeightDefaultM: 2.6,
});

async function seedValid() {
  const db = await raw();
  await db.put('takeoffProjects', { id: 'P1', name: 'one', createdAt: 1, updatedAt: 1, planIds: ['A', 'B'], comparisonIds: ['C1'] });
  await db.put('takeoffProjects', { id: 'P2', name: 'two', createdAt: 1, updatedAt: 1, planIds: ['D'], comparisonIds: [] });
  for (const [id, proj] of [['A', 'P1'], ['B', 'P1'], ['D', 'P2']] as const) {
    await db.put('projects', plan(id, proj));
    await db.put('pdfFiles', pdf(id), id);
    await db.put('planVersions', version(`V-${id}`, id));
    await db.put('aiReviews', review(`${id}:1:h`, id));
    await db.put('openingsAiReviews', opening(`o-${id}`, id));
  }
  await db.put('comparisons', comparison('C1', 'P1', ['R1']));
  await db.put('comparePdfFiles', pdf('c1 orig'), 'C1:original');
  await db.put('comparePdfFiles', pdf('c1 r1'), 'C1:revision:R1');
  db.close();
}

beforeEach(clearAll);

test('deletePlan removes that plan\'s versions and AI reviews and nothing else', async () => {
  await seedValid();
  await deletePlan('A');
  const d = await dump();
  assert.deepEqual(keysOf(d, 'projects'), ['B', 'D']);
  assert.deepEqual(keysOf(d, 'pdfFiles'), ['B', 'D']);
  assert.deepEqual(keysOf(d, 'planVersions'), ['V-B', 'V-D']);
  assert.deepEqual(keysOf(d, 'aiReviews'), ['B:1:h', 'D:1:h']);
  assert.deepEqual(keysOf(d, 'openingsAiReviews'), ['o-B', 'o-D']);
  assert.deepEqual((d.takeoffProjects.find(([k]) => k === 'P1')![1] as { planIds: string[] }).planIds, ['B']);
});

test('deleteProject removes every dependent of its plans and leaves other projects intact', async () => {
  await seedValid();
  await deleteProject('P1');
  const d = await dump();
  assert.deepEqual(keysOf(d, 'takeoffProjects'), ['P2']);
  assert.deepEqual(keysOf(d, 'projects'), ['D']);
  assert.deepEqual(keysOf(d, 'planVersions'), ['V-D']);
  assert.deepEqual(keysOf(d, 'aiReviews'), ['D:1:h']);
  assert.deepEqual(keysOf(d, 'openingsAiReviews'), ['o-D']);
  assert.deepEqual(keysOf(d, 'comparisons'), []);
  assert.deepEqual(keysOf(d, 'comparePdfFiles'), []);
});

test('a clean database has no orphans', async () => {
  await seedValid();
  const report = await scanOrphans();
  assert.equal(totalCleanable(report), 0);
  assert.deepEqual(report.reportOnly.danglingPlanRefs, []);
});

async function seedOrphans() {
  await seedValid();
  const db = await raw();
  // Cleanable: the owners do not exist.
  await db.put('planVersions', version('V-gone', 'GONE'));
  await db.put('aiReviews', review('GONE:1:h', 'GONE'));
  await db.put('openingsAiReviews', opening('o-gone', 'GONE'));
  await db.put('pdfFiles', pdf('gone'), 'GONE');
  await db.put('comparePdfFiles', pdf('x'), 'CGONE:original');
  await db.put('comparePdfFiles', pdf('x'), 'CGONE:revision:R9');
  await db.put('aiJobs', { requestId: 'job-done', planId: 'GONE', pageNumber: 1, sourceHash: 'h', status: 'COMPLETED', createdAt: 1, updatedAt: 1 });
  await db.put('openingsAiJobs', { requestId: 'ojob-done', planId: 'GONE', pageNumber: 1, sourceHash: 'h', status: 'FAILED' });
  // Report-only: could be live work or user data.
  await db.put('aiJobs', { requestId: 'job-running', planId: 'GONE', pageNumber: 1, sourceHash: 'h', status: 'PROCESSING', createdAt: 1, updatedAt: 1 });
  await db.put('comparePdfFiles', pdf('late'), 'C1:revision:R-new');
  await db.put('projects', plan('LOST', 'NO-SUCH-PROJECT'));
  await db.put('takeoffProjects', { id: 'P3', name: 'dangling', createdAt: 1, updatedAt: 1, planIds: ['MISSING'], comparisonIds: ['CMISSING'] });
  // Legacy shapes that are valid and must survive.
  await db.put('projects', plan('LEGACY'));
  await db.put('pdfFiles', pdf('legacy'), 'LEGACY');
  await db.put('planVersions', version('V-legacy', 'LEGACY'));
  await db.put('comparisons', comparison('CL', 'P1', null));
  await db.put('comparePdfFiles', pdf('l o'), 'CL:original');
  await db.put('comparePdfFiles', pdf('l r'), 'CL:revised');
  db.close();
}

test('detection classifies cleanable and report-only records, and spares valid and legacy data', async () => {
  await seedOrphans();
  const r = await scanOrphans();
  assert.deepEqual(r.cleanable.planVersions, ['V-gone']);
  assert.deepEqual(r.cleanable.aiReviews, ['GONE:1:h']);
  assert.deepEqual(r.cleanable.openingsAiReviews, ['o-gone']);
  assert.deepEqual(r.cleanable.pdfFiles, ['GONE']);
  assert.deepEqual(r.cleanable.comparePdfFiles.sort(), ['CGONE:original', 'CGONE:revision:R9']);
  // Jobs are never cleanable: finished ones hold cost history, running ones are live work.
  assert.deepEqual(r.reportOnly.finishedJobsForMissingPlans.sort(), ['job-done', 'ojob-done']);
  assert.deepEqual(r.reportOnly.activeJobsForMissingPlans, ['job-running']);
  assert.deepEqual(r.reportOnly.unreferencedRevisionPdfs, ['C1:revision:R-new']);
  assert.deepEqual(r.reportOnly.plansWithoutProject, ['LOST']);
  assert.deepEqual(r.reportOnly.danglingPlanRefs, [{ projectId: 'P3', planId: 'MISSING' }]);
  assert.deepEqual(r.reportOnly.danglingComparisonRefs, [{ projectId: 'P3', comparisonId: 'CMISSING' }]);
});

test('cleanup deletes only the cleanable orphans and is idempotent', async () => {
  await seedOrphans();
  const before = await dump();
  const report = await scanOrphans();
  const counts = await deleteOrphans(report);
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), totalCleanable(report));
  const after = await dump();

  const removed = new Set([
    'planVersions:V-gone', 'aiReviews:GONE:1:h', 'openingsAiReviews:o-gone', 'pdfFiles:GONE',
    'comparePdfFiles:CGONE:original', 'comparePdfFiles:CGONE:revision:R9',
  ]);
  for (const store of STORES) {
    for (const [key, value] of before[store]) {
      const gone = removed.has(`${store}:${String(key)}`);
      const now = after[store].find(([k]) => k === key);
      if (gone) assert.equal(now, undefined, `${store}:${String(key)} should be deleted`);
      else assert.deepEqual(now?.[1], value, `${store}:${String(key)} must be untouched`);
    }
  }
  assert.equal(totalCleanable(await scanOrphans()), 0);
});

test('completed AI jobs with cost history survive cleanup, even for deleted plans', async () => {
  const db = await raw();
  const job = {
    requestId: 'costly', planId: 'GONE', pageNumber: 1, sourceHash: 'h', status: 'COMPLETED', createdAt: 1, updatedAt: 1,
    metrics: { estimatedCostUsd: 0.08 },
  };
  await db.put('aiJobs', job);
  await db.put('openingsAiJobs', { requestId: 'ocostly', planId: 'GONE', pageNumber: 1, sourceHash: 'h', status: 'COMPLETED' });
  await db.put('planVersions', version('V-gone', 'GONE'));
  db.close();
  const report = await scanOrphans();
  assert.deepEqual(report.reportOnly.finishedJobsForMissingPlans.sort(), ['costly', 'ocostly']);
  await deleteOrphans(report);
  const d = await dump();
  assert.deepEqual(d.aiJobs.map(([, v]) => v), [job]);
  assert.deepEqual(keysOf(d, 'openingsAiJobs'), ['ocostly']);
  assert.deepEqual(keysOf(d, 'planVersions'), []);
});

test('protected plans and comparisons are never cleanable', async () => {
  await seedOrphans();
  const report = await scanOrphans({ planIds: new Set(['GONE']), comparisonIds: new Set(['CGONE']) });
  assert.equal(totalCleanable(report), 0);
});

test('a plan saved after the scan keeps its records (owner re-checked inside the transaction)', async () => {
  await seedOrphans();
  const report = await scanOrphans();
  const db = await raw();
  await db.put('projects', plan('GONE', 'P1'));
  db.close();
  await deleteOrphans(report);
  const d = await dump();
  assert.ok(keysOf(d, 'planVersions').includes('V-gone'));
  assert.ok(keysOf(d, 'aiReviews').includes('GONE:1:h'));
  assert.ok(keysOf(d, 'pdfFiles').includes('GONE'));
  assert.ok(!keysOf(d, 'comparePdfFiles').includes('CGONE:original'));
});

test('a failure during cleanup rolls every deletion back', async () => {
  await seedOrphans();
  const before = await dump();
  const report = await scanOrphans();
  // A malformed entry makes the transaction throw after earlier categories were already deleted.
  (report.cleanable.comparePdfFiles as unknown[]).push({ not: 'a key' });
  await assert.rejects(deleteOrphans(report));
  assert.deepEqual(await dump(), before);
});

test('selecting categories limits what is removed', async () => {
  await seedOrphans();
  await deleteOrphans(await scanOrphans(), ['planVersions']);
  const d = await dump();
  assert.ok(!keysOf(d, 'planVersions').includes('V-gone'));
  assert.ok(keysOf(d, 'aiReviews').includes('GONE:1:h'));
});

test('pure detection: unknown layers and non-string keys are ignored, legacy comparisons keep revised blobs', () => {
  const snapshot: OrphanSnapshot = {
    plans: [], projects: [], aiJobs: [], openingsAiJobs: [], aiBatches: [], planVersions: [], aiReviews: [], openingsAiReviews: [],
    comparisons: [{ id: 'c', revisionIds: null }],
    pdfFileKeys: [], comparePdfKeys: ['c:revised', 'c:revision:x', 'c:weird', 'nocolon', 'c:original'],
  };
  const r = detectOrphans(snapshot);
  assert.equal(totalCleanable(r), 0);
  assert.deepEqual(r.reportOnly.unreferencedRevisionPdfs, []);
});
