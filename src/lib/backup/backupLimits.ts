/**
 * Size limits of the current in-memory (non-streaming) backup implementation. The hard limit is
 * temporary: it exists because export and import hold several copies of the PDFs at once, and goes
 * away if backups are streamed.
 */
export const BACKUP_WARN_BYTES = 100 * 1024 * 1024;
export const BACKUP_HARD_LIMIT_BYTES = 300 * 1024 * 1024;
/** manifest.json holds documents only, never PDFs; far more than a real project needs. */
export const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;

export function toMegabytes(bytes: number): number {
  return Math.max(1, Math.round(bytes / (1024 * 1024)));
}

export interface StorageEstimate { quota?: number; usage?: number }

/**
 * Advisory only: browsers report approximate, sometimes rounded or hidden figures. Returns the free
 * bytes the browser claims, or null when it gives no usable estimate.
 */
export async function estimateFreeStorage(
  estimate: () => Promise<StorageEstimate> = () => navigator.storage.estimate(),
): Promise<number | null> {
  try {
    const { quota, usage } = await estimate();
    if (typeof quota !== 'number' || typeof usage !== 'number' || !(quota > 0)) return null;
    return Math.max(0, quota - usage);
  } catch {
    return null;
  }
}
