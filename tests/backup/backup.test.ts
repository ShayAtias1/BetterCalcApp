import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zipSync } from 'fflate';
import { buildBackup, type ProjectBackupSource } from '../../src/lib/backup/backupBuild';
import { decodeBackup, encodeBackup } from '../../src/lib/backup/backupArchive';
import { COPY_NAME_SUFFIX, planImport, remapIds, remapReviewKey, type ExistingIds } from '../../src/lib/backup/backupImportPlan';
import { BackupError, BACKUP_FORMAT_VERSION } from '../../src/lib/backup/backupFormat';

const pdf = (text: string) => new Blob([new TextEncoder().encode(`%PDF-1.7 ${text}`)], { type: 'application/pdf' });
const none: ExistingIds = { projects: new Set(), plans: new Set(), comparisons: new Set(), planVersions: new Set() };

function source(): ProjectBackupSource {
  const plan = {
    id: 'plan-1', projectId: 'proj-1', name: 'Floor 1', createdAt: 1, updatedAt: 2, pdfFileName: 'a.pdf',
    pages: { 1: { calibration: { pixelsPerMeter: 42 } } }, rooms: [], measurements: [{ id: 'm1', points: [{ x: 1.5, y: 2.5 }] }],
    markups: [], aiOpeningImportKeys: ['plan-1:1:hashA'],
    revisionApplications: [{ id: 'app-1', comparisonId: 'cmp-1', revisionId: 'rev-1', versionId: 'ver-1' }],
  };
  const comparison = {
    id: 'cmp-1', projectId: 'proj-1', name: 'Rev', linkedPlanId: 'plan-1', revisions: [{ id: 'rev-1', markups: [], measurements: [] }],
    activeRevisionId: 'rev-1', pages: {},
  };
  return {
    project: { id: 'proj-1', name: 'My project', createdAt: 1, updatedAt: 2, planIds: ['plan-1'], comparisonIds: ['cmp-1'] },
    plans: [{
      plan: plan as never,
      pdf: pdf('plan'),
      versions: [{ id: 'ver-1', planId: 'plan-1', createdAt: 3, reason: 'revision-apply', label: 'v', plan: { ...plan } }],
      aiReviews: [{ key: 'plan-1:1:hashA', planId: 'plan-1', pageNumber: 1, sourceHash: 'hashA', candidates: [], resolvedIds: [], updatedAt: 4 }],
      openingsAiReviews: [{ key: 'plan-1:1:hashB', planId: 'plan-1', pageNumber: 1, sourceHash: 'hashB' } as never],
    }],
    comparisons: [{ comparison: comparison as never, pdfs: { original: pdf('orig'), 'revision:rev-1': pdf('rev') } }],
  };
}

async function roundTrip(src: ProjectBackupSource[] = [source()]) {
  const archive = await buildBackup(src, 7, 123);
  return decodeBackup(encodeBackup(archive));
}

test('round trip preserves documents, blobs and cross references', async () => {
  const archive = await roundTrip();
  assert.equal(archive.manifest.formatVersion, BACKUP_FORMAT_VERSION);
  assert.equal(archive.manifest.appSchemaVersion, 7);
  const [imported] = planImport(archive, none);
  assert.equal(imported.importedAsCopy, false);
  assert.deepEqual(imported.project, source().project);
  assert.deepEqual(imported.plans[0].plan, source().plans[0].plan);
  assert.deepEqual(imported.comparisons[0].comparison, source().comparisons[0].comparison);
  assert.equal(await imported.plans[0].pdf!.text(), '%PDF-1.7 plan');
  assert.equal(await imported.comparisons[0].pdfs['revision:rev-1'].text(), '%PDF-1.7 rev');
  assert.equal(imported.plans[0].versions.length, 1);
  assert.equal(imported.plans[0].aiReviews.length, 1);
  assert.equal(imported.plans[0].openingsAiReviews.length, 1);
});

test('identical PDFs are stored once', async () => {
  const a = source();
  const b = source();
  b.project = { ...b.project, id: 'proj-2' };
  b.plans[0].plan = { ...b.plans[0].plan, id: 'plan-2', projectId: 'proj-2' };
  b.plans[0].versions = [];
  b.plans[0].aiReviews = [];
  b.plans[0].openingsAiReviews = [];
  b.comparisons = [];
  const archive = await roundTrip([a, b]);
  assert.equal(archive.blobs.size, 3);
});

test('collisions import as a copy with every nested reference remapped', async () => {
  const archive = await roundTrip();
  const existing: ExistingIds = { ...none, plans: new Set(['plan-1']) };
  const [copy] = planImport(archive, existing);
  assert.equal(copy.importedAsCopy, true);
  assert.equal(copy.project.name, `My project${COPY_NAME_SUFFIX}`);
  const planId = copy.plans[0].plan.id;
  const cmpId = copy.comparisons[0].comparison.id;
  const verId = copy.plans[0].versions[0].id;
  assert.notEqual(copy.project.id, 'proj-1');
  assert.notEqual(planId, 'plan-1');
  assert.notEqual(cmpId, 'cmp-1');
  assert.notEqual(verId, 'ver-1');
  assert.deepEqual(copy.project.planIds, [planId]);
  assert.deepEqual(copy.project.comparisonIds, [cmpId]);
  assert.equal(copy.plans[0].plan.projectId, copy.project.id);
  assert.equal(copy.comparisons[0].comparison.projectId, copy.project.id);
  assert.equal(copy.comparisons[0].comparison.linkedPlanId, planId);
  const plan = copy.plans[0].plan as unknown as { aiOpeningImportKeys: string[]; revisionApplications: Record<string, string>[] };
  assert.deepEqual(plan.aiOpeningImportKeys, [`${planId}:1:hashA`]);
  assert.equal(plan.revisionApplications[0].comparisonId, cmpId);
  assert.equal(plan.revisionApplications[0].versionId, verId);
  assert.equal(plan.revisionApplications[0].revisionId, 'rev-1');
  const version = copy.plans[0].versions[0];
  assert.equal(version.planId, planId);
  assert.equal((version.plan as { id: string }).id, planId);
  assert.equal(copy.plans[0].aiReviews[0].planId, planId);
  assert.equal(copy.plans[0].aiReviews[0].key, `${planId}:1:hashA`);
  assert.equal(copy.plans[0].openingsAiReviews[0].key, `${planId}:1:hashB`);
  // Blob layers stay addressable under the comparison's new id by the same layer names.
  assert.deepEqual(Object.keys(copy.comparisons[0].pdfs).sort(), ['original', 'revision:rev-1']);
  // The source objects were not mutated.
  assert.equal(source().plans[0].plan.id, 'plan-1');
});

test('revision history pointing outside the backup is detached, never matched to a local comparison', async () => {
  const src = source();
  const plan = src.plans[0].plan as unknown as { revisionApplications: Record<string, string>[]; measurements: Record<string, unknown>[] };
  plan.revisionApplications.push({ id: 'app-x', comparisonId: 'cmp-external', revisionId: 'r', versionId: 'v-x' });
  plan.measurements.push({ id: 'm2', revisionSource: { comparisonId: 'cmp-external', revisionId: 'r', changeId: 'c', applicationId: 'app-x' } });
  const archive = await roundTrip([src]);
  // Not a collision: ids are kept, yet the external reference must not stay matchable.
  const [imported] = planImport(archive, none);
  const out = imported.plans[0].plan as unknown as typeof plan;
  assert.deepEqual(imported.detachedComparisonRefs, ['cmp-external']);
  const detached = out.revisionApplications[1].comparisonId;
  assert.notEqual(detached, 'cmp-external');
  assert.equal((out.measurements[1].revisionSource as { comparisonId: string }).comparisonId, detached);
  // References to comparisons that ARE in the backup are untouched (or remapped with them).
  assert.equal(out.revisionApplications[0].comparisonId, 'cmp-1');
  const [copy] = planImport(archive, { ...none, comparisons: new Set(['cmp-1']) });
  const copied = copy.plans[0].plan as unknown as typeof plan;
  assert.equal(copied.revisionApplications[0].comparisonId, copy.comparisons[0].comparison.id);
  assert.notEqual(copied.revisionApplications[1].comparisonId, 'cmp-external');
});

test('opening-review keys (JSON form) are remapped with the plan', () => {
  const map = new Map([['plan-1', 'NEW']]);
  const key = JSON.stringify(['openings-v1', 'plan-1', 2, 'hash', 'imp']);
  assert.equal(remapReviewKey(key, map), JSON.stringify(['openings-v1', 'NEW', 2, 'hash', 'imp']));
  assert.equal(remapReviewKey(JSON.stringify(['openings-v1', 'other', 2, 'h', 'i']), map), JSON.stringify(['openings-v1', 'other', 2, 'h', 'i']));
  assert.equal(remapReviewKey('[not json', map), '[not json');
  assert.equal(remapReviewKey('plan-1:3:h', map), 'NEW:3:h');
});

test('importing the same backup twice yields two independent copies', async () => {
  const archive = await roundTrip();
  const [first] = planImport(archive, none);
  const [second] = planImport(archive, {
    projects: new Set([first.project.id]),
    plans: new Set(first.plans.map((p) => p.plan.id)),
    comparisons: new Set(first.comparisons.map((c) => c.comparison.id)),
    planVersions: new Set(first.plans.flatMap((p) => p.versions.map((v) => v.id))),
  });
  assert.equal(second.importedAsCopy, true);
  assert.notEqual(second.project.id, first.project.id);
});

test('remapping touches only identifier fields, never user content', () => {
  const map = new Map([['plan-1', 'NEW-PLAN'], ['cmp-1', 'NEW-CMP']]);
  const out = remapIds({
    id: 'plan-1', planId: 'plan-1', linkedPlanId: 'plan-1', comparisonId: 'cmp-1',
    name: 'plan-1', notes: 'see plan-1:1:abc and cmp-1', text: 'plan-1',
    rooms: [{ id: 'plan-1', name: 'cmp-1', label: 'plan-1' }],
    reviewKey: 'plan-1:2:h', aiOpeningImportKeys: ['plan-1:2:h', 'other:1:x'], planIds: ['plan-1', 'zzz'],
    'plan-1': 'key stays',
  }, map);
  assert.deepEqual(out, {
    id: 'plan-1', planId: 'NEW-PLAN', linkedPlanId: 'NEW-PLAN', comparisonId: 'NEW-CMP',
    name: 'plan-1', notes: 'see plan-1:1:abc and cmp-1', text: 'plan-1',
    rooms: [{ id: 'plan-1', name: 'cmp-1', label: 'plan-1' }],
    reviewKey: 'NEW-PLAN:2:h', aiOpeningImportKeys: ['NEW-PLAN:2:h', 'other:1:x'], planIds: ['NEW-PLAN', 'zzz'],
    'plan-1': 'key stays',
  });
});

test('collision copy leaves user text containing ids alone', async () => {
  const src = source();
  src.project = { ...src.project, name: 'plan-1 notes' };
  (src.plans[0].plan as unknown as { name: string }).name = 'cmp-1';
  const [copy] = planImport(await roundTrip([src]), { ...none, plans: new Set(['plan-1']) });
  assert.equal(copy.plans[0].plan.name, 'cmp-1');
  assert.equal(copy.project.name, `plan-1 notes${COPY_NAME_SUFFIX}`);
});

test('a comparison linked to a plan outside the backup is unlinked, never reattached', async () => {
  const src = source();
  src.plans = [];
  src.project = { ...src.project, planIds: [] };
  const archive = await roundTrip([src]);
  // A local plan with the very id the comparison pointed at must not be linked.
  const [imported] = planImport(archive, { ...none, plans: new Set(['plan-1']) });
  assert.equal('linkedPlanId' in imported.comparisons[0].comparison, false);
  assert.deepEqual(imported.droppedPlanLinks.map((l) => l.planId), ['plan-1']);
});

test('links between projects of one backup stay consistent through remapping', async () => {
  const a = source();
  const b = source();
  b.project = { ...b.project, id: 'proj-2', planIds: ['plan-2'], comparisonIds: ['cmp-2'] };
  b.plans = [{ ...b.plans[0], plan: { ...b.plans[0].plan, id: 'plan-2', projectId: 'proj-2' }, versions: [], aiReviews: [], openingsAiReviews: [] }];
  b.comparisons = [{ comparison: { ...b.comparisons[0].comparison, id: 'cmp-2', projectId: 'proj-2', linkedPlanId: 'plan-1' } as never, pdfs: {} }];
  // plan-1 (project 1) collides; project 2 does not, but links to it.
  const [first, second] = planImport(await roundTrip([a, b]), { ...none, plans: new Set(['plan-1']) });
  assert.equal(first.importedAsCopy, true);
  assert.equal(second.importedAsCopy, false);
  assert.equal(second.comparisons[0].comparison.linkedPlanId, first.plans[0].plan.id);
  assert.deepEqual(second.droppedPlanLinks, []);
});

test('tampered blobs are rejected by hash verification', async () => {
  const archive = await buildBackup([source()], 7);
  const [hash] = [...archive.blobs.keys()];
  const tampered = new Uint8Array(archive.blobs.get(hash)!);
  tampered[tampered.length - 1] ^= 0xff;
  archive.blobs.set(hash, tampered);
  await assert.rejects(decodeBackup(encodeBackup(archive)), (e: BackupError) => e.code === 'hash-mismatch');
});

test('rejects non-backups, newer formats and malformed manifests', async () => {
  const enc = (value: unknown) => zipSync({ 'manifest.json': new TextEncoder().encode(JSON.stringify(value)) });
  await assert.rejects(decodeBackup(new Uint8Array([1, 2, 3])), (e: BackupError) => e.code === 'not-a-backup');
  await assert.rejects(decodeBackup(zipSync({ 'x.txt': new Uint8Array([1]) })), (e: BackupError) => e.code === 'not-a-backup');
  await assert.rejects(decodeBackup(enc({ format: 'other' })), (e: BackupError) => e.code === 'not-a-backup');
  const good = (await buildBackup([source()], 7)).manifest;
  await assert.rejects(decodeBackup(enc({ ...good, formatVersion: BACKUP_FORMAT_VERSION + 1 })), (e: BackupError) => e.code === 'unsupported-version');
  await assert.rejects(decodeBackup(enc({ ...good, projects: [{ project: { id: 'p' } }] })), (e: BackupError) => e.code === 'invalid');
  // A referenced blob that is not in the blob table.
  const dangling = structuredClone(good);
  dangling.blobs = {};
  await assert.rejects(decodeBackup(enc(dangling)), (e: BackupError) => e.code === 'missing-blob');
  // Duplicate plan ids inside one file.
  const dup = structuredClone(good);
  dup.projects[0].plans.push(dup.projects[0].plans[0]);
  await assert.rejects(decodeBackup(enc(dup)), (e: BackupError) => e.code === 'invalid');
});

test('rejects forbidden keys and unreferenced zip entries are ignored', async () => {
  assert.throws(() => remapIds(JSON.parse('{"__proto__":{"x":1}}'), new Map()), (e: BackupError) => e.code === 'invalid');
  const archive = await buildBackup([source()], 7);
  const bytes = encodeBackup(archive);
  const decoded = await decodeBackup(bytes);
  assert.equal(decoded.blobs.size, archive.blobs.size);
});

test('older backups without optional document fields still import', async () => {
  const src = source();
  delete (src.project as { comparisonIds?: string[] }).comparisonIds;
  src.comparisons = [];
  const [imported] = planImport(await roundTrip([src]), none);
  assert.equal(imported.comparisons.length, 0);
  assert.equal(imported.plans[0].plan.id, 'plan-1');
});
