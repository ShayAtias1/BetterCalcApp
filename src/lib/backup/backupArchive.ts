import { unzipSync, zipSync, type Zippable } from 'fflate';
import {
  BACKUP_FORMAT_VERSION, BackupError, BLOB_ENTRY_PREFIX, MANIFEST_ENTRY, isSha256, sha256Hex, validateManifest,
  type BackupManifest,
} from './backupFormat';

import { BACKUP_HARD_LIMIT_BYTES, MAX_MANIFEST_BYTES } from './backupLimits';

export interface BackupArchive {
  manifest: BackupManifest;
  /** SHA-256 → bytes, each verified against its hash and the manifest's size. */
  blobs: Map<string, Uint8Array>;
}

/** Zips a manifest and its blobs. PDFs are already compressed, so blobs are stored as they are. */
export function encodeBackup(archive: BackupArchive): Uint8Array {
  const files: Zippable = {
    [MANIFEST_ENTRY]: [new TextEncoder().encode(JSON.stringify(archive.manifest)), { level: 6 }],
  };
  for (const [hash, bytes] of archive.blobs) files[`${BLOB_ENTRY_PREFIX}${hash}`] = [bytes, { level: 0 }];
  return zipSync(files);
}

/** Total size of the PDFs a manifest declares. */
export function manifestBlobBytes(manifest: BackupManifest): number {
  return Object.values(manifest.blobs).reduce((n, b) => n + b.size, 0);
}

function unzipSelected(bytes: Uint8Array, select: (name: string, originalSize: number) => boolean): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes, { filter: (file) => select(file.name, file.originalSize) });
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('not-a-backup', 'not a readable archive');
  }
}

/**
 * Step 1: reads and validates only `manifest.json` (its size is checked before it is inflated) and
 * rejects archives whose declared PDF total exceeds the current limit, before any PDF is extracted.
 */
export function readManifest(bytes: Uint8Array): BackupManifest {
  const files = unzipSelected(bytes, (name, size) => {
    if (name !== MANIFEST_ENTRY) return false;
    if (size > MAX_MANIFEST_BYTES) throw new BackupError('too-large', 'manifest too large');
    return true;
  });
  const manifestBytes = files[MANIFEST_ENTRY];
  if (!manifestBytes) throw new BackupError('not-a-backup', 'manifest.json missing');
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw new BackupError('not-a-backup', 'manifest is not JSON');
  }
  const manifest = validateManifest(parsed);
  if (manifestBlobBytes(manifest) > BACKUP_HARD_LIMIT_BYTES) throw new BackupError('too-large', 'archive too large');
  return manifest;
}

/**
 * Step 2: extracts the PDFs the manifest lists. An entry whose recorded size differs from the
 * manifest's is refused before it is inflated; entries the manifest does not list are never
 * extracted. Every blob is then re-hashed.
 */
export async function extractBlobs(bytes: Uint8Array, manifest: BackupManifest): Promise<Map<string, Uint8Array>> {
  const files = unzipSelected(bytes, (name, size) => {
    if (!name.startsWith(BLOB_ENTRY_PREFIX)) return false;
    const hash = name.slice(BLOB_ENTRY_PREFIX.length);
    if (!isSha256(hash) || !Object.hasOwn(manifest.blobs, hash)) return false;
    if (size !== manifest.blobs[hash].size) throw new BackupError('hash-mismatch', `blob ${hash} has the wrong size`);
    return true;
  });
  const blobs = new Map<string, Uint8Array>();
  for (const [hash, info] of Object.entries(manifest.blobs)) {
    const data = files[`${BLOB_ENTRY_PREFIX}${hash}`];
    if (!data) throw new BackupError('missing-blob', `blob ${hash} missing`);
    if (data.byteLength !== info.size) throw new BackupError('hash-mismatch', `blob ${hash} has the wrong size`);
    if (await sha256Hex(data) !== hash) throw new BackupError('hash-mismatch', `blob ${hash} is corrupt`);
    blobs.set(hash, data);
  }
  return blobs;
}

/** Reads and verifies an untrusted archive in one call. Throws `BackupError`. */
export async function decodeBackup(bytes: Uint8Array): Promise<BackupArchive> {
  const manifest = readManifest(bytes);
  return { manifest, blobs: await extractBlobs(bytes, manifest) };
}

export { BACKUP_FORMAT_VERSION };
