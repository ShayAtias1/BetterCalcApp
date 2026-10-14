import { create } from 'zustand';
import type { WallRegionRef } from './wallRegionMerge';
import { useCompareStore } from '../../store/compareStore';
import { useAppStore } from '../../store/appStore';
import { confirmAiDialog, confirmDialog, notify } from '../appDialogs';
import { t } from '../../i18n';
import { loadPlan } from '../../db/database';
import type { RevisionAiRun, RevisionChange, RevisionEditType } from '../../types/revisionAnalysis';
import { IDENTITY_TRANSFORM } from '../../types/compare';
import { detectRevisionPage, drawingsInSourceSpace, prepareRevisionPage } from './detect';
import { buildAiChanges, parseRevisionPageResult, prepareRevisionPageRequest, REVISION_PAGE_TASK, type RevisionPageSubmission } from './aiPageAnalysis';
import {
  aiCandidates,
  checkRevisionAiService,
  findRevisionAiJob,
  mergeRevisionLabels,
  parseRevisionLabels,
  prepareRevisionAiRequest,
  previewRevisionAi,
  submitRevisionAi,
} from './aiClassify';
import { commitApplication, editedSince, prepareApplication, revertApplication, type ApplicationPreview } from './apply';

/**
 * Session UI state and actions of AI Revision Compare. The results themselves live in the
 * comparison document (compareStore) and the linked plan (IndexedDB) — nothing here is persisted.
 */
export type ChangeFilter = 'high' | 'meaningful' | 'all';

interface RevisionUiState {
  detecting: boolean;
  progress: number;
  step: 'loading' | 'aligning' | 'comparing' | 'classifying' | 'rendering' | 'sending' | null;
  aiBusy: boolean;
  applying: boolean;
  selectedChangeId: string | null;
  selectedWallRegions: WallRegionRef[];
  selectWallRegion: (changeId: string, index: number, additive?: boolean) => void;
  filter: ChangeFilter;
  /** One-shot viewport request for the compare canvas. */
  focus: { pageKey: number; bbox: RevisionChange['bbox']; nonce: number } | null;
  /** Bumped after an application or revert so views re-read the linked plan. */
  planTick: number;
  /** Whether detected changes are drawn on the plan. View-only: the review list and results are untouched. */
  markersVisible: boolean;
  /** Change whose geometry is being corrected on the plan. */
  editingChangeId: string | null;
  /** Which geometry the plan handles show while editing: both, the original's (removed) or the revision's (added). */
  editSide: 'both' | 'removed' | 'added';
  /** Active manual drawing classification; wall footprints remain drafts until completed. */
  placingType: RevisionEditType | null;
  placingWall: { changeId: string; side: 'removed' | 'added' } | null;
  openingDrawingMode: 'rectangle' | 'polygon';
  /** Canvas draft controls exposed to the existing sidebar; never persisted. */
  openingDrawing: {
    side: 'removed' | 'added';
    sides: ('removed' | 'added')[];
    pointCount: number;
    error: boolean;
    finish: () => void;
    back: () => void;
    selectSide: (side: 'removed' | 'added') => void;
  } | null;
  /** Short "what changed" notes with a leader arrow next to each change on the plan. View-only. */
  labelsVisible: boolean;
  /** An approved change whose card is opened in full; other approved cards show a one-line summary. */
  expandedChangeId: string | null;
  setFilter: (f: ChangeFilter) => void;
  toggleMarkersVisible: () => void;
  selectChange: (id: string | null) => void;
}

export const useRevisionUi = create<RevisionUiState>((set, get) => ({
  detecting: false,
  progress: 0,
  step: null,
  aiBusy: false,
  applying: false,
  selectedChangeId: null,
  selectedWallRegions: [],
  selectWallRegion: (changeId, index, additive = false) => {
    const store = useCompareStore.getState();
    const change = store.comparison?.revisions.find(r => r.id === store.comparison?.activeRevisionId)
      ?.analysis?.pages[store.currentPageKey]?.changes.find(c => c.id === changeId);
    if (!change?.walls[index]) return;
    if (change.status === 'applied') { if (!additive) get().selectChange(changeId); return; }
    store.setToolMode('select');
    store.setSelectedMarkupId(null);
    store.setSelectedMeasurementId(null);
    const previous = additive ? get().selectedWallRegions : [];
    const selected = previous.some(ref => ref.changeId === changeId && ref.index === index);
    set({ selectedWallRegions: selected ? previous.filter(ref => ref.changeId !== changeId || ref.index !== index) : [...previous, { changeId, index }],
      selectedChangeId: changeId, editingChangeId: changeId, editSide: 'both', placingType: null, placingWall: null, markersVisible: true });
  },
  filter: 'high',
  focus: null,
  planTick: 0,
  markersVisible: true,
  editingChangeId: null,
  editSide: 'both',
  placingType: null,
  placingWall: null,
  openingDrawingMode: 'rectangle',
  openingDrawing: null,
  labelsVisible: true,
  expandedChangeId: null,
  setFilter: (filter) => set({ filter }),
  toggleMarkersVisible: () => set((s) => ({ markersVisible: !s.markersVisible })),
  selectChange: (selectedChangeId) => {
    const store = useCompareStore.getState();
    if (selectedChangeId) {
      store.setToolMode('select');
      store.setSelectedMarkupId(null);
      store.setSelectedMeasurementId(null);
    }
    set({ selectedChangeId, selectedWallRegions: [], editingChangeId: selectedChangeId, editSide: 'both', placingType: null, placingWall: null, ...(selectedChangeId ? { markersVisible: true } : {}) });
  },
}));

export function startManualChangeDrawing(type: RevisionEditType, wall: RevisionUiState['placingWall'] = null): void {
  const store = useCompareStore.getState();
  store.setToolMode('select');
  store.setSelectedMarkupId(null);
  store.setSelectedMeasurementId(null);
  useRevisionUi.setState({ placingType: type, placingWall: wall, editingChangeId: null, selectedChangeId: null, selectedWallRegions: [], markersVisible: true });
}

/** Which proposals a filter shows. Approved/applied ones always stay visible; rejected ones only under "all". */
export function visibleChanges(changes: RevisionChange[], filter: ChangeFilter): RevisionChange[] {
  return changes.filter((c) => {
    if (c.status === 'approved' || c.status === 'applied') return true;
    if (filter === 'all') return true;
    if (c.status === 'rejected') return false;
    return filter === 'high' ? c.significance === 'high' : c.significance !== 'low';
  });
}

/** Selects a proposal, switching to its page, and asks the canvas to bring it into view. */
export function focusChange(change: RevisionChange): void {
  const store = useCompareStore.getState();
  if (store.currentPageKey !== change.pageNumber) store.setCurrentPageKey(change.pageNumber);
  useRevisionUi.getState().selectChange(change.id);
  useRevisionUi.setState({ focus: { pageKey: change.pageNumber, bbox: change.bbox, nonce: Date.now() } });
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runChangeDetection(): Promise<void> {
  const ui = useRevisionUi.getState();
  if (ui.detecting) return;
  const { comparison, currentPageKey } = useCompareStore.getState();
  if (!comparison?.activeRevisionId) {
    notify(t('revisionAi.detect.noRevision'));
    return;
  }
  const revisionId = comparison.activeRevisionId;
  useRevisionUi.setState({ detecting: true, progress: 0, step: 'loading', selectedChangeId: null });
  try {
    const outcome = await detectRevisionPage(comparison, revisionId, currentPageKey, (progress, step) => useRevisionUi.setState({ progress, step }));
    const latest = useCompareStore.getState().comparison;
    // The user may have switched comparison or revision while this ran: never write a stale result elsewhere.
    if (latest?.id !== comparison.id || !latest.revisions.some((r) => r.id === revisionId)) return;
    useCompareStore.getState().saveRevisionAnalysis(revisionId, outcome.analysis, outcome.refinedAlignment);
    if (outcome.analysis.alignment.status !== 'poor' && outcome.analysis.changes.every((c) => c.significance !== 'high')) {
      notify(t('revisionAi.detect.nothingFound'));
    }
  } catch (e) {
    notify(message(e) === 'page-missing' ? t('revisionAi.detect.pageMissing') : t('revisionAi.detect.failed'));
    console.error('revision_detect', e);
  } finally {
    useRevisionUi.setState({ detecting: false, step: null, progress: 0 });
  }
}

function aiErrorText(e: unknown): string {
  const m = message(e);
  if (m === 'ai-unreachable' || m === 'ai-invalid-response') return t('revisionAi.ai.unreachable');
  if (m === 'ai-outdated') return t('revisionAi.ai.outdated');
  if (m === 'ai-not-configured') return t('revisionAi.ai.notConfigured');
  return t('revisionAi.ai.failed', { error: m });
}

const polling = new Set<string>();
const delay = () => new Promise((resolve) => setTimeout(resolve, 2500));

function setRun(comparisonId: string, revisionId: string, pageKey: number, patch: Partial<RevisionAiRun>) {
  const store = useCompareStore.getState();
  if (store.comparison?.id !== comparisonId) return false;
  store.updateRevisionAnalysis(revisionId, pageKey, (a) => (a.ai ? { ...a, ai: { ...a.ai, ...patch, updatedAt: Date.now() } } : a));
  return true;
}

/** Polls a submitted classification with free status reads until it finishes. Never resubmits. */
async function track(comparisonId: string, revisionId: string, pageKey: number, run: RevisionAiRun): Promise<void> {
  if (polling.has(run.requestId)) return;
  polling.add(run.requestId);
  try {
    for (;;) {
      await delay();
      if (useCompareStore.getState().comparison?.id !== comparisonId) return; // resumed when reopened
      try {
        const job = await findRevisionAiJob(run.requestId);
        const expectedTask = run.task === 'page' ? REVISION_PAGE_TASK : 'revision-v1';
        if (job.task !== expectedTask || job.requestId !== run.requestId || (run.requestDigest && job.requestDigest !== run.requestDigest)) {
          throw Object.assign(new Error('identity mismatch'), { terminal: true });
        }
        if (job.status === 'PROCESSING') continue;
        if (job.status === 'FAILED') {
          setRun(comparisonId, revisionId, pageKey, { status: 'FAILED', error: job.error ?? 'failed' });
          notify(t('revisionAi.ai.failed', { error: job.error ?? '' }));
          return;
        }
        if (run.task === 'page') {
          await completePageAnalysis(comparisonId, revisionId, pageKey, run, job.result);
          return;
        }
        const labels = parseRevisionLabels(job.result, run.changeIds);
        const store = useCompareStore.getState();
        if (store.comparison?.id !== comparisonId) return;
        store.updateRevisionAnalysis(revisionId, pageKey, (a) => {
          if (a.ai?.requestId !== run.requestId) return a;
          return { ...mergeRevisionLabels(a, labels), ai: { ...a.ai, status: 'COMPLETED', updatedAt: Date.now() } };
        });
        await store.persist();
        notify(t('revisionAi.ai.done'));
        return;
      } catch (e) {
        const status = (e as { status?: number }).status;
        const inTransit = status === 404 && Date.now() - run.submittedAt < 90_000;
        if (inTransit) continue;
        if ((e as { terminal?: boolean }).terminal || status === 404 || status === 410 || Date.now() - run.submittedAt > 3600_000) {
          setRun(comparisonId, revisionId, pageKey, { status: 'FAILED', error: t('revisionAi.ai.notResubmitted') });
          return;
        }
        // Transient network/service errors: keep polling with free GETs.
      }
    }
  } finally {
    polling.delete(run.requestId);
  }
}

/** Resumes polling for classifications that were in flight when the comparison was last open. */
export function resumeRevisionAi(): void {
  const comparison = useCompareStore.getState().comparison;
  if (!comparison) return;
  for (const revision of comparison.revisions) {
    for (const analysis of Object.values(revision.analysis?.pages ?? {})) {
      if (analysis.ai?.status === 'PROCESSING') void track(comparison.id, revision.id, analysis.pageNumber, analysis.ai);
    }
  }
}

export async function runAiClassification(): Promise<void> {
  if (useRevisionUi.getState().aiBusy) return;
  const store = useCompareStore.getState();
  const { comparison, currentPageKey } = store;
  const revision = comparison?.revisions.find((r) => r.id === comparison.activeRevisionId);
  const analysis = revision?.analysis?.pages[currentPageKey];
  if (!comparison || !revision || !analysis) return;
  if (comparison.revisions.some((r) => Object.values(r.analysis?.pages ?? {}).some((p) => p.ai?.status === 'PROCESSING'))) return;
  const candidates = aiCandidates(analysis);
  if (!candidates.length) {
    notify(t('revisionAi.ai.none'));
    return;
  }
  useRevisionUi.setState({ aiBusy: true });
  try {
    await checkRevisionAiService();
    const body = await prepareRevisionAiRequest(comparison, revision.id, currentPageKey, candidates);
    const preview = await previewRevisionAi(body);
    const accepted = await confirmAiDialog(
      t('revisionAi.ai.disclosure', { count: body.images.length, cost: preview.estimatedCostUsd.toFixed(3), reservation: preview.reservationUsd.toFixed(2) }),
      t('revisionAi.ai.notice'),
    );
    const latest = useCompareStore.getState();
    if (!accepted || latest.comparison?.id !== comparison.id || latest.currentPageKey !== currentPageKey) return;
    const run: RevisionAiRun = {
      requestId: body.requestId,
      status: 'PROCESSING',
      requestDigest: preview.requestDigest,
      changeIds: candidates.map((c) => c.id),
      estimatedCostUsd: preview.estimatedCostUsd,
      submittedAt: Date.now(),
      updatedAt: Date.now(),
    };
    // Durable request identity before paid admission, so a lost response is recovered, never resent.
    latest.updateRevisionAnalysis(revision.id, currentPageKey, (a) => ({ ...a, ai: run }));
    await useCompareStore.getState().persist();
    if (useCompareStore.getState().saveError) throw new Error(useCompareStore.getState().saveError ?? 'save failed');
    try {
      await submitRevisionAi(body, preview);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status && [400, 403, 409, 413, 415, 429, 503].includes(status)) {
        setRun(comparison.id, revision.id, currentPageKey, { status: 'FAILED', error: message(e) });
        throw e;
      }
      // Ambiguous: recovery by status only.
    }
    void track(comparison.id, revision.id, currentPageKey, run);
  } catch (e) {
    notify(aiErrorText(e));
  } finally {
    useRevisionUi.setState({ aiBusy: false });
  }
}

/** Full-plan AI answer → locally verified proposals on the page. */
async function completePageAnalysis(comparisonId: string, revisionId: string, pageKey: number, run: RevisionAiRun, result: unknown): Promise<void> {
  const comparison = useCompareStore.getState().comparison;
  if (comparison?.id !== comparisonId || !run.manifest) return;
  try {
    const parsed = parseRevisionPageResult(result);
    const drawings = await drawingsInSourceSpace(comparison, revisionId, pageKey, run.alignment ?? IDENTITY_TRANSFORM);
    const changes = buildAiChanges(parsed.changes, run.manifest, drawings);
    const store = useCompareStore.getState();
    if (store.comparison?.id !== comparisonId) return;
    store.mergeRevisionAiChanges(revisionId, pageKey, run.requestId, changes);
    await store.persist();
    notify(t('revisionAi.page.done', { count: changes.length }));
  } catch (e) {
    setRun(comparisonId, revisionId, pageKey, { status: 'FAILED', error: message(e) });
    notify(t('revisionAi.ai.failed', { error: message(e) }));
  }
}

async function requestPage<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'X-BetterCalc-AI': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new Error('ai-unreachable');
  }
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(await response.text());
  } catch {
    throw new Error('ai-invalid-response');
  }
  if (!response.ok) throw Object.assign(new Error(typeof value?.error === 'string' ? value.error : 'ai-failed'), { status: response.status });
  return value as T;
}

/**
 * The primary automatic detection: a paid, full-plan AI analysis of both revisions of the page on
 * screen. Free local steps run first (alignment refinement and quality gate), so a misaligned pair
 * never costs anything; the request is priced and needs explicit consent; its identity is saved
 * before admission and recovered by status reads only.
 */
export async function runAiPageAnalysis(): Promise<void> {
  if (useRevisionUi.getState().aiBusy) return;
  const store = useCompareStore.getState();
  const { comparison, currentPageKey } = store;
  const revision = comparison?.revisions.find((r) => r.id === comparison.activeRevisionId);
  if (!comparison || !revision) {
    notify(t('revisionAi.detect.noRevision'));
    return;
  }
  if (comparison.revisions.some((r) => Object.values(r.analysis?.pages ?? {}).some((p) => p.ai?.status === 'PROCESSING'))) {
    notify(t('revisionAi.page.inProgress'));
    return;
  }
  useRevisionUi.setState({ aiBusy: true, detecting: true, progress: 0.02, step: 'loading' });
  try {
    const health = await requestPage<{ supportedTasks?: string[]; configured?: boolean }>('/ai/health');
    if (!health.supportedTasks?.includes(REVISION_PAGE_TASK)) throw new Error('ai-outdated');
    if (!health.configured) throw new Error('ai-not-configured');
    const prep = await prepareRevisionPage(comparison, revision.id, currentPageKey, (progress, step) => useRevisionUi.setState({ progress: progress * 0.5, step }));
    if (prep.quality.status === 'poor') {
      // Store the failed check so the panel shows why; nothing was sent.
      store.beginRevisionAiAnalysis(revision.id, prep.analysisBase, null, { task: 'page', requestId: '', status: 'FAILED', changeIds: [], submittedAt: Date.now(), updatedAt: Date.now(), error: t('revisionAi.alignment.poorHint') });
      notify(t('revisionAi.alignment.poorHint'));
      return;
    }
    useRevisionUi.setState({ progress: 0.6, step: 'rendering' });
    const body: RevisionPageSubmission = await prepareRevisionPageRequest(comparison, revision.id, currentPageKey, prep.finalAlignment);
    const bytes = body.images.reduce((sum, i) => sum + i.base64.length * 0.75, 0);
    if (bytes > 40_000_000) throw new Error('ai-payload-too-large');
    useRevisionUi.setState({ progress: 0.85, step: 'sending' });
    const preview = await requestPage<{ task: string; previewId: string; requestId: string; requestDigest: string; expiresAt: number; estimatedCostUsd: number; reservationUsd: number }>('/ai/revision-previews', body);
    if (preview.task !== REVISION_PAGE_TASK || preview.requestId !== body.requestId || !/^[a-f0-9]{64}$/.test(preview.requestDigest ?? '') || !Number.isFinite(preview.estimatedCostUsd)) throw new Error('ai-invalid-preview');
    useRevisionUi.setState({ detecting: false, step: null });
    const accepted = await confirmAiDialog(
      t('revisionAi.page.disclosure', { cost: preview.estimatedCostUsd.toFixed(2), reservation: preview.reservationUsd.toFixed(2) }),
      t('revisionAi.page.notice'),
    );
    const latest = useCompareStore.getState();
    if (!accepted || latest.comparison?.id !== comparison.id || latest.currentPageKey !== currentPageKey) return;
    const run: RevisionAiRun = {
      task: 'page',
      requestId: body.requestId,
      status: 'PROCESSING',
      requestDigest: preview.requestDigest,
      changeIds: [],
      estimatedCostUsd: preview.estimatedCostUsd,
      submittedAt: Date.now(),
      updatedAt: Date.now(),
      manifest: body.manifest,
      alignment: prep.finalAlignment,
    };
    // Durable identity (and the refined alignment the images used) before paid admission.
    latest.beginRevisionAiAnalysis(revision.id, prep.analysisBase, prep.finalAlignment === prep.userAlignment ? null : prep.finalAlignment, run);
    await useCompareStore.getState().persist();
    if (useCompareStore.getState().saveError) throw new Error(useCompareStore.getState().saveError ?? 'save failed');
    try {
      await requestPage('/ai/revision-jobs', { ...body, consent: { approved: true, approvedAt: Date.now(), previewId: preview.previewId, requestDigest: preview.requestDigest } });
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status && [400, 403, 409, 413, 415, 429, 503].includes(status)) {
        setRun(comparison.id, revision.id, currentPageKey, { status: 'FAILED', error: message(e) });
        throw e;
      }
      // Ambiguous: recovered by status reads only.
    }
    void track(comparison.id, revision.id, currentPageKey, run);
  } catch (e) {
    const m = message(e);
    notify(m === 'ai-payload-too-large' ? t('revisionAi.page.tooLarge') : m === 'page-missing' ? t('revisionAi.detect.pageMissing') : aiErrorText(e));
  } finally {
    useRevisionUi.setState({ aiBusy: false, detecting: false, step: null, progress: 0 });
  }
}

function applyErrorText(e: unknown): string {
  switch (message(e)) {
    case 'chain-base-not-applied': return t('revisionAi.apply.chainBaseNotApplied');
    case 'chain-superseded': return t('revisionAi.apply.chainSuperseded');
    case 'plan-changed': return t('revisionAi.apply.planChanged');
    case 'plan-different-file': return t('revisionAi.apply.differentFile');
    case 'revert-not-latest': return t('revisionAi.apply.revertNotLatest');
    default: return t('revisionAi.apply.failed');
  }
}

function summaryText(p: ApplicationPreview): string {
  const lines = [t('revisionAi.apply.summaryChanges', { count: p.changes.length })];
  if (p.duplicates.length) lines.push(t('revisionAi.apply.summaryDuplicates', { count: p.duplicates.length }));
  if (p.addedItems.length) {
    const area = p.addedItems.reduce((s, m) => s + (m.areaM2 ?? 0), 0);
    lines.push(t('revisionAi.apply.summaryItems', { count: p.addedItems.length, area: area.toFixed(2) }));
  }
  if (p.removedItems.length) lines.push(t('revisionAi.apply.summaryRemoved', { count: p.removedItems.length }));
  if (p.roomUpdates.length) {
    const list = p.roomUpdates.map((r) => `${r.name}${r.beforeAreaM2 != null && r.afterAreaM2 != null ? ` (${r.beforeAreaM2} → ${r.afterAreaM2})` : ''}`).join(', ');
    lines.push(t('revisionAi.apply.summaryRooms', { count: p.roomUpdates.length, list }));
  }
  if (p.openingsAdded) lines.push(t('revisionAi.apply.summaryOpeningsAdded', { count: p.openingsAdded }));
  if (p.openingsRemoved) lines.push(t('revisionAi.apply.summaryOpeningsRemoved', { count: p.openingsRemoved }));
  for (const d of p.deltas) lines.push(t('revisionAi.apply.summaryDelta', { label: d.label, before: d.before, after: d.after, unit: d.unitLabel }));
  if (p.unapplied.length) lines.push(t('revisionAi.apply.summaryUnapplied', { count: p.unapplied.length }));
  if (p.reviews.length) {
    lines.push(t('revisionAi.apply.summaryReviews', { count: p.reviews.length }));
    lines.push(reviewLines(p));
  }
  lines.push(t('revisionAi.apply.versionNote'));
  return lines.join('\n');
}

/** The review reasons themselves, not only their count — the user has to act on them. */
function reviewLines(p: ApplicationPreview, max = 5): string {
  const reasons = [...new Set(p.reviews.map((r) => r.reason))];
  const shown = reasons.slice(0, max).map((r) => `• ${r}`);
  if (reasons.length > max) shown.push(t('revisionAi.apply.summaryMore', { count: reasons.length - max }));
  return shown.join('\n');
}

export async function applyApprovedChanges(): Promise<void> {
  if (useRevisionUi.getState().applying) return;
  const store = useCompareStore.getState();
  const comparison = store.comparison;
  const revision = comparison?.revisions.find((r) => r.id === comparison.activeRevisionId);
  if (!comparison?.linkedPlanId || !revision) return;
  useRevisionUi.setState({ applying: true });
  try {
    await store.persist();
    const preview = await prepareApplication(comparison, revision.id, comparison.linkedPlanId);
    // Changes the plan's ledger already holds (by id) only get their status back.
    const duplicateIds = preview.duplicates.map((c) => c.id);
    if (!preview.changes.length) {
      if (duplicateIds.length) {
        useCompareStore.getState().setRevisionChangesStatus(revision.id, duplicateIds, 'applied');
        await useCompareStore.getState().persist();
      }
      // Nothing would be written: never commit an empty application or mark anything applied.
      notify(preview.unapplied.length ? t('revisionAi.apply.nothingWritten', { reasons: reviewLines(preview) }) : t('revisionAi.apply.nothing'));
      return;
    }
    const ok = await confirmDialog(summaryText(preview), { title: t('revisionAi.apply.confirmTitle', { revision: revision.label }), confirmLabel: t('revisionAi.apply.confirm') });
    if (!ok) return;
    await commitApplication(preview, revision.label);
    useCompareStore.getState().setRevisionChangesStatus(revision.id, [...preview.changes.map((c) => c.id), ...duplicateIds], 'applied');
    await useCompareStore.getState().persist();
    void useAppStore.getState().refreshProjectPlans();
    useRevisionUi.setState((st) => ({ planTick: st.planTick + 1 }));
    notify(preview.reviews.length
      ? t('revisionAi.apply.doneWithReviews', { count: preview.changes.length, reviews: preview.reviews.length })
      : t('revisionAi.apply.done'));
  } catch (e) {
    notify(applyErrorText(e));
    console.error('revision_apply', e);
  } finally {
    useRevisionUi.setState({ applying: false });
  }
}

export async function revertRevisionApplication(applicationId: string): Promise<void> {
  const comparison = useCompareStore.getState().comparison;
  if (!comparison?.linkedPlanId) return;
  try {
    const plan = await loadPlan(comparison.linkedPlanId);
    const app = plan?.revisionApplications?.find((a) => a.id === applicationId);
    if (!plan || !app) return;
    const ok = await confirmDialog(editedSince(plan, app) ? t('revisionAi.apply.revertEdited') : t('revisionAi.apply.revertConfirm'), { destructive: true, confirmLabel: t('revisionAi.apply.revert') });
    if (!ok) return;
    const reverted = await revertApplication(plan.id, applicationId);
    useCompareStore.getState().setRevisionChangesStatus(reverted.revisionId, reverted.changes.map((c) => c.changeId), 'approved');
    await useCompareStore.getState().persist();
    void useAppStore.getState().refreshProjectPlans();
    useRevisionUi.setState((st) => ({ planTick: st.planTick + 1 }));
    notify(t('revisionAi.apply.revertDone'));
  } catch (e) {
    notify(applyErrorText(e));
    console.error('revision_revert', e);
  }
}
