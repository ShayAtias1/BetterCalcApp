import type { AiBatch } from '../lib/ai/batchModel';
import type { AiJobRecord, AiReviewRecord } from '../lib/ai/contracts';
import { notifyPdfBlobChanged } from '../lib/pdfBlobEvents';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { v4 as uuid } from 'uuid';
import type { Plan, Project } from '../types';
import { DEFAULT_AREA_KIND_COLORS, IDENTITY_TRANSFORM } from '../types/compare';
import type { Comparison, ComparisonPage, RevisionLayer } from '../types/compare';
import { migrateComparePageOwnership } from '../lib/compareMigration';
import { withMeasurementValues } from '../lib/measurementValues';

interface QtoDB extends DBSchema {
  aiBatches: { key:string; value:AiBatch };
  aiReviews: { key:string; value:AiReviewRecord };
  aiJobs: { key:string; value:AiJobRecord };
  /**
   * Plans. The store keeps its historical name: before projects existed every saved takeoff was a
   * single plan document stored here, and keeping the name means no record ever has to move.
   */
  projects: {
    key: string;
    value: Plan;
  };
  pdfFiles: {
    key: string; // planId
    value: Blob;
  };
  /** Project folders (`Project`): a name plus the ordered ids of their plans. */
  takeoffProjects: {
    key: string;
    value: Project;
  };
  comparisons: {
    key: string;
    value: Comparison;
  };
  comparePdfFiles: {
    key: string; // `${comparisonId}:${layer}`
    value: Blob;
  };
}

const DB_NAME = 'bettercalc-qto';
const DB_VERSION = 5;

let dbPromise: Promise<IDBPDatabase<QtoDB>> | null = null;

function getDb(): Promise<IDBPDatabase<QtoDB>> {
  if (!dbPromise) {
    dbPromise = openDB<QtoDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('aiBatches')) db.createObjectStore('aiBatches', {keyPath:'id'});
        // v4 adds isolated AI stores; existing plan/PDF storage is unchanged.
        if (!db.objectStoreNames.contains('aiReviews')) db.createObjectStore('aiReviews', {keyPath:'key'});
        if (!db.objectStoreNames.contains('aiJobs')) db.createObjectStore('aiJobs', {keyPath:'requestId'});
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('pdfFiles')) {
          db.createObjectStore('pdfFiles');
        }
        if (!db.objectStoreNames.contains('comparisons')) {
          db.createObjectStore('comparisons', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('comparePdfFiles')) {
          db.createObjectStore('comparePdfFiles');
        }
        // v3: project folders. Existing plans are wrapped into them lazily (migrateLegacyPlans).
        if (!db.objectStoreNames.contains('takeoffProjects')) {
          db.createObjectStore('takeoffProjects', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

// ---------- plans ----------

/**
 * Gives measurements saved before `lengthM` existed their value (lib/measurementValues). In memory
 * only: nothing is written on open, and the value is saved with the plan's next ordinary save.
 */
function withPlanMeasurementValues(plan: Plan): Plan {
  if (!Array.isArray(plan.measurements)) return plan;
  const measurements = withMeasurementValues(plan.measurements);
  return measurements === plan.measurements ? plan : { ...plan, measurements };
}

/** Every saved plan, as read for use. */
async function readAllPlans(db: IDBPDatabase<QtoDB>): Promise<Plan[]> {
  return (await db.getAll('projects')).map(withPlanMeasurementValues);
}

export async function savePlan(plan: Plan): Promise<void> {
  const db = await getDb();
  await db.put('projects', plan);
}

export async function savePdfBlob(planId: string, blob: Blob): Promise<void> {
  const db = await getDb();
  await db.put('pdfFiles', blob, planId);
  notifyPdfBlobChanged(`plan:${planId}`);
}

export async function loadPdfBlob(planId: string): Promise<Blob | undefined> {
  const db = await getDb();
  return db.get('pdfFiles', planId);
}

export async function loadPlan(id: string): Promise<Plan | undefined> {
  const db = await getDb();
  const plan = await db.get('projects', id);
  return plan && withPlanMeasurementValues(plan);
}

/** Deletes a plan with its PDF and takes it out of its project's plan list. */
export async function deletePlan(planId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['projects', 'pdfFiles', 'takeoffProjects'], 'readwrite');
  const plan = await tx.objectStore('projects').get(planId);
  if (plan?.projectId) {
    const project = await tx.objectStore('takeoffProjects').get(plan.projectId);
    if (project) {
      await tx.objectStore('takeoffProjects').put({
        ...project,
        planIds: project.planIds.filter((id) => id !== planId),
        updatedAt: Date.now(),
      });
    }
  }
  await tx.objectStore('projects').delete(planId);
  await tx.objectStore('pdfFiles').delete(planId);
  await tx.done;
}

// ---------- projects ----------

export interface ProjectWithPlans {
  project: Project;
  /** In the project's display order. */
  plans: Plan[];
  /** The project's revision comparisons, in display order. */
  comparisons: Comparison[];
}

export async function saveProject(project: Project): Promise<void> {
  const db = await getDb();
  await db.put('takeoffProjects', project);
}

/**
 * "קומה-3.pdf" → "קומה-3"; the name an old single-plan record's plan gets when it is wrapped. The
 * fallback is fixed Hebrew on purpose (not the UI language): migrations must give the same result
 * whenever they run, and every record they wrap was made by the Hebrew-only app.
 */
function planNameFromFile(pdfFileName: string): string {
  return pdfFileName.replace(/\.pdf$/i, '').trim() || 'תוכנית 1';
}

/**
 * The one migration from the single-plan era. A saved plan with no project (every record saved
 * before projects existed), or whose project record is missing, is wrapped into a project:
 * the project takes the record's old name, the plan is renamed after its PDF file, and nothing
 * else in the record — rooms, calibration, PDF blob key — is touched.
 *
 * Idempotent: the wrapping project's id is derived from the plan id, so a run interrupted between
 * the two writes simply completes on the next load instead of creating a second project.
 * Also self-heals a project's `planIds` if a plan points at it without being listed.
 */
async function migrateLegacyPlans(db: IDBPDatabase<QtoDB>): Promise<void> {
  const [projects, plans] = await Promise.all([db.getAll('takeoffProjects'), db.getAll('projects')]);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const changedProjects = new Set<string>();
  const changedPlans: Plan[] = [];

  for (const plan of plans) {
    const projectId = plan.projectId ?? `legacy-${plan.id}`;
    let project = byId.get(projectId);
    if (!project) {
      project = { id: projectId, name: plan.name, createdAt: plan.createdAt, updatedAt: plan.updatedAt, planIds: [] };
      byId.set(projectId, project);
      changedProjects.add(projectId);
    }
    if (!project.planIds.includes(plan.id)) {
      project.planIds = [...project.planIds, plan.id];
      changedProjects.add(projectId);
    }
    if (!plan.projectId) changedPlans.push({ ...plan, projectId, name: planNameFromFile(plan.pdfFileName) });
  }

  if (changedProjects.size === 0 && changedPlans.length === 0) return;
  const tx = db.transaction(['takeoffProjects', 'projects'], 'readwrite');
  for (const id of changedProjects) await tx.objectStore('takeoffProjects').put(byId.get(id)!);
  for (const plan of changedPlans) await tx.objectStore('projects').put(plan);
  await tx.done;
}

/**
 * The same wrapping for Revision Compare. A comparison saved before projects held comparisons
 * becomes its own project, named after the comparison — the comparison record itself only gains
 * `projectId`; its revisions, alignment, markings and PDF blobs are untouched. Idempotent (the
 * project id is derived from the comparison id), and self-heals `comparisonIds` like `planIds`.
 */
async function migrateLegacyComparisons(db: IDBPDatabase<QtoDB>): Promise<void> {
  const [projects, comparisons] = await Promise.all([db.getAll('takeoffProjects'), db.getAll('comparisons')]);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const changedProjects = new Set<string>();
  const changedComparisons: Comparison[] = [];

  for (const comparison of comparisons) {
    const projectId = comparison.projectId ?? `legacy-cmp-${comparison.id}`;
    let project = byId.get(projectId);
    if (!project) {
      project = { id: projectId, name: comparison.name, createdAt: comparison.createdAt, updatedAt: comparison.updatedAt, planIds: [] };
      byId.set(projectId, project);
      changedProjects.add(projectId);
    }
    const ids = project.comparisonIds ?? [];
    if (!ids.includes(comparison.id)) {
      project.comparisonIds = [...ids, comparison.id];
      changedProjects.add(projectId);
    }
    if (!comparison.projectId) changedComparisons.push({ ...comparison, projectId });
  }

  if (changedProjects.size === 0 && changedComparisons.length === 0) return;
  const tx = db.transaction(['takeoffProjects', 'comparisons'], 'readwrite');
  for (const id of changedProjects) await tx.objectStore('takeoffProjects').put(byId.get(id)!);
  for (const comparison of changedComparisons) await tx.objectStore('comparisons').put(comparison);
  await tx.done;
}

async function migrateLegacyDocuments(db: IDBPDatabase<QtoDB>): Promise<void> {
  await migrateLegacyPlans(db);
  await migrateLegacyComparisons(db);
}

/** Orders a project's documents by its id list; anything unlisted (should not happen after migration) goes last. */
function byListOrder<T extends { id: string; createdAt: number }>(items: T[], ids: string[]): T[] {
  const order = new Map(ids.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity) || a.createdAt - b.createdAt);
}

function withOrderedPlans(project: Project, allPlans: Plan[], allComparisons: Comparison[]): ProjectWithPlans {
  return {
    project,
    plans: byListOrder(allPlans.filter((p) => p.projectId === project.id), project.planIds),
    comparisons: byListOrder(allComparisons.filter((c) => c.projectId === project.id), project.comparisonIds ?? []),
  };
}

/** Every project with its plans and comparisons, most recently worked-on first. Runs the legacy migrations first. */
export async function listProjects(): Promise<ProjectWithPlans[]> {
  const db = await getDb();
  await migrateLegacyDocuments(db);
  const [projects, plans, comparisons] = await Promise.all([db.getAll('takeoffProjects'), readAllPlans(db), listComparisons()]);
  const lastTouched = (x: ProjectWithPlans) =>
    Math.max(x.project.updatedAt, ...x.plans.map((p) => p.updatedAt), ...x.comparisons.map((c) => c.updatedAt));
  return projects.map((p) => withOrderedPlans(p, plans, comparisons)).sort((a, b) => lastTouched(b) - lastTouched(a));
}

/** Record counts only, for anonymous analytics (`app_opened`) — never reads a document's contents. */
export async function countLocalDocuments(): Promise<{ projects: number; plans: number; comparisons: number }> {
  const db = await getDb();
  const [projects, plans, comparisons] = await Promise.all([db.count('takeoffProjects'), db.count('projects'), db.count('comparisons')]);
  return { projects, plans, comparisons };
}

export async function loadProjectWithPlans(projectId: string): Promise<ProjectWithPlans | undefined> {
  const db = await getDb();
  await migrateLegacyDocuments(db);
  const project = await db.get('takeoffProjects', projectId);
  if (!project) return undefined;
  const [plans, comparisons] = await Promise.all([readAllPlans(db), listComparisons()]);
  return withOrderedPlans(project, plans, comparisons);
}

/** Deletes a project together with every one of its plans and comparisons, and all their PDFs. */
export async function deleteProject(projectId: string): Promise<void> {
  const db = await getDb();
  for (const comparison of (await db.getAll('comparisons')).filter((c) => c.projectId === projectId)) {
    await deleteComparison(comparison.id);
  }
  const plans = (await db.getAll('projects')).filter((p) => p.projectId === projectId);
  const tx = db.transaction(['projects', 'pdfFiles', 'takeoffProjects'], 'readwrite');
  for (const plan of plans) {
    await tx.objectStore('projects').delete(plan.id);
    await tx.objectStore('pdfFiles').delete(plan.id);
  }
  await tx.objectStore('takeoffProjects').delete(projectId);
  await tx.done;
}

/**
 * Older saved comparisons had a single `revised*` layer instead of a `revisions` array.
 * Convert them in place (and move the matching PDF blob) the first time they're loaded.
 */
async function migrateLegacyRevisedLayer(db: IDBPDatabase<QtoDB>, raw: Comparison): Promise<Comparison> {
  if (Array.isArray(raw.revisions) && raw.activeRevisionId) return raw;
  const legacy = raw as unknown as {
    revisedFileName?: string;
    revisedOpacity?: number;
    revisedVisible?: boolean;
    revisedColorTint?: string;
    revisedUseSourceColors?: boolean;
    pages: Record<
      number,
      {
        originalPageNumber: number;
        originalCalibration: ComparisonPage['originalCalibration'];
        revisedPageNumber?: number;
        revisedCalibration?: ComparisonPage['revisions'][string]['revisedCalibration'];
        alignment?: ComparisonPage['revisions'][string]['alignment'];
        alignmentPoints?: ComparisonPage['revisions'][string]['alignmentPoints'];
      }
    >;
  };
  const revisionId = uuid();
  // markups/measurements are deliberately left unset here — migrateRevisionScopedData (run right
  // after this) is what attributes the old comparison-level lists to this revision.
  const revision = {
    id: revisionId,
    // Fixed Hebrew on purpose, like planNameFromFile: a migration of Hebrew-era data, not UI text.
    label: 'מעודכן',
    fileName: legacy.revisedFileName ?? '',
    opacity: legacy.revisedOpacity ?? 0.75,
    visible: legacy.revisedVisible ?? true,
    colorTint: legacy.revisedColorTint ?? '#ef4444',
    useSourceColors: legacy.revisedUseSourceColors ?? false,
  } as unknown as RevisionLayer;
  const pages: Record<number, ComparisonPage> = {};
  for (const [key, p] of Object.entries(legacy.pages ?? {})) {
    pages[Number(key)] = {
      originalPageNumber: p.originalPageNumber,
      originalCalibration: p.originalCalibration ?? null,
      revisions: {
        [revisionId]: {
          revisedPageNumber: p.revisedPageNumber ?? p.originalPageNumber,
          revisedCalibration: p.revisedCalibration ?? null,
          alignment: p.alignment ?? IDENTITY_TRANSFORM,
          alignmentPoints: p.alignmentPoints ?? [],
        },
      },
    };
  }
  const migrated: Comparison = {
    ...raw,
    pages,
    revisions: [revision],
    activeRevisionId: revisionId,
    areaKindColors: raw.areaKindColors ?? { ...DEFAULT_AREA_KIND_COLORS },
  };

  const oldBlob = await db.get('comparePdfFiles', `${raw.id}:revised`);
  if (oldBlob) {
    await db.put('comparePdfFiles', oldBlob, `${raw.id}:revision:${revisionId}`);
    await db.delete('comparePdfFiles', `${raw.id}:revised`);
  }
  await db.put('comparisons', migrated);
  return migrated;
}

/**
 * Markups and measurements used to be shared across all of a comparison's revisions.
 * They now belong to whichever revision was active when drawn — attribute the old
 * shared lists to the (then-)active revision, or the first one, the first time it's loaded.
 */
async function migrateRevisionScopedData(db: IDBPDatabase<QtoDB>, raw: Comparison): Promise<Comparison> {
  const legacy = raw as unknown as { markups?: Comparison['revisions'][number]['markups']; measurements?: Comparison['revisions'][number]['measurements'] };
  const needsMigration = raw.revisions.some((r) => !Array.isArray(r.markups) || !Array.isArray(r.measurements));
  if (!needsMigration) return raw;

  const legacyTargetId = raw.revisions.some((r) => r.id === raw.activeRevisionId) ? raw.activeRevisionId : raw.revisions[0]?.id;
  const legacyMarkups = Array.isArray(legacy.markups) ? legacy.markups : [];
  const legacyMeasurements = Array.isArray(legacy.measurements) ? legacy.measurements : [];

  const revisions = raw.revisions.map((r) => ({
    ...r,
    markups: Array.isArray(r.markups) ? r.markups : r.id === legacyTargetId ? legacyMarkups : [],
    measurements: Array.isArray(r.measurements) ? r.measurements : r.id === legacyTargetId ? legacyMeasurements : [],
  }));

  const migrated: Comparison = { ...raw, revisions };
  delete (migrated as unknown as { markups?: unknown }).markups;
  delete (migrated as unknown as { measurements?: unknown }).measurements;

  await db.put('comparisons', migrated);
  return migrated;
}

async function migrateComparison(db: IDBPDatabase<QtoDB>, raw: Comparison): Promise<Comparison> {
  const step1 = await migrateLegacyRevisedLayer(db, raw);
  const step2 = await migrateRevisionScopedData(db, step1);
  const { comparison, changed } = migrateComparePageOwnership(step2);
  if (changed) await db.put('comparisons', comparison);
  return withComparisonMeasurementValues(comparison);
}

/** The comparison counterpart of `withPlanMeasurementValues` — in memory only, per revision. */
function withComparisonMeasurementValues(comparison: Comparison): Comparison {
  let changed = false;
  const revisions = comparison.revisions.map((r) => {
    const measurements = withMeasurementValues(r.measurements);
    if (measurements === r.measurements) return r;
    changed = true;
    return { ...r, measurements };
  });
  return changed ? { ...comparison, revisions } : comparison;
}

export async function saveComparison(comparison: Comparison): Promise<void> {
  const db = await getDb();
  await db.put('comparisons', comparison);
}

export async function listComparisons(): Promise<Comparison[]> {
  const db = await getDb();
  const all = await db.getAll('comparisons');
  const migrated = await Promise.all(all.map((c) => migrateComparison(db, c)));
  return migrated.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadComparison(id: string): Promise<Comparison | undefined> {
  const db = await getDb();
  const raw = await db.get('comparisons', id);
  if (!raw) return undefined;
  return migrateComparison(db, raw);
}

/** Deletes a comparison with all its PDFs, and takes it out of its project's comparison list. */
export async function deleteComparison(id: string): Promise<void> {
  const db = await getDb();
  const existing = await db.get('comparisons', id);
  if (existing?.projectId) {
    const project = await db.get('takeoffProjects', existing.projectId);
    if (project) {
      await db.put('takeoffProjects', {
        ...project,
        comparisonIds: (project.comparisonIds ?? []).filter((c) => c !== id),
        updatedAt: Date.now(),
      });
    }
  }
  await db.delete('comparisons', id);
  await db.delete('comparePdfFiles', `${id}:original`);
  await db.delete('comparePdfFiles', `${id}:revised`);
  for (const revision of existing?.revisions ?? []) {
    await db.delete('comparePdfFiles', `${id}:revision:${revision.id}`);
  }
}

/** `layer` is 'original' or `revision:${revisionId}`. */
export async function saveComparePdfBlob(comparisonId: string, layer: string, blob: Blob): Promise<void> {
  const db = await getDb();
  await db.put('comparePdfFiles', blob, `${comparisonId}:${layer}`);
  notifyPdfBlobChanged(`compare:${comparisonId}:${layer}`);
}

export async function loadComparePdfBlob(comparisonId: string, layer: string): Promise<Blob | undefined> {
  const db = await getDb();
  return db.get('comparePdfFiles', `${comparisonId}:${layer}`);
}

export async function deleteComparePdfBlob(comparisonId: string, layer: string): Promise<void> {
  const db = await getDb();
  await db.delete('comparePdfFiles', `${comparisonId}:${layer}`);
  notifyPdfBlobChanged(`compare:${comparisonId}:${layer}`);
}

// ---------- page-bound AI development reviews and jobs ----------
export async function loadAiReview(key:string):Promise<AiReviewRecord|undefined>{return (await getDb()).get('aiReviews',key);}
export async function updateAiReview(key:string,update:(previous:AiReviewRecord|undefined)=>AiReviewRecord):Promise<void>{
  const db=await getDb(),tx=db.transaction('aiReviews','readwrite');
  await tx.store.put(update(await tx.store.get(key)));await tx.done;
}
export async function saveAiJob(job:AiJobRecord):Promise<void>{await (await getDb()).put('aiJobs',job);}
export async function listAiJobs():Promise<AiJobRecord[]>{return (await getDb()).getAll('aiJobs');}

export async function saveAiBatch(batch:AiBatch):Promise<void>{await (await getDb()).put('aiBatches',batch);}
export async function listAiBatches():Promise<AiBatch[]>{return (await getDb()).getAll('aiBatches');}
