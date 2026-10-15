import type { Plan, Project } from '../../types';
import type { Comparison } from '../../types/compare';
import type { PlanVersion } from '../../types/revisionAnalysis';
import type { AiReviewRecord } from '../ai/contracts';
import type { AiOpeningReview } from '../../types/aiOpenings';

/**
 * The `.bettercalc` backup format: a zip holding `manifest.json` plus one `blobs/<sha256>` entry per
 * distinct PDF. Blobs are content-addressed and the manifest refers to them only by hash, so the same
 * pieces can later be uploaded to object storage (one object per hash, one manifest per revision).
 */
export const BACKUP_FORMAT = 'bettercalc-backup';
/** Bumped only for changes an older reader cannot understand. Readers refuse anything newer. */
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_FILE_EXTENSION = '.bettercalc';
export const MANIFEST_ENTRY = 'manifest.json';
export const BLOB_ENTRY_PREFIX = 'blobs/';

export type BackupErrorCode = 'not-a-backup' | 'unsupported-version' | 'invalid' | 'hash-mismatch' | 'missing-blob' | 'too-large' | 'conflict';

export class BackupError extends Error {
  code: BackupErrorCode;
  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

export interface BackupPlanEntry {
  plan: Plan;
  /** SHA-256 of the plan's PDF; null when the PDF was not stored. */
  pdf: string | null;
  versions: PlanVersion[];
  aiReviews: AiReviewRecord[];
  openingsAiReviews: AiOpeningReview[];
}

export interface BackupComparisonEntry {
  comparison: Comparison;
  /** Compare PDF layer (`original`, `revision:<id>`) → SHA-256. */
  pdfs: Record<string, string>;
}

export interface BackupProjectEntry {
  project: Project;
  plans: BackupPlanEntry[];
  comparisons: BackupComparisonEntry[];
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  /** IndexedDB schema version of the exporting app; documents are migrated lazily on load. */
  appSchemaVersion: number;
  exportedAt: number;
  /** Every blob in the archive, by SHA-256 (lowercase hex). */
  blobs: Record<string, { size: number; type: string }>;
  projects: BackupProjectEntry[];
}

const SHA256 = /^[0-9a-f]{64}$/;
export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

type Obj = Record<string, unknown>;
function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function bad(message: string): never {
  throw new BackupError('invalid', message);
}
function requireId(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) bad(`${what}: missing id`);
  return value;
}
function requireArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) bad(`${what}: expected a list`);
  return value;
}

/**
 * Strict structural validation of an untrusted manifest. Documents are only checked for the fields
 * the importer relies on (ids and cross-references); everything else in them is carried through
 * unchanged and handled by the app's tolerant lazy migrations. Throws `BackupError`.
 */
export function validateManifest(raw: unknown): BackupManifest {
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) throw new BackupError('not-a-backup', 'not a BetterCalc backup');
  const version = raw.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) bad('formatVersion');
  if (version > BACKUP_FORMAT_VERSION) throw new BackupError('unsupported-version', `backup format ${version} is newer than this app supports`);
  if (typeof raw.appSchemaVersion !== 'number' || !Number.isInteger(raw.appSchemaVersion) || raw.appSchemaVersion < 1) bad('appSchemaVersion');
  if (typeof raw.exportedAt !== 'number') bad('exportedAt');
  if (!isObj(raw.blobs)) bad('blobs');
  const blobs = raw.blobs;
  for (const [hash, info] of Object.entries(blobs)) {
    if (!isSha256(hash) || !isObj(info)) bad('blob table');
    if (typeof info.size !== 'number' || !Number.isInteger(info.size) || info.size < 0) bad('blob size');
    if (typeof info.type !== 'string') bad('blob type');
  }
  const seen = new Set<string>();
  const unique = (id: string, what: string) => {
    if (seen.has(`${what}:${id}`)) bad(`duplicate ${what} id`);
    seen.add(`${what}:${id}`);
  };
  const blobRef = (hash: unknown, what: string) => {
    if (!isSha256(hash)) bad(`${what}: bad blob hash`);
    if (!Object.hasOwn(blobs, hash)) throw new BackupError('missing-blob', `${what}: blob not in table`);
  };

  for (const entry of requireArray(raw.projects, 'projects')) {
    if (!isObj(entry) || !isObj(entry.project)) bad('project entry');
    const projectId = requireId(entry.project.id, 'project');
    unique(projectId, 'project');
    if (typeof entry.project.name !== 'string') bad('project name');
    if (!Array.isArray(entry.project.planIds)) bad('project planIds');
    for (const plan of requireArray(entry.plans, 'plans')) {
      if (!isObj(plan) || !isObj(plan.plan)) bad('plan entry');
      const planId = requireId(plan.plan.id, 'plan');
      unique(planId, 'plan');
      if (!isObj(plan.plan.pages)) bad('plan pages');
      if (plan.pdf !== null) blobRef(plan.pdf, 'plan pdf');
      for (const version of requireArray(plan.versions, 'versions')) {
        if (!isObj(version)) bad('version');
        unique(requireId(version.id, 'version'), 'version');
        if (version.planId !== planId) bad('version planId');
      }
      for (const review of requireArray(plan.aiReviews, 'aiReviews')) {
        if (!isObj(review) || typeof review.key !== 'string' || review.planId !== planId) bad('aiReview');
      }
      for (const review of requireArray(plan.openingsAiReviews, 'openingsAiReviews')) {
        if (!isObj(review) || typeof review.key !== 'string' || review.planId !== planId) bad('openingsAiReview');
      }
    }
    for (const cmp of requireArray(entry.comparisons, 'comparisons')) {
      if (!isObj(cmp) || !isObj(cmp.comparison)) bad('comparison entry');
      unique(requireId(cmp.comparison.id, 'comparison'), 'comparison');
      if (!Array.isArray(cmp.comparison.revisions)) bad('comparison revisions');
      if (!isObj(cmp.pdfs)) bad('comparison pdfs');
      for (const hash of Object.values(cmp.pdfs)) blobRef(hash, 'comparison pdf');
    }
  }
  return raw as unknown as BackupManifest;
}
