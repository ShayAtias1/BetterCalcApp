import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import { openDB } from 'idb';
import { zipSync } from 'fflate';
import { extractBlobs, readManifest, encodeBackup } from '../../src/lib/backup/backupArchive';
import { buildBackup } from '../../src/lib/backup/backupBuild';
import { BackupError, BACKUP_FORMAT, BACKUP_FORMAT_VERSION, sha256Hex } from '../../src/lib/backup/backupFormat';
import { BACKUP_HARD_LIMIT_BYTES, BACKUP_WARN_BYTES, estimateFreeStorage } from '../../src/lib/backup/backupLimits';
import { listProjects } from '../../src/db/database';
import { exportProjects, importBackup } from '../../src/lib/backup/backupService';

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const code = (c: string) => (e: unknown) => e instanceof BackupError && e.code === c;

function manifest(blobs: Record<string, { size: number; type: string }>) {
  return { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, appSchemaVersion: 7, exportedAt: 1, blobs, projects: [] };
}

test('declared PDF total over the hard limit is refused before any PDF is extracted', () => {
  const hash = 'a'.repeat(64);
  const zip = zipSync({ 'manifest.json': enc(manifest({ [hash]: { size: BACKUP_HARD_LIMIT_BYTES + 1, type: 'application/pdf' } })) });
  assert.throws(() => readManifest(zip), code('too-large'));
});

test('an entry whose size differs from the manifest is refused before inflating', async () => {
  const data = new TextEncoder().encode('%PDF real');
  const hash = await sha256Hex(data);
  const lying = manifest({ [hash]: { size: 3, type: 'application/pdf' } });
  const zip = zipSync({ 'manifest.json': enc(lying), [`blobs/${hash}`]: data });
  const m = readManifest(zip);
  await assert.rejects(extractBlobs(zip, m), code('hash-mismatch'));
});

test('entries the manifest does not list are never extracted', async () => {
  const data = new TextEncoder().encode('%PDF a');
  const hash = await sha256Hex(data);
  const extra = 'b'.repeat(64);
  const zip = zipSync({
    'manifest.json': enc(manifest({ [hash]: { size: data.length, type: 'application/pdf' } })),
    [`blobs/${hash}`]: data,
    [`blobs/${extra}`]: new Uint8Array(1000),
    'other.bin': new Uint8Array(1000),
  });
  const blobs = await extractBlobs(zip, readManifest(zip));
  assert.deepEqual([...blobs.keys()], [hash]);
});

test('storage estimates are advisory: missing or failing estimates give null', async () => {
  assert.equal(await estimateFreeStorage(async () => ({})), null);
  assert.equal(await estimateFreeStorage(async () => { throw new Error('no'); }), null);
  assert.equal(await estimateFreeStorage(async () => ({ quota: 1000, usage: 400 })), 600);
  assert.equal(await estimateFreeStorage(async () => ({ quota: 1000, usage: 4000 })), 0);
});

test('a normal-size archive round-trips through the two-step reader', async () => {
  const pdf = new Blob(['%PDF small'], { type: 'application/pdf' });
  const archive = await buildBackup([{
    project: { id: 'p', name: 'p', createdAt: 1, updatedAt: 1, planIds: ['a'] },
    plans: [{ plan: { id: 'a', projectId: 'p', pages: {} } as never, pdf, versions: [], aiReviews: [], openingsAiReviews: [] }],
    comparisons: [],
  }], 7);
  const zip = encodeBackup(archive);
  const blobs = await extractBlobs(zip, readManifest(zip));
  assert.equal(blobs.size, 1);
});

const STORES = ['takeoffProjects', 'projects', 'pdfFiles', 'comparisons', 'comparePdfFiles', 'planVersions', 'aiReviews', 'openingsAiReviews'];
async function seedProject(id: string, bytes: number) {
  await listProjects();
  const db = await openDB('bettercalc-qto');
  await db.put('takeoffProjects', { id, name: id, createdAt: 1, updatedAt: 1, planIds: [`${id}-plan`] });
  await db.put('projects', {
    id: `${id}-plan`, projectId: id, name: 'p', createdAt: 1, updatedAt: 1, pdfFileName: 'a.pdf', pages: {}, rooms: [], measurements: [], markups: [],
    defaultCladdingHeightM: 2.5, defaultTilingWastePercent: 5, defaultCladdingWastePercent: 5, defaultPanelsWastePercent: 5, areaKindColors: {}, wallHeightDefaultM: 2.6,
  });
  await db.put('pdfFiles', new Blob([new ArrayBuffer(bytes)], { type: 'application/pdf' }), `${id}-plan`);
  db.close();
}
async function wipe() {
  await listProjects();
  const db = await openDB('bettercalc-qto');
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) await tx.objectStore(s).clear();
  await tx.done;
  db.close();
}
async function counts() {
  const db = await openDB('bettercalc-qto');
  const out = { projects: await db.count('takeoffProjects'), pdfs: await db.count('pdfFiles') };
  db.close();
  return out;
}

const originalStorage = Object.getOwnPropertyDescriptor(globalThis.navigator, 'storage');
beforeEach(wipe);
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis.navigator, 'storage', originalStorage);
  else delete (globalThis.navigator as unknown as { storage?: unknown }).storage;
});

test('export over the warning threshold asks first; declining reads nothing and cancels', async () => {
  await seedProject('big', BACKUP_WARN_BYTES + 1024);
  let asked: number | null = null;
  const declined = await exportProjects(['big'], async (info) => { asked = info.bytes; return false; });
  assert.equal(declined, null);
  assert.ok(asked! > BACKUP_WARN_BYTES);
  const accepted = await exportProjects(['big'], async () => true);
  assert.equal(accepted?.projectCount, 1);

  // Importing that backup is also confirmed first, and declining writes nothing.
  await wipe();
  let importAsked = false;
  const result = await importBackup(accepted!.bytes, async (info) => { importAsked = info.large; return false; });
  assert.equal(result, null);
  assert.equal(importAsked, true);
  assert.deepEqual(await counts(), { projects: 0, pdfs: 0 });
  const done = await importBackup(accepted!.bytes, async () => true);
  assert.equal(done?.projects.length, 1);
  assert.deepEqual(await counts(), { projects: 1, pdfs: 1 });
});

test('export over the hard limit is refused before any PDF is read', async () => {
  await seedProject('huge', BACKUP_HARD_LIMIT_BYTES + 1024);
  await assert.rejects(exportProjects(['huge']), code('too-large'));
});

test('an import file over the hard limit is refused before it is read', async () => {
  const fake = { size: BACKUP_HARD_LIMIT_BYTES + 64 * 1024 * 1024, arrayBuffer: () => { throw new Error('must not be read'); } };
  Object.setPrototypeOf(fake, Blob.prototype);
  await assert.rejects(importBackup(fake as unknown as Blob), code('too-large'));
});

test('low browser storage estimate asks for confirmation but is only advisory', async () => {
  await seedProject('small', 1024);
  const { bytes } = (await exportProjects(['small']))!;
  await wipe();
  Object.defineProperty(globalThis.navigator, 'storage', { configurable: true, value: { estimate: async () => ({ quota: 100, usage: 99 }) } });
  let info: { lowStorage: boolean; freeBytes: number | null } | null = null;
  const declined = await importBackup(bytes, async (i) => { info = i; return false; });
  assert.equal(declined, null);
  assert.equal(info!.lowStorage, true);
  assert.equal(info!.freeBytes, 1);
  // Without a confirm callback (or when accepted) the import still proceeds.
  assert.equal((await importBackup(bytes, async () => true))?.projects.length, 1);
});
