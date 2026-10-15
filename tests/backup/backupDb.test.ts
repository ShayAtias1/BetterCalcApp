import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { openDB } from 'idb';
import { listProjects, readProjectForBackup, writeImportedProjects, BackupImportConflictError, type ProjectBackupData } from '../../src/db/database';
import { exportProjects, importBackup } from '../../src/lib/backup/backupService';
import { BackupError } from '../../src/lib/backup/backupFormat';

const STORES = ['takeoffProjects', 'projects', 'pdfFiles', 'comparisons', 'comparePdfFiles', 'planVersions', 'aiReviews', 'openingsAiReviews'] as const;
const pdf = (text: string) => new Blob([`%PDF-1.7 ${text}`], { type: 'application/pdf' });

/** Raw handle for seeding and inspecting; the app code under test opens its own connection. */
async function raw() {
  await listProjects(); // makes the app create the schema
  return openDB('bettercalc-qto');
}
async function clearAll() {
  const db = await raw();
  const tx = db.transaction([...STORES, 'aiJobs', 'aiBatches', 'openingsAiJobs'], 'readwrite');
  for (const store of tx.objectStoreNames) await tx.objectStore(store).clear();
  await tx.done;
  db.close();
}
async function counts() {
  const db = await raw();
  const out: Record<string, number> = {};
  for (const store of STORES) out[store] = await db.count(store);
  db.close();
  return out;
}

function plan(id: string, projectId: string, extra: object = {}) {
  return {
    id, projectId, name: `Plan ${id}`, createdAt: 1, updatedAt: 2, pdfFileName: `${id}.pdf`,
    pages: { 1: { calibration: { pixelsPerMeter: 50 } } }, rooms: [], measurements: [], markups: [],
    defaultCladdingHeightM: 2.5, defaultTilingWastePercent: 5, defaultCladdingWastePercent: 5, defaultPanelsWastePercent: 5,
    areaKindColors: {}, wallHeightDefaultM: 2.6, ...extra,
  };
}

async function seed() {
  const db = await raw();
  await db.put('takeoffProjects', { id: 'P1', name: 'Project one', createdAt: 1, updatedAt: 9, planIds: ['A'], comparisonIds: ['C1'] });
  await db.put('projects', plan('A', 'P1', {
    aiOpeningImportKeys: ['A:1:h1'],
    revisionApplications: [{ id: 'app', comparisonId: 'C1', revisionId: 'R1', versionId: 'V1', status: 'applied' }],
  }));
  await db.put('pdfFiles', pdf('plan A'), 'A');
  await db.put('planVersions', { id: 'V1', planId: 'A', createdAt: 3, reason: 'revision-apply', label: 'x', plan: plan('A', 'P1') });
  await db.put('aiReviews', { key: 'A:1:h1', planId: 'A', pageNumber: 1, sourceHash: 'h1', candidates: [], resolvedIds: [], updatedAt: 4 });
  await db.put('openingsAiReviews', { key: 'A:1:h2', planId: 'A', pageNumber: 1, sourceHash: 'h2', task: 'openings-v1', candidates: [] });
  await db.put('comparisons', {
    id: 'C1', projectId: 'P1', name: 'Cmp', apartmentNumber: '', notes: 'links A', createdAt: 1, updatedAt: 5, originalFileName: 'o.pdf',
    originalOpacity: 1, originalVisible: true, originalColorTint: '#000', originalUseSourceColors: false, pages: {},
    revisions: [{ id: 'R1', label: 'r', fileName: 'r.pdf', opacity: 1, visible: true, colorTint: '#f00', useSourceColors: false, markups: [], measurements: [] }],
    activeRevisionId: 'R1', areaKindColors: {}, wallHeightDefaultM: 2.6, linkedPlanId: 'A',
  });
  await db.put('comparePdfFiles', pdf('orig C1'), 'C1:original');
  await db.put('comparePdfFiles', pdf('rev C1'), 'C1:revision:R1');
  db.close();
}

async function snapshot() {
  const db = await raw();
  const out: Record<string, unknown> = {};
  for (const store of STORES) {
    const keys = await db.getAllKeys(store);
    const values = await db.getAll(store);
    out[store] = await Promise.all(keys.map(async (k, i) => {
      const v = values[i];
      return [k, v instanceof Blob ? `blob:${await v.text()}` : v];
    }));
  }
  db.close();
  return out;
}

beforeEach(clearAll);

test('export, wipe, import restores every record and blob identically', async () => {
  await seed();
  const before = await snapshot();
  const { bytes, projectCount } = (await exportProjects())!;
  assert.equal(projectCount, 1);

  await clearAll();
  assert.deepEqual(await counts(), Object.fromEntries(STORES.map((s) => [s, 0])));

  const result = (await importBackup(bytes))!;
  assert.deepEqual(result.projects.map((p) => p.importedAsCopy), [false]);
  assert.deepEqual(result.droppedPlanLinks, []);
  assert.deepEqual(await snapshot(), before);
  const [loaded] = await listProjects();
  assert.equal(loaded.plans.length, 1);
  assert.equal(loaded.comparisons.length, 1);
});

test('importing over existing ids creates an independent copy and leaves originals untouched', async () => {
  await seed();
  const before = await snapshot();
  const { bytes } = (await exportProjects(['P1']))!;
  const result = (await importBackup(bytes))!;
  const [info] = result.projects;
  assert.equal(info.importedAsCopy, true);
  assert.notEqual(info.projectId, 'P1');

  const after = await snapshot();
  for (const store of STORES) {
    const original = (after[store] as [string, unknown][]).filter(([k]) => (before[store] as [string, unknown][]).some(([bk]) => bk === k));
    assert.deepEqual(original, before[store], `${store} originals changed`);
  }
  assert.deepEqual(await counts(), { ...Object.fromEntries(STORES.map((s) => [s, 2])), comparePdfFiles: 4 });

  const copy = (await listProjects()).find((p) => p.project.id === info.projectId)!;
  const copyPlan = copy.plans[0];
  const copyCmp = copy.comparisons[0];
  assert.notEqual(copyPlan.id, 'A');
  assert.equal(copyPlan.projectId, copy.project.id);
  assert.equal(copyCmp.linkedPlanId, copyPlan.id);
  assert.deepEqual(copy.project.planIds, [copyPlan.id]);
  const rev = (copyPlan as unknown as { revisionApplications: { comparisonId: string; versionId: string }[] }).revisionApplications[0];
  assert.equal(rev.comparisonId, copyCmp.id);
  const db = await raw();
  assert.ok(await db.get('planVersions', rev.versionId));
  assert.equal(await (await db.get('pdfFiles', copyPlan.id))!.text(), '%PDF-1.7 plan A');
  assert.equal(await (await db.get('comparePdfFiles', `${copyCmp.id}:revision:R1`))!.text(), '%PDF-1.7 rev C1');
  assert.ok(await db.get('aiReviews', `${copyPlan.id}:1:h1`));
  assert.ok(await db.get('openingsAiReviews', `${copyPlan.id}:1:h2`));
  db.close();
});

test('regression: a project with real-format opening reviews imports as a copy next to its original', async () => {
  // Opening reviews are keyed by the JSON text of [task, planId, page, hash, importId], not "planId:...".
  // The old key remap left that key unchanged, so the copy collided with the original and the import failed.
  const db = await raw();
  await db.put('takeoffProjects', { id: 'R1', name: 'Real keys', createdAt: 1, updatedAt: 1, planIds: ['RA'], comparisonIds: [] });
  await db.put('projects', plan('RA', 'R1', {
    aiOpeningImportKeys: [JSON.stringify(['openings-v1', 'RA', 1, 'h9', 'imp-1'])],
    openings: [{ id: 'o1', planId: 'RA', pageNumber: 1, aiDetection: { reviewKey: JSON.stringify(['openings-v1', 'RA', 1, 'h9', 'imp-1']) } }],
  }));
  await db.put('openingsAiReviews', { task: 'openings-v1', key: JSON.stringify(['openings-v1', 'RA', 1, 'h9', 'imp-1']), planId: 'RA', pageNumber: 1, sourceHash: 'h9', importId: 'imp-1', candidates: [], deferred: [], coverageNotes: [] });
  db.close();
  const before = await snapshot();
  const { bytes } = (await exportProjects(['R1']))!;
  const result = (await importBackup(bytes))!;
  assert.equal(result.projects[0].importedAsCopy, true);
  const copy = (await listProjects()).find((p) => p.project.id === result.projects[0].projectId)!;
  const copyPlan = copy.plans[0] as unknown as { id: string; aiOpeningImportKeys: string[]; openings: { planId: string; aiDetection: { reviewKey: string } }[] };
  const expected = JSON.stringify(['openings-v1', copyPlan.id, 1, 'h9', 'imp-1']);
  assert.deepEqual(copyPlan.aiOpeningImportKeys, [expected]);
  assert.equal(copyPlan.openings[0].planId, copyPlan.id);
  assert.equal(copyPlan.openings[0].aiDetection.reviewKey, expected);
  const db2 = await raw();
  assert.ok(await db2.get('openingsAiReviews', expected));
  db2.close();
  const after = await snapshot();
  for (const [k, v] of before.openingsAiReviews as [string, unknown][]) {
    assert.deepEqual((after.openingsAiReviews as [string, unknown][]).find(([ak]) => ak === k)?.[1], v);
  }
});

test('a failure mid-write rolls back the whole import', async () => {
  const good: ProjectBackupData = {
    project: { id: 'N1', name: 'good', createdAt: 1, updatedAt: 1, planIds: ['NA'] },
    plans: [{ plan: plan('NA', 'N1') as never, pdf: pdf('na'), versions: [], aiReviews: [], openingsAiReviews: [] }],
    comparisons: [],
  };
  // A function cannot be structured-cloned, so IndexedDB rejects this put after the first project was written.
  const poisoned: ProjectBackupData = {
    project: { id: 'N2', name: 'bad', createdAt: 1, updatedAt: 1, planIds: ['NB'] },
    plans: [{ plan: plan('NB', 'N2', { poison: () => 1 }) as never, pdf: null, versions: [], aiReviews: [], openingsAiReviews: [] }],
    comparisons: [],
  };
  await assert.rejects(writeImportedProjects([good, poisoned]));
  assert.deepEqual(await counts(), Object.fromEntries(STORES.map((s) => [s, 0])));
});

test('an id that appears after planning aborts the import without writing anything', async () => {
  await seed();
  const before = await snapshot();
  const fresh: ProjectBackupData = {
    project: { id: 'FRESH', name: 'fresh', createdAt: 1, updatedAt: 1, planIds: ['FP'] },
    plans: [{ plan: plan('FP', 'FRESH') as never, pdf: pdf('fp'), versions: [], aiReviews: [], openingsAiReviews: [] }],
    comparisons: [],
  };
  const clash: ProjectBackupData = {
    project: { id: 'P1', name: 'clash', createdAt: 1, updatedAt: 1, planIds: [] },
    plans: [], comparisons: [],
  };
  await assert.rejects(writeImportedProjects([fresh, clash]), BackupImportConflictError);
  assert.deepEqual(await snapshot(), before);
});

test('a corrupt archive writes nothing', async () => {
  await seed();
  const before = await snapshot();
  const { bytes } = (await exportProjects())!;
  const damaged = new Uint8Array(bytes);
  damaged[Math.floor(damaged.length / 2)] ^= 0xff;
  await assert.rejects(importBackup(damaged), BackupError);
  assert.deepEqual(await snapshot(), before);
});

test('a comparison linked to a plan in another project is unlinked on import, not reattached', async () => {
  await seed();
  const db = await raw();
  await db.put('takeoffProjects', { id: 'P2', name: 'Project two', createdAt: 1, updatedAt: 1, planIds: [], comparisonIds: ['C2'] });
  await db.put('comparisons', {
    id: 'C2', projectId: 'P2', name: 'Cross', apartmentNumber: '', notes: '', createdAt: 1, updatedAt: 1, originalFileName: 'o.pdf',
    originalOpacity: 1, originalVisible: true, originalColorTint: '#000', originalUseSourceColors: false, pages: {},
    revisions: [{ id: 'R2', label: 'r', fileName: 'r.pdf', opacity: 1, visible: true, colorTint: '#f00', useSourceColors: false, markups: [], measurements: [] }],
    activeRevisionId: 'R2', areaKindColors: {}, wallHeightDefaultM: 2.6, linkedPlanId: 'A', // plan A lives in P1
  });
  db.close();

  // Only P2 is exported, and plan A still exists locally: it must not be linked to the imported copy.
  const { bytes } = (await exportProjects(['P2']))!;
  const result = (await importBackup(bytes))!;
  assert.equal(result.projects[0].importedAsCopy, true);
  assert.equal(result.droppedPlanLinks.length, 1);
  const imported = (await listProjects()).find((p) => p.project.id === result.projects[0].projectId)!;
  assert.equal(imported.comparisons[0].linkedPlanId, undefined);

  // The original is untouched, and exporting both projects together keeps the link.
  const original = await readProjectForBackup('P2');
  assert.equal(original!.comparisons[0].comparison.linkedPlanId, 'A');
  const both = (await exportProjects(['P1', 'P2']))!;
  await clearAll();
  const restored = (await importBackup(both.bytes))!;
  assert.deepEqual(restored.droppedPlanLinks, []);
  const cross = (await listProjects()).flatMap((p) => p.comparisons).find((c) => c.id === 'C2')!;
  assert.equal(cross.linkedPlanId, 'A');
});

test('legacy plans without a project are exported after migration and import cleanly', async () => {
  const db = await raw();
  const legacy = plan('L1', 'x');
  delete (legacy as { projectId?: string }).projectId;
  await db.put('projects', legacy);
  await db.put('pdfFiles', pdf('legacy'), 'L1');
  db.close();
  const { bytes, projectCount } = (await exportProjects())!;
  assert.equal(projectCount, 1);
  await clearAll();
  const result = (await importBackup(bytes))!;
  assert.equal(result.projects.length, 1);
  const [project] = await listProjects();
  assert.equal(project.plans[0].id, 'L1');
  assert.equal(project.plans[0].projectId, project.project.id);
});
