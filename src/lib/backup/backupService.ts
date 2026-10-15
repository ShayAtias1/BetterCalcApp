import { BACKUP_SCHEMA_VERSION, listProjectIdsForBackup, readExistingBackupIds, readProjectForBackup, writeImportedProjects } from '../../db/database';
import { buildBackup } from './backupBuild';
import { extractBlobs, encodeBackup, manifestBlobBytes, readManifest } from './backupArchive';
import { planImport } from './backupImportPlan';
import { BackupError } from './backupFormat';
import { BACKUP_HARD_LIMIT_BYTES, BACKUP_WARN_BYTES, estimateFreeStorage } from './backupLimits';

export interface BackupExportResult {
  bytes: Uint8Array;
  projectCount: number;
}

export interface LargeBackupInfo {
  /** Total PDF bytes in the backup. */
  bytes: number;
  /** True when it exceeds the "this is big" warning threshold. */
  large: boolean;
  /** Import only: the browser's (approximate) free storage, when it reports one and it looks too small. */
  freeBytes: number | null;
  lowStorage: boolean;
}

/** Resolves false to cancel. Called only when there is something to warn about. */
export type ConfirmLarge = (info: LargeBackupInfo) => Promise<boolean>;

/**
 * Exports the given projects (all of them when omitted) as one `.bettercalc` archive. Read-only.
 * Callers persist an open plan or comparison first, as everywhere else.
 *
 * The PDF total is taken from the stored blobs' sizes before any PDF is read into memory: over the
 * hard limit it throws `BackupError('too-large')`; over the warning threshold `confirm` decides.
 * Returns null when the user cancels.
 */
export async function exportProjects(projectIds?: string[], confirm?: ConfirmLarge): Promise<BackupExportResult | null> {
  const ids = projectIds ?? await listProjectIdsForBackup();
  let sources = [];
  for (const id of ids) {
    const source = await readProjectForBackup(id);
    if (source) sources.push(source);
  }
  const bytes = sources.reduce(
    (n, s) => n
      + s.plans.reduce((m, p) => m + (p.pdf?.size ?? 0), 0)
      + s.comparisons.reduce((m, c) => m + Object.values(c.pdfs).reduce((k, b) => k + b.size, 0), 0),
    0,
  );
  if (bytes > BACKUP_HARD_LIMIT_BYTES) throw new BackupError('too-large', 'backup exceeds the export limit');
  if (bytes > BACKUP_WARN_BYTES && confirm && !await confirm({ bytes, large: true, freeBytes: null, lowStorage: false })) return null;

  const projectCount = sources.length;
  const archive = await buildBackup(sources, BACKUP_SCHEMA_VERSION);
  sources = []; // the stored blobs are no longer needed; their bytes now live in `archive`
  return { bytes: encodeBackup(archive), projectCount };
}

export interface BackupImportResult {
  /** The ids the projects were stored under, with whether they had to be imported as copies. */
  projects: { projectId: string; name: string; importedAsCopy: boolean }[];
  /** Comparison→plan links that were removed because the plan was not part of the backup. */
  droppedPlanLinks: { comparisonId: string; planId: string }[];
  /** Comparison ids that plans' revision history referenced but the backup did not contain (detached). */
  detachedComparisonRefs: string[];
}

/**
 * Verifies and imports a `.bettercalc` archive in a single transaction. Never overwrites: projects
 * whose ids exist locally are imported as copies. Throws `BackupError` before anything is written.
 *
 * Sizes are checked before extraction: the file's own size before it is read, the declared PDF
 * total from the manifest before any PDF is inflated. `confirm` is asked once when the backup is
 * large or the browser's storage estimate (advisory only) suggests it may not fit; null = cancelled.
 */
export async function importBackup(source: Uint8Array | Blob, confirm?: ConfirmLarge): Promise<BackupImportResult | null> {
  const fileSize = source instanceof Blob ? source.size : source.byteLength;
  // Compressed size can only be smaller than what it holds, so this never rejects a valid backup
  // that is within the limit by more than the manifest allowance.
  if (fileSize > BACKUP_HARD_LIMIT_BYTES + 8 * 1024 * 1024) throw new BackupError('too-large', 'backup file exceeds the import limit');

  let bytes: Uint8Array | null = source instanceof Blob ? new Uint8Array(await source.arrayBuffer()) : source;
  const manifest = readManifest(bytes);
  const total = manifestBlobBytes(manifest);

  const freeBytes = await estimateFreeStorage();
  const lowStorage = freeBytes !== null && freeBytes < total * 1.2;
  const large = total > BACKUP_WARN_BYTES;
  if ((large || lowStorage) && confirm && !await confirm({ bytes: total, large, freeBytes, lowStorage })) return null;

  let archive: { manifest: typeof manifest; blobs: Map<string, Uint8Array> } | null = {
    manifest,
    blobs: await extractBlobs(bytes, manifest),
  };
  bytes = null; // the raw file is no longer needed; blobs are views into it only until planImport copies them
  const imported = planImport(archive, await readExistingBackupIds());
  archive = null;
  await writeImportedProjects(imported);
  return {
    projects: imported.map((p) => ({ projectId: p.project.id, name: p.project.name, importedAsCopy: p.importedAsCopy })),
    droppedPlanLinks: imported.flatMap((p) => p.droppedPlanLinks),
    detachedComparisonRefs: imported.flatMap((p) => p.detachedComparisonRefs),
  };
}
