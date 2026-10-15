/**
 * Detection of IndexedDB records that belong to a document that no longer exists. Pure: it works on a
 * snapshot of ids and never touches storage. Two outputs:
 *  - `cleanable`: records whose owner is gone and that are safe to delete;
 *  - `reportOnly`: anomalies that are NOT deleted, because removing them could lose user data or race
 *    with an operation in progress (user documents, dangling references, unreferenced revision PDFs,
 *    AI jobs — running ones are live work, finished ones hold cost history).
 * Plans, comparisons and projects themselves are never cleanable.
 */
export interface OrphanSnapshot {
  plans: { id: string; projectId?: string }[];
  projects: { id: string; planIds: string[]; comparisonIds?: string[] }[];
  /** `revisionIds` is null for legacy comparisons that predate the `revisions` array. */
  comparisons: { id: string; projectId?: string; revisionIds: string[] | null }[];
  pdfFileKeys: string[];
  comparePdfKeys: string[];
  planVersions: { id: string; planId: string }[];
  aiReviews: { key: string; planId: string }[];
  openingsAiReviews: { key: string; planId: string }[];
  aiJobs: { requestId: string; planId: string; status: string }[];
  openingsAiJobs: { requestId: string; planId: string; status: string }[];
  aiBatches: { id: string; projectId: string; pages: { planId: string }[] }[];
}

/** Ids of documents with work in progress (an open plan, a comparison being created); never cleaned. */
export interface OrphanProtection {
  planIds?: ReadonlySet<string>;
  comparisonIds?: ReadonlySet<string>;
}

export interface OrphanReport {
  cleanable: {
    planVersions: string[];
    aiReviews: string[];
    openingsAiReviews: string[];
    pdfFiles: string[];
    comparePdfFiles: string[];
  };
  reportOnly: {
    /** `${comparisonId}:revision:${id}` blobs of an existing comparison that does not list that revision. */
    unreferencedRevisionPdfs: string[];
    activeJobsForMissingPlans: string[];
    /**
     * Finished jobs of plans that no longer exist. They carry cost and usage history, so they are
     * reported but never deleted by cleanup.
     */
    finishedJobsForMissingPlans: string[];
    plansWithoutProject: string[];
    comparisonsWithoutProject: string[];
    danglingPlanRefs: { projectId: string; planId: string }[];
    danglingComparisonRefs: { projectId: string; comparisonId: string }[];
    batchesWithMissingPlans: string[];
  };
}

export type CleanableCategory = keyof OrphanReport['cleanable'];
export const CLEANABLE_CATEGORIES: CleanableCategory[] = [
  'planVersions', 'aiReviews', 'openingsAiReviews', 'pdfFiles', 'comparePdfFiles',
];

const FINISHED = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'IDLE']);

export function isFinishedJobStatus(status: string): boolean {
  return FINISHED.has(status);
}

export function totalCleanable(report: OrphanReport): number {
  return CLEANABLE_CATEGORIES.reduce((n, c) => n + report.cleanable[c].length, 0);
}

export function detectOrphans(s: OrphanSnapshot, protect: OrphanProtection = {}): OrphanReport {
  const planIds = new Set(s.plans.map((p) => p.id));
  const comparisonById = new Map(s.comparisons.map((c) => [c.id, c]));
  const projectIds = new Set(s.projects.map((p) => p.id));
  const planGone = (id: string) => typeof id === 'string' && !planIds.has(id) && !protect.planIds?.has(id);
  const comparisonGone = (id: string) => !comparisonById.has(id) && !protect.comparisonIds?.has(id);

  const report: OrphanReport = {
    cleanable: { planVersions: [], aiReviews: [], openingsAiReviews: [], pdfFiles: [], comparePdfFiles: [] },
    reportOnly: {
      unreferencedRevisionPdfs: [], activeJobsForMissingPlans: [], finishedJobsForMissingPlans: [], plansWithoutProject: [], comparisonsWithoutProject: [],
      danglingPlanRefs: [], danglingComparisonRefs: [], batchesWithMissingPlans: [],
    },
  };

  for (const v of s.planVersions) if (planGone(v.planId)) report.cleanable.planVersions.push(v.id);
  for (const r of s.aiReviews) if (planGone(r.planId)) report.cleanable.aiReviews.push(r.key);
  for (const r of s.openingsAiReviews) if (planGone(r.planId)) report.cleanable.openingsAiReviews.push(r.key);
  for (const key of s.pdfFileKeys) if (typeof key === 'string' && planGone(key)) report.cleanable.pdfFiles.push(key);

  for (const key of s.comparePdfKeys) {
    if (typeof key !== 'string') continue;
    const colon = key.indexOf(':');
    if (colon <= 0) continue;
    const comparisonId = key.slice(0, colon);
    const layer = key.slice(colon + 1);
    if (comparisonGone(comparisonId)) {
      report.cleanable.comparePdfFiles.push(key);
      continue;
    }
    const comparison = comparisonById.get(comparisonId);
    if (comparison?.revisionIds && layer.startsWith('revision:') && !comparison.revisionIds.includes(layer.slice('revision:'.length))) {
      // The document's autosave can trail an added revision's PDF, so this is reported, never deleted.
      report.reportOnly.unreferencedRevisionPdfs.push(key);
    }
  }

  // Jobs are never cleanable: finished ones hold cost history, running ones are live work.
  for (const job of [...s.aiJobs, ...s.openingsAiJobs]) {
    if (!planGone(job.planId)) continue;
    if (isFinishedJobStatus(job.status)) report.reportOnly.finishedJobsForMissingPlans.push(job.requestId);
    else report.reportOnly.activeJobsForMissingPlans.push(job.requestId);
  }

  for (const p of s.plans) if (p.projectId && !projectIds.has(p.projectId)) report.reportOnly.plansWithoutProject.push(p.id);
  for (const c of s.comparisons) if (c.projectId && !projectIds.has(c.projectId)) report.reportOnly.comparisonsWithoutProject.push(c.id);
  for (const project of s.projects) {
    for (const planId of project.planIds) if (!planIds.has(planId)) report.reportOnly.danglingPlanRefs.push({ projectId: project.id, planId });
    for (const comparisonId of project.comparisonIds ?? []) {
      if (!comparisonById.has(comparisonId)) report.reportOnly.danglingComparisonRefs.push({ projectId: project.id, comparisonId });
    }
  }
  for (const b of s.aiBatches) if (b.pages.some((p) => !planIds.has(p.planId))) report.reportOnly.batchesWithMissingPlans.push(b.id);
  return report;
}
