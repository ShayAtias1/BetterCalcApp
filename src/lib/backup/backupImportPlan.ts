import { v4 as uuid } from 'uuid';
import type { Plan, Project } from '../../types';
import type { Comparison } from '../../types/compare';
import type { PlanVersion } from '../../types/revisionAnalysis';
import type { AiReviewRecord } from '../ai/contracts';
import type { AiOpeningReview } from '../../types/aiOpenings';
import { BackupError } from './backupFormat';
import type { BackupArchive } from './backupArchive';

/** Ids already present in the local database; a backup never overwrites any of them. */
export interface ExistingIds {
  projects: ReadonlySet<string>;
  plans: ReadonlySet<string>;
  comparisons: ReadonlySet<string>;
  planVersions: ReadonlySet<string>;
}

export interface ImportedProject {
  project: Project;
  plans: {
    plan: Plan;
    pdf: Blob | null;
    versions: PlanVersion[];
    aiReviews: AiReviewRecord[];
    openingsAiReviews: AiOpeningReview[];
  }[];
  comparisons: { comparison: Comparison; pdfs: Record<string, Blob> }[];
  /** True when the project's ids were replaced because some of them already exist locally. */
  importedAsCopy: boolean;
  /** Comparison→plan links dropped because the linked plan is not part of the backup. */
  droppedPlanLinks: { comparisonId: string; planId: string }[];
  /** Comparison ids referenced by this project's plans (applied-revision history) that are not part of the backup. */
  detachedComparisonRefs: string[];
}

/** Marks a project imported on top of an id collision. Fixed Hebrew on purpose, like other stored names. */
export const COPY_NAME_SUFFIX = ' (עותק)';

/**
 * The only fields that ever hold a reference to a project, plan, comparison or plan version, wherever
 * they appear in a document (including inside plan-version snapshots). Anything else — names, notes,
 * labels, text — is never touched, whatever it contains.
 */
const ID_FIELDS = new Set(['projectId', 'planId', 'comparisonId', 'linkedPlanId', 'versionId']);
const ID_LIST_FIELDS = new Set(['planIds', 'comparisonIds']);
/** Review keys: `${planId}:${page}:${hash}`; only the leading plan id is an identifier. */
const KEY_FIELDS = new Set(['reviewKey']);
const KEY_LIST_FIELDS = new Set(['aiOpeningImportKeys']);

/**
 * Rewrites a review key that embeds a remapped plan id. Two shapes exist in saved data:
 * room-detection reviews use `${planId}:${page}:${hash}`, and opening reviews use the JSON text of
 * `["openings-v1", planId, page, hash, importId]`. Only the plan id inside the key is replaced.
 */
export function remapReviewKey(key: string, idMap: ReadonlyMap<string, string>): string {
  if (key.startsWith('[')) {
    try {
      const parts: unknown = JSON.parse(key);
      if (Array.isArray(parts) && typeof parts[1] === 'string' && idMap.has(parts[1])) {
        return JSON.stringify(parts.map((part, i) => (i === 1 ? idMap.get(part as string) : part)));
      }
    } catch {
      // Not JSON: fall through to the colon-separated form.
    }
    return key;
  }
  const colon = key.indexOf(':');
  if (colon <= 0) return key;
  const replacement = idMap.get(key.slice(0, colon));
  return replacement === undefined ? key : replacement + key.slice(colon);
}

/**
 * Deep-copies `value`, replacing old ids with new ones only in the identifier fields listed above
 * (exact matches, and the plan-id prefix of review keys). Never rewrites arbitrary strings or keys.
 */
export function remapIds<T>(value: T, idMap: ReadonlyMap<string, string>): T {
  const exact = (v: unknown) => (typeof v === 'string' ? (idMap.get(v) ?? v) : v);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node)) {
      if (key === '__proto__') throw new BackupError('invalid', 'forbidden key');
      if (ID_FIELDS.has(key)) out[key] = exact(child);
      else if (ID_LIST_FIELDS.has(key) && Array.isArray(child)) out[key] = child.map(exact);
      else if (KEY_FIELDS.has(key) && typeof child === 'string') out[key] = remapReviewKey(child, idMap);
      else if (KEY_LIST_FIELDS.has(key) && Array.isArray(child)) {
        out[key] = child.map((k) => (typeof k === 'string' ? remapReviewKey(k, idMap) : k));
      } else out[key] = walk(child);
    }
    return out;
  };
  return walk(value) as T;
}

/** Every value of a `comparisonId` field anywhere inside `value`. */
function collectComparisonRefs(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectComparisonRefs(item, into);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'comparisonId' && typeof child === 'string') into.add(child);
      else collectComparisonRefs(child, into);
    }
  }
}

/**
 * Pure: turns a verified archive into documents ready to write. A project whose project, plan,
 * comparison or plan-version id already exists locally is imported as a copy with all of those ids
 * regenerated (and every reference to them rewritten); other projects keep their ids. Nothing
 * existing is ever replaced.
 */
export function planImport(archive: BackupArchive, existing: ExistingIds): ImportedProject[] {
  const entries = archive.manifest.projects;
  const takenProjects = new Set(existing.projects);
  // One id map for the whole file, so references between projects of the same backup stay consistent
  // whichever of them had to be regenerated.
  const idMap = new Map<string, string>();
  const copies = new Set<string>();
  for (const entry of entries) {
    const plans = entry.plans.map((p) => p.plan.id);
    const comparisons = entry.comparisons.map((c) => c.comparison.id);
    const versions = entry.plans.flatMap((p) => p.versions.map((v) => v.id));
    const collides =
      takenProjects.has(entry.project.id) ||
      plans.some((id) => existing.plans.has(id)) ||
      comparisons.some((id) => existing.comparisons.has(id)) ||
      versions.some((id) => existing.planVersions.has(id));
    if (!collides) continue;
    copies.add(entry.project.id);
    for (const id of [entry.project.id, ...plans, ...comparisons, ...versions]) idMap.set(id, uuid());
  }
  // Plans (and their version snapshots) remember which comparison applied a revision, and which
  // comparison wrote each applied quantity. A reference to a comparison that is not in this backup
  // would otherwise match an unrelated local comparison that happens to carry that id, so it is given
  // a fresh id that belongs to no record: the history is kept but cannot attach to anything.
  const backupComparisons = new Set(entries.flatMap((e) => e.comparisons.map((c) => c.comparison.id)));
  const refsByProject = new Map<string, string[]>();
  for (const entry of entries) {
    const refs = new Set<string>();
    collectComparisonRefs(entry.plans.map((p) => [p.plan, p.versions]), refs);
    const external = [...refs].filter((id) => !backupComparisons.has(id));
    for (const id of external) if (!idMap.has(id)) idMap.set(id, uuid());
    refsByProject.set(entry.project.id, external);
  }
  const mapped = (id: string) => idMap.get(id) ?? id;
  // Plans this backup restores (after remapping): the only valid targets of a comparison's link.
  const importedPlanIds = new Set(entries.flatMap((e) => e.plans.map((p) => mapped(p.plan.id))));

  return entries.map((entry): ImportedProject => {
    const importedAsCopy = copies.has(entry.project.id);
    const blob = (hash: string) => {
      const data = archive.blobs.get(hash);
      if (!data) throw new BackupError('missing-blob', `blob ${hash} missing`);
      const type = archive.manifest.blobs[hash]?.type ?? 'application/pdf';
      return new Blob([data as Uint8Array<ArrayBuffer>], { type });
    };
    const remapped = remapIds(entry, idMap);
    const base = remapped.project;
    const project: Project = importedAsCopy
      ? { ...base, id: mapped(entry.project.id), name: base.name + COPY_NAME_SUFFIX }
      : base;
    const droppedPlanLinks: ImportedProject['droppedPlanLinks'] = [];

    return {
      project,
      importedAsCopy,
      droppedPlanLinks,
      detachedComparisonRefs: refsByProject.get(entry.project.id) ?? [],
      plans: remapped.plans.map((p, i) => {
        const source = entry.plans[i];
        const versions = p.versions.map((v, j) => {
          // The snapshot is a whole plan document: its own `id` is the plan id.
          const snapshot = v.plan as Record<string, unknown> | null;
          const next = snapshot && typeof snapshot === 'object' && snapshot.id === source.plan.id
            ? { ...snapshot, id: mapped(source.plan.id) }
            : snapshot;
          return { ...v, id: mapped(source.versions[j].id), plan: next };
        });
        return {
          plan: { ...p.plan, id: mapped(source.plan.id), projectId: project.id },
          pdf: source.pdf ? blob(source.pdf) : null,
          versions,
          aiReviews: p.aiReviews.map((r, j) => ({ ...r, key: remapReviewKey(source.aiReviews[j].key, idMap) })),
          openingsAiReviews: p.openingsAiReviews.map((r, j) => ({ ...r, key: remapReviewKey(source.openingsAiReviews[j].key, idMap) })),
        };
      }),
      comparisons: remapped.comparisons.map((c, i) => {
        const source = entry.comparisons[i];
        let comparison = { ...c.comparison, id: mapped(source.comparison.id), projectId: project.id };
        const link = comparison.linkedPlanId;
        if (link !== undefined && !importedPlanIds.has(link)) {
          // The linked plan is not part of this backup. Keeping the id could attach the imported
          // comparison to an unrelated local plan, so the link is dropped (standalone comparison).
          droppedPlanLinks.push({ comparisonId: comparison.id, planId: link });
          const { linkedPlanId: _dropped, ...standalone } = comparison;
          comparison = standalone;
        }
        // Layer names (`original`, `revision:<id>`) are not remapped: revision ids are scoped to a comparison.
        return {
          comparison,
          pdfs: Object.fromEntries(Object.entries(source.pdfs).map(([layer, hash]) => [layer, blob(hash)])),
        };
      }),
    };
  });
}
