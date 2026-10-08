import { aiWarnings, aiCandidateTypeKey, aiCandidateLabel } from '../lib/localAiReview';
import { candidateGeometryProblems, overlapNotes } from '../lib/ai/oneClick';
import type { LocalAiMetadata } from '../lib/localAiImport';
import { canAuthorTakeoff, canUseToolMode, canUseMarkupTool, canUseMeasureTool, isTouchInput, isPhoneWorkspace } from '../lib/workspaceCapabilities';
import { useFieldWorkflowStore } from './fieldWorkflowStore';
import { concreteOf, rebarOf } from '../lib/structuralPlan';
import { hasManualMark, nextAutoNumber } from '../lib/structuralMarks';
import { withRenewedLayerIds } from '../lib/rebarMesh';
import { editManualMeshLayout, renewManualMeshSheetIds, type ManualMeshEdit } from '../lib/manualMeshLayout';
import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { AreaCalcMode, AreaKind, AreaShape, Calibration, ExportRegion, Markup, MarkupTool, Measurement, MeasureTool, Opening, OpeningType, Point, Plan, Project, Room, ToolMode, WorkItem, WorkType } from '../types';
import { DEFAULT_AREA_KIND_COLORS } from '../types';
import { MEASUREMENT_DEFAULTS, OPENING_DEFAULT_SIZES } from '../config/measurementDefaults';
import {
  deleteComparison as dbDeleteComparison,
  loadComparison,
  saveComparePdfBlob,
  saveComparison as dbSaveComparison,
  savePlan as dbSavePlan,
  saveProject as dbSaveProject,
  deletePlan as dbDeletePlan,
  loadPdfBlob,
  loadPlan,
  loadProjectWithPlans,
  savePdfBlob,
} from '../db/database';
import { clonePlanForDuplicate } from '../lib/planDuplication';
import { createEmptyComparison, useCompareStore } from './compareStore';
import type { Comparison } from '../types/compare';
import type { ConcreteElement, ConcreteKind, DrawnStraightBar, MeshReinforcement, RebarLevel, StirrupPlacement } from '../types/structural';
import {
  addConcreteElement,
  addConcreteFromRooms,
  addRebarItem,
  copyBottomToTop,
  addRebarMeshFromRooms,
  changeConcreteKind as changeKind,
  newConcreteElement,
  newRebarBars,
  newRebarStirrup,
  newRebarMesh,
  removeConcreteElement,
  removeRebarItem,
  updateConcreteElement as updateConcrete,
  updateRebarItem as updateRebar,
  setMeshLevels,
  setMeshReinforcement,
  type MeshLevelChoice,
  type RebarPatch,
} from '../lib/structuralMutations';
import { polygonAreaPx } from '../lib/geometry';
import { isRectangle } from '../lib/zoneGeometry';
import { resolveStraightBars } from '../lib/rebar';
import { resizeStraightBar, translateBar } from '../lib/straightBarsGeometry';
import type { AreaGeometryKind } from '../lib/areaGeometryEditing';
import { overlayForTool, readOverlayVisibility, OVERLAY_STORAGE_KEY, type OverlayKey, type OverlayVisibility } from '../lib/overlayVisibility';
import { createHistoryTracker } from '../lib/undoHistory';
import { loadPdfPlanSource } from '../lib/planSource';
import { runRoomDetection, type DetectionSummary } from '../lib/roomDetection';
import { buildWorkItemsForProfile, getRoomProfile, roomProfileName } from '../lib/roomProfiles';
import { t } from '../i18n';
import {
  notePlanLoaded,
  notePlanSaved,
  trackCalibrationCompleted,
  trackComparisonCreated,
  trackComparisonOpened,
  trackError,
  trackPlanCreated,
  trackProjectCreated,
  trackRoomDrawn,
  trackRoomsCreated,
  trackWorkItemsAdded,
} from '../lib/analytics';

const historyTracker = createHistoryTracker<Plan>();

/** How far a duplicated room is shifted from its source, in native page px, so the copy is visible. */
const ROOM_DUPLICATE_OFFSET = 30;

/** Whole structural copies shift by 25 cm on calibrated pages, otherwise by the room convention. */
function structuralDuplicatePoints(plan: Plan, pageNumber: number, points: Point[]): Point[] {
  const scale = plan.pages[pageNumber]?.calibration?.metersPerPixel;
  const offset = scale && Number.isFinite(scale) && scale > 0 ? 0.25 / scale : ROOM_DUPLICATE_OFFSET;
  return points.map((point) => ({ ...point, x: point.x + offset, y: point.y + offset }));
}

const ROOM_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#c026d3', '#65a30d'];

function nextColor(existing: number): string {
  return ROOM_COLORS[existing % ROOM_COLORS.length];
}

export function createEmptyPlan(name: string, pdfFileName: string, projectId: string): Plan {
  const now = Date.now();
  return {
    id: uuid(),
    projectId,
    name,
    createdAt: now,
    updatedAt: now,
    pdfFileName,
    pages: {},
    rooms: [],
    measurements: [],
    markups: [],
    defaultCladdingHeightM: MEASUREMENT_DEFAULTS.claddingHeightM,
    defaultPanelHeightM: MEASUREMENT_DEFAULTS.panelHeightM,
    defaultTilingWastePercent: 0,
    defaultTilingAsWastePercent: 0,
    defaultCladdingWastePercent: 0,
    defaultPanelsWastePercent: 0,
    areaKindColors: { ...DEFAULT_AREA_KIND_COLORS },
    wallHeightDefaultM: MEASUREMENT_DEFAULTS.wallHeightM,
  };
}

/**
 * Deep clone of a room for any duplicate action (single room or whole apartment), so the two
 * paths can never drift apart on which fields they carry:
 * - new id for the room, for every work item and for every opening;
 * - fresh point objects and a fresh work-item array — nothing is shared with the source;
 * - work items copied verbatim (overrides included), never rebuilt from the room profile, so
 *   manual edits such as a deleted item survive;
 * - `roomType` carries over (the user's own classification) while the auto-detection metadata is
 *   dropped: a copy is something the user made, not something the detector found.
 * `overrides` is applied last — callers use it for the translated points, page, apartment and colour.
 */
function cloneRoomForDuplicate(source: Room, overrides: Partial<Room> & { color: string }): Room {
  return {
    ...source,
    id: uuid(),
    points: source.points.map((p) => ({ x: p.x, y: p.y })),
    workItems: source.workItems.map((wi) => ({ ...wi, id: uuid() })),
    openings: source.openings?.map((o) => ({ ...o, id: uuid() })),
    roomType: source.roomType,
    detectedType: undefined,
    detectionConfidence: undefined,
    ...overrides,
  };
}

/**
 * A detection suggestion, held in session state only — never part of `Plan`, never persisted,
 * never counted in quantities. Mirrors what the detection engine already returns (see DetectedRoom)
 * plus the page it was found on and an id for the review list.
 */
export interface DetectionCandidate {
  id: string;
  pageNumber: number;
  points: Point[];
  /** Name the detector read off the plan; empty when it recognised none. */
  suggestedName: string;
  /** ROOM_PROFILES key the detector matched, or null when it could not classify the room. */
  roomTypeKey: string | null;
  /** Qualitative only ('high' = a room name was recognised) — not a probability. */
  confidence: 'high' | 'low';
  originalPoints?: Point[];
  originalValidationProblems?: string[];
  localAi?: LocalAiMetadata;
  validationProblems?: string[];
  reviewedWarningIds?: string[];
  semanticTypeEdited?: boolean;
  semanticTypeConfirmed?: boolean;
}

/** Rechecked at the commit boundary, independent of disabled UI controls. */
function candidateCanBeAccepted(candidate: DetectionCandidate, plan: Plan, pageNumber: number): boolean {
  if (candidate.pageNumber !== pageNumber) return false;
  if (!candidate.localAi) return true;
  const meta = candidate.localAi;
  return meta.planId === plan.id && meta.pageNumber === pageNumber &&
    !plan.rooms.some(room => room.id === candidate.id) &&
    !candidate.validationProblems?.length &&
    candidateGeometryProblems(candidate.points, meta).length === 0;
}

/**
 * Turns an accepted candidate into an ordinary room. The accepted room is a normal room in every
 * way; `detectedType`/`detectionConfidence` are only metadata about where it came from, while
 * `roomType` records legacy detection classification. Local AI types require separate confirmation and never seed finish items.
 */
function roomFromCandidate(candidate: DetectionCandidate, project: Plan, seed: number, apartmentNumber: string): Room {
  const profile = getRoomProfile(candidate.localAi
    ? (candidate.semanticTypeConfirmed ? aiCandidateTypeKey(candidate) : null) : candidate.roomTypeKey);
  return {
    id: candidate.localAi ? candidate.id : uuid(),
    pageNumber: candidate.pageNumber,
    points: candidate.points.map((p) => ({ x: p.x, y: p.y })),
    closed: true,
    // `seed` counts up across a batch, so accepting several unnamed candidates gives each one its
    // own number instead of naming them all after the same room count.
    name: candidate.localAi ? aiCandidateLabel(candidate) : candidate.suggestedName || t('defaultNames.room', { number: seed + 1 }),
    // Accepting is a manual act, so the room joins the apartment the user is working in — all the
    // detection metadata below is preserved untouched.
    apartmentNumber,
    notes: '',
    // Even separately confirmed local AI types never seed work items. Legacy work items come
    // from the one shared profile builder; an unclassified candidate becomes a
    // plain room with no work items, exactly like a room drawn by hand.
    workItems: !candidate.localAi && profile ? buildWorkItemsForProfile(profile, project) : [],
    color: nextColor(seed),
    roomType: profile?.key,
    detectedType: candidate.localAi ? undefined : profile?.key,
    ...(candidate.localAi ? { aiSource: { targetPoint:candidate.localAi.targetPoint?{...candidate.localAi.targetPoint}:undefined,detectionMode:candidate.localAi.detectionMode,overlapWarnings:candidate.localAi.overlapWarnings?[...candidate.localAi.overlapWarnings]:undefined,spaceId: candidate.localAi.spaceId,
      suggestedType: candidate.localAi.suggestedType ?? null, geometryClass: candidate.localAi.geometryClass,
      geometryConfidence: candidate.localAi.geometryConfidence, typeConfidence: candidate.localAi.typeConfidence,
      requiresReview: candidate.localAi.requiresReview, ambiguities: candidate.localAi.ambiguities ? [...candidate.localAi.ambiguities] : undefined,
      reason: candidate.localAi.reason,
      reviewNotes: [...candidate.localAi.reviewNotes], reviewedWarningIds: [...(candidate.reviewedWarningIds ?? [])] } } : {}),
    detectionConfidence: candidate.confidence,
  };
}

/**
 * A hand-drawn room. With a room template chosen for new rooms, the room starts classified and
 * with that template's work items (from the one shared profile builder) — a starting point the user
 * edits like any other room.
 */
function newRoom(project: Plan, pageNumber: number, points: Point[], apartmentNumber: string, templateKey: string | null): Room {
  const profile = getRoomProfile(templateKey);
  return {
    id: uuid(),
    pageNumber,
    points,
    closed: true,
    name: profile
      ? t('defaultNames.roomOfType', { type: roomProfileName(profile), number: project.rooms.length + 1 })
      : t('defaultNames.room', { number: project.rooms.length + 1 }),
    // Stamped from the apartment the user is working in; still editable per room afterwards.
    apartmentNumber,
    notes: '',
    workItems: profile ? buildWorkItemsForProfile(profile, project) : [],
    roomType: profile?.key,
    color: nextColor(project.rooms.length),
  };
}

interface AppState {
  /**
   * The open plan — the document every viewer, tool and export works on. (The key predates
   * projects, when the open document was the whole project.) null on the project overview/home.
   */
  project: Plan | null;
  /** The open project folder; null on the home screen. */
  currentProject: Project | null;
  /** Snapshot of the open project's plans for the overview and the plan switcher; the open plan itself is `project`. */
  projectPlans: Plan[];
  /** Snapshot of the open project's revision comparisons, for the overview. The open one lives in compareStore. */
  projectComparisons: Comparison[];
  /** Room template (ROOM_PROFILES key) applied to newly drawn rooms; null = plain room. Session UI state. */
  newRoomTemplate: string | null;
  currentPage: number;
  numPages: number;
  toolMode: ToolMode;
  selectedRoomId: string | null;
  /**
   * The room the user just finished drawing by hand (polygon or rectangle), so the sidebar can open
   * straight into its details. UI-only and not persisted; rooms that arrive any other way — accepted
   * detection candidates, duplicates, undo — never set it.
   */
  manuallyCreatedRoomId: string | null;
  calibrationPoints: Point[];
  drawingPoints: Point[];
  /**
   * What a finished polygon or rectangle becomes. 'room' is the original behavior and the default;
   * the structural targets are for concrete and rebar zones. Session UI state — not persisted, not
   * in history — and reset to 'room' whenever a plan is opened or closed.
   */
  drawTarget: DrawTarget;
  barsDrawing: 'zone' | 'line' | null;
  stirrupDrawing: 'line' | 'area' | null;
  selectedStirrupPlacementId: string | null;
  /** The concrete zone open in the Concrete tab's form. Session UI state, like `selectedRoomId`: not persisted and cleared by undo, redo, page changes and plan switches. */
  selectedConcreteId: string | null;
  /** The rebar item open in the Rebar tab's form. Session UI state, cleared like `selectedConcreteId`. */
  selectedRebarId: string | null;
  selectedDrawnBarId: string | null;
  /** The kind the next drawn concrete zone gets (the Concrete tab's picker). Session UI state. */
  concreteKind: ConcreteKind;
  measureTool: MeasureTool | null;
  measurePoints: Point[];
  areaShape: AreaShape;
  areaCalcMode: AreaCalcMode;
  pendingAreaKind: AreaKind | null;
  /** When on, each new polygon vertex (or the second point of a distance measurement) snaps to a horizontal/vertical line from the previous one. */
  orthoSnap: boolean;
  /** View menu: one independent show/hide switch per overlay domain (persisted per browser, see lib/overlayVisibility). */
  overlayVisible: OverlayVisibility;
  setOverlayVisible: (key: OverlayKey, visible: boolean) => void;
  /** True from the moment a mutation happens until the next successful persist. */
  dirty: boolean;
  /** True while a persist is in flight. */
  saving: boolean;
  /** Message of the last failed persist, cleared on the next successful one. */
  saveError: string | null;

  /**
   * Apartment the user is currently working in. Newly created rooms are stamped with it, so a whole
   * apartment can be marked without retyping the number per room. Empty string = "ללא שיוך".
   * Session state only: apartments stay derived from `Room.apartmentNumber`, with no new entity and
   * no migration.
   */
  activeApartmentNumber: string;
  setActiveApartmentNumber: (apartmentNumber: string) => void;

  /** Chosen PDF-export crop region per page (native page coordinates). Not persisted — a per-session export setting. */
  exportRegions: Record<number, ExportRegion>;
  setExportRegion: (pageNumber: number, region: ExportRegion | null) => void;

  /** Undo/redo stacks of past/future project snapshots. Not persisted — reset whenever the project changes. */
  history: Plan[];
  future: Plan[];
  undo: () => void;
  redo: () => void;

  /** Auto room-detection progress state (not persisted). */
  detecting: boolean;
  detectionProgress: number; // 0..1
  detectionLabel: string;
  detectionSummary: DetectionSummary | null;
  /** Detection suggestions awaiting review. Session state — not in Plan, not persisted, not in history. */
  selectedDetectionCandidateId: string | null;
  selectDetectionCandidate: (id: string | null) => void;
  editDetectionCandidate: (id: string, points: Point[]) => void;
  restoreDetectionCandidate: (id: string) => void;
  setDetectionWarningReviewed: (id: string, warningId: string, reviewed: boolean) => void;
  setAllDetectionWarningsReviewed: (reviewed: boolean) => void;
  setDetectionCandidateType: (id: string, key: string | null) => void;
  confirmDetectionCandidateType: (id: string) => void;
  detectionCandidates: DetectionCandidate[];
  /** Page the pending candidates belong to; they are dropped when the user leaves it. */
  detectionCandidatesPage: number | null;
  detectRooms: () => Promise<void>;
  /** Turns one candidate into a real room (one history entry) and drops it from the review list. */
  acceptDetectionCandidate: (candidateId: string) => string | null;
  /** Turns every remaining candidate into a room as a single history entry. Returns how many. */
  acceptAllDetectionCandidates: () => number;
  /** Drops one suggestion. No project change, no history, no save. */
  rejectDetectionCandidate: (candidateId: string) => void;
  /** Drops every suggestion (reject all / page change / Escape). No project change, no history. */
  clearDetectionCandidates: () => void;
  autoCalculateQuantities: () => number;
  clearDetectionSummary: () => void;

  setProject: (p: Plan | null) => void;

  /** Loads a project folder and shows its overview. */
  openProject: (projectId: string) => Promise<void>;
  /** Saves the open plan and returns to the home screen. False when the save failed (nothing is dropped). */
  closeProject: () => Promise<boolean>;
  /** Creates a project, optionally with a first plan from a PDF (which is then opened). */
  /** Creates an empty project and opens its overview — no plan, no workspace; the user picks the next step there. */
  createProject: (name: string) => Promise<void>;
  renameProject: (name: string) => void;
  /** Re-reads the open project's plans from disk (after the open plan was saved or plans changed). */
  refreshProjectPlans: () => Promise<void>;
  /** Opens (or switches to) a plan; the previous plan is saved first and never left in memory. */
  openPlan: (planId: string) => Promise<boolean>;
  /** Saves the open plan and goes back to the project overview. */
  closePlan: () => Promise<boolean>;
  addPlan: (file: File, name: string) => Promise<Plan | null>;
  duplicatePlan: (planId: string) => Promise<Plan | null>;
  deletePlan: (planId: string) => Promise<void>;
  renamePlan: (planId: string, name: string) => Promise<void>;
  /**
   * Revision comparisons of the open project. Each is a Revision Compare `Comparison` document; the
   * Compare workspace and its store are unchanged — these only file it under the project.
   */
  createComparison: (input: { name: string; apartmentNumber: string; original: File; revised: File[] }) => Promise<void>;
  openComparison: (comparisonId: string) => Promise<void>;
  renameComparison: (comparisonId: string, name: string) => Promise<void>;
  deleteComparison: (comparisonId: string) => Promise<void>;
  setNewRoomTemplate: (key: string | null) => void;
  /** Replaces a room's work items with its template's — the explicit "reset to template" action. */
  applyRoomTemplate: (roomId: string) => void;
  setCurrentPage: (n: number) => void;
  setNumPages: (n: number) => void;
  setToolMode: (m: ToolMode) => void;
  setSelectedRoomId: (id: string | null) => void;

  addCalibrationPoint: (p: Point) => void;
  clearCalibrationPoints: () => void;
  applyCalibration: (realDistanceMeters: number) => void;

  addDrawingPoint: (p: Point) => void;
  clearDrawingPoints: () => void;
  setDrawTarget: (target: DrawTarget) => void;
  setSelectedConcreteId: (id: string | null) => void;
  setConcreteKind: (kind: ConcreteKind) => void;
  /** Debounced into one undo step per burst, like typing in a room's fields. */
  updateConcreteElement: (id: string, patch: Partial<Omit<ConcreteElement, 'id'>>) => void;
  /** Changes the kind of an existing zone (mark renumbered if still automatic). One undo step. */
  changeConcreteElementKind: (id: string, kind: ConcreteKind) => void;
  /** Translate a whole zone in one undo/autosave action; manual sheet coordinates stay local. */
  startBarsZone: (id: string) => void;
  startDrawingBar: (id: string) => void;
  setBarsIndividualMode: (id: string) => void;
  finishDrawnBar: (start: Point, end: Point) => void;
  setSelectedDrawnBarId: (id: string | null) => void;
  editDrawnBar: (itemId: string, bar: DrawnStraightBar) => void;
  resizeDrawnBar: (itemId: string, barId: string, lengthM: number) => void;
  duplicateDrawnBar: (itemId: string, barId: string) => void;
  deleteDrawnBar: (itemId: string, barId: string) => void;
  removeBarsZone: (id: string) => void;
  moveStructuralZone: (kind: 'concrete' | 'mesh' | 'bars', id: string, offset: Point) => void;
  editAreaGeometry: (kind: AreaGeometryKind, id: string, points: Point[], placementId?: string) => void;
  duplicateConcreteElement: (id: string) => void;
  deleteConcreteElement: (id: string) => void;
  /**
   * Copies the outlines of existing rooms into new concrete zones of the chosen kind (the room itself
   * is untouched). One undo step. A single new zone is selected so its form opens; several are left
   * in the list. Returns how many zones were created.
   */
  copyRoomsToConcrete: (roomIds: string[]) => number;

  setSelectedRebarId: (id: string | null) => void;
  /** Debounced into one undo step per burst, like typing in a room's fields. */
  updateRebarItem: (id: string, patch: RebarPatch) => void;
  /** One physical layout action, one undo step; drag commits on release. */
  editMeshLayout: (id: string, level: RebarLevel, edit: ManualMeshEdit) => void;
  /** Adds a manual-bars row on the current page and selects it. */
  addRebarBars: () => void;
  addRebarStirrup: () => void;
  duplicateStirrupItem: (id: string) => void;
  duplicateStirrupPlacement: (id: string, placementId: string) => void;
  startStirrupPlacement: (id: string, kind: 'line' | 'area') => void;
  finishStirrupLine: (start: Point, end: Point) => void;
  editStirrupShape: (id: string, shape: import('../types/structural').StirrupShape) => void;
  editStirrupPlacement: (id: string, placement: StirrupPlacement, debounced?: boolean) => void;
  deleteStirrupPlacement: (id: string, placementId: string) => void;
  selectStirrupPlacement: (id: string, placementId: string) => void;
  duplicateRebarMesh: (id: string) => void;
  duplicateStraightBars: (id: string) => void;
  removeDrawnBarsLayout: (id: string) => void;
  deleteRebarItem: (id: string) => void;
  /** Which reinforcement levels (Bottom / Top / both) a mesh zone has. One undo step. */
  setRebarMeshLevels: (id: string, choice: MeshLevelChoice) => void;
  /** Replaces one level's reinforcement (mode, diameter, spacing…). Debounced into one undo step per burst. */
  setRebarMeshReinforcement: (id: string, level: RebarLevel, reinforcement: MeshReinforcement) => void;
  /** "Copy Bottom to Top": Top becomes an independent copy of Bottom. One undo step. */
  copyRebarBottomToTop: (id: string) => void;
  /** Copies the outlines of existing rooms into new mesh zones (rooms untouched). One undo step; returns how many. */
  copyRoomsToRebar: (roomIds: string[]) => number;
  finishDrawing: () => void;
  finishRectangle: (p1: Point, p2: Point) => void;

  setMeasureTool: (t: MeasureTool | null) => void;
  setAreaShape: (s: AreaShape) => void;
  setAreaCalcMode: (m: AreaCalcMode) => void;
  setPendingAreaKind: (k: AreaKind | null) => void;
  setAreaKindColor: (kind: AreaKind, color: string) => void;
  setOrthoSnap: (v: boolean) => void;
  /**
   * The bottom quantities panel: whether it is open, how tall the user dragged it and whether it is
   * maximised. Session UI state only — nothing here is written to the project or to IndexedDB, and
   * nothing here can affect a quantity, a coordinate or an export.
   */
  quantitiesOpen: boolean;
  quantitiesHeight: number;
  quantitiesMaximized: boolean;
  /**
   * The plan export dialog that is open (PDF or Excel), and which export is running. Held here - not in
   * the buttons that open it - because the top bar's export menu closes (and unmounts its items) the
   * moment one is clicked; the dialogs are mounted once in the workspace (QuantityExportDialogs).
   */
  quantityExportDialog: { kind: 'pdf' | 'excel'; surface: 'topbar_menu' | 'quantities_panel' } | null;
  quantityExportBusy: 'pdf' | 'excel' | null;
  setQuantityExportDialog: (dialog: { kind: 'pdf' | 'excel'; surface: 'topbar_menu' | 'quantities_panel' } | null) => void;
  setQuantityExportBusy: (busy: 'pdf' | 'excel' | null) => void;
  setQuantitiesOpen: (open: boolean) => void;
  setQuantitiesHeight: (px: number) => void;
  toggleQuantitiesMaximized: () => void;

  addMeasurePoint: (p: Point) => void;
  clearMeasurePoints: () => void;
  finishMeasurement: (m: Measurement) => void;
  updateMeasurement: (id: string, patch: Partial<Measurement>) => void;
  deleteMeasurement: (id: string) => void;

  markupTool: MarkupTool | null;
  markupPoints: Point[];
  markupColor: string;
  selectedMarkupId: string | null;
  /** When on, markup lines (dimension/arrow/cloud) snap to horizontal/vertical from the previous point. */
  markupOrtho: boolean;
  setMarkupOrtho: (v: boolean) => void;
  setMarkupTool: (t: MarkupTool | null) => void;
  setMarkupColor: (c: string) => void;
  /** Label size multiplier applied to newly created text notes / dimension labels. */
  markupFontScale: number;
  setMarkupFontScale: (v: number) => void;
  addMarkupPoint: (p: Point) => void;
  clearMarkupPoints: () => void;
  finishMarkup: (m: Markup) => void;
  updateMarkup: (id: string, patch: Partial<Markup>) => void;
  /** Like updateMarkup but skips the undo snapshot and autosave schedule — for continuous drag updates. */
  updateMarkupQuiet: (id: string, patch: Partial<Markup>) => void;
  deleteMarkup: (id: string) => void;
  duplicateMarkup: (id: string) => void;
  setSelectedMarkupId: (id: string | null) => void;

  updateRoom: (id: string, patch: Partial<Room>) => void;
  /**
   * Sets (or clears, with null) the room type the user picked, and — only for a room that has no
   * work items yet — seeds the profile's work items. One mutation, so one undo step.
   * Returns what it did, so the panel can tell the user when existing work was left alone.
   */
  setRoomType: (roomId: string, roomType: string | null) => 'created' | 'kept' | 'none';
  /**
   * Copies a room (geometry, details, roomType and work items) into a new, fully independent room
   * offset by ROOM_DUPLICATE_OFFSET, selects it, and records it as a single undo step.
   * Returns the new room's id, or null when `roomId` does not exist.
   */
  duplicateRoom: (roomId: string) => string | null;
  /**
   * Copies every room of `sourceApartmentNumber` into `targetApartmentNumber`, keeping each room's
   * own geometry and page untouched (a typical apartment is duplicated for its quantities, not to
   * paste a shape elsewhere). One undo step. Returns how many rooms were copied.
   */
  duplicateApartment: (sourceApartmentNumber: string, targetApartmentNumber: string) => number;
  deleteRoom: (id: string) => void;
  addWorkItem: (roomId: string, type: WorkType) => void;
  updateWorkItem: (roomId: string, itemId: string, patch: Partial<WorkItem>) => void;
  removeWorkItem: (roomId: string, itemId: string) => void;
  addOpening: (roomId: string, type: OpeningType) => void;
  /** Debounced into one undo step per burst, like typing in a work item. */
  updateOpening: (roomId: string, openingId: string, patch: Partial<Opening>) => void;
  removeOpening: (roomId: string, openingId: string) => void;
  moveRoomPoint: (roomId: string, pointIndex: number, p: Point) => void;
  deleteRoomPoint: (roomId: string, pointIndex: number) => void;

  updateProjectMeta: (
    patch: Partial<
      Pick<
        Plan,
        | 'name'
        | 'defaultCladdingHeightM'
        | 'defaultPanelHeightM'
        | 'defaultTilingWastePercent'
        | 'defaultTilingAsWastePercent'
        | 'defaultCladdingWastePercent'
        | 'defaultPanelsWastePercent'
        | 'defaultPaintingWastePercent'
        | 'defaultPlasterWastePercent'
        | 'defaultWaterproofingWastePercent'
        | 'wallHeightDefaultM'
      >
    >
  ) => void;

  persist: () => Promise<void>;
}

/**
 * Marks the project as carrying unsaved work. Every mutation path goes through here: either via
 * `scheduleSave` (the normal autosave route) or directly, for the `*Quiet` variants that skip the
 * autosave schedule and persist only when the drag ends.
 */
function markDirty(set: (patch: Partial<AppState>) => void) {
  set({ dirty: true });
}

/** What a finished polygon or rectangle becomes; see `AppState.drawTarget`. */
export type DrawTarget = 'room' | 'concrete' | 'rebar';

/**
 * Where a finished shape goes when the draw target is not 'room': a concrete zone or a rebar mesh
 * zone becomes a real item — and nothing else ever creates one. A shape with fewer than three points
 * or no area is just dropped, like cancelling.
 */
function commitStructuralZone(get: () => AppState, set: (patch: Partial<AppState>) => void, points: Point[]) {
  const { project, drawTarget, currentPage, concreteKind } = get();
  if (!project || (drawTarget !== 'concrete' && drawTarget !== 'rebar') || points.length < 3 || polygonAreaPx(points) <= 0) {
    set({ drawingPoints: [] });
    return;
  }
  if (drawTarget === 'rebar' && get().stirrupDrawing === 'area') {
    const item = rebarOf(project).find((i) => i.id === get().selectedRebarId);
    if (!item || item.kind !== 'stirrup' || !isRectangle(points)) return;
    const placement: StirrupPlacement = { id: uuid(), kind: 'area', pageNumber: currentPage, points: structuredClone(points), spacingXM: 1, spacingYM: 1, quantityMode: 'automatic' };
    historyTracker.push(get, set, project);
    set({ project: { ...updateRebar(project, item.id, { placements: [...item.placements, placement] }), updatedAt: Date.now() },
      selectedStirrupPlacementId: placement.id, stirrupDrawing: null, drawingPoints: [], toolMode: 'select' });
    scheduleSave(get, set);
    return;
  }
  if (drawTarget === 'rebar' && get().barsDrawing === 'zone') {
    const item = rebarOf(project).find((i) => i.id === get().selectedRebarId);
    if (!item || item.kind !== 'bars' || !isRectangle(points)) return;
    historyTracker.push(get, set, project);
    const barsZone = { ...item.barsZone, pageNumber: currentPage, points: structuredClone(points),
      direction: item.barsZone?.direction ?? 'long' as const, lengthMode: item.barsZone?.lengthMode ?? 'automatic' as const };
    set({ project: { ...updateRebar(project, item.id, { barsZone, pageNumber: currentPage }), updatedAt: Date.now() },
      drawingPoints: [], barsDrawing: null, stirrupDrawing: null, toolMode: 'select' });
    scheduleSave(get, set);
    return;
  }
  historyTracker.push(get, set, project);
  if (drawTarget === 'rebar') {
    const mesh = newRebarMesh(project, currentPage, points);
    set({
      project: { ...addRebarItem(project, mesh), updatedAt: Date.now() },
      drawingPoints: [],
      selectedRebarId: mesh.id,
      selectedRoomId: null,
      toolMode: 'select',
    });
  } else {
    const element = newConcreteElement(project, currentPage, concreteKind, points);
    set({
      project: { ...addConcreteElement(project, element), updatedAt: Date.now() },
      drawingPoints: [],
      selectedConcreteId: element.id,
      selectedRoomId: null,
      toolMode: 'select',
    });
  }
  scheduleSave(get, set);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(get: () => AppState, set: (patch: Partial<AppState>) => void) {
  markDirty(set);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void get().persist();
  }, 800);
}

export type SaveState = 'saving' | 'saved' | 'unsaved' | 'error';

/** Save state for the UI, derived from the existing flags — `useAppStore(selectSaveState)`. */
export function selectSaveState(s: AppState): SaveState {
  if (!s.project) return 'saved';
  if (s.saving) return 'saving';
  if (s.saveError) return 'error';
  return s.dirty ? 'unsaved' : 'saved';
}

function loadOverlayVisibility(): OverlayVisibility {
  try {
    return readOverlayVisibility(typeof window !== 'undefined' ? window.localStorage.getItem(OVERLAY_STORAGE_KEY) : null);
  } catch {
    return readOverlayVisibility(null);
  }
}

function saveOverlayVisibility(v: OverlayVisibility) {
  try {
    window.localStorage.setItem(OVERLAY_STORAGE_KEY, JSON.stringify(v));
  } catch {
    // still applies for this session
  }
}

/** Turns on just one overlay domain (when the user starts working in it) and leaves the others as they are. */
function ensureOverlayVisible(
  key: OverlayKey | null,
  get: () => { overlayVisible: OverlayVisibility },
  set: (patch: { overlayVisible: OverlayVisibility }) => void
) {
  if (!key || get().overlayVisible[key]) return;
  const next = { ...get().overlayVisible, [key]: true };
  set({ overlayVisible: next });
  saveOverlayVisibility(next);
}

export const useAppStore = create<AppState>((set, get) => ({
  project: null,
  currentProject: null,
  projectPlans: [],
  projectComparisons: [],
  newRoomTemplate: null,
  currentPage: 1,
  numPages: 1,
  toolMode: 'select',
  selectedRoomId: null,
  manuallyCreatedRoomId: null,
  calibrationPoints: [],
  drawingPoints: [],
  drawTarget: 'room',
  barsDrawing: null, stirrupDrawing: null,
  selectedConcreteId: null,
  selectedRebarId: null, selectedDrawnBarId: null, selectedStirrupPlacementId: null,
  concreteKind: 'slab',
  measureTool: null,
  measurePoints: [],
  markupTool: null,
  markupPoints: [],
  markupColor: '#ef4444',
  markupOrtho: false,
  markupFontScale: 1,
  selectedMarkupId: null,
  areaShape: 'polygon',
  areaCalcMode: 'footprint',
  pendingAreaKind: null,
  orthoSnap: false,
  quantitiesOpen: false,
  quantitiesHeight: 320,
  quantitiesMaximized: false,
  quantityExportDialog: null,
  quantityExportBusy: null,
  overlayVisible: loadOverlayVisibility(),
  setOverlayVisible: (key, visible) => {
    const next = { ...get().overlayVisible, [key]: visible };
    set({ overlayVisible: next });
    saveOverlayVisibility(next);
  },
  dirty: false,
  saving: false,
  saveError: null,
  activeApartmentNumber: '',
  setActiveApartmentNumber: (apartmentNumber) => set({ activeApartmentNumber: apartmentNumber }),
  exportRegions: {},
  setExportRegion: (pageNumber, region) =>
    set((state) => {
      const next = { ...state.exportRegions };
      if (region) next[pageNumber] = region;
      else delete next[pageNumber];
      return { exportRegions: next };
    }),
  history: [],
  future: [],
  detecting: false,
  detectionProgress: 0,
  detectionLabel: '',
  detectionSummary: null,
  selectedDetectionCandidateId: null,
  detectionCandidates: [],
  detectionCandidatesPage: null,

  setProject: (p) => {
    historyTracker.discard();
    if (p) notePlanLoaded(p);
    // A project is always saved before it is opened (and on close), so a fresh switch starts clean.
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    set({
      project: p,
      dirty: false,
      saveError: null,
      currentPage: 1,
      selectedRoomId: null,
      selectedMarkupId: null,
      selectedConcreteId: null,
      selectedRebarId: null, selectedDrawnBarId: null, selectedStirrupPlacementId: null,
      drawTarget: 'room',
      barsDrawing: null, stirrupDrawing: null,
      exportRegions: {},
      activeApartmentNumber: '',
      history: [],
      future: [],
      detectionSummary: null,
      selectedDetectionCandidateId: null,
      detectionCandidates: [],
      detectionCandidatesPage: null,
      detecting: false,
      detectionProgress: 0,
    });
  },
  clearDetectionSummary: () => set({ detectionSummary: null }),

  // ---------- projects & plans ----------
  // Each plan is its own saved document. Only one is ever in memory (`project`); leaving it — to
  // another plan, the overview or home — always saves it first, so plans can never mix.

  openProject: async (projectId) => {
    const loaded = await loadProjectWithPlans(projectId);
    if (!loaded) return;
    get().setProject(null);
    set({ currentProject: loaded.project, projectPlans: loaded.plans, projectComparisons: loaded.comparisons });
  },
  closeProject: async () => {
    if (get().project && !(await get().closePlan())) return false;
    set({ currentProject: null, projectPlans: [], projectComparisons: [] });
    return true;
  },
  createProject: async (name) => {
    const now = Date.now();
    const project: Project = { id: uuid(), name, createdAt: now, updatedAt: now, planIds: [] };
    await dbSaveProject(project);
    trackProjectCreated(project.id);
    await get().openProject(project.id);
  },
  renameProject: (name) => {
    const { currentProject } = get();
    if (!currentProject) return;
    const updated = { ...currentProject, name, updatedAt: Date.now() };
    set({ currentProject: updated });
    void dbSaveProject(updated);
  },
  refreshProjectPlans: async () => {
    const { currentProject } = get();
    if (!currentProject) return;
    const loaded = await loadProjectWithPlans(currentProject.id);
    // The user may have left the project while this was loading (the logo goes straight home):
    // a stale result must not bring the closed project back.
    if (loaded && get().currentProject?.id === currentProject.id) {
      set({ currentProject: loaded.project, projectPlans: loaded.plans, projectComparisons: loaded.comparisons });
    }
  },
  openPlan: async (planId) => {
    const { project } = get();
    if (project?.id === planId) return true;
    if (project) {
      await get().persist();
      // A failed save keeps the current plan open rather than dropping its unsaved work.
      if (get().saveError) return false;
    }
    const plan = await loadPlan(planId);
    if (!plan) return false;
    get().setProject(plan);
    void get().refreshProjectPlans();
    return true;
  },
  closePlan: async () => {
    if (get().project) {
      await get().persist();
      if (get().saveError) return false;
    }
    get().setProject(null);
    await get().refreshProjectPlans();
    return true;
  },
  addPlan: async (file, name) => {
    const { currentProject } = get();
    if (!currentProject) return null;
    const plan = createEmptyPlan(name, file.name, currentProject.id);
    await savePdfBlob(plan.id, file);
    await dbSavePlan(plan);
    await dbSaveProject({ ...currentProject, planIds: [...currentProject.planIds, plan.id], updatedAt: Date.now() });
    trackPlanCreated(plan, 'upload', file.size, currentProject.planIds.length + 1);
    await get().refreshProjectPlans();
    return plan;
  },
  duplicatePlan: async (planId) => {
    const { currentProject, project } = get();
    if (!currentProject) return null;
    // Copy what the user sees: an open plan is saved first so the copy includes its latest edits.
    if (project?.id === planId) {
      await get().persist();
      if (get().saveError) return null;
    }
    const [source, blob] = await Promise.all([loadPlan(planId), loadPdfBlob(planId)]);
    if (!source) return null;
    const copy = clonePlanForDuplicate(source, t('defaultNames.copy', { name: source.name }));
    if (blob) await savePdfBlob(copy.id, blob);
    await dbSavePlan(copy);
    const planIds = [...currentProject.planIds];
    const at = planIds.indexOf(planId);
    planIds.splice(at < 0 ? planIds.length : at + 1, 0, copy.id);
    await dbSaveProject({ ...currentProject, planIds, updatedAt: Date.now() });
    trackPlanCreated(copy, 'duplicate', blob?.size, planIds.indexOf(copy.id) + 1);
    await get().refreshProjectPlans();
    return copy;
  },
  deletePlan: async (planId) => {
    if (get().project?.id === planId) get().setProject(null);
    await dbDeletePlan(planId);
    await get().refreshProjectPlans();
  },
  renamePlan: async (planId, name) => {
    if (get().project?.id === planId) {
      get().updateProjectMeta({ name });
      return;
    }
    const plan = await loadPlan(planId);
    if (!plan) return;
    await dbSavePlan({ ...plan, name, updatedAt: Date.now() });
    await get().refreshProjectPlans();
  },
  createComparison: async ({ name, apartmentNumber, original, revised }) => {
    const { currentProject } = get();
    if (!currentProject) return;
    // Same document and PDF layout the Compare start screen always created, plus its project.
    const comparison: Comparison = {
      ...createEmptyComparison(name, apartmentNumber, original.name, revised.map((f) => f.name)),
      projectId: currentProject.id,
    };
    await saveComparePdfBlob(comparison.id, 'original', original);
    await Promise.all(comparison.revisions.map((rev, i) => saveComparePdfBlob(comparison.id, `revision:${rev.id}`, revised[i])));
    await dbSaveComparison(comparison);
    await dbSaveProject({
      ...currentProject,
      comparisonIds: [...(currentProject.comparisonIds ?? []), comparison.id],
      updatedAt: Date.now(),
    });
    trackComparisonCreated(comparison);
    await get().refreshProjectPlans();
    useCompareStore.getState().setComparison(comparison);
  },
  openComparison: async (comparisonId) => {
    // Only reachable from the overview, where no plan is open — nothing of the takeoff is left in memory.
    const comparison = await loadComparison(comparisonId);
    if (!comparison) return;
    trackComparisonOpened(comparison);
    useCompareStore.getState().setComparison(comparison);
  },
  renameComparison: async (comparisonId, name) => {
    const comparison = await loadComparison(comparisonId);
    if (!comparison) return;
    await dbSaveComparison({ ...comparison, name, updatedAt: Date.now() });
    await get().refreshProjectPlans();
  },
  deleteComparison: async (comparisonId) => {
    await dbDeleteComparison(comparisonId);
    await get().refreshProjectPlans();
  },
  setNewRoomTemplate: (key) => set({ newRoomTemplate: key }),
  applyRoomTemplate: (roomId) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    if (!project) return;
    const room = project.rooms.find((r) => r.id === roomId);
    const profile = getRoomProfile(room?.roomType);
    if (!room || !profile) return;
    historyTracker.push(get, set, project);
    const workItems = buildWorkItemsForProfile(profile, project);
    const rooms = project.rooms.map((r) => (r.id === roomId ? { ...r, workItems } : r));
    const updated = { ...project, rooms, updatedAt: Date.now() };
    set({ project: updated });
    trackWorkItemsAdded(updated, workItems, 'apply_template');
    scheduleSave(get, set);
  },

  detectRooms: async () => {
    const { project, currentPage, detecting } = get();
    if (!project || detecting) return;
    // A rerun replaces the previous review session rather than piling onto it.
    set({ detecting: true, detectionProgress: 0, detectionLabel: t('detection.starting'), detectionSummary: null, detectionCandidates: [], detectionCandidatesPage: null });
    try {
      const { source } = await loadPdfPlanSource(project.id, () => loadPdfBlob(project.id), currentPage);
      const { rooms: detected, summary } = await runRoomDetection(source, {
        onProgress: (f, label) => set({ detectionProgress: f, detectionLabel: label }),
      });

      // The run is async: if the user moved to another page (or another project) meanwhile, these
      // results describe a page they are no longer reviewing. Drop them rather than letting stale
      // suggestions sit in state for a page that is not on screen.
      if (get().currentPage !== currentPage || get().project?.id !== project.id) return;

      // Detection produces *suggestions only*: nothing is written to the project, no history entry
      // and no autosave. A candidate becomes a room only when the user accepts it.
      const candidates: DetectionCandidate[] = detected.map((d) => ({
        id: uuid(),
        pageNumber: currentPage,
        points: d.polygon,
        suggestedName: d.name,
        roomTypeKey: d.roomTypeKey,
        confidence: d.confidence,
      }));
      set({
        detectionCandidates: candidates,
        detectionCandidatesPage: candidates.length > 0 ? currentPage : null,
        detectionSummary: summary,
      });
    } catch (err) {
      set({ detectionLabel: err instanceof Error ? err.message : t('detection.failed') });
    } finally {
      set({ detecting: false });
    }
  },
  selectDetectionCandidate: (id) => {
    const { project, currentPage, detectionCandidates } = get();
    const candidate = detectionCandidates.find(c => c.id === id && c.pageNumber === currentPage && c.localAi?.planId === project?.id);
    set({ selectedDetectionCandidateId: candidate?.id ?? null,
      ...(candidate ? { selectedRoomId: null, selectedMarkupId: null } : {}) });
  },
  editDetectionCandidate: (id, points) => {
    if (!canAuthorTakeoff()) return;
    const { project, currentPage } = get();
    set({ detectionCandidates: get().detectionCandidates.map(c => {
      if (c.id !== id || !c.localAi || c.localAi.planId !== project?.id || c.pageNumber !== currentPage) return c;
      return { ...c, originalPoints: c.originalPoints ?? c.points.map(p => ({ ...p })),
        originalValidationProblems: c.originalValidationProblems ?? [...(c.validationProblems ?? [])],
        points: points.map(p => ({ ...p })), validationProblems: candidateGeometryProblems(points, c.localAi),
        ...(c.localAi.targetPoint?{localAi:{...c.localAi,overlapWarnings:overlapNotes(points,project?.rooms??[],currentPage)},reviewedWarningIds:c.reviewedWarningIds?.filter(id=>!id.startsWith('overlap:'))}:{}) };
    }) });
  },
  restoreDetectionCandidate: (id) => {
    const candidate = get().detectionCandidates.find(c => c.id === id);
    if (!candidate?.originalPoints || !canAuthorTakeoff() || candidate.localAi?.planId !== get().project?.id || candidate.pageNumber !== get().currentPage) return;
    set({ detectionCandidates: get().detectionCandidates.map(c => c.id === id ? { ...c,
      points: candidate.originalPoints!.map(p => ({ ...p })), validationProblems: [...(candidate.originalValidationProblems ?? [])],
      ...(c.localAi?.targetPoint?{localAi:{...c.localAi,overlapWarnings:overlapNotes(candidate.originalPoints!,get().project?.rooms??[],get().currentPage)},reviewedWarningIds:c.reviewedWarningIds?.filter(id=>!id.startsWith('overlap:'))}:{}) } : c) });
  },
  setDetectionWarningReviewed: (id, warningId, reviewed) => {
    const { project, currentPage } = get();
    set({ detectionCandidates: get().detectionCandidates.map(c => {
      if (c.id !== id || c.localAi?.planId !== project?.id || !c.localAi || c.pageNumber !== currentPage ||
          !aiWarnings(c.localAi).some(w => w.id === warningId)) return c;
      const ids = new Set(c.reviewedWarningIds ?? []);
      if (reviewed) ids.add(warningId); else ids.delete(warningId);
      return { ...c, reviewedWarningIds: [...ids] };
    }) });
  },
  setAllDetectionWarningsReviewed: (reviewed) => {
    const { project, currentPage } = get();
    set({ detectionCandidates: get().detectionCandidates.map(c =>
      c.localAi && c.localAi.planId === project?.id && c.pageNumber === currentPage
        ? { ...c, reviewedWarningIds: reviewed ? aiWarnings(c.localAi).map(w => w.id) : [] } : c) });
  },
  setDetectionCandidateType: (id, key) => {
    if (!canAuthorTakeoff() || (key !== null && !getRoomProfile(key))) return;
    const { project, currentPage } = get();
    set({ detectionCandidates: get().detectionCandidates.map(c =>
      c.id === id && c.localAi?.planId === project?.id && c.pageNumber === currentPage
        ? { ...c, roomTypeKey: key, semanticTypeEdited: true, semanticTypeConfirmed: false } : c) });
  },
  confirmDetectionCandidateType: (id) => {
    if (!canAuthorTakeoff()) return;
    const { project, currentPage } = get();
    set({ detectionCandidates: get().detectionCandidates.map(c =>
      c.id === id && c.localAi?.planId === project?.id && c.pageNumber === currentPage && getRoomProfile(aiCandidateTypeKey(c))
        ? { ...c, semanticTypeConfirmed: true } : c) });
  },
  acceptDetectionCandidate: (candidateId) => {
    const { project, detectionCandidates } = get();
    if (!project) return null;
    const candidate = detectionCandidates.find((c) => c.id === candidateId && c.pageNumber === get().currentPage);
    if (!candidate || !canAuthorTakeoff() || !candidateCanBeAccepted(candidate, project, get().currentPage)) return null;

    historyTracker.push(get, set, project);
    const room = roomFromCandidate(candidate, project, project.rooms.length, get().activeApartmentNumber);
    set({
      project: { ...project, rooms: [...project.rooms, room], updatedAt: Date.now() },
      // The candidate leaves the review list; the rest stay for review. Candidates are session
      // state, so an undo of this room does not bring the suggestion back — that is fine.
      detectionCandidates: detectionCandidates.filter((c) => c.id !== candidateId),
      selectedDetectionCandidateId: get().selectedDetectionCandidateId === candidateId ? null : get().selectedDetectionCandidateId,
      selectedRoomId: room.id,
    });
    scheduleSave(get, set);
    return room.id;
  },
  acceptAllDetectionCandidates: () => {
    const { project, detectionCandidates, currentPage } = get();
    if (!project || !canAuthorTakeoff()) return 0;
    // Only valid suggestions on the current source page are accepted. Blocked suggestions
    // remain in the review list so their validation problems can be inspected or rejected.
    const accepted = detectionCandidates.filter((c) => candidateCanBeAccepted(c, project, currentPage));
    if (accepted.length === 0) return 0;

    // One push for the whole batch: a single undo removes every room it created.
    historyTracker.push(get, set, project);
    let seed = project.rooms.length;
    const activeApartment = get().activeApartmentNumber;
    const rooms = accepted.map((c) => roomFromCandidate(c, project, seed++, activeApartment));
    set({
      project: { ...project, rooms: [...project.rooms, ...rooms], updatedAt: Date.now() },
      selectedDetectionCandidateId: accepted.some(c => c.id === get().selectedDetectionCandidateId) ? null : get().selectedDetectionCandidateId,
      detectionCandidates: detectionCandidates.filter(c => !accepted.some(a => a.id === c.id)),
      detectionCandidatesPage: detectionCandidates.length > accepted.length ? currentPage : null,
      selectedRoomId: null,
    });
    scheduleSave(get, set);
    return rooms.length;
  },
  rejectDetectionCandidate: (candidateId) => {
    // Pure session state: no project change, no history, no save.
    const remaining = get().detectionCandidates.filter((c) => c.id !== candidateId);
    set({ selectedDetectionCandidateId: get().selectedDetectionCandidateId === candidateId ? null : get().selectedDetectionCandidateId, detectionCandidates: remaining, detectionCandidatesPage: remaining.length > 0 ? get().detectionCandidatesPage : null });
  },
  clearDetectionCandidates: () => {
    if (get().detectionCandidates.length === 0 && get().detectionCandidatesPage === null) return;
    set({ selectedDetectionCandidateId: null, detectionCandidates: [], detectionCandidatesPage: null });
  },
  autoCalculateQuantities: () => {
    const { project, currentPage } = get();
    if (!project) return 0;
    // Only fill in rooms on this page that were detected and have no work items yet, so re-running
    // (or running after manual edits) never duplicates or overwrites the user's own choices.
    const targets = project.rooms.filter((r) => r.pageNumber === currentPage && r.detectedType && r.workItems.length === 0);
    if (targets.length === 0) return 0;
    historyTracker.push(get, set, project);
    const targetIds = new Set(targets.map((r) => r.id));
    const rooms = project.rooms.map((r) => {
      if (!targetIds.has(r.id)) return r;
      // A type the user confirmed wins over the detected guess; both go through the same builder.
      const profile = getRoomProfile(r.roomType ?? r.detectedType);
      if (!profile) return r;
      return { ...r, workItems: buildWorkItemsForProfile(profile, project) };
    });
    set({ project: { ...project, rooms, updatedAt: Date.now() } });
    scheduleSave(get, set);
    return targets.length;
  },
  undo: () => {
    historyTracker.flush(get, set);
    const { project, history, future } = get();
    if (!project || history.length === 0) return;
    const previous = history[history.length - 1];
    set({ project: previous, history: history.slice(0, -1), future: [project, ...future], selectedRoomId: null, selectedConcreteId: null, selectedRebarId: null, selectedDrawnBarId: null, selectedStirrupPlacementId: null });
    scheduleSave(get, set);
  },
  redo: () => {
    // Same as undo: a mutation still sitting in the history debounce has to be recorded first, or
    // redo would restore a future snapshot on top of an un-snapshotted change. (Recording it also
    // clears `future`, which is correct — a new edit invalidates the redo stack.)
    historyTracker.flush(get, set);
    const { project, history, future } = get();
    if (!project || future.length === 0) return;
    const next = future[0];
    set({ project: next, history: [...history, project], future: future.slice(1), selectedRoomId: null, selectedConcreteId: null, selectedRebarId: null, selectedDrawnBarId: null, selectedStirrupPlacementId: null });
    scheduleSave(get, set);
  },
  setCurrentPage: (n) => {
    // Selecting a room from the list re-sets the page it is already on; that must not throw away a
    // detection review the user is in the middle of. Candidates are tied to a page, so they are
    // dropped only when the page actually changes.
    const pageChanged = n !== get().currentPage;
    set({
      currentPage: n,
      ...(pageChanged ? { selectedDetectionCandidateId: null, detectionCandidates: [], detectionCandidatesPage: null } : {}),
      selectedRoomId: null,
      selectedMarkupId: null,
      selectedConcreteId: null,
      selectedRebarId: null, selectedDrawnBarId: null, selectedStirrupPlacementId: null,
      barsDrawing: null, stirrupDrawing: null,
      drawingPoints: [],
      calibrationPoints: [],
      measurePoints: [],
      markupPoints: [],
    });
  },
  setNumPages: (n) => set({ numPages: n }),
  setToolMode: (m) => {
    if (!canUseToolMode(m) || (m === 'measure' && !canUseMeasureTool(get().measureTool)) || (m === 'markup' && !canUseMarkupTool(get().markupTool))) return;
    useFieldWorkflowStore.getState().setGeometryAction('browse');
    useFieldWorkflowStore.getState().setCalibrationDialog(false);
    useFieldWorkflowStore.getState().setDraft(isTouchInput() && m !== 'select' && m !== 'pan');
    set({
      selectedDetectionCandidateId: null,
      toolMode: m,
      barsDrawing: null, stirrupDrawing: null,
      calibrationPoints: [],
      drawingPoints: [],
      measurePoints: [],
      markupPoints: [],
    });
    ensureOverlayVisible(overlayForTool(m, get().drawTarget), get, set);
  },
  setSelectedRoomId: (id) => set({ selectedRoomId: id, ...(id ? { selectedDetectionCandidateId: null } : {}) }),

  addCalibrationPoint: (p) => {
    if (!canAuthorTakeoff()) return;
    const pts = [...get().calibrationPoints, p];
    set({ calibrationPoints: pts.slice(-2) });
  },
  clearCalibrationPoints: () => set({ calibrationPoints: [] }),
  applyCalibration: (realDistanceMeters) => {
    if (!canAuthorTakeoff()) return;
    const { project, calibrationPoints, currentPage } = get();
    if (!project || calibrationPoints.length !== 2 || realDistanceMeters <= 0) return;
    const [a, b] = calibrationPoints;
    const pixelDistance = Math.hypot(b.x - a.x, b.y - a.y);
    if (pixelDistance === 0) return;
    const calibration: Calibration = {
      pixelDistance,
      realDistanceMeters,
      metersPerPixel: realDistanceMeters / pixelDistance,
    };
    const pages = {
      ...project.pages,
      [currentPage]: { pageNumber: currentPage, calibration },
    };
    historyTracker.push(get, set, project);
    const updated = { ...project, pages, updatedAt: Date.now() };
    set({ project: updated, calibrationPoints: [], toolMode: 'select' });
    trackCalibrationCompleted(updated, !!project.pages[currentPage]?.calibration, get().numPages);
    scheduleSave(get, set);
  },

  addDrawingPoint: (p) => { if (canAuthorTakeoff()) set({ drawingPoints: [...get().drawingPoints, p] }); },
  clearDrawingPoints: () => set({ drawingPoints: [] }),
  // Changing the target drops a shape in progress: it was started for the previous target.
  setDrawTarget: (target) => {
    if (get().drawTarget === target) return;
    set({ drawTarget: target, drawingPoints: [], barsDrawing: null, stirrupDrawing: null });
    ensureOverlayVisible(overlayForTool(get().toolMode, target), get, set);
  },
  setSelectedConcreteId: (id) => set({ selectedConcreteId: id }),
  setConcreteKind: (kind) => set({ concreteKind: kind }),
  updateConcreteElement: (id, patch) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    if (!project) return;
    historyTracker.pushDebounced(get, set, project);
    set({ project: { ...updateConcrete(project, id, patch), updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  addRebarStirrup: () => {
    if (!canAuthorTakeoff()) return;
    const { project, currentPage } = get();
    if (!project) return;
    const item = newRebarStirrup(project, currentPage);
    ensureOverlayVisible('rebar', get, set);
    historyTracker.push(get, set, project);
    set({ project: { ...addRebarItem(project, item), updatedAt: Date.now() }, selectedRebarId: item.id,
      selectedDrawnBarId: null, selectedStirrupPlacementId: null, barsDrawing: null, stirrupDrawing: null, drawingPoints: [], toolMode: 'select' });
    scheduleSave(get, set);
  },
  duplicateStirrupItem: (id) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    const source = project && rebarOf(project).find((i) => i.id === id);
    if (!project || !source || source.kind !== 'stirrup') return;
    const copy = { ...structuredClone(source), id: uuid() };
    if (!hasManualMark(copy)) copy.autoNumber = nextAutoNumber(rebarOf(project), 'stirrup');
    copy.placements = copy.placements.map((p) => {
      if (p.kind === 'area') return { ...p, id: uuid(), points: structuralDuplicatePoints(project, p.pageNumber, p.points) };
      const [start, end] = structuralDuplicatePoints(project, p.pageNumber, [p.start, p.end]);
      return { ...p, id: uuid(), start, end };
    });
    historyTracker.push(get, set, project);
    set({ project: { ...addRebarItem(project, copy), updatedAt: Date.now() }, selectedRebarId: copy.id,
      selectedStirrupPlacementId: null, selectedDrawnBarId: null, barsDrawing: null, stirrupDrawing: null, drawingPoints: [], toolMode: 'select' });
    scheduleSave(get, set);
  },
  duplicateStirrupPlacement: (id, placementId) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    const item = project && rebarOf(project).find((i) => i.id === id);
    const source = item?.kind === 'stirrup' ? item.placements.find((p) => p.id === placementId) : undefined;
    if (!project || !item || item.kind !== 'stirrup' || !source) return;
    const copied = structuredClone(source);
    let placement: StirrupPlacement;
    if (copied.kind === 'area') placement = { ...copied, id: uuid(), points: structuralDuplicatePoints(project, copied.pageNumber, copied.points) };
    else {
      const [start, end] = structuralDuplicatePoints(project, copied.pageNumber, [copied.start, copied.end]);
      placement = { ...copied, id: uuid(), start, end };
    }
    historyTracker.push(get, set, project);
    set({ project: { ...updateRebar(project, id, { placements: [...item.placements, placement] }), updatedAt: Date.now() } });
    get().selectStirrupPlacement(id, placement.id);
    scheduleSave(get, set);
  },
  startStirrupPlacement: (id, kind) => {
    useFieldWorkflowStore.getState().setDraft(isTouchInput());
    useFieldWorkflowStore.getState().setGeometryAction('browse');
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    const item = project && rebarOf(project).find((i) => i.id === id);
    if (!item || item.kind !== 'stirrup') return;
    ensureOverlayVisible('rebar', get, set);
    set({ selectedRebarId: id, selectedStirrupPlacementId: null, selectedDrawnBarId: null,
      drawTarget: 'rebar', barsDrawing: null, stirrupDrawing: kind, toolMode: kind === 'line' ? 'draw' : 'draw-rect', drawingPoints: [] });
  },
  finishStirrupLine: (start, end) => {
    if (!canAuthorTakeoff()) return;
    const { project, selectedRebarId, currentPage, stirrupDrawing } = get();
    const item = project && rebarOf(project).find((i) => i.id === selectedRebarId);
    if (!project || !item || item.kind !== 'stirrup' || stirrupDrawing !== 'line' || Math.hypot(end.x - start.x, end.y - start.y) < 1e-9) return;
    const placement: StirrupPlacement = { id: uuid(), kind: 'line', pageNumber: currentPage, start: { ...start }, end: { ...end }, spacingM: 0.2, quantityMode: 'automatic' };
    historyTracker.push(get, set, project);
    set({ project: { ...updateRebar(project, item.id, { placements: [...item.placements, placement] }), updatedAt: Date.now() },
      selectedStirrupPlacementId: placement.id, stirrupDrawing: null, drawingPoints: [], toolMode: 'select' });
    scheduleSave(get, set);
  },
  editStirrupShape: (id, shape) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    if (!project || !rebarOf(project).some((item) => item.id === id && item.kind === 'stirrup')) return;
    historyTracker.push(get, set, project);
    set({ project: { ...updateRebar(project, id, { shape }), updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  editStirrupPlacement: (id, placement, debounced = false) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    const item = project && rebarOf(project).find((i) => i.id === id);
    if (!project || !item || item.kind !== 'stirrup') return;
    const previous = item.placements.find((p) => p.id === placement.id && p.kind === placement.kind);
    if (!previous || JSON.stringify(previous) === JSON.stringify(placement)) return;
    const points = placement.kind === 'line' ? [placement.start, placement.end] : placement.points;
    if (!points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return;
    if (placement.kind === 'line' && Math.hypot(placement.end.x - placement.start.x, placement.end.y - placement.start.y) < 1e-9) return;
    if (placement.kind === 'area' && !isRectangle(placement.points)) return;
    if (debounced) historyTracker.pushDebounced(get, set, project);
    else historyTracker.push(get, set, project);
    set({ project: { ...updateRebar(project, id, { placements: item.placements.map((p) => p.id === placement.id ? structuredClone(placement) : p) }), updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  deleteStirrupPlacement: (id, placementId) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    const item = project && rebarOf(project).find((i) => i.id === id);
    if (!project || !item || item.kind !== 'stirrup' || !item.placements.some((p) => p.id === placementId)) return;
    historyTracker.push(get, set, project);
    set({ project: { ...updateRebar(project, id, { placements: item.placements.filter((p) => p.id !== placementId) }), updatedAt: Date.now() },
      selectedStirrupPlacementId: get().selectedStirrupPlacementId === placementId ? null : get().selectedStirrupPlacementId,
      ...(get().selectedStirrupPlacementId === placementId ? { stirrupDrawing: null, drawingPoints: [], toolMode: 'select' as const } : {}) });
    scheduleSave(get, set);
  },
  selectStirrupPlacement: (id, placementId) => {
    const { project } = get();
    const item = project && rebarOf(project).find((i) => i.id === id);
    const placement = item?.kind === 'stirrup' ? item.placements.find((p) => p.id === placementId) : undefined;
    if (!placement) return;
    get().setCurrentPage(placement.pageNumber);
    set({ selectedRebarId: id, selectedStirrupPlacementId: placementId, drawTarget: 'rebar', toolMode: 'select' });
  },
  setSelectedDrawnBarId: (id) => set({ selectedDrawnBarId: id }),
  editDrawnBar: (itemId, bar) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    const item = project && rebarOf(project).find((i) => i.id === itemId);
    if (!project || !item || item.kind !== 'bars' || !item.drawnBars?.some((b) => b.id === bar.id)) return;
    const coords = [bar.start.x, bar.start.y, bar.end.x, bar.end.y];
    if (!coords.every(Number.isFinite) || Math.hypot(bar.end.x - bar.start.x, bar.end.y - bar.start.y) < 1e-9) return;
    historyTracker.push(get, set, project);
    set({ project: { ...updateRebar(project, itemId, { drawnBars: item.drawnBars.map((b) => b.id === bar.id ? structuredClone(bar) : b) }), updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  resizeDrawnBar: (itemId, barId, lengthM) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    const item = project && rebarOf(project).find((i) => i.id === itemId);
    const bar = item?.kind === 'bars' ? item.drawnBars?.find((b) => b.id === barId) : undefined;
    if (!project || !bar) return;
    const resized = resizeStraightBar(bar, lengthM, project.pages[bar.pageNumber]?.calibration?.metersPerPixel ?? 0);
    if (!resized || !item || item.kind !== 'bars' || !item.drawnBars) return;
    historyTracker.pushDebounced(get, set, project);
    set({ project: { ...updateRebar(project, itemId, { drawnBars: item.drawnBars.map((b) => b.id === barId ? resized : b) }), updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  duplicateDrawnBar: (itemId, barId) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    const item = project && rebarOf(project).find((i) => i.id === itemId);
    const source = item?.kind === 'bars' ? item.drawnBars?.find((bar) => bar.id === barId) : undefined;
    if (!project || !item || item.kind !== 'bars' || !source) return;
    const [start, end] = structuralDuplicatePoints(project, source.pageNumber, [source.start, source.end]);
    const bar = { ...structuredClone(source), id: uuid(), start, end };
    historyTracker.push(get, set, project);
    set({ project: { ...updateRebar(project, itemId, { drawnBars: [...(item.drawnBars ?? []), bar] }), updatedAt: Date.now() }, selectedDrawnBarId: bar.id });
    scheduleSave(get, set);
  },
  deleteDrawnBar: (itemId, barId) => {
    if (!canAuthorTakeoff()) return;
    const { project, selectedDrawnBarId } = get();
    const item = project && rebarOf(project).find((i) => i.id === itemId);
    if (!project || !item || item.kind !== 'bars' || !item.drawnBars?.some((bar) => bar.id === barId)) return;
    historyTracker.push(get, set, project);
    set({ project: { ...updateRebar(project, itemId, { drawnBars: item.drawnBars.filter((bar) => bar.id !== barId) }), updatedAt: Date.now() },
      selectedDrawnBarId: selectedDrawnBarId === barId ? null : selectedDrawnBarId });
    scheduleSave(get, set);
  },
  setBarsIndividualMode: (id) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    const item = project && rebarOf(project).find((i) => i.id === id);
    if (!project || !item || item.kind !== 'bars' || item.barsZone || item.drawnBars !== undefined) return;
    historyTracker.push(get, set, project);
    set({ project: { ...updateRebar(project, id, { drawnBars: [] }), updatedAt: Date.now() }, drawingPoints: [], barsDrawing: null, stirrupDrawing: null });
    scheduleSave(get, set);
  },
  startDrawingBar: (id) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    const item = project && rebarOf(project).find((i) => i.id === id);
    if (!item || item.kind !== 'bars' || item.barsZone) return;
    get().setBarsIndividualMode(id);
    get().setCurrentPage(item.pageNumber);
    ensureOverlayVisible('rebar', get, set);
    useFieldWorkflowStore.getState().setGeometryAction('browse');
    useFieldWorkflowStore.getState().setDraft(isTouchInput());
    set({ selectedRebarId: id, selectedDrawnBarId: null, selectedStirrupPlacementId: null, drawTarget: 'rebar', barsDrawing: 'line', toolMode: 'draw', drawingPoints: [] });
  },
  finishDrawnBar: (start, end) => {
    if (!canAuthorTakeoff()) return;
    const { project, selectedRebarId, currentPage, barsDrawing } = get();
    const item = project && rebarOf(project).find((i) => i.id === selectedRebarId);
    if (!project || !item || item.kind !== 'bars' || item.barsZone || barsDrawing !== 'line' || item.pageNumber !== currentPage) return;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-9) return;
    const bar = { id: uuid(), pageNumber: currentPage, start: { ...start }, end: { ...end } };
    historyTracker.push(get, set, project);
    set({ project: { ...updateRebar(project, item.id, { drawnBars: [...(item.drawnBars ?? []), bar] }), updatedAt: Date.now() }, drawingPoints: [], selectedDrawnBarId: bar.id });
    scheduleSave(get, set);
  },
  removeDrawnBarsLayout: (id) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    const item = project && rebarOf(project).find((i) => i.id === id);
    if (!project || !item || item.kind !== 'bars' || item.drawnBars === undefined) return;
    historyTracker.push(get, set, project);
    set({ project: { ...updateRebar(project, id, { drawnBars: undefined, count: 0, lengthM: 0 }), updatedAt: Date.now() },
      selectedDrawnBarId: null, selectedStirrupPlacementId: null, barsDrawing: null, stirrupDrawing: null, drawingPoints: [], toolMode: 'select' });
    scheduleSave(get, set);
  },
  duplicateStraightBars: (id) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    const source = project && rebarOf(project).find((i) => i.id === id);
    if (!project || !source || source.kind !== 'bars') return;
    const copy = { ...structuredClone(source), id: uuid() };
    if (!hasManualMark(copy)) copy.autoNumber = nextAutoNumber(rebarOf(project), 'bars');
    if (copy.barsZone) copy.barsZone.points = structuralDuplicatePoints(project, copy.barsZone.pageNumber, copy.barsZone.points);
    if (copy.drawnBars !== undefined) {
      const offset = structuralDuplicatePoints(project, source.pageNumber, [{ x: 0, y: 0 }])[0];
      copy.drawnBars = copy.drawnBars.map((bar) => ({ ...translateBar(bar, offset), id: uuid() }));
    }
    historyTracker.push(get, set, project);
    set({ project: { ...addRebarItem(project, copy), updatedAt: Date.now() }, selectedRebarId: copy.id,
      selectedDrawnBarId: null, selectedStirrupPlacementId: null, barsDrawing: null, stirrupDrawing: null, drawingPoints: [], toolMode: 'select' });
    scheduleSave(get, set);
  },
  startBarsZone: (id) => {
    useFieldWorkflowStore.getState().setDraft(isTouchInput());
    useFieldWorkflowStore.getState().setGeometryAction('browse');
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    const item = project && rebarOf(project).find((i) => i.id === id);
    if (!item || item.kind !== 'bars' || item.drawnBars !== undefined) return;
    ensureOverlayVisible('rebar', get, set);
    set({ selectedRebarId: id, selectedDrawnBarId: null, selectedStirrupPlacementId: null, drawTarget: 'rebar', barsDrawing: 'zone', toolMode: 'draw-rect', drawingPoints: [] });
  },
  removeBarsZone: (id) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    const item = project && rebarOf(project).find((i) => i.id === id);
    if (!project || !item || item.kind !== 'bars' || !item.barsZone) return;
    const resolved = resolveStraightBars(item, project.pages[item.pageNumber]?.calibration ?? null);
    historyTracker.push(get, set, project);
    set({ project: { ...updateRebar(project, id, { barsZone: undefined, lengthM: resolved.effectiveLengthM ?? item.lengthM }), updatedAt: Date.now() },
      barsDrawing: null, stirrupDrawing: null, drawingPoints: [], toolMode: 'select' });
    scheduleSave(get, set);
  },
  editAreaGeometry: (kind, id, points, placementId) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    if (!project || points.length < 3 || !points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) || polygonAreaPx(points) <= 1e-9) return;
    if (kind === 'stirrup') {
      const item = rebarOf(project).find((i) => i.id === id);
      const placement = item?.kind === 'stirrup' ? item.placements.find((p) => p.id === placementId) : undefined;
      if (placement?.kind !== 'area' || !isRectangle(points)) return;
      if (placement.points.every((point, index) => point.x === points[index]?.x && point.y === points[index]?.y)) return;
      get().editStirrupPlacement(id, { ...placement, points: structuredClone(points) });
      return;
    }
    const source = kind === 'room' ? project.rooms.find((room) => room.id === id)
      : kind === 'concrete' ? concreteOf(project).find((element) => element.id === id)
      : rebarOf(project).find((item) => item.id === id && item.kind === (kind === 'bars' ? 'bars' : 'mesh'));
    if (!source) return;
    const previous = 'points' in source ? source.points : 'kind' in source && source.kind === 'bars' ? source.barsZone?.points : undefined;
    if (!previous || (kind === 'bars' && !isRectangle(points))) return;
    if (previous.length === points.length && previous.every((point, index) => point.x === points[index].x && point.y === points[index].y)) return;
    const geometry = structuredClone(points);
    const next = kind === 'room' ? { ...project, rooms: project.rooms.map((room) => room.id === id ? { ...room, points: geometry } : room) }
      : kind === 'concrete' ? updateConcrete(project, id, { points: geometry })
      : 'kind' in source && source.kind === 'bars' && source.barsZone
        ? updateRebar(project, id, { barsZone: { ...source.barsZone, points: geometry } })
        : updateRebar(project, id, { points: geometry });
    historyTracker.push(get, set, project);
    set({ project: { ...next, updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  moveStructuralZone: (kind, id, offset) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    if (!project || (!offset.x && !offset.y) || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) return;
    const source = kind === 'concrete'
      ? concreteOf(project).find((element) => element.id === id)
      : rebarOf(project).find((item) => item.id === id);
    if (!source) return;
    const original = 'points' in source ? source.points : source.kind === 'bars' ? source.barsZone?.points : undefined;
    if (!original && !(source.kind === 'bars' && source.drawnBars?.length)) return;
    const points = original?.map((point) => ({ ...point, x: point.x + offset.x, y: point.y + offset.y })) ?? [];
    const next = kind === 'concrete' ? updateConcrete(project, id, { points })
      : source.kind === 'bars' && source.drawnBars ? updateRebar(project, id, { drawnBars: source.drawnBars.map((bar) => translateBar(bar, offset)) })
      : source.kind === 'bars' && source.barsZone ? updateRebar(project, id, { barsZone: { ...source.barsZone, points } })
      : updateRebar(project, id, { points });
    historyTracker.push(get, set, project);
    set({ project: { ...next, updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  duplicateConcreteElement: (id) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    const source = project && concreteOf(project).find((element) => element.id === id);
    if (!project || !source) return;
    const copy = { ...structuredClone(source), id: uuid(), points: structuralDuplicatePoints(project, source.pageNumber, source.points) };
    if (!hasManualMark(copy)) copy.autoNumber = nextAutoNumber(concreteOf(project), copy.kind);
    historyTracker.push(get, set, project);
    set({ project: { ...addConcreteElement(project, copy), updatedAt: Date.now() }, selectedConcreteId: copy.id });
    scheduleSave(get, set);
  },
  changeConcreteElementKind: (id, kind) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    if (!project) return;
    const next = changeKind(project, id, kind);
    if (next === project) return;
    historyTracker.push(get, set, project);
    set({ project: { ...next, updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  copyRoomsToConcrete: (roomIds) => {
    if (!canAuthorTakeoff()) return 0;
    const { project, concreteKind } = get();
    if (!project) return 0;
    const wanted = new Set(roomIds);
    const { plan, created } = addConcreteFromRooms(project, project.rooms.filter((r) => wanted.has(r.id)), concreteKind);
    if (created.length === 0) return 0;
    ensureOverlayVisible('concrete', get, set);
    historyTracker.push(get, set, project);
    set({ project: { ...plan, updatedAt: Date.now() } });
    if (created.length === 1) {
      get().setCurrentPage(created[0].pageNumber);
      set({ selectedConcreteId: created[0].id });
    }
    scheduleSave(get, set);
    return created.length;
  },
  setSelectedRebarId: (id) => set({ selectedRebarId: id, selectedDrawnBarId: null, selectedStirrupPlacementId: null, barsDrawing: null, stirrupDrawing: null, drawingPoints: [] }),
  editMeshLayout: (id, level, edit) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    const mesh = project && rebarOf(project).find((i) => i.id === id && i.kind === 'mesh');
    if (!project || !mesh || mesh.kind !== 'mesh') return;
    const next = editManualMeshLayout(mesh, project.pages[mesh.pageNumber]?.calibration ?? null, level, edit, uuid);
    if (next === mesh) return;
    historyTracker.push(get, set, project);
    set({ project: { ...updateRebar(project, id, { manualLayouts: next.manualLayouts }), updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  updateRebarItem: (id, patch) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    if (!project) return;
    historyTracker.pushDebounced(get, set, project);
    set({ project: { ...updateRebar(project, id, patch), updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  addRebarBars: () => {
    if (!canAuthorTakeoff()) return;
    const { project, currentPage } = get();
    if (!project) return;
    historyTracker.push(get, set, project);
    const bars = newRebarBars(project, currentPage);
    set({ project: { ...addRebarItem(project, bars), updatedAt: Date.now() }, selectedRebarId: bars.id, selectedDrawnBarId: null, selectedStirrupPlacementId: null, barsDrawing: null, stirrupDrawing: null, drawingPoints: [], toolMode: 'select' });
    scheduleSave(get, set);
  },
  duplicateRebarMesh: (id) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    const source = project && rebarOf(project).find((item) => item.id === id);
    if (!project || !source || source.kind !== 'mesh') return;
    const copy = {
      ...renewManualMeshSheetIds(withRenewedLayerIds(structuredClone(source)), uuid),
      id: uuid(),
      points: structuralDuplicatePoints(project, source.pageNumber, source.points),
    };
    historyTracker.push(get, set, project);
    set({ project: { ...addRebarItem(project, copy), updatedAt: Date.now() }, selectedRebarId: copy.id });
    scheduleSave(get, set);
  },
  deleteRebarItem: (id) => {
    if (!canAuthorTakeoff()) return;
    const { project, selectedRebarId } = get();
    if (!project) return;
    historyTracker.push(get, set, project);
    set({ project: { ...removeRebarItem(project, id), updatedAt: Date.now() }, selectedRebarId: selectedRebarId === id ? null : selectedRebarId,
      ...(selectedRebarId === id ? { selectedDrawnBarId: null, selectedStirrupPlacementId: null, barsDrawing: null, stirrupDrawing: null, drawingPoints: [] } : {}) });
    scheduleSave(get, set);
  },
  setRebarMeshLevels: (id, choice) => {
    const { project } = get();
    if (!project) return;
    const next = setMeshLevels(project, id, choice);
    if (next === project) return;
    historyTracker.push(get, set, project);
    set({ project: { ...next, updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  setRebarMeshReinforcement: (id, level, reinforcement) => {
    const { project } = get();
    if (!project) return;
    const next = setMeshReinforcement(project, id, level, reinforcement);
    if (next === project) return;
    historyTracker.pushDebounced(get, set, project);
    set({ project: { ...next, updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  copyRebarBottomToTop: (id) => {
    const { project } = get();
    if (!project) return;
    const next = copyBottomToTop(project, id);
    if (next === project) return;
    historyTracker.push(get, set, project);
    set({ project: { ...next, updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  copyRoomsToRebar: (roomIds) => {
    const { project } = get();
    if (!project) return 0;
    const wanted = new Set(roomIds);
    const { plan, created } = addRebarMeshFromRooms(project, project.rooms.filter((r) => wanted.has(r.id)));
    if (created.length === 0) return 0;
    ensureOverlayVisible('rebar', get, set);
    historyTracker.push(get, set, project);
    set({ project: { ...plan, updatedAt: Date.now() } });
    if (created.length === 1) {
      get().setCurrentPage(created[0].pageNumber);
      set({ selectedRebarId: created[0].id });
    }
    scheduleSave(get, set);
    return created.length;
  },
  deleteConcreteElement: (id) => {
    if (!canAuthorTakeoff()) return;
    const { project, selectedConcreteId } = get();
    if (!project) return;
    historyTracker.push(get, set, project);
    set({
      project: { ...removeConcreteElement(project, id), updatedAt: Date.now() },
      selectedConcreteId: selectedConcreteId === id ? null : selectedConcreteId,
    });
    scheduleSave(get, set);
  },
  finishDrawing: () => {
    if (!canAuthorTakeoff()) return;
    if (get().barsDrawing === 'line' || get().stirrupDrawing === 'line') return;
    if (get().drawTarget !== 'room') return commitStructuralZone(get, set, get().drawingPoints);
    const { project, drawingPoints, currentPage, activeApartmentNumber } = get();
    if (!project || drawingPoints.length < 3) {
      set({ drawingPoints: [] });
      return;
    }
    historyTracker.push(get, set, project);
    const room = newRoom(project, currentPage, drawingPoints, activeApartmentNumber, get().newRoomTemplate);
    const updated = { ...project, rooms: [...project.rooms, room], updatedAt: Date.now() };
    set({ project: updated, drawingPoints: [], selectedRoomId: room.id, manuallyCreatedRoomId: room.id, toolMode: 'select' });
    trackRoomDrawn(updated, room, 'polygon');
    scheduleSave(get, set);
  },
  finishRectangle: (p1, p2) => {
    if (!canAuthorTakeoff()) return;
    if (get().drawTarget !== 'room') {
      return commitStructuralZone(get, set, [p1, { x: p2.x, y: p1.y }, p2, { x: p1.x, y: p2.y }]);
    }
    const { project, currentPage, activeApartmentNumber } = get();
    if (!project) return;
    historyTracker.push(get, set, project);
    const points: Point[] = [p1, { x: p2.x, y: p1.y }, p2, { x: p1.x, y: p2.y }];
    const room = newRoom(project, currentPage, points, activeApartmentNumber, get().newRoomTemplate);
    const updated = { ...project, rooms: [...project.rooms, room], updatedAt: Date.now() };
    set({ project: updated, drawingPoints: [], selectedRoomId: room.id, manuallyCreatedRoomId: room.id, toolMode: 'select' });
    trackRoomDrawn(updated, room, 'rectangle');
    scheduleSave(get, set);
  },

  setMeasureTool: (t) => {
    if (!canUseMeasureTool(t)) return;
    useFieldWorkflowStore.getState().setDraft((isTouchInput() || isPhoneWorkspace()) && !!t);
    useFieldWorkflowStore.getState().setGeometryAction('browse');
    set({ toolMode: t ? 'measure' : 'select', measureTool: t, measurePoints: [] });
    if (t) ensureOverlayVisible('measurements', get, set);
  },
  setAreaShape: (s) => set({ areaShape: s, measurePoints: [] }),
  setAreaCalcMode: (m) => set({ areaCalcMode: m, measurePoints: [] }),
  setPendingAreaKind: (k) => set({ pendingAreaKind: k }),
  setAreaKindColor: (kind, color) => {
    const { project } = get();
    if (!project) return;
    // Debounced: a colour picker fires continuously while dragging, so the whole drag is one step.
    historyTracker.pushDebounced(get, set, project);
    set({ project: { ...project, areaKindColors: { ...project.areaKindColors, [kind]: color }, updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  setOrthoSnap: (v) => set({ orthoSnap: v }),
  setQuantityExportDialog: (dialog) => set({ quantityExportDialog: dialog }),
  setQuantityExportBusy: (busy) => set({ quantityExportBusy: busy }),
  setQuantitiesOpen: (open) => set({ quantitiesOpen: open, ...(open ? {} : { quantitiesMaximized: false }) }),
  // The height is clamped by the panel itself against the live viewport; the store only remembers it.
  setQuantitiesHeight: (px) => set({ quantitiesHeight: px }),
  toggleQuantitiesMaximized: () => set((s) => ({ quantitiesMaximized: !s.quantitiesMaximized })),

  addMeasurePoint: (p) => set({ measurePoints: [...get().measurePoints, p] }),
  clearMeasurePoints: () => set({ measurePoints: [] }),
  finishMeasurement: (m) => {
    if (isPhoneWorkspace() && (m.tool !== 'distance' || !get().project?.pages[m.pageNumber]?.calibration)) return;
    const { project } = get();
    if (!project) return;
    historyTracker.push(get, set, project);
    const measurements = [...(project.measurements ?? []), m];
    set({ project: { ...project, measurements, updatedAt: Date.now() }, measurePoints: [] });
    scheduleSave(get, set);
  },
  updateMeasurement: (id, patch) => {
    const { project } = get();
    if (!project) return;
    historyTracker.pushDebounced(get, set, project);
    const measurements = (project.measurements ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m));
    set({ project: { ...project, measurements, updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  deleteMeasurement: (id) => {
    const { project } = get();
    if (!project) return;
    historyTracker.push(get, set, project);
    const measurements = (project.measurements ?? []).filter((m) => m.id !== id);
    set({ project: { ...project, measurements, updatedAt: Date.now() } });
    scheduleSave(get, set);
  },

  setMarkupTool: (t) => {
    if (!canUseMarkupTool(t)) return;
    useFieldWorkflowStore.getState().setDraft((isTouchInput() || isPhoneWorkspace()) && !!t);
    useFieldWorkflowStore.getState().setGeometryAction('browse');
    set({ toolMode: t ? 'markup' : 'select', markupTool: t, markupPoints: [] });
    if (t) ensureOverlayVisible('markups', get, set);
  },
  setMarkupColor: (c) => set({ markupColor: c }),
  setMarkupOrtho: (v) => set({ markupOrtho: v }),
  setMarkupFontScale: (v) => set({ markupFontScale: v }),
  addMarkupPoint: (p) => set({ markupPoints: [...get().markupPoints, p] }),
  clearMarkupPoints: () => set({ markupPoints: [] }),
  finishMarkup: (m) => {
    if (!canUseMarkupTool(m.tool)) return;
    const { project } = get();
    if (!project) return;
    historyTracker.push(get, set, project);
    const markups = [...(project.markups ?? []), m];
    set({ project: { ...project, markups, updatedAt: Date.now() }, markupPoints: [] });
    scheduleSave(get, set);
  },
  updateMarkup: (id, patch) => {
    if (isPhoneWorkspace()) {
      const note = get().project?.markups?.find((m) => m.id === id);
      if (note?.tool !== 'text' || Object.keys(patch).some((key) => key !== 'text' && key !== 'rotationDeg')) return;
    }
    const { project } = get();
    if (!project) return;
    // Debounced like updateMarkupQuiet, so a move/resize burst collapses into one undo step — the
    // quiet updates during the drag and this closing call share the same pre-drag snapshot.
    // An empty patch is the "drag finished, save it" signal (PdfViewer's mouse-up); it changes
    // nothing on its own, so it must not open an undo step of its own on a click that never moved.
    if (Object.keys(patch).length > 0) historyTracker.pushDebounced(get, set, project);
    const markups = (project.markups ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m));
    set({ project: { ...project, markups, updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  updateMarkupQuiet: (id, patch) => {
    if (isPhoneWorkspace()) return;
    const { project } = get();
    if (!project) return;
    historyTracker.pushDebounced(get, set, project);
    const markups = (project.markups ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m));
    set({ project: { ...project, markups } });
    markDirty(set);
  },
  deleteMarkup: (id) => {
    const { project, selectedMarkupId } = get();
    if (!project) return;
    historyTracker.push(get, set, project);
    const markups = (project.markups ?? []).filter((m) => m.id !== id);
    set({
      project: { ...project, markups, updatedAt: Date.now() },
      selectedMarkupId: selectedMarkupId === id ? null : selectedMarkupId,
    });
    scheduleSave(get, set);
  },
  duplicateMarkup: (id) => {
    if (isPhoneWorkspace() && !canUseMarkupTool(get().project?.markups?.find((m) => m.id === id)?.tool ?? null)) return;
    const { project } = get();
    if (!project) return;
    const original = (project.markups ?? []).find((m) => m.id === id);
    if (!original) return;
    historyTracker.push(get, set, project);
    const offset = 20;
    const copy: Markup = {
      ...original,
      id: uuid(),
      points: original.points.map((p) => ({ x: p.x + offset, y: p.y + offset })),
      createdAt: Date.now(),
    };
    const markups = [...(project.markups ?? []), copy];
    set({ project: { ...project, markups, updatedAt: Date.now() }, selectedMarkupId: copy.id });
    scheduleSave(get, set);
  },
  setSelectedMarkupId: (id) => set({ selectedMarkupId: id }),

  updateRoom: (id, patch) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    if (!project) return;
    historyTracker.pushDebounced(get, set, project);
    const rooms = project.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r));
    set({ project: { ...project, rooms, updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  setRoomType: (roomId, roomType) => {
    if (!canAuthorTakeoff()) return 'none';
    const { project } = get();
    if (!project) return 'none';
    const room = project.rooms.find((r) => r.id === roomId);
    if (!room) return 'none';

    const profile = getRoomProfile(roomType);
    // Work items are only seeded into an empty room. A room the user has already filled in keeps
    // its items untouched — picking a type must never erase decisions they already made.
    const seeded = profile && room.workItems.length === 0 ? buildWorkItemsForProfile(profile, project) : null;
    const outcome: 'created' | 'kept' | 'none' = seeded ? 'created' : profile && room.workItems.length > 0 ? 'kept' : 'none';

    // One push for the whole thing (type + any seeded items) = one undo step. The room's `name` is
    // never touched here: the user's name and the classification are separate fields.
    historyTracker.push(get, set, project);
    const rooms = project.rooms.map((r) =>
      r.id === roomId ? { ...r, roomType, ...(seeded ? { workItems: seeded } : {}) } : r
    );
    const updated = { ...project, rooms, updatedAt: Date.now() };
    set({ project: updated });
    if (seeded) trackWorkItemsAdded(updated, seeded, 'room_type');
    scheduleSave(get, set);
    return outcome;
  },
  duplicateRoom: (roomId) => {
    if (!canAuthorTakeoff()) return null;
    const { project } = get();
    if (!project) return null;
    const original = project.rooms.find((r) => r.id === roomId);
    // Unknown id: no state change, no history entry, no error.
    if (!original) return null;

    historyTracker.push(get, set, project);
    // Same page — cross-page duplication is the apartment action's job.
    // Rectangles are stored as a 4-point polygon like any other room, so offsetting the points
    // covers every geometry field there is.
    const copy = cloneRoomForDuplicate(original, {
      points: original.points.map((p) => ({ x: p.x + ROOM_DUPLICATE_OFFSET, y: p.y + ROOM_DUPLICATE_OFFSET })),
      name: original.name ? t('defaultNames.copy', { name: original.name }) : t('defaultNames.roomCopy'),
      color: nextColor(project.rooms.length),
    });

    const updated = { ...project, rooms: [...project.rooms, copy], updatedAt: Date.now() };
    set({ project: updated, selectedRoomId: copy.id });
    trackRoomsCreated(updated, 'duplicate', [copy]);
    scheduleSave(get, set);
    return copy.id;
  },
  duplicateApartment: (sourceApartmentNumber, targetApartmentNumber) => {
    if (!canAuthorTakeoff()) return 0;
    const { project } = get();
    if (!project) return 0;
    const sourceRooms = project.rooms.filter((r) => r.apartmentNumber === sourceApartmentNumber);
    if (sourceRooms.length === 0) return 0;

    // Duplicating an apartment is about reusing its rooms and their quantities, not about placing
    // geometry somewhere new: every copy keeps the source room's own polygon and page exactly, so
    // areas and perimeters come out identical. One push = one undo for the whole apartment.
    historyTracker.push(get, set, project);
    let colorSeed = project.rooms.length;
    const copies = sourceRooms.map((r) =>
      cloneRoomForDuplicate(r, {
        apartmentNumber: targetApartmentNumber,
        color: nextColor(colorSeed++),
      })
    );

    const updated = { ...project, rooms: [...project.rooms, ...copies], updatedAt: Date.now() };
    set({ project: updated, selectedRoomId: copies[0].id });
    trackRoomsCreated(updated, 'apartment_duplicate', copies);
    scheduleSave(get, set);
    return copies.length;
  },
  deleteRoom: (id) => {
    if (!canAuthorTakeoff()) return;
    const { project, selectedRoomId } = get();
    if (!project) return;
    historyTracker.push(get, set, project);
    const rooms = project.rooms.filter((r) => r.id !== id);
    set({
      project: { ...project, rooms, updatedAt: Date.now() },
      selectedRoomId: selectedRoomId === id ? null : selectedRoomId,
    });
    scheduleSave(get, set);
  },
  addWorkItem: (roomId, type) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    if (!project) return;
    if (!project.rooms.some((r) => r.id === roomId)) return;
    historyTracker.push(get, set, project);
    const item: WorkItem = {
      id: uuid(),
      type,
      heightM: type === 'cladding' ? project.defaultCladdingHeightM : undefined,
      tilingCategory: type === 'tiling' ? 'regular' : undefined,
    };
    const rooms = project.rooms.map((r) => (r.id === roomId ? { ...r, workItems: [...r.workItems, item] } : r));
    const updated = { ...project, rooms, updatedAt: Date.now() };
    set({ project: updated });
    trackWorkItemsAdded(updated, [item], 'manual');
    scheduleSave(get, set);
  },
  updateWorkItem: (roomId, itemId, patch) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    if (!project) return;
    historyTracker.pushDebounced(get, set, project);
    const rooms = project.rooms.map((r) => {
      if (r.id !== roomId) return r;
      const workItems = r.workItems.map((wi) => (wi.id === itemId ? { ...wi, ...patch } : wi));
      return { ...r, workItems };
    });
    set({ project: { ...project, rooms, updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  removeWorkItem: (roomId, itemId) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    if (!project) return;
    historyTracker.push(get, set, project);
    const rooms = project.rooms.map((r) => {
      if (r.id !== roomId) return r;
      return { ...r, workItems: r.workItems.filter((wi) => wi.id !== itemId) };
    });
    set({ project: { ...project, rooms, updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  addOpening: (roomId, type) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    if (!project) return;
    historyTracker.push(get, set, project);
    const opening: Opening = { id: uuid(), type, ...OPENING_DEFAULT_SIZES[type], quantity: 1 };
    const rooms = project.rooms.map((r) => (r.id === roomId ? { ...r, openings: [...(r.openings ?? []), opening] } : r));
    set({ project: { ...project, rooms, updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  updateOpening: (roomId, openingId, patch) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    if (!project) return;
    historyTracker.pushDebounced(get, set, project);
    const rooms = project.rooms.map((r) => {
      if (r.id !== roomId) return r;
      return { ...r, openings: (r.openings ?? []).map((o) => (o.id === openingId ? { ...o, ...patch } : o)) };
    });
    set({ project: { ...project, rooms, updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  removeOpening: (roomId, openingId) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    if (!project) return;
    historyTracker.push(get, set, project);
    const rooms = project.rooms.map((r) => {
      if (r.id !== roomId) return r;
      return { ...r, openings: (r.openings ?? []).filter((o) => o.id !== openingId) };
    });
    set({ project: { ...project, rooms, updatedAt: Date.now() } });
    scheduleSave(get, set);
  },
  moveRoomPoint: (roomId, pointIndex, p) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    if (!project) return;
    historyTracker.pushDebounced(get, set, project);
    const rooms = project.rooms.map((r) => {
      if (r.id !== roomId) return r;
      const points = r.points.map((pt, i) => (i === pointIndex ? p : pt));
      return { ...r, points };
    });
    set({ project: { ...project, rooms, updatedAt: Date.now() } });
    markDirty(set);
  },
  deleteRoomPoint: (roomId, pointIndex) => {
    if (!canAuthorTakeoff()) return;
    const { project } = get();
    if (!project) return;
    historyTracker.push(get, set, project);
    const rooms = project.rooms.map((r) => {
      if (r.id !== roomId) return r;
      if (r.points.length <= 3) return r;
      return { ...r, points: r.points.filter((_, i) => i !== pointIndex) };
    });
    set({ project: { ...project, rooms, updatedAt: Date.now() } });
    scheduleSave(get, set);
  },

  updateProjectMeta: (patch) => {
    const { project } = get();
    if (!project) return;
    historyTracker.pushDebounced(get, set, project);
    set({ project: { ...project, ...patch, updatedAt: Date.now() } });
    scheduleSave(get, set);
  },

  persist: async () => {
    const { project } = get();
    if (!project) return;
    // A save that is happening now supersedes the scheduled one.
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    set({ saving: true });
    try {
      await dbSavePlan(project);
      // Only clear the flag if nothing was edited while the write was in flight — otherwise those
      // newer edits are still unsaved.
      if (get().project === project) set({ dirty: false });
      set({ saveError: null });
      // Derived activation (`quantities_ready`) is checked against what is actually on disk.
      notePlanSaved(project);
    } catch (err) {
      // Stays dirty: the work is not on disk, and the beforeunload guard must keep warning.
      set({ saveError: err instanceof Error ? err.message : t('errors.saveFailed') });
      console.error('Failed to save project', err);
      trackError('save_plan', err);
    } finally {
      set({ saving: false });
    }
  },
}));
