import type { Plan, Project } from '../../types';
import type { Comparison } from '../../types/compare';
import type { PlanVersion } from '../../types/revisionAnalysis';
import type { AiReviewRecord } from '../ai/contracts';
import type { AiOpeningReview } from '../../types/aiOpenings';
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, sha256Hex, type BackupManifest, type BackupProjectEntry } from './backupFormat';
import type { BackupArchive } from './backupArchive';

/** One project as read from the local database (documents already migrated), with its raw blobs. */
export interface ProjectBackupSource {
  project: Project;
  plans: {
    plan: Plan;
    pdf: Blob | null;
    versions: PlanVersion[];
    aiReviews: AiReviewRecord[];
    openingsAiReviews: AiOpeningReview[];
  }[];
  comparisons: { comparison: Comparison; pdfs: Record<string, Blob> }[];
}

/** Pure: turns already-read project sources into a manifest plus content-addressed blobs. */
export async function buildBackup(sources: ProjectBackupSource[], appSchemaVersion: number, now = Date.now()): Promise<BackupArchive> {
  const blobs = new Map<string, Uint8Array>();
  const table: BackupManifest['blobs'] = {};
  const addBlob = async (blob: Blob): Promise<string> => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const hash = await sha256Hex(bytes);
    if (!blobs.has(hash)) {
      blobs.set(hash, bytes);
      table[hash] = { size: bytes.byteLength, type: blob.type || 'application/pdf' };
    }
    return hash;
  };

  const projects: BackupProjectEntry[] = [];
  for (const source of sources) {
    const plans = [];
    for (const p of source.plans) {
      plans.push({
        plan: p.plan,
        pdf: p.pdf ? await addBlob(p.pdf) : null,
        versions: p.versions,
        aiReviews: p.aiReviews,
        openingsAiReviews: p.openingsAiReviews,
      });
    }
    const comparisons = [];
    for (const c of source.comparisons) {
      const pdfs: Record<string, string> = {};
      for (const [layer, blob] of Object.entries(c.pdfs)) pdfs[layer] = await addBlob(blob);
      comparisons.push({ comparison: c.comparison, pdfs });
    }
    projects.push({ project: source.project, plans, comparisons });
  }
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appSchemaVersion,
    exportedAt: now,
    blobs: table,
    projects,
  };
  return { manifest, blobs };
}
