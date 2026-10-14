import { create } from 'zustand';
import { prepareWallRegionMerge, type WallRegionRef, type WallMergeError, type WallGapPreview } from '../lib/revision/wallRegionMerge';
import { v4 as uuid } from 'uuid';
import type {
  AlignmentPointPair,
  AreaCalcMode,
  AreaKind,
  AreaShape,
  CompareCalibration,
  Comparison,
  CompareToolMode,
  CompareViewMode,
  ComparisonPage,
  ExportRegion,
  LayerTransform,
  Markup,
  MarkupTool,
  Measurement,
  MeasureTool,
  RevisionLayer,
  RevisionPageData,
} from '../types/compare';
import { DEFAULT_AREA_KIND_COLORS, IDENTITY_TRANSFORM } from '../types/compare';
import type { Point } from '../types';
import { saveComparison as dbSaveComparison } from '../db/database';
import { createHistoryTracker } from '../lib/undoHistory';
import { t } from '../i18n';
import { noteAlignment, trackChangeMarked, trackError } from '../lib/analytics';
import { resolveAlignmentStatus, resolveCompareScale, type AlignmentStatus, type ResolvedScale } from '../lib/compareScale';
import type { ComparisonContext, RevisionAiRun, RevisionChange, RevisionEditType, RevisionPageAnalysis } from '../types/revisionAnalysis';
import { sameChange } from '../lib/revision/changeMatch';
import { changeItems, recomputeMeasurement } from '../lib/revision/changeItems';
import { isOpeningDifference, openingImpactReady } from '../lib/revision/openingImpact';
import { openingGeometryNeedsVerification } from '../lib/revision/changeEdit';
import { familyOf, openingFromFootprint } from '../lib/revision/changeEdit';
import { detectionThresholds, matchRelocation } from '../lib/revision/vectorDiff';
import { elementOfItem, finalizeEditedChange, hasUnplacedLines, retypeChange, setElementLine, setOpeningHeight, setWallFootprint, setWallHeight, sidesOf, wallFromFootprint } from '../lib/revision/changeEdit';
import { analysisInputKey, baseRevisionOf } from '../lib/revision/detect';
import type { RevisionWall } from '../types/revisionAnalysis';

const historyTracker = createHistoryTracker<Comparison>();
/**
 * Bumped at every commit point — an application to (or revert of) the linked plan, and the start
 * and arrival of a paid AI analysis. Undo history never reaches back across one: those states live
 * outside this document (the plan's ledger, the AI service), so restoring an older snapshot would
 * contradict them or discard a paid result.
 */
let commitEpoch = 0;

const REVISION_COLOR_PALETTE = ['#ef4444', '#2563eb', '#9333ea', '#f59e0b', '#16a34a', '#0891b2'];

export function createEmptyComparison(
  name: string,
  apartmentNumber: string,
  originalFileName: string,
  revisedFileNames: string[]
): Comparison {
  const now = Date.now();
  const revisions: RevisionLayer[] = revisedFileNames.map((fileName, i) => ({
    id: uuid(),
    label: revisedFileNames.length > 1 ? t('defaultNames.revisionNumbered', { number: i + 1 }) : t('defaultNames.revision'),
    fileName,
    opacity: 0.75,
    visible: true,
    colorTint: REVISION_COLOR_PALETTE[i % REVISION_COLOR_PALETTE.length],
    useSourceColors: false,
    markups: [],
    measurements: [],
  }));
  return {
    id: uuid(),
    name,
    apartmentNumber,
    notes: '',
    createdAt: now,
    updatedAt: now,
    originalFileName,
    originalOpacity: 1,
    originalVisible: true,
    originalColorTint: '#9ca3af',
    originalUseSourceColors: false,
    pages: {},
    revisions,
    activeRevisionId: revisions[0]?.id ?? '',
    areaKindColors: { ...DEFAULT_AREA_KIND_COLORS },
    wallHeightDefaultM: 2.5,
  };
}

/** Applies `updater` to the comparison's currently active revision, leaving the others untouched. */
function updateActiveRevision(comparison: Comparison, updater: (r: RevisionLayer) => RevisionLayer): RevisionLayer[] {
  return comparison.revisions.map((r) => (r.id === comparison.activeRevisionId ? updater(r) : r));
}

function emptyPage(originalPageNumber: number): ComparisonPage {
  return {
    originalPageNumber,
    originalCalibration: null,
    revisions: {},
  };
}

function emptyRevisionPageData(revisedPageNumber: number): RevisionPageData {
  return {
    revisedPageNumber,
    revisedCalibration: null,
    alignment: IDENTITY_TRANSFORM,
    alignmentPoints: [],
  };
}

export interface CompareEditSnapshot {
  comparison: Comparison | null;
  history: Comparison[];
  future: Comparison[];
  dirty: boolean;
  /** Commit point the snapshot was taken in; a snapshot from before a later commit is never restored. */
  epoch?: number;
}

interface CompareState {
  comparison: Comparison | null;
  currentPageKey: number;
  originalNumPages: number;
  revisedNumPages: number;
  toolMode: CompareToolMode;
  viewMode: CompareViewMode;
  swipePosition: number; // 0-1, fraction of viewport width
  blinkShowingRevised: boolean;

  calibrationLayer: 'original' | 'revised' | null;
  calibrationPoints: Point[];

  alignmentPairs: AlignmentPointPair[];
  alignmentPendingOriginal: Point | null;
  pickingAlignmentPoints: boolean;

  measureTool: MeasureTool | null;
  measurePoints: Point[];
  pendingAreaKind: AreaKind | null;
  areaShape: AreaShape;
  areaCalcMode: AreaCalcMode;
  /** When on, each new polygon vertex snaps to a horizontal/vertical line from the previous one. */
  orthoSnap: boolean;

  markupTool: MarkupTool | null;
  markupPoints: Point[];
  markupColor: string;
  /** When on, markup lines (dimension/arrow/cloud) snap to horizontal/vertical from the previous point. */
  markupOrtho: boolean;

  selectedMarkupId: string | null;
  selectedMeasurementId: string | null;

  /** Chosen PDF-export crop per page key (original layer's native px). Session state, like the takeoff side. */
  exportRegions: Record<number, ExportRegion>;

  /** Bottom "שינויים" panel: session UI state only, never persisted with the comparison. */
  changesOpen: boolean;
  changesHeight: number;
  changesMaximized: boolean;
  /** Whether the changes table lists the whole revision or only the source page on screen. */
  changesScope: 'all' | 'page';
  setChangesOpen: (open: boolean) => void;
  setChangesHeight: (px: number) => void;
  toggleChangesMaximized: () => void;
  setChangesScope: (scope: 'all' | 'page') => void;

  /** Manual show/hide toggle for finished markups — independent of which revision is active. */
  annotationsVisible: boolean;
  /** Manual show/hide toggle for finished measurements — independent of the markups toggle. */
  measurementsVisible: boolean;

  /** True from the moment a mutation happens until the next successful persist. */
  dirty: boolean;
  /** True while a persist is in flight. */
  saving: boolean;
  /** Message of the last failed persist, cleared on the next successful one. */
  saveError: string | null;

  /** Undo/redo stacks of past/future comparison snapshots. Not persisted — reset whenever the comparison changes. */
  history: Comparison[];
  future: Comparison[];
  captureEditSnapshot: () => CompareEditSnapshot;
  cancelEditSnapshot: (before: CompareEditSnapshot) => void;
  undo: () => void;
  redo: () => void;

  setComparison: (c: Comparison | null) => void;
  setCurrentPageKey: (n: number) => void;
  setOriginalNumPages: (n: number) => void;
  setRevisedNumPages: (n: number) => void;
  setToolMode: (m: CompareToolMode) => void;
  setViewMode: (m: CompareViewMode) => void;
  setSwipePosition: (v: number) => void;
  toggleAnnotationsVisible: () => void;
  toggleMeasurementsVisible: () => void;
  toggleBlink: () => void;
  setExportRegion: (pageKey: number, r: ExportRegion | null) => void;

  ensurePage: (pageKey: number) => ComparisonPage;
  updatePage: (pageKey: number, patch: Partial<ComparisonPage>) => void;
  updatePageQuiet: (pageKey: number, patch: Partial<ComparisonPage>) => void;
  updateActiveRevisionPage: (pageKey: number, patch: Partial<RevisionPageData>) => void;
  updateActiveRevisionPageQuiet: (pageKey: number, patch: Partial<RevisionPageData>) => void;

  setLayerOpacity: (layer: string, opacity: number) => void;
  setLayerVisible: (layer: string, visible: boolean) => void;
  setLayerTint: (layer: string, color: string) => void;
  setLayerSourceColors: (layer: string, useSource: boolean) => void;

  addRevision: (fileName: string) => string | null;
  removeRevision: (id: string) => void;
  renameRevision: (id: string, label: string) => void;
  setActiveRevisionId: (id: string) => void;
  /**
   * Moves a revision one slot up/down in `comparison.revisions`. That array's order is the display
   * order (layer panel, revision tabs) and the order the all-revisions export walks, and it is part
   * of the comparison, so the new order is persisted like any other edit.
   */
  moveRevision: (id: string, direction: -1 | 1) => void;

  startCalibration: (layer: 'original' | 'revised') => void;
  addCalibrationPoint: (p: Point) => void;
  clearCalibration: () => void;
  applyCalibration: (realDistanceMeters: number) => void;

  /**
   * `method` records how the transform was produced; it defaults to a manual adjustment. `discrete`
   * records its own undo step at once (auto align) instead of coalescing a slider/drag burst.
   */
  setAlignmentTransform: (pageKey: number, transform: LayerTransform, method?: 'points' | 'manual', discrete?: boolean) => void;
  /** Maps the given source page to a page of the active revision's PDF. */
  setRevisedPageNumber: (pageKey: number, revisedPageNumber: number) => void;
  beginAlignmentPointPick: () => void;
  addAlignmentPoint: (p: Point, isOriginal: boolean) => void;
  clearAlignmentPicking: () => void;
  clearAlignmentPoints: (pageKey: number) => void;

  setMeasureTool: (t: MeasureTool | null) => void;
  setPendingAreaKind: (k: AreaKind | null) => void;
  /** Arms the area tool already classified as demolition / new construction. */
  startChangeMeasurement: (kind: AreaKind) => void;
  /** Reclassifies an existing change item without touching its geometry or quantities. */
  setMeasurementKind: (id: string, kind: AreaKind) => void;
  setSelectedMeasurementId: (id: string | null) => void;
  /** Selects a measurement, switching to the source page that owns it when necessary. */
  focusMeasurement: (id: string) => void;
  setAreaShape: (s: AreaShape) => void;
  setAreaCalcMode: (m: AreaCalcMode) => void;
  setOrthoSnap: (v: boolean) => void;
  addMeasurePoint: (p: Point) => void;
  clearMeasurePoints: () => void;
  /** Page ownership is assigned by the store from the page on screen, not by the caller. */
  finishMeasurement: (measurement: Omit<Measurement, 'pageNumber'>) => void;
  updateMeasurement: (id: string, patch: Partial<Measurement>, quiet?: boolean) => void;
  deleteMeasurement: (id: string) => void;

  setMarkupTool: (t: MarkupTool | null) => void;
  setMarkupColor: (c: string) => void;
  setMarkupOrtho: (v: boolean) => void;
  /** Label size multiplier applied to newly created text notes / dimension labels. */
  markupFontScale: number;
  setMarkupFontScale: (v: number) => void;
  addMarkupPoint: (p: Point) => void;
  clearMarkupPoints: () => void;
  /** Page ownership is assigned by the store from the page on screen, not by the caller. */
  finishMarkup: (markup: Omit<Markup, 'pageNumber'>) => void;
  updateMarkup: (id: string, patch: Partial<Markup>) => void;
  /** Like updateMarkup but skips the autosave schedule — for continuous drag updates. */
  updateMarkupQuiet: (id: string, patch: Partial<Markup>) => void;
  deleteMarkup: (id: string) => void;
  duplicateMarkup: (id: string) => void;
  setSelectedMarkupId: (id: string | null) => void;

  setAreaKindColor: (kind: AreaKind, color: string) => void;

  updateComparisonMeta: (patch: Partial<Pick<Comparison, 'name' | 'apartmentNumber' | 'notes' | 'wallHeightDefaultM'>>) => void;

  // ---------- AI Revision Compare ----------
  setComparisonContext: (context: ComparisonContext) => void;
  setLinkedPlanId: (planId: string | undefined) => void;
  /** What a revision is compared against: null = the original, or an earlier revision (sequential chain). */
  setRevisionBase: (revisionId: string, baseRevisionId: string | null) => void;
  /** Stores a page's detection result; a refined alignment is written to the page in the same undo step. */
  saveRevisionAnalysis: (revisionId: string, analysis: RevisionPageAnalysis, refinedAlignment: LayerTransform | null) => void;
  /** Bookkeeping updates (AI run status/labels): saved, but not an undo step. */
  updateRevisionAnalysis: (revisionId: string, pageKey: number, updater: (a: RevisionPageAnalysis) => RevisionPageAnalysis) => void;
  /** Approve / reject / reset a proposal of the active revision. Approval creates its demolition/construction items. */
  reviewRevisionChange: (pageKey: number, changeId: string, status: 'approved' | 'rejected' | 'pending') => void;
  /**
   * Manual confirmation for a change whose wall geometry could not be verified: its measured
   * unpaired face lines become wall runs (thickness unknown). Nothing is drawn or sized by guess.
   */
  confirmChangeAsWall: (pageKey: number, changeId: string) => void;
  /**
   * Starts a full-plan AI analysis on a page: records its alignment check and request, and stores a
   * refined alignment (one undo step). Approved/applied proposals are kept; open proposals from an
   * analysis of different inputs (other alignment/base/scale) are dropped as stale.
   */
  beginRevisionAiAnalysis: (revisionId: string, meta: Omit<RevisionPageAnalysis, 'changes' | 'filteredCount' | 'ai'>, refinedAlignment: LayerTransform | null, run: RevisionAiRun) => void;
  /** Adds the AI's proposals to the page, skipping ones that duplicate an existing proposal, and closes the run. */
  mergeRevisionAiChanges: (revisionId: string, pageKey: number, requestId: string, changes: RevisionChange[]) => void;
  /**
   * Manual correction of a proposal of the active revision (geometry or classification). The result
   * becomes user-authoritative; an approved change's demolition/construction items are rebuilt from
   * it. `quiet` is for every move of a drag burst (one undo step, saved by finishRevisionChangeEdit).
   */
  editRevisionChange: (pageKey: number, changeId: string, edit: (c: RevisionChange) => RevisionChange, quiet?: boolean) => void;
  /** Saves after a quiet edit burst (drag end). */
  finishRevisionChangeEdit: () => void;
  /** Adds a change the detection missed, as a pending proposal with placeholder geometry at `at`; returns its id. */
  addManualRevisionChange: (pageKey: number, type: RevisionEditType, at: Point, footprints?: Point[][], openingShapes?: ('rectangle' | 'polygon')[]) => string | null;
  /** Deletes a detected or manual change and its pending items. Applied changes must be reverted first. */
  deleteRevisionChange: (pageKey: number, changeId: string) => void;
  mergeWallRegions: (pageKey: number, selection: WallRegionRef[], confirmedPreview?: string) => { changeId: string } | { error: WallMergeError; preview?: WallGapPreview };
  /** Marks changes applied to (or, after a revert, returned from) the linked takeoff plan. */
  setRevisionChangesStatus: (revisionId: string, changeIds: string[], status: 'applied' | 'approved') => void;

  persist: () => Promise<void>;
}

/**
 * Marks the comparison as carrying unsaved work. Every mutation path goes through here: the normal
 * autosave route below, and the `*Quiet` variants that persist only when a drag ends.
 */
function markDirty(set: (patch: Partial<CompareState>) => void) {
  set({ dirty: true });
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(get: () => CompareState, set: (patch: Partial<CompareState>) => void) {
  markDirty(set);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void get().persist();
  }, 800);
}

export type CompareSaveState = 'saving' | 'saved' | 'unsaved' | 'error';

/** Save state for the UI, derived from the flags above — `useCompareStore(selectCompareSaveState)`. */
export function selectCompareSaveState(s: CompareState): CompareSaveState {
  if (!s.comparison) return 'saved';
  if (s.saving) return 'saving';
  if (s.saveError) return 'error';
  return s.dirty ? 'unsaved' : 'saved';
}

/**
 * The active revision's record for a source page, if it has one yet. Plain helpers rather than
 * zustand selectors: they build fresh objects, which a `useStore` selector must never do.
 */
export function revisionPageOf(comparison: Comparison | null, pageKey: number): RevisionPageData | undefined {
  if (!comparison) return undefined;
  return comparison.pages[pageKey]?.revisions[comparison.activeRevisionId];
}

/**
 * The real-world scale in use for measurements on a page/active-revision pair — the single source
 * of truth for both the canvas math and the UI's calibration status.
 */
export function compareScaleFor(comparison: Comparison | null, pageKey: number): ResolvedScale {
  return resolveCompareScale(comparison?.pages[pageKey], revisionPageOf(comparison, pageKey));
}

/**
 * Whether a demolition/construction item can be edited directly. Manual items always can; an item
 * created by an approved revision change can while the change is approved (its edits go to the
 * change's line) — not once applied to the plan, nor when its line cannot be identified.
 */
export function itemEditable(comparison: Comparison | null, m: Measurement): boolean {
  if (!m.revisionChangeId) return true;
  const revision = comparison?.revisions.find((r) => r.id === comparison.activeRevisionId);
  const change = revision?.analysis?.pages[m.pageNumber]?.changes.find((c) => c.id === m.revisionChangeId);
  return change?.status === 'approved' && !!elementOfItem(change, m);
}

/** Alignment state of a page/active-revision pair. */
export function alignmentStatusFor(comparison: Comparison | null, pageKey: number): AlignmentStatus {
  return resolveAlignmentStatus(revisionPageOf(comparison, pageKey));
}

function touch(comparison: Comparison): Comparison {
  return { ...comparison, updatedAt: Date.now() };
}

/** The demolition/construction items an approved change creates, in the comparison's current context and scale. */
/**
 * `previous` are the change's items being replaced: an item standing for the same line keeps its id,
 * so a selected wall stays selected (and a drag keeps its target) while its geometry is edited.
 */
function approvalItems(comparison: Comparison, change: RevisionChange, revisionId = comparison.activeRevisionId, previous: Measurement[] = []): Measurement[] {
  const page = comparison.pages[change.pageNumber];
  const scale = resolveCompareScale(page, page?.revisions[revisionId]);
  if (scale.state !== 'calibrated') return [];
  const idFor = (element: { list: 'walls' | 'doors'; index: number; part?: number }) => previous.find((m) => {
    const ref = elementOfItem(change, m);
    return ref?.list === element.list && ref.index === element.index && (ref.part ?? 0) === (element.part ?? 0);
  })?.id ?? uuid();
  return changeItems(change, comparison.context ?? 'design', scale.metersPerPixel, comparison.wallHeightDefaultM).map((item) => ({
    id: idFor(item.element),
    revisionElement: item.element,
    pageNumber: change.pageNumber,
    tool: 'area' as const,
    points: item.points,
    areaKind: item.areaKind,
    areaM2: item.areaM2,
    calcMode: 'wall' as const,
    wallLengthM: item.wallLengthM,
    wallHeightM: item.wallHeightM,
    centerline: item.centerline,
    revisionChangeId: change.id,
  }));
}

function bboxIou(a: RevisionChange['bbox'], b: RevisionChange['bbox']): number {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const union = a.width * a.height + b.width * b.height - w * h;
  return union > 0 ? (w * h) / union : 0;
}

/**
 * Recalculates every stored quantity on a source page from geometry and the scale now in force —
 * calibration and (for a revised-layer calibration) alignment changes never leave stale values.
 */
function recomputePage(comparison: Comparison, pageKey: number): Comparison {
  const page = comparison.pages[pageKey];
  let changed = false;
  const revisions = comparison.revisions.map((r) => {
    const scale = resolveCompareScale(page, page?.revisions[r.id]);
    if (scale.state !== 'calibrated') return r;
    let touched = false;
    const measurements = r.measurements.map((m) => {
      if (m.pageNumber !== pageKey) return m;
      const next = recomputeMeasurement(m, scale.metersPerPixel);
      if (next.areaM2 !== m.areaM2 || next.lengthM !== m.lengthM || next.wallLengthM !== m.wallLengthM) touched = true;
      return next;
    });
    if (!touched) return r;
    changed = true;
    return { ...r, measurements };
  });
  return changed ? { ...comparison, revisions } : comparison;
}

/** Ends undo/redo at a commit point (see commitEpoch). */
function commitPoint(set: (patch: Partial<CompareState>) => void) {
  historyTracker.discard();
  commitEpoch++;
  set({ history: [], future: [] });
}

/**
 * Keeps the AI run records of the current document when undo/redo restores a snapshot: a request
 * in flight (or its outcome) belongs to the AI service, not to the user's edit history.
 */
function withCurrentAiRuns(restored: Comparison, current: Comparison): Comparison {
  if (restored.id !== current.id) return restored;
  let changed = false;
  const revisions = restored.revisions.map((r) => {
    const live = current.revisions.find((x) => x.id === r.id)?.analysis?.pages;
    if (!live || !r.analysis) return r;
    let touched = false;
    const pages = Object.fromEntries(Object.entries(r.analysis.pages).map(([key, page]) => {
      const ai = live[Number(key)]?.ai;
      if (!ai || ai === page.ai) return [key, page];
      touched = true;
      return [key, { ...page, ai }];
    }));
    if (!touched) return r;
    changed = true;
    return { ...r, analysis: { pages } };
  });
  return changed ? { ...restored, revisions } : restored;
}

/**
 * Replaces the items of approved (not yet applied) changes with ones built from the comparison as it
 * is now — context, calibration and default wall height — so previews, the Changes table, exports
 * and a later apply all agree. A change approved before its sheet was calibrated gains its items here.
 */
function rebuildApprovedItems(comparison: Comparison, include: (c: RevisionChange) => boolean): Comparison {
  let changed = false;
  const revisions = comparison.revisions.map((r) => {
    if (!r.analysis) return r;
    let measurements = r.measurements;
    let touched = false;
    const pages = Object.fromEntries(Object.entries(r.analysis.pages).map(([key, page]) => [key, {
      ...page,
      changes: page.changes.map((c) => {
        if (c.status !== 'approved' || !include(c)) return c;
        touched = true;
        const old = new Set(c.measurementIds ?? []);
        const created = approvalItems(comparison, c, r.id, measurements.filter((m) => old.has(m.id)));
        measurements = [...measurements.filter((m) => !old.has(m.id)), ...created];
        return { ...c, measurementIds: created.map((m) => m.id) };
      }),
    }]));
    if (!touched) return r;
    changed = true;
    return { ...r, measurements, analysis: { pages } };
  });
  return changed ? { ...comparison, revisions } : comparison;
}

/**
 * A full-plan AI result locates changes in source-page px: a new calibration or a detection mask
 * does not move them. When such an edit is all that changed, the result stays current (its input
 * key follows the edit) instead of locking the paid proposals as stale.
 */
function keepAiResultsCurrent(before: Comparison, after: Comparison, pageKey: number): Comparison {
  let changed = false;
  const revisions = after.revisions.map((r) => {
    const page = r.analysis?.pages[pageKey];
    if (!page || page.manualOnly || page.ai?.task !== 'page' || page.inputKey !== analysisInputKey(before, r.id, pageKey)) return r;
    const inputKey = analysisInputKey(after, r.id, pageKey);
    if (inputKey === page.inputKey) return r;
    changed = true;
    return { ...r, analysis: { pages: { ...r.analysis!.pages, [pageKey]: { ...page, inputKey } } } };
  });
  return changed ? { ...after, revisions } : after;
}

export const useCompareStore = create<CompareState>((set, get) => ({
  comparison: null,
  currentPageKey: 1,
  originalNumPages: 1,
  revisedNumPages: 1,
  toolMode: 'select',
  viewMode: 'overlay',
  swipePosition: 0.5,
  blinkShowingRevised: true,

  calibrationLayer: null,
  calibrationPoints: [],

  alignmentPairs: [],
  alignmentPendingOriginal: null,
  pickingAlignmentPoints: false,

  measureTool: null,
  measurePoints: [],
  pendingAreaKind: null,
  areaShape: 'polygon',
  areaCalcMode: 'footprint',
  orthoSnap: false,

  markupTool: null,
  markupPoints: [],
  markupColor: '#ef4444',
  markupOrtho: false,
  markupFontScale: 1,

  selectedMarkupId: null,
  selectedMeasurementId: null,

  exportRegions: {},
  changesOpen: false,
  changesHeight: 300,
  changesMaximized: false,
  changesScope: 'all',
  annotationsVisible: true,
  measurementsVisible: true,
  dirty: false,
  saving: false,
  saveError: null,
  history: [],
  future: [],

  setComparison: (c) => {
    historyTracker.discard();
    // Lazily replace legacy full-opening items; review decisions and applied documents stay intact.
    const rebuilt = c ? rebuildApprovedItems(c, isOpeningDifference) : null;
    const loaded = c && rebuilt && JSON.stringify(c.revisions) !== JSON.stringify(rebuilt.revisions) ? rebuilt : c;
    set({
      comparison: loaded,
      currentPageKey: 1,
      exportRegions: {},
      dirty: loaded !== c,
      saveError: null,
      annotationsVisible: true,
      measurementsVisible: true,
      selectedMarkupId: null,
      selectedMeasurementId: null,
      history: [],
      future: [],
    });
    if (loaded !== c) scheduleSave(get, set);
  },
  captureEditSnapshot: () => {
    historyTracker.flush(get, set);
    const { comparison, history, future, dirty } = get();
    return { comparison, history, future, dirty, epoch: commitEpoch };
  },
  cancelEditSnapshot: (before) => {
    historyTracker.discard();
    // A commit point happened during the gesture: the snapshot predates it and must not come back.
    if (before.epoch !== undefined && before.epoch !== commitEpoch) return;
    const { epoch: _epoch, ...snapshot } = before;
    set(snapshot);
  },
  undo: () => {
    historyTracker.flush(get, set);
    const { comparison, history, future } = get();
    if (!comparison || history.length === 0) return;
    const previous = withCurrentAiRuns(history[history.length - 1], comparison);
    set({
      comparison: previous,
      history: history.slice(0, -1),
      future: [comparison, ...future],
      selectedMarkupId: null,
      selectedMeasurementId: null,
    });
    scheduleSave(get, set);
  },
  redo: () => {
    // Consistent with undo: a mutation still inside the history debounce is recorded first,
    // otherwise redo would restore a future snapshot on top of an un-snapshotted change.
    historyTracker.flush(get, set);
    const { comparison, history, future } = get();
    if (!comparison || future.length === 0) return;
    const next = withCurrentAiRuns(future[0], comparison);
    set({
      comparison: next,
      history: [...history, comparison],
      future: future.slice(1),
      selectedMarkupId: null,
      selectedMeasurementId: null,
    });
    scheduleSave(get, set);
  },
  setCurrentPageKey: (n) =>
    set({
      currentPageKey: n,
      // Same reset as switching tools/revisions: nothing half-drawn carries across pages.
      calibrationPoints: [],
      calibrationLayer: null,
      alignmentPairs: [],
      alignmentPendingOriginal: null,
      pickingAlignmentPoints: false,
      measurePoints: [],
      markupPoints: [],
      selectedMarkupId: null,
      selectedMeasurementId: null,
    }),
  setOriginalNumPages: (n) => set({ originalNumPages: n }),
  setRevisedNumPages: (n) => set({ revisedNumPages: n }),
  setToolMode: (m) =>
    set({
      toolMode: m,
      calibrationPoints: [],
      calibrationLayer: null,
      alignmentPairs: [],
      alignmentPendingOriginal: null,
      pickingAlignmentPoints: false,
      measurePoints: [],
      markupPoints: [],
      selectedMarkupId: null,
    }),
  setViewMode: (m) => set({ viewMode: m }),
  setSwipePosition: (v) => set({ swipePosition: Math.min(1, Math.max(0, v)) }),
  toggleBlink: () => set((s) => ({ blinkShowingRevised: !s.blinkShowingRevised })),
  toggleAnnotationsVisible: () => set((s) => ({ annotationsVisible: !s.annotationsVisible })),
  toggleMeasurementsVisible: () => set((s) => ({ measurementsVisible: !s.measurementsVisible })),
  setChangesOpen: (open) => set({ changesOpen: open, ...(open ? {} : { changesMaximized: false }) }),
  setChangesHeight: (px) => set({ changesHeight: px }),
  toggleChangesMaximized: () => set((s) => ({ changesMaximized: !s.changesMaximized })),
  setChangesScope: (scope) => set({ changesScope: scope }),
  setExportRegion: (pageKey, r) =>
    set((state) => {
      // Per page: a crop chosen on page 2 must not follow the user to page 5.
      const next = { ...state.exportRegions };
      if (r) next[pageKey] = r;
      else delete next[pageKey];
      return { exportRegions: next };
    }),

  ensurePage: (pageKey) => {
    const { comparison } = get();
    if (!comparison) throw new Error('No active comparison');
    const existing = comparison.pages[pageKey];
    if (existing) return existing;
    const created = emptyPage(pageKey);
    const pages = { ...comparison.pages, [pageKey]: created };
    set({ comparison: touch({ ...comparison, pages }) });
    markDirty(set);
    return created;
  },

  updatePage: (pageKey, patch) => {
    const { comparison } = get();
    if (!comparison) return;
    const current = comparison.pages[pageKey] ?? emptyPage(pageKey);
    const pages = { ...comparison.pages, [pageKey]: { ...current, ...patch } };
    set({ comparison: touch({ ...comparison, pages }) });
    scheduleSave(get, set);
  },

  /** Like updatePage but skips the autosave schedule — for continuous drag updates. Caller persists explicitly when the drag ends. */
  updatePageQuiet: (pageKey: number, patch: Partial<ComparisonPage>) => {
    const { comparison } = get();
    if (!comparison) return;
    historyTracker.pushDebounced(get, set, comparison);
    const current = comparison.pages[pageKey] ?? emptyPage(pageKey);
    const pages = { ...comparison.pages, [pageKey]: { ...current, ...patch } };
    set({ comparison: { ...comparison, pages } });
    markDirty(set);
  },

  updateActiveRevisionPage: (pageKey, patch) => {
    const { comparison } = get();
    if (!comparison) return;
    const page = get().ensurePage(pageKey);
    const revisionId = comparison.activeRevisionId;
    if (!revisionId) return;
    const rp = page.revisions[revisionId] ?? emptyRevisionPageData(pageKey);
    get().updatePage(pageKey, { revisions: { ...page.revisions, [revisionId]: { ...rp, ...patch } } });
  },

  updateActiveRevisionPageQuiet: (pageKey, patch) => {
    const { comparison } = get();
    if (!comparison) return;
    const page = get().ensurePage(pageKey);
    const revisionId = comparison.activeRevisionId;
    if (!revisionId) return;
    const rp = page.revisions[revisionId] ?? emptyRevisionPageData(pageKey);
    get().updatePageQuiet(pageKey, { revisions: { ...page.revisions, [revisionId]: { ...rp, ...patch } } });
  },

  setLayerOpacity: (layer, opacity) => {
    const { comparison } = get();
    if (!comparison) return;
    historyTracker.pushDebounced(get, set, comparison);
    if (layer === 'original') {
      set({ comparison: touch({ ...comparison, originalOpacity: opacity }) });
    } else {
      const revisions = comparison.revisions.map((r) => (r.id === layer ? { ...r, opacity } : r));
      set({ comparison: touch({ ...comparison, revisions }) });
    }
    scheduleSave(get, set);
  },
  setLayerVisible: (layer, visible) => {
    const { comparison } = get();
    if (!comparison) return;
    historyTracker.push(get, set, comparison);
    if (layer === 'original') {
      set({ comparison: touch({ ...comparison, originalVisible: visible }) });
    } else {
      const revisions = comparison.revisions.map((r) => (r.id === layer ? { ...r, visible } : r));
      set({ comparison: touch({ ...comparison, revisions }) });
    }
    scheduleSave(get, set);
  },
  setLayerTint: (layer, color) => {
    const { comparison } = get();
    if (!comparison) return;
    historyTracker.push(get, set, comparison);
    if (layer === 'original') {
      set({ comparison: touch({ ...comparison, originalColorTint: color }) });
    } else {
      const revisions = comparison.revisions.map((r) => (r.id === layer ? { ...r, colorTint: color } : r));
      set({ comparison: touch({ ...comparison, revisions }) });
    }
    scheduleSave(get, set);
  },
  setLayerSourceColors: (layer, useSource) => {
    const { comparison } = get();
    if (!comparison) return;
    historyTracker.push(get, set, comparison);
    if (layer === 'original') {
      set({ comparison: touch({ ...comparison, originalUseSourceColors: useSource }) });
    } else {
      const revisions = comparison.revisions.map((r) => (r.id === layer ? { ...r, useSourceColors: useSource } : r));
      set({ comparison: touch({ ...comparison, revisions }) });
    }
    scheduleSave(get, set);
  },

  addRevision: (fileName) => {
    const { comparison } = get();
    if (!comparison) return null;
    historyTracker.push(get, set, comparison);
    const id = uuid();
    const revision: RevisionLayer = {
      id,
      label: t('defaultNames.revisionNumbered', { number: comparison.revisions.length + 1 }),
      fileName,
      opacity: 0.75,
      visible: true,
      colorTint: REVISION_COLOR_PALETTE[comparison.revisions.length % REVISION_COLOR_PALETTE.length],
      useSourceColors: false,
      markups: [],
      measurements: [],
    };
    set({
      comparison: touch({ ...comparison, revisions: [...comparison.revisions, revision], activeRevisionId: id }),
    });
    scheduleSave(get, set);
    return id;
  },
  removeRevision: (id) => {
    const { comparison } = get();
    if (!comparison) return;
    historyTracker.push(get, set, comparison);
    const revisions = comparison.revisions.filter((r) => r.id !== id);
    const pages = Object.fromEntries(
      Object.entries(comparison.pages).map(([key, p]) => {
        if (!(id in p.revisions)) return [key, p];
        const nextRevisions = { ...p.revisions };
        delete nextRevisions[id];
        return [key, { ...p, revisions: nextRevisions }];
      })
    );
    const activeRevisionId = comparison.activeRevisionId === id ? revisions[0]?.id ?? '' : comparison.activeRevisionId;
    set({ comparison: touch({ ...comparison, revisions, pages, activeRevisionId }) });
    scheduleSave(get, set);
  },
  renameRevision: (id, label) => {
    const { comparison } = get();
    if (!comparison || !label.trim()) return;
    historyTracker.push(get, set, comparison);
    const revisions = comparison.revisions.map((r) => (r.id === id ? { ...r, label: label.trim() } : r));
    set({ comparison: touch({ ...comparison, revisions }) });
    scheduleSave(get, set);
  },
  setActiveRevisionId: (id) => {
    const { comparison } = get();
    if (!comparison) return;
    set({
      comparison: touch({ ...comparison, activeRevisionId: id }),
      calibrationPoints: [],
      calibrationLayer: null,
      alignmentPairs: [],
      alignmentPendingOriginal: null,
      pickingAlignmentPoints: false,
      measurePoints: [],
      markupPoints: [],
      selectedMarkupId: null,
      selectedMeasurementId: null,
    });
    scheduleSave(get, set);
  },

  moveRevision: (id, direction) => {
    const { comparison } = get();
    if (!comparison) return;
    const index = comparison.revisions.findIndex((r) => r.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= comparison.revisions.length) return;
    historyTracker.push(get, set, comparison);
    const revisions = [...comparison.revisions];
    [revisions[index], revisions[target]] = [revisions[target], revisions[index]];
    set({ comparison: touch({ ...comparison, revisions }) });
    scheduleSave(get, set);
  },

  startCalibration: (layer) => set({ toolMode: 'calibrate', calibrationLayer: layer, calibrationPoints: [] }),
  addCalibrationPoint: (p) => {
    const pts = [...get().calibrationPoints, p];
    set({ calibrationPoints: pts.slice(-2) });
  },
  clearCalibration: () => set({ calibrationPoints: [], calibrationLayer: null }),
  applyCalibration: (realDistanceMeters) => {
    const { comparison, calibrationPoints, calibrationLayer, currentPageKey } = get();
    if (!comparison || calibrationPoints.length !== 2 || !calibrationLayer || realDistanceMeters <= 0) return;
    const [a, b] = calibrationPoints;
    // The clicked points are always in the source page's native px — the overlay is drawn in that
    // space whichever layer the user is looking at.
    const sourcePixelDistance = Math.hypot(b.x - a.x, b.y - a.y);
    if (sourcePixelDistance === 0) return;
    historyTracker.push(get, set, comparison);
    if (calibrationLayer === 'original') {
      const calibration: CompareCalibration = {
        pixelDistance: sourcePixelDistance,
        realDistanceMeters,
        metersPerPixel: realDistanceMeters / sourcePixelDistance,
        space: 'original',
      };
      get().updatePage(currentPageKey, { originalCalibration: calibration });
    } else {
      // Store the revised layer's calibration in the revised PDF's *own* px, so it survives any
      // later re-alignment: `alignment` is a similarity transform, so one revised px spans
      // `alignment.scale` source px whatever the rotation or offset is.
      const alignmentScale =
        comparison.pages[currentPageKey]?.revisions[comparison.activeRevisionId]?.alignment.scale ?? 1;
      if (!(alignmentScale > 0)) return;
      const pixelDistance = sourcePixelDistance / alignmentScale;
      const calibration: CompareCalibration = {
        pixelDistance,
        realDistanceMeters,
        metersPerPixel: realDistanceMeters / pixelDistance,
        space: 'revised',
      };
      get().updateActiveRevisionPage(currentPageKey, { revisedCalibration: calibration });
    }
    const recalculated = get().comparison;
    if (recalculated) {
      const rebuilt = rebuildApprovedItems(recomputePage(recalculated, currentPageKey), (c) => c.pageNumber === currentPageKey);
      set({ comparison: keepAiResultsCurrent(comparison, rebuilt, currentPageKey) });
    }
    set({ calibrationPoints: [], calibrationLayer: null, toolMode: 'select' });
  },

  setAlignmentTransform: (pageKey, transform, method = 'manual', discrete = false) => {
    const { comparison } = get();
    if (comparison) (discrete ? historyTracker.push : historyTracker.pushDebounced)(get, set, comparison);
    get().updateActiveRevisionPage(pageKey, { alignment: transform, alignmentMethod: method });
    // A revised-layer calibration follows the alignment scale: keep stored quantities in step.
    const aligned = get().comparison;
    if (aligned && compareScaleFor(aligned, pageKey).source === 'revised') set({ comparison: recomputePage(aligned, pageKey) });
    // Point pairs count at once; slider bursts only once they settle (see noteAlignment).
    const updated = get().comparison;
    if (updated) noteAlignment(updated, pageKey, method);
  },
  setRevisedPageNumber: (pageKey, revisedPageNumber) => {
    const { comparison } = get();
    if (!comparison || !Number.isFinite(revisedPageNumber)) return;
    historyTracker.push(get, set, comparison);
    get().updateActiveRevisionPage(pageKey, { revisedPageNumber: Math.max(1, Math.round(revisedPageNumber)) });
  },
  beginAlignmentPointPick: () =>
    set({ toolMode: 'align', pickingAlignmentPoints: true, alignmentPairs: [], alignmentPendingOriginal: null }),
  addAlignmentPoint: (p, isOriginal) => {
    const { alignmentPendingOriginal, alignmentPairs, currentPageKey, pickingAlignmentPoints } = get();
    if (!pickingAlignmentPoints) return;
    if (isOriginal) {
      set({ alignmentPendingOriginal: p });
      return;
    }
    if (!alignmentPendingOriginal) return;
    const pairs = [...alignmentPairs, { originalPoint: alignmentPendingOriginal, revisedPoint: p }].slice(-2);
    const donePicking = pairs.length === 2;
    set({ alignmentPairs: pairs, alignmentPendingOriginal: null, pickingAlignmentPoints: !donePicking });
    if (donePicking) {
      const { comparison } = get();
      if (comparison) historyTracker.push(get, set, comparison);
      get().updateActiveRevisionPage(currentPageKey, { alignmentPoints: pairs });
    }
  },
  clearAlignmentPicking: () => set({ alignmentPairs: [], alignmentPendingOriginal: null }),
  clearAlignmentPoints: (pageKey) => {
    const { comparison } = get();
    if (comparison) historyTracker.push(get, set, comparison);
    get().updateActiveRevisionPage(pageKey, { alignmentPoints: [], alignment: IDENTITY_TRANSFORM, alignmentMethod: undefined });
    set({ alignmentPairs: [], alignmentPendingOriginal: null });
  },

  setMeasureTool: (t) => set({ toolMode: t ? 'measure' : 'select', measureTool: t, measurePoints: [], pendingAreaKind: null }),
  setPendingAreaKind: (k) => set({ pendingAreaKind: k }),
  startChangeMeasurement: (kind) => set({ toolMode: 'measure', measureTool: 'area', pendingAreaKind: kind, measurePoints: [], selectedMeasurementId: null, selectedMarkupId: null, markupPoints: [] }),
  setMeasurementKind: (id, kind) => {
    const { comparison } = get();
    if (!comparison) return;
    if (comparison.revisions.find((r) => r.id === comparison.activeRevisionId)?.measurements.find((m) => m.id === id)?.revisionChangeId) return;
    historyTracker.push(get, set, comparison);
    const revisions = updateActiveRevision(comparison, (r) => ({
      ...r,
      measurements: r.measurements.map((m) => (m.id === id ? { ...m, areaKind: kind } : m)),
    }));
    set({ comparison: touch({ ...comparison, revisions }) });
    scheduleSave(get, set);
  },
  setSelectedMeasurementId: (id) => set({ selectedMeasurementId: id, ...(id ? { toolMode: 'select', selectedMarkupId: null, measurePoints: [], markupPoints: [] } : {}) }),
  focusMeasurement: (id) => {
    const { comparison, currentPageKey } = get();
    if (!comparison) return;
    const active = comparison.revisions.find((r) => r.id === comparison.activeRevisionId);
    const target = active?.measurements.find((m) => m.id === id);
    if (!target) return;
    // Changing page clears in-progress state and the selection, so select afterwards.
    if (target.pageNumber !== currentPageKey) get().setCurrentPageKey(target.pageNumber);
    get().setSelectedMeasurementId(id);
  },
  setAreaShape: (s) => set({ areaShape: s, measurePoints: [], ...(s === 'line' ? { areaCalcMode: 'wall' } : {}) }),
  setAreaCalcMode: (m) => set({ areaCalcMode: m, measurePoints: [], ...(m === 'footprint' && get().areaShape === 'line' ? { areaShape: 'polygon' } : {}) }),
  setOrthoSnap: (v) => set({ orthoSnap: v }),
  addMeasurePoint: (p) => set({ measurePoints: [...get().measurePoints, p] }),
  clearMeasurePoints: () => set({ measurePoints: [] }),
  finishMeasurement: (measurement) => {
    const { comparison, currentPageKey } = get();
    if (!comparison) return;
    historyTracker.push(get, set, comparison);
    // Page ownership is assigned here, not by the caller, so nothing can be stored page-less.
    const owned: Measurement = { ...measurement, pageNumber: currentPageKey };
    const revisions = updateActiveRevision(comparison, (r) => ({ ...r, measurements: [...r.measurements, owned] }));
    set({ comparison: touch({ ...comparison, revisions }), measurePoints: [] });
    trackChangeMarked(comparison.id, owned, get().areaShape);
    scheduleSave(get, set);
  },
  updateMeasurement: (id, patch, quiet = false) => {
    const { comparison } = get();
    if (!comparison) return;
    const active = comparison.revisions.find((r) => r.id === comparison.activeRevisionId);
    const target = active?.measurements.find((m) => m.id === id);
    if (!target) return;
    if (target.revisionChangeId) {
      // An approved change's item is an ordinary editable wall/opening: its edits are written to the
      // change's own line, and the change rebuilds its items (same ids) — so quantities, approval and
      // a later apply all follow the edited geometry. Applied items stay locked.
      const change = active?.analysis?.pages[target.pageNumber]?.changes.find((c) => c.id === target.revisionChangeId);
      const ref = change ? elementOfItem(change, target) : null;
      if (!ref || !change || change.status !== 'approved') return;
      if (Object.keys(patch).length === 0) {
        get().finishRevisionChangeEdit();
        return;
      }
      // Only geometry and height are editable; derived quantities are never overwritten directly.
      if (!patch.points && !patch.centerline && patch.wallHeightM === undefined) return;
      const edit = (c: RevisionChange): RevisionChange => {
        let next = c;
        if (ref.list === 'walls' && patch.points) next = setWallFootprint(next, ref.index, patch.points);
        if (ref.list === 'doors' && patch.centerline && patch.centerline.length >= 2) {
          next = setElementLine(next, ref, patch.centerline[0], patch.centerline[patch.centerline.length - 1]);
        }
        if (patch.wallHeightM !== undefined) {
          const h = patch.wallHeightM > 0 ? patch.wallHeightM : undefined;
          next = ref.list === 'walls' ? setWallHeight(next, ref.index, h) : setOpeningHeight(next, ref.index, h);
        }
        return next;
      };
      get().editRevisionChange(target.pageNumber, change.id, edit, quiet);
      return;
    }
    historyTracker.pushDebounced(get, set, comparison);
    const revisions = updateActiveRevision(comparison, (r) => ({
      ...r,
      measurements: r.measurements.map((m) => {
        if (m.id !== id) return m;
        const next = { ...m, ...patch };
        const scale = compareScaleFor(comparison, m.pageNumber);
        if (!patch.points && !patch.centerline) return next;
        return scale.state === 'calibrated' ? recomputeMeasurement(next, scale.metersPerPixel)
          : { ...next, ...(next.tool === 'area' ? { areaM2: 0, wallLengthM: 0 } : { lengthM: 0 }) };
      }),
    }));
    if (quiet) {
      set({ comparison: { ...comparison, revisions } });
      markDirty(set);
    } else {
      set({ comparison: touch({ ...comparison, revisions }) });
      scheduleSave(get, set);
    }
  },
  deleteMeasurement: (id) => {
    const { comparison } = get();
    if (!comparison) return;
    const target = comparison.revisions.find((r) => r.id === comparison.activeRevisionId)?.measurements.find((m) => m.id === id);
    if (!target) return;
    if (target.revisionChangeId) {
      get().deleteRevisionChange(target.pageNumber, target.revisionChangeId);
      return;
    }
    historyTracker.push(get, set, comparison);
    const revisions = updateActiveRevision(comparison, (r) => ({ ...r, measurements: r.measurements.filter((m) => m.id !== id) }));
    set({
      comparison: touch({ ...comparison, revisions }),
      selectedMeasurementId: get().selectedMeasurementId === id ? null : get().selectedMeasurementId,
    });
    scheduleSave(get, set);
  },

  setMarkupTool: (t) => set({ toolMode: t ? 'markup' : 'select', markupTool: t, markupPoints: [] }),
  setMarkupColor: (c) => set({ markupColor: c }),
  setMarkupOrtho: (v) => set({ markupOrtho: v }),
  setMarkupFontScale: (v) => set({ markupFontScale: v }),
  addMarkupPoint: (p) => set({ markupPoints: [...get().markupPoints, p] }),
  clearMarkupPoints: () => set({ markupPoints: [] }),
  finishMarkup: (markup) => {
    const { comparison, currentPageKey } = get();
    if (!comparison) return;
    historyTracker.push(get, set, comparison);
    const owned: Markup = { ...markup, pageNumber: currentPageKey };
    const revisions = updateActiveRevision(comparison, (r) => ({ ...r, markups: [...r.markups, owned] }));
    set({ comparison: touch(keepAiResultsCurrent(comparison, { ...comparison, revisions }, currentPageKey)), markupPoints: [] });
    scheduleSave(get, set);
  },
  updateMarkup: (id, patch) => {
    const { comparison } = get();
    if (!comparison) return;
    // Debounced like updateMarkupQuiet, so a drag burst and its closing call share one snapshot.
    // An empty patch is the "drag finished, save it" signal and must not open an undo step of its
    // own on a click that never moved anything.
    if (Object.keys(patch).length > 0) historyTracker.pushDebounced(get, set, comparison);
    const revisions = updateActiveRevision(comparison, (r) => ({
      ...r,
      markups: r.markups.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
    set({ comparison: touch(keepAiResultsCurrent(comparison, { ...comparison, revisions }, get().currentPageKey)) });
    scheduleSave(get, set);
  },
  updateMarkupQuiet: (id, patch) => {
    const { comparison } = get();
    if (!comparison) return;
    historyTracker.pushDebounced(get, set, comparison);
    const revisions = updateActiveRevision(comparison, (r) => ({
      ...r,
      markups: r.markups.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
    set({ comparison: keepAiResultsCurrent(comparison, { ...comparison, revisions }, get().currentPageKey) });
    markDirty(set);
  },
  deleteMarkup: (id) => {
    const { comparison } = get();
    if (!comparison) return;
    historyTracker.push(get, set, comparison);
    const revisions = updateActiveRevision(comparison, (r) => ({ ...r, markups: r.markups.filter((m) => m.id !== id) }));
    set({ comparison: touch(keepAiResultsCurrent(comparison, { ...comparison, revisions }, get().currentPageKey)), selectedMarkupId: get().selectedMarkupId === id ? null : get().selectedMarkupId });
    scheduleSave(get, set);
  },
  duplicateMarkup: (id) => {
    const { comparison } = get();
    if (!comparison) return;
    const active = comparison.revisions.find((r) => r.id === comparison.activeRevisionId);
    const original = active?.markups.find((m) => m.id === id);
    if (!original) return;
    historyTracker.push(get, set, comparison);
    const offset = 20;
    const copy: Markup = {
      ...original,
      id: uuid(),
      points: original.points.map((p) => ({ x: p.x + offset, y: p.y + offset })),
      createdAt: Date.now(),
    };
    const revisions = updateActiveRevision(comparison, (r) => ({ ...r, markups: [...r.markups, copy] }));
    set({ comparison: touch(keepAiResultsCurrent(comparison, { ...comparison, revisions }, copy.pageNumber)), selectedMarkupId: copy.id });
    scheduleSave(get, set);
  },
  setSelectedMarkupId: (id) => set({ selectedMarkupId: id, ...(id ? { toolMode: 'select', selectedMeasurementId: null, measurePoints: [], markupPoints: [] } : {}) }),

  setAreaKindColor: (kind, color) => {
    const { comparison } = get();
    if (!comparison) return;
    historyTracker.pushDebounced(get, set, comparison);
    set({ comparison: touch({ ...comparison, areaKindColors: { ...comparison.areaKindColors, [kind]: color } }) });
    scheduleSave(get, set);
  },

  updateComparisonMeta: (patch) => {
    const { comparison } = get();
    if (!comparison) return;
    historyTracker.pushDebounced(get, set, comparison);
    const next: Comparison = { ...comparison, ...patch };
    // Generated wall items follow the default height they were created from (their own height is not editable).
    const heightChanged = patch.wallHeightDefaultM !== undefined && patch.wallHeightDefaultM !== comparison.wallHeightDefaultM;
    set({ comparison: touch(heightChanged ? rebuildApprovedItems(next, () => true) : next) });
    scheduleSave(get, set);
  },

  setComparisonContext: (context) => {
    const { comparison } = get();
    if (!comparison || (comparison.context ?? 'design') === context) return;
    historyTracker.push(get, set, comparison);
    // Approved (not yet applied) changes stand for different items in each context: rebuild them so
    // the Changes table, exports and a later apply all use the context now in force. Applied changes
    // keep theirs — they are already in the plan's ledger under the context they were applied with.
    set({ comparison: touch(rebuildApprovedItems({ ...comparison, context }, () => true)) });
    scheduleSave(get, set);
  },
  setLinkedPlanId: (planId) => {
    const { comparison } = get();
    if (!comparison) return;
    historyTracker.push(get, set, comparison);
    set({ comparison: touch({ ...comparison, linkedPlanId: planId }) });
    scheduleSave(get, set);
  },
  setRevisionBase: (revisionId, baseRevisionId) => {
    const { comparison } = get();
    if (!comparison) return;
    historyTracker.push(get, set, comparison);
    const revisions = comparison.revisions.map((r) => (r.id === revisionId ? { ...r, baseRevisionId } : r));
    set({ comparison: touch({ ...comparison, revisions }) });
    scheduleSave(get, set);
  },
  saveRevisionAnalysis: (revisionId, analysis, refinedAlignment) => {
    const { comparison } = get();
    if (!comparison) return;
    historyTracker.push(get, set, comparison);
    let next: Comparison = {
      ...comparison,
      revisions: comparison.revisions.map((r) => {
        if (r.id !== revisionId) return r;
        // A rerun replaces the page's proposals; approved items of the old run stay as measurements
        // only when already applied — unapplied ones are withdrawn with their proposals.
        const previous = r.analysis?.pages[analysis.pageNumber];
        // Manual corrections and manually added changes are the user's work and survive a rerun.
        const userOwned = (c: RevisionChange) => c.status === 'applied' || !!c.manual || !!c.edited;
        const withdrawn = new Set(
          (previous?.changes ?? []).filter((c) => c.status === 'approved' && !userOwned(c)).flatMap((c) => c.measurementIds ?? [])
        );
        const kept = (previous?.changes ?? []).filter(userOwned);
        // A change already applied to the plan is found again by a rerun: keep the applied record only.
        const fresh = analysis.changes.filter((c) => !kept.some((k) => k.kind === c.kind && k.category === c.category && bboxIou(k.bbox, c.bbox) >= 0.5));
        return {
          ...r,
          measurements: r.measurements.filter((m) => !withdrawn.has(m.id)),
          analysis: { pages: { ...(r.analysis?.pages ?? {}), [analysis.pageNumber]: { ...analysis, changes: [...kept, ...fresh] } } },
        };
      }),
    };
    if (refinedAlignment) {
      const page = next.pages[analysis.pageNumber] ?? emptyPage(analysis.pageNumber);
      const rp = page.revisions[revisionId] ?? emptyRevisionPageData(analysis.pageNumber);
      next = { ...next, pages: { ...next.pages, [analysis.pageNumber]: { ...page, revisions: { ...page.revisions, [revisionId]: { ...rp, alignment: refinedAlignment } } } } };
      next = recomputePage(next, analysis.pageNumber);
    }
    set({ comparison: touch(next) });
    scheduleSave(get, set);
  },
  updateRevisionAnalysis: (revisionId, pageKey, updater) => {
    const { comparison } = get();
    if (!comparison) return;
    const revisions = comparison.revisions.map((r) => {
      const current = r.analysis?.pages[pageKey];
      if (r.id !== revisionId || !current) return r;
      return { ...r, analysis: { pages: { ...r.analysis!.pages, [pageKey]: updater(current) } } };
    });
    set({ comparison: touch({ ...comparison, revisions }) });
    scheduleSave(get, set);
  },
  reviewRevisionChange: (pageKey, changeId, status) => {
    const { comparison } = get();
    if (!comparison) return;
    const revision = comparison.revisions.find((r) => r.id === comparison.activeRevisionId);
    const change = revision?.analysis?.pages[pageKey]?.changes.find((c) => c.id === changeId);
    if (!revision || !change || change.status === 'applied' || change.status === status) return;
    // Lines still at their starting position have not been measured: they cannot be approved.
    if (status === 'approved' && hasUnplacedLines(change)) return;
    if (status === 'approved' && openingGeometryNeedsVerification(change)) return;
    if (status === 'approved' && isOpeningDifference(change) && (!openingImpactReady(change) || compareScaleFor(comparison, pageKey).state !== 'calibrated')) return;
    historyTracker.push(get, set, comparison);
    let measurements = revision.measurements.filter((m) => !(change.measurementIds ?? []).includes(m.id));
    let updated: RevisionChange = { ...change, status, measurementIds: undefined, reviewedAt: Date.now() };
    if (status === 'approved') {
      const created = approvalItems(comparison, change);
      measurements = [...measurements, ...created];
      updated = { ...updated, measurementIds: created.map((m) => m.id) };
    }
    const revisions = comparison.revisions.map((r) => {
      if (r.id !== revision.id) return r;
      const pageAnalysis = r.analysis!.pages[pageKey];
      return {
        ...r,
        measurements,
        analysis: { pages: { ...r.analysis!.pages, [pageKey]: { ...pageAnalysis, changes: pageAnalysis.changes.map((c) => (c.id === changeId ? updated : c)) } } },
      };
    });
    set({ comparison: touch({ ...comparison, revisions }) });
    scheduleSave(get, set);
  },
  confirmChangeAsWall: (pageKey, changeId) => {
    const { comparison } = get();
    if (!comparison) return;
    const revision = comparison.revisions.find((r) => r.id === comparison.activeRevisionId);
    const change = revision?.analysis?.pages[pageKey]?.changes.find((c) => c.id === changeId);
    if (!revision || !change || change.status !== 'pending' || !change.wallCandidates?.length) return;
    historyTracker.push(get, set, comparison);
    const confirmed: RevisionWall[] = change.wallCandidates.flatMap((candidate) => candidate.pieces.map(([a, b]) => {
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      // Display strip only (1 px each side); the quantity is the measured run length.
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      return {
        side: candidate.side,
        centerline: [a, b] as [Point, Point],
        footprint: [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }],
        lengthPx: len,
        thicknessPx: 0,
        manual: true,
      };
    }));
    // Verified walls stay; confirmed lines are added to them, then the relocation match is redone.
    const walls = [...change.walls, ...confirmed];
    const thresholds = detectionThresholds(compareScaleFor(comparison, change.pageNumber).metersPerPixel);
    const relocation = matchRelocation(walls, thresholds.tolerancePx, thresholds.relocationMaxShift);
    const updated: RevisionChange = {
      ...change,
      category: 'wall',
      walls,
      wallCandidates: undefined,
      relocation,
      ...(relocation ? { kind: 'modified' as const } : {}),
      evidence: [...change.evidence, 'manual-wall', ...(relocation ? ['relocated'] : [])],
    };
    const revisions = comparison.revisions.map((r) => {
      if (r.id !== revision.id) return r;
      const pageAnalysis = r.analysis!.pages[pageKey];
      return { ...r, analysis: { pages: { ...r.analysis!.pages, [pageKey]: { ...pageAnalysis, changes: pageAnalysis.changes.map((c) => (c.id === changeId ? updated : c)) } } } };
    });
    set({ comparison: touch({ ...comparison, revisions }) });
    scheduleSave(get, set);
  },
  beginRevisionAiAnalysis: (revisionId, meta, refinedAlignment, run) => {
    const { comparison } = get();
    if (!comparison) return;
    commitPoint(set);
    let next: Comparison = {
      ...comparison,
      revisions: comparison.revisions.map((r) => {
        if (r.id !== revisionId) return r;
        const previous = r.analysis?.pages[meta.pageNumber];
        // A run that failed before anything was sent (the free alignment check) reports why, and
        // leaves the page's existing proposals — possibly paid for — exactly as they were.
        if (run.status === 'FAILED' && previous) {
          return { ...r, analysis: { pages: { ...r.analysis!.pages, [meta.pageNumber]: { ...previous, alignment: meta.alignment, ai: run } } } };
        }
        const sameInputs = previous?.inputKey === meta.inputKey;
        const kept = (previous?.changes ?? []).filter((c) => sameInputs || c.status === 'approved' || c.status === 'applied' || c.manual || c.edited);
        const page: RevisionPageAnalysis = { ...meta, changes: kept, filteredCount: sameInputs ? previous?.filteredCount ?? 0 : 0, ai: run };
        return { ...r, analysis: { pages: { ...(r.analysis?.pages ?? {}), [meta.pageNumber]: page } } };
      }),
    };
    if (refinedAlignment) {
      const page = next.pages[meta.pageNumber] ?? emptyPage(meta.pageNumber);
      const rp = page.revisions[revisionId] ?? emptyRevisionPageData(meta.pageNumber);
      next = { ...next, pages: { ...next.pages, [meta.pageNumber]: { ...page, revisions: { ...page.revisions, [revisionId]: { ...rp, alignment: refinedAlignment } } } } };
      next = recomputePage(next, meta.pageNumber);
    }
    set({ comparison: touch(next) });
    scheduleSave(get, set);
  },
  mergeRevisionAiChanges: (revisionId, pageKey, requestId, changes) => {
    const { comparison } = get();
    if (!comparison) return;
    const revisions = comparison.revisions.map((r) => {
      const page = r.analysis?.pages[pageKey];
      if (r.id !== revisionId || !page || page.ai?.requestId !== requestId) return r;
      // An existing proposal for the same physical change wins (it may already be approved/applied).
      const fresh = changes.filter((c) => !page.changes.some((existing) => sameChange(existing, c)));
      return { ...r, analysis: { pages: { ...r.analysis!.pages, [pageKey]: {
        ...page,
        changes: [...page.changes, ...fresh].sort((a, b) => b.score - a.score),
        ai: { ...page.ai!, status: 'COMPLETED' as const, updatedAt: Date.now() },
      } } } };
    });
    commitPoint(set);
    set({ comparison: touch({ ...comparison, revisions }) });
    scheduleSave(get, set);
  },
  editRevisionChange: (pageKey, changeId, edit, quiet = false) => {
    const { comparison } = get();
    if (!comparison) return;
    const revision = comparison.revisions.find((r) => r.id === comparison.activeRevisionId);
    const change = revision?.analysis?.pages[pageKey]?.changes.find((c) => c.id === changeId);
    if (!revision || !change || change.status === 'applied') return;
    if (quiet) historyTracker.pushDebounced(get, set, comparison);
    else historyTracker.push(get, set, comparison);
    let updated = finalizeEditedChange(edit(change));
    let measurements = revision.measurements;
    if (change.status === 'approved' && (hasUnplacedLines(updated) || !openingImpactReady(updated) || openingGeometryNeedsVerification(updated))) {
      // A new line still has to be placed: the approval no longer stands for measured geometry.
      measurements = measurements.filter((m) => !(change.measurementIds ?? []).includes(m.id));
      updated = { ...updated, status: 'pending', measurementIds: undefined };
    } else if (change.status === 'approved') {
      // Approval stands; its quantities follow the corrected geometry (same items, same ids).
      // Resolve each old item's line on the change as it was, so an item saved without one keeps its id too.
      const previous = measurements.filter((m) => (change.measurementIds ?? []).includes(m.id))
        .map((m) => ({ ...m, revisionElement: elementOfItem(change, m) ?? undefined }));
      const created = approvalItems(comparison, updated, revision.id, previous);
      measurements = [...measurements.filter((m) => !(change.measurementIds ?? []).includes(m.id)), ...created];
      updated = { ...updated, measurementIds: created.map((m) => m.id) };
    }
    const revisions = comparison.revisions.map((r) => {
      if (r.id !== revision.id) return r;
      const pageAnalysis = r.analysis!.pages[pageKey];
      return { ...r, measurements, analysis: { pages: { ...r.analysis!.pages, [pageKey]: { ...pageAnalysis, changes: pageAnalysis.changes.map((c) => (c.id === changeId ? updated : c)) } } } };
    });
    if (quiet) {
      set({ comparison: { ...comparison, revisions } });
      markDirty(set);
    } else {
      set({ comparison: touch({ ...comparison, revisions }) });
      scheduleSave(get, set);
    }
  },
  finishRevisionChangeEdit: () => {
    historyTracker.flush(get, set);
    const { comparison } = get();
    if (!comparison) return;
    set({ comparison: touch(comparison) });
    scheduleSave(get, set);
  },
  addManualRevisionChange: (pageKey, type, at, footprints, openingShapes) => {
    const { comparison } = get();
    if (!comparison) return null;
    const revision = comparison.revisions.find((r) => r.id === comparison.activeRevisionId);
    if (!revision) return null;
    const sides = sidesOf(type);
    const walls = type.startsWith('wall') ? (footprints ?? []).map((points, index) => wallFromFootprint(sides[index], points)) : [];
    if (type.startsWith('wall') && (walls.length !== sides.length || walls.some(w => !w))) return null;
    const openings = familyOf(type) === 'opening' ? (footprints ?? []).map((points, index) => openingFromFootprint(sides[index], points,
      type.startsWith('window') ? 'window' : type.startsWith('door') ? 'door' : undefined, openingShapes?.[index])) : [];
    if (familyOf(type) === 'opening' && (openings.length !== sides.length || openings.some(d => !d))) return null;
    const scale = compareScaleFor(comparison, pageKey);
    const draft: RevisionChange = {
      id: uuid(),
      pageNumber: pageKey,
      kind: 'added',
      category: 'other',
      significance: 'high',
      score: 1,
      evidence: ['manual-change'],
      bbox: { x: at.x - 20, y: at.y - 20, width: 40, height: 40 },
      addedSegments: [],
      removedSegments: [],
      walls: walls.filter((w): w is RevisionWall => !!w),
      doors: openings.filter((d): d is NonNullable<typeof d> => !!d),
      addedLengthPx: 0,
      removedLengthPx: 0,
      status: 'pending',
      manual: true,
    };
    const change = finalizeEditedChange(retypeChange(draft, type, scale.state === 'calibrated' ? scale.metersPerPixel : 0));
    historyTracker.push(get, set, comparison);
    const revisions = comparison.revisions.map((r) => {
      if (r.id !== revision.id) return r;
      // A page nobody ran detection on gets a manual-only record: it holds the user's changes, and
      // its alignment fields are placeholders the UI does not present as a quality check.
      const existing = r.analysis?.pages[pageKey];
      const page: RevisionPageAnalysis = existing ?? {
        pageNumber: pageKey,
        inputKey: analysisInputKey(comparison, r.id, pageKey),
        method: 'vector',
        baseRevisionId: baseRevisionOf(comparison, r)?.id ?? null,
        createdAt: Date.now(),
        alignment: { status: 'fair', residualPx: 0, residualMm: null, inlierRatio: 0, tolerancePx: 0, correction: { dx: 0, dy: 0, rotationDeg: 0 } },
        usedAlignment: comparison.pages[pageKey]?.revisions[r.id]?.alignment ?? IDENTITY_TRANSFORM,
        manualOnly: true,
        changes: [],
        filteredCount: 0,
      };
      return { ...r, analysis: { pages: { ...(r.analysis?.pages ?? {}), [pageKey]: { ...page, changes: [...page.changes, change] } } } };
    });
    set({ comparison: touch({ ...comparison, revisions }) });
    scheduleSave(get, set);
    return change.id;
  },
  mergeWallRegions: (pageKey, selection, confirmedPreview) => {
    const { comparison } = get();
    const revision = comparison?.revisions.find(r => r.id === comparison.activeRevisionId);
    const page = revision?.analysis?.pages[pageKey];
    if (!comparison || !revision || !page) return { error: 'incompatible' };
    const scale = compareScaleFor(comparison, pageKey);
    const result = prepareWallRegionMerge(page.changes, selection, { metersPerPixel: scale.state === 'calibrated' ? scale.metersPerPixel : 0, confirmedPreview });
    if (!result.ok) return { error: result.error, ...(result.preview ? { preview: result.preview } : {}) };
    const ids = new Set(result.changeIds);
    const itemIds = new Set(page.changes.filter(c => ids.has(c.id)).flatMap(c => c.measurementIds ?? []));
    let merged = result.change;
    const created = merged.status === 'approved' ? approvalItems(comparison, merged, revision.id) : [];
    merged = { ...merged, measurementIds: created.length ? created.map(m => m.id) : undefined };
    historyTracker.push(get, set, comparison);
    const revisions = comparison.revisions.map(r => r.id !== revision.id ? r : {
      ...r,
      measurements: [...r.measurements.filter(m => !ids.has(m.revisionChangeId ?? '') && !itemIds.has(m.id)), ...created],
      analysis: { pages: { ...r.analysis!.pages, [pageKey]: { ...page,
        changes: page.changes.flatMap(c => c.id === merged.id ? [merged] : ids.has(c.id) ? [] : [c]),
      } } },
    });
    set({ comparison: touch({ ...comparison, revisions }), selectedMeasurementId: null });
    scheduleSave(get, set);
    return { changeId: merged.id };
  },
  deleteRevisionChange: (pageKey, changeId) => {
    const { comparison } = get();
    if (!comparison) return;
    const revision = comparison.revisions.find((r) => r.id === comparison.activeRevisionId);
    const change = revision?.analysis?.pages[pageKey]?.changes.find((c) => c.id === changeId);
    if (!revision || !change || change.status === 'applied') return;
    historyTracker.push(get, set, comparison);
    const revisions = comparison.revisions.map((r) => {
      if (r.id !== revision.id) return r;
      const pageAnalysis = r.analysis!.pages[pageKey];
      return {
        ...r,
        measurements: r.measurements.filter((m) => m.revisionChangeId !== changeId && !(change.measurementIds ?? []).includes(m.id)),
        analysis: { pages: { ...r.analysis!.pages, [pageKey]: { ...pageAnalysis, changes: pageAnalysis.changes.filter((c) => c.id !== changeId) } } },
      };
    });
    const selectedMeasurementId = get().selectedMeasurementId;
    const removedSelection = revision.measurements.some((m) => m.id === selectedMeasurementId
      && (m.revisionChangeId === changeId || (change.measurementIds ?? []).includes(m.id)));
    set({ comparison: touch({ ...comparison, revisions }), selectedMeasurementId: removedSelection ? null : selectedMeasurementId });
    scheduleSave(get, set);
  },
  setRevisionChangesStatus: (revisionId, changeIds, status) => {
    const { comparison } = get();
    if (!comparison) return;
    const ids = new Set(changeIds);
    const revisions = comparison.revisions.map((r) => {
      if (r.id !== revisionId || !r.analysis) return r;
      const pages = Object.fromEntries(Object.entries(r.analysis.pages).map(([key, p]) => [
        key,
        { ...p, changes: p.changes.map((c) => (ids.has(c.id) ? { ...c, status } : c)) },
      ]));
      return { ...r, analysis: { pages } };
    });
    // The plan's ledger now says what is applied: no undo step may bring back an older status.
    commitPoint(set);
    set({ comparison: touch({ ...comparison, revisions }) });
    scheduleSave(get, set);
  },

  persist: async () => {
    const { comparison } = get();
    if (!comparison) return;
    // A save happening now supersedes the scheduled one.
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    set({ saving: true });
    try {
      await dbSaveComparison(comparison);
      // Only clear the flag when nothing was edited while the write was in flight.
      if (get().comparison === comparison) set({ dirty: false });
      set({ saveError: null });
    } catch (err) {
      // Stays dirty: the work is not on disk, and the unload guard must keep warning.
      set({ saveError: err instanceof Error ? err.message : t('errors.saveFailed') });
      console.error('Failed to save comparison', err);
      trackError('save_comparison', err);
    } finally {
      set({ saving: false });
    }
  },
}));
