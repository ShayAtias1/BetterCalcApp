import { useAppStore } from '../store/appStore';
import { useCompareStore } from '../store/compareStore';
import { loadProjectWithPlans, loadPlan, loadComparison, loadPdfBlob, loadComparePdfBlob } from '../db/database';
import type { CompareViewMode } from '../types/compare';

export const WORKSPACE_SESSION_KEY = 'bettercalc.workspace-session.v1';
const database = { loadProjectWithPlans, loadPlan, loadComparison, loadPdfBlob, loadComparePdfBlob };
type Bookmark = {
  version: 1;
  workspace: 'project' | 'takeoff' | 'compare';
  projectId?: string;
  documentId?: string;
  page: number;
  viewMode?: CompareViewMode;
  revisionId?: string;
};
const viewModes: CompareViewMode[] = ['overlay', 'swipe', 'blink'];

function readBookmark(storage: Storage | null): Bookmark | null {
  try {
    const b = JSON.parse(storage?.getItem(WORKSPACE_SESSION_KEY) ?? 'null');
    if (!b || b.version !== 1 || !['project', 'takeoff', 'compare'].includes(b.workspace)
      || (b.projectId !== undefined && typeof b.projectId !== 'string')
      || (b.workspace === 'project' ? !b.projectId : typeof b.documentId !== 'string' || !b.documentId)) return null;
    return { version: 1, workspace: b.workspace, projectId: b.projectId, documentId: b.documentId,
      page: Number.isSafeInteger(b.page) && b.page > 0 ? b.page : 1,
      viewMode: viewModes.includes(b.viewMode) ? b.viewMode : 'overlay',
      revisionId: typeof b.revisionId === 'string' ? b.revisionId : undefined };
  } catch { return null; }
}

/** Only navigation metadata is stored here. IndexedDB remains the sole document source. */
export function createWorkspaceSession(storage: Storage | null, db = database) {
  let ready = false;
  let lastWritten: string | null | undefined;
  let boot: Promise<void> | undefined;
  let unsubscribe: (() => void)[] = [];
  const pristine = () => {
    const app = useAppStore.getState(), compare = useCompareStore.getState();
    return !app.project && !app.currentProject && !compare.comparison && !app.dirty && !compare.dirty;
  };
  const record = () => {
    if (!ready) return;
    const app = useAppStore.getState(), compare = useCompareStore.getState();
    const bookmark: Bookmark | null = app.project ? { version: 1, workspace: 'takeoff',
      projectId: app.project.projectId ?? app.currentProject?.id, documentId: app.project.id, page: app.currentPage }
      : compare.comparison ? { version: 1, workspace: 'compare', projectId: compare.comparison.projectId ?? app.currentProject?.id,
        documentId: compare.comparison.id, page: compare.currentPageKey, viewMode: compare.viewMode, revisionId: compare.comparison.activeRevisionId }
      : app.currentProject ? { version: 1, workspace: 'project', projectId: app.currentProject.id, page: 1 } : null;
    const serialized = bookmark ? JSON.stringify(bookmark) : null;
    if (serialized === lastWritten) return;
    try {
      if (serialized) storage?.setItem(WORKSPACE_SESSION_KEY, serialized);
      else storage?.removeItem(WORKSPACE_SESSION_KEY);
      lastWritten = serialized;
    } catch { /* Disabled/full browser storage must never prevent ordinary navigation. */ }
  };
  const restore = async () => {
    const bookmark = readBookmark(storage);
    if (!bookmark || !pristine()) return;
    const plan = bookmark.workspace === 'takeoff' ? await db.loadPlan(bookmark.documentId!) : undefined;
    const comparison = bookmark.workspace === 'compare' ? await db.loadComparison(bookmark.documentId!) : undefined;
    if ((bookmark.workspace === 'takeoff' && !plan) || (bookmark.workspace === 'compare' && !comparison)) return;
    const documentProjectId = plan?.projectId ?? comparison?.projectId;
    if (documentProjectId && bookmark.projectId && documentProjectId !== bookmark.projectId) return;
    const projectId = documentProjectId ?? bookmark.projectId;
    const folder = projectId ? await db.loadProjectWithPlans(projectId) : undefined;
    if (projectId && !folder) return;
    let revisionId: string | undefined;
    if (plan && !await db.loadPdfBlob(plan.id)) return;
    if (comparison) {
      revisionId = comparison.revisions.find(r => r.id === bookmark.revisionId)?.id
        ?? comparison.revisions.find(r => r.id === comparison.activeRevisionId)?.id ?? comparison.revisions[0]?.id;
      if (!revisionId) return;
      const [original, revised] = await Promise.all([db.loadComparePdfBlob(comparison.id, 'original'),
        db.loadComparePdfBlob(comparison.id, `revision:${revisionId}`)]);
      if (!original || !revised) return;
    }
    // Loading is asynchronous. Never replace a document opened or edited in the meantime.
    if (!pristine()) return;
    if (folder) useAppStore.setState({ currentProject: folder.project, projectPlans: folder.plans, projectComparisons: folder.comparisons });
    if (plan) {
      useAppStore.getState().setProject(plan);
      useAppStore.getState().setCurrentPage(plan.pages[bookmark.page] ? bookmark.page : 1);
    } else if (comparison) {
      useCompareStore.getState().setComparison({ ...comparison, activeRevisionId: revisionId! });
      useCompareStore.getState().setCurrentPageKey(comparison.pages[bookmark.page] ? bookmark.page : 1);
      useCompareStore.getState().setViewMode(bookmark.viewMode ?? 'overlay');
    }
  };
  return {
    start() {
      if (boot) return boot;
      unsubscribe = [useAppStore.subscribe(record), useCompareStore.subscribe(record)];
      boot = restore().catch(() => { /* Missing/unavailable IndexedDB falls back home. */ }).finally(() => {
        ready = true;
        record();
      });
      return boot;
    },
    stop() { unsubscribe.forEach(fn => fn()); unsubscribe = []; ready = false; },
  };
}

let session: ReturnType<typeof createWorkspaceSession> | undefined;
export function startWorkspaceSession(): Promise<void> {
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* Storage may be blocked. */ }
  session ??= createWorkspaceSession(storage);
  return session.start();
}
