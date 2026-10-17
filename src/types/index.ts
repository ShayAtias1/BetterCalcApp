// Core domain types for the quantity-takeoff app.

import { MEASUREMENT_DEFAULTS } from '../config/measurementDefaults';
import type { ConcreteElement, RebarItem } from './structural';
import type { PlanOpening } from './openings';
import type { RevisionApplication, RevisionBackdrop } from './revisionAnalysis';
export type { PlanOpening, PlanOpeningKind, NewPlanOpening, PlanOpeningPatch, LegacyOpeningRef } from './openings';

export type TilingCategory = 'regular' | 'as';

/**
 * Addable work item types — the "+" buttons in the room panel. 'panels' is skirting (the id is kept
 * so saved projects keep loading). Each type's label, unit, basis and defaults live in
 * `lib/workTypes.ts`.
 */
export type WorkType = 'tiling' | 'cladding' | 'panels' | 'painting' | 'plaster' | 'waterproofing';

/** A door, window or other opening in a room's walls, entered by hand in metres. */
export type OpeningType = 'door' | 'window' | 'custom';

export interface Opening {
  id: string;
  type: OpeningType;
  widthM: number;
  heightM: number;
  /** How many identical openings this row stands for. */
  quantity: number;
}

/**
 * Work types added after the original four report categories. Each reports as its own category, and
 * reports only show their columns when a project actually uses them — so older projects export
 * exactly as before.
 */
export const EXTRA_REPORT_CATEGORIES = ['painting', 'plaster', 'waterproofing'] as const;
export type ExtraReportCategory = (typeof EXTRA_REPORT_CATEGORIES)[number];

/** The categories shown in quantity reports/totals (tiling is split by category). */
export type ReportCategory = 'tiling_regular' | 'tiling_as' | 'cladding' | 'panels' | ExtraReportCategory;

/**
 * Panels (skirting) are a strip running along the room perimeter, this height (meters) tall.
 * This is the historical fallback only: the effective height is the work item's own `heightM`,
 * then the project's `defaultPanelHeightM`, then this (see `effectiveHeightM`).
 */
export const PANEL_HEIGHT_M = MEASUREMENT_DEFAULTS.panelHeightM;

/**
 * How a work category's quantity is measured. The geometric methods reuse the room's calculated
 * area/perimeter; the manual ones take a number typed on the work item (no page scale needed).
 */
export type CalculationMethod = 'floorArea' | 'wallArea' | 'ceilingArea' | 'perimeter' | 'manualArea' | 'manualLength' | 'manualCount';

/** A built-in work type, or an item of a user-defined category (`WorkItem.categoryId` + `method`). */
export type WorkItemType = WorkType | 'custom';

/**
 * One share of a work item's calculated quantity, assigned to a work item / specification of the
 * catalog (e.g. "White paint"). `quantity: null` is the automatic remainder: the calculated quantity
 * minus every manual share. Shares split the item's quantity — they never add to it.
 */
export interface WorkAllocation {
  id: string;
  /** A `WorkSpec` id, resolved through the plan's catalog snapshot. */
  specId: string;
  quantity: number | null;
}

/** A user-defined work category of the local catalog (built-in work types are not stored). */
export interface WorkCategory {
  id: string;
  name: string;
  method: CalculationMethod;
  /** Unit name for `manualCount` (e.g. "sacks"); the other methods have fixed units. */
  unitLabel?: string;
  createdAt: number;
  updatedAt: number;
}

/** A work item / material specification within a category (built-in or user-defined). */
export interface WorkSpec {
  id: string;
  /** A `WorkCategory` id, or `builtin:<WorkType>` for a built-in work type. */
  categoryId: string;
  name: string;
  /** Free text: size, product, colour… */
  specification?: string;
  /**
   * Its own calculation method (e.g. "Ceiling paint" under Painting). Absent: the category's method.
   * A work item with its own method is added to a room as its own quantity, never as a share of the
   * category's quantity, so floor, wall and ceiling amounts stay separate.
   */
  method?: CalculationMethod;
  /** Unit name for its own `manualCount` method. */
  unitLabel?: string;
  createdAt: number;
  updatedAt: number;
}

/** The catalog entries a plan uses, copied in when first used so later catalog edits never change it. */
export interface WorkCatalogSnapshot {
  categories: WorkCategory[];
  specs: WorkSpec[];
}

export interface WorkItem {
  id: string;
  type: WorkItemType;
  /** type 'custom' only: the category in the plan's catalog snapshot. */
  categoryId?: string;
  /** type 'custom' only: the category's method, kept on the item so it always calculates. */
  method?: CalculationMethod;
  /** type 'custom' only: the work item / spec with its own method this room item measures. */
  specId?: string;
  /** Manual methods only: the quantity in the method's unit. */
  manualQuantity?: number;
  /** Optional split of the calculated quantity between work items / specifications. */
  allocations?: WorkAllocation[];
  /** Only relevant for type 'tiling' — regular or AS (wet-area) tiling. Defaults to 'regular' if unset. */
  tilingCategory?: TilingCategory;
  /** For every type but tiling — height in meters used to multiply the perimeter. Falls back to the project default. */
  heightM?: number;
  /** Waste percentage override (0-100). If undefined, the project's per-type default is used. */
  wastePercent?: number;
  /**
   * Whether the room's openings reduce this item. Undefined follows the work type's definition
   * (`deductsOpenings` in lib/workTypes); only meaningful for types that list opening types to deduct.
   */
  deductOpenings?: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface Room {
  /** Local AI provenance only; never used to calculate quantities. */
  aiSource?: {
    targetPoint?: Point;
    detectionMode?: string;
    overlapWarnings?: string[];
    spaceId: string;
    suggestedType: string | null;
    geometryClass: string;
    geometryConfidence?: string;
    typeConfidence?: string;
    requiresReview?: boolean;
    ambiguities?: string[];
    reason?: string | null;
    reviewNotes: string[];
    reviewedWarningIds: string[];
  };
  id: string;
  pageNumber: number;
  /** Polygon vertices in PDF page coordinates (unscaled, at pdf.js scale=1). */
  points: Point[];
  closed: boolean;
  name: string;
  apartmentNumber: string;
  notes: string;
  workItems: WorkItem[];
  /** Doors, windows and other openings deducted from wall-based work. Absent on rooms saved before openings existed. */
  openings?: Opening[];
  color: string;
  /**
   * The room type the *user* chose (a ROOM_PROFILES key), used for classification and defaults.
   * Independent of `name`, which stays whatever the user typed, and of `detectedType`, which is
   * only what auto-detection guessed. null/undefined means unclassified — a perfectly valid state.
   */
  roomType?: string | null;
  /** Set when the room came from auto-detection: the matched room-type profile key (see roomProfiles). Never written from the user's pick. */
  detectedType?: string;
  /** Auto-detection confidence: 'high' when a name was recognized, 'low' when it needs manual review. */
  detectionConfidence?: 'high' | 'low';
}

export interface Calibration {
  /** Distance in px (page coordinates at scale=1) between the two calibration points. */
  pixelDistance: number;
  /** Real-world distance in meters entered by the user. */
  realDistanceMeters: number;
  /** meters per pixel, derived: realDistanceMeters / pixelDistance */
  metersPerPixel: number;
}

export interface PageData {
  pageNumber: number;
  calibration: Calibration | null;
}

/**
 * A takeoff project: a named folder of plans. Kept deliberately thin — each plan is its own saved
 * document (see `Plan`), so opening, saving or switching one plan never loads or rewrites the others.
 */
export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** The project's plans, in display order. Each id is a `Plan` stored on its own. */
  planIds: string[];
  /**
   * The project's revision comparisons, in display order. Each id is a Revision Compare
   * `Comparison`, stored on its own like a plan. Absent on projects saved before comparisons joined.
   */
  comparisonIds?: string[];
}

/**
 * One plan (PDF) inside a project, with everything measured on it: calibration, rooms, openings,
 * work items, waste/height defaults, measurements and markups. Before projects existed this was the
 * whole saved document (then called Project); old records are wrapped in a project on first load
 * (`migrateLegacyPlans` in db/database.ts). Stored in the IndexedDB `projects` object store, PDF in
 * `pdfFiles` under the plan id.
 */
export interface Plan {
  aiOpeningImportKeys?: string[];
  id: string;
  /** The owning project. Absent only on records saved before projects existed, until migrated. */
  projectId?: string;
  /** The plan's own name (e.g. "קומה 3"). */
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Stored PDF file as a Blob in IndexedDB. */
  pdfFileName: string;
  pages: Record<number, PageData>;
  rooms: Room[];
  /** Canonical physical openings; eligible approved records supplement legacy room quantities safely. */
  openings?: PlanOpening[];
  measurements: Measurement[];
  markups: Markup[];
  /**
   * Concrete and rebar takeoff zones (types/structural). Optional: plans saved before they existed
   * have neither array — read them through lib/structuralPlan, never directly.
   */
  concreteElements?: ConcreteElement[];
  rebarItems?: RebarItem[];
  defaultCladdingHeightM: number;
  /** Panel (skirting) height in meters for items without their own `heightM`. Optional: projects saved before this existed fall back to PANEL_HEIGHT_M. */
  defaultPanelHeightM?: number;
  defaultTilingWastePercent: number;
  /** Waste % for AS tiling. Optional: projects saved before this existed fall back to defaultTilingWastePercent. */
  defaultTilingAsWastePercent?: number;
  defaultCladdingWastePercent: number;
  defaultPanelsWastePercent: number;
  /** Waste % defaults for the later work types. Optional: absent on older projects, which fall back to the work type's own default. */
  defaultPaintingWastePercent?: number;
  defaultPlasterWastePercent?: number;
  defaultWaterproofingWastePercent?: number;
  /** Customizable per project; defaults to DEFAULT_AREA_KIND_COLORS. */
  areaKindColors: Record<AreaKind, string>;
  /** Default wall height (meters) used to seed new 'wall' calc-mode area measurements; editable per-measurement afterward. */
  wallHeightDefaultM: number;
  /** Catalog entries this plan uses (see WorkCatalogSnapshot). Absent on plans that never used one. */
  workCatalog?: WorkCatalogSnapshot;
  /** Ledger of revision changes applied to this plan from Revision Compare. Absent until the first one. */
  revisionApplications?: RevisionApplication[];
  /** The revision drawing displayed behind this plan (the latest application in force); the original PDF stays the coordinate reference. */
  revisionBackdrop?: RevisionBackdrop;
}

export type ToolMode = 'select' | 'pan' | 'calibrate' | 'draw' | 'draw-rect' | 'measure' | 'export-region' | 'markup';

export type MarkupTool = 'cloud' | 'arrow' | 'rectangle' | 'text' | 'dimension' | 'mask';

export interface Markup {
  id: string;
  pageNumber: number;
  tool: MarkupTool;
  /**
   * Interpretation depends on tool: 2 points for arrow/rectangle, polyline for cloud, 1 point for text.
   * A dimension holds 2 points for a single measure, or 3+ colinear points for a continued chain
   * (AutoCAD DIMCONTINUE style) — each consecutive pair is one measured segment.
   */
  points: Point[];
  /** For a dimension: the label of the whole run (the chain total when there are 3+ points). */
  text?: string;
  /** For a dimension chain: one label per segment, so `segmentTexts.length === points.length - 1`. */
  segmentTexts?: string[];
  /**
   * For a dimension: how far the dimension line was moved off the points it measures, in page px
   * along the run's normal. The points stay put; extension lines join them to the moved line.
   */
  offset?: number;
  /** For a dimension: mirrors it about its own line — values (and a chain's overall line) swap sides. */
  flipped?: boolean;
  /** Label size multiplier for text notes and dimension labels (1 = default). Absent means 1. */
  fontScale?: number;
  /** For tool === 'text': the note's rotation in degrees (0 = horizontal, -90 = reading bottom-to-top). */
  rotationDeg?: number;
  color: string;
  createdAt: number;
}

/** A page-native-coordinate rectangle marking the area of the plan to include in a PDF export, instead of the full page. */
export interface ExportRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MeasureTool = 'distance' | 'area' | 'perimeter';

/** How the user draws an area measurement: click a closed polygon, or drag a rectangle's two opposite corners. */
export type AreaShape = 'polygon' | 'rectangle' | 'line';

/** Area-measurement classification, used to tally demolition vs. new-construction quantities. */
export type AreaKind = 'demolition' | 'construction';

export const DEFAULT_AREA_KIND_COLORS: Record<AreaKind, string> = {
  demolition: '#eab308',
  construction: '#16a34a',
};

/**
 * How an area measurement's square-meter value is derived: 'footprint' is the drawn shape's own
 * area (the default); 'wall' is for a wall being demolished/built, where the plan only shows the
 * wall's run in 2D — the tool takes the longest edge of the drawn shape (the wall's length, not its
 * plan-view thickness) and multiplies it by a wall height (which can't be read off a 2D plan).
 */
export type AreaCalcMode = 'footprint' | 'wall';

export interface Measurement {
  id: string;
  pageNumber: number;
  tool: MeasureTool;
  points: Point[];
  /**
   * For tool === 'distance' | 'perimeter': the measured length in metres, rounded to the centimetre —
   * fixed when the measurement is made. Its label is made from this (lib/measurementValues).
   * Filled on load from `label` for measurements saved before this field existed.
   */
  lengthM?: number;
  /**
   * Legacy: the display text older builds saved instead of a number (e.g. "3.24 מ'" or "12.5 מ\"ר").
   * No longer written; read only to recover the value of a measurement saved that way.
   */
  label?: string;
  /** For tool === 'area': classifies the marked area for the demolition/construction summary. */
  areaKind?: AreaKind;
  /** For tool === 'area': raw computed square-meter value, kept alongside `label` so summaries don't need to re-parse it. */
  areaM2?: number;
  /** For tool === 'area': how areaM2 was derived. Defaults to 'footprint' when absent (measurements created before this field existed). */
  calcMode?: AreaCalcMode;
  /** For calcMode === 'wall': the longest-edge length in meters (areaM2 = wallLengthM * wallHeightM). */
  wallLengthM?: number;
  /** For calcMode === 'wall': the wall height used for this specific measurement — starts from the project's default, editable per-measurement. */
  wallHeightM?: number;
  /** For an item written by a revision application: the measured wall centre line (its length is the run). */
  centerline?: Point[];
  /** Provenance of an item written by a revision application (AI Revision Compare). */
  revisionSource?: { comparisonId: string; revisionId: string; changeId: string; applicationId: string };
}

/** One row per room, matching the contractor-facing quantities report layout. */
/** A report column of a user-defined category (or of a work item with its own method): `custom:<categoryId>|<method>`. */
export type CustomReportKey = `custom:${string}`;
/** Any column of the quantity reports: a built-in report category or a custom one. */
export type ReportColumn = ReportCategory | CustomReportKey;

/** One custom column's numbers for one room, with what is needed to name it in any language. */
export interface CustomColumnQuantity {
  /** The user's category name; null for a built-in category (named by the dictionary). */
  categoryName: string | null;
  builtinType: WorkType | null;
  method: CalculationMethod;
  /** Whether the label names the method too (it differs from the category's own). */
  showMethod: boolean;
  unit: 'm2' | 'lm' | 'unit';
  /** Unit name of a counted column, when the catalog gives one. */
  unitName: string | null;
  /** Typed (manual) quantities need no page scale. */
  manual: boolean;
  /** Primary quantity in `unit`; null when not calculable (page not calibrated). */
  quantity: number | null;
  order: number | null;
  wastePercent: number | null;
  /** Strips (perimeter method) only: the m² reading. */
  areaM2: number | null;
  orderAreaM2: number | null;
}

export interface RoomQuantitySummary {
  roomId: string;
  apartmentNumber: string;
  roomName: string;
  /** User-defined categories' columns; absent when the room has none (older reports are unchanged). */
  custom?: Partial<Record<CustomReportKey, CustomColumnQuantity>>;
  /**
   * False when the room's page has no scale. All the numbers below are then `null` — the room's
   * quantities are *not calculable*, which is a different thing from a real zero, and every
   * consumer (screen table, PDF, Excel) must say so instead of printing 0.
   */
  pageCalibrated: boolean;
  tilingRegularAreaM2: number | null;
  tilingAsAreaM2: number | null;
  claddingAreaM2: number | null;
  panelsAreaM2: number | null;
  /** Panels are also bought by the running metre: the room's perimeter. null when not calculable. */
  panelsLengthM: number | null;
  /** The same length with the item's waste applied — what to order in running metres. */
  panelsOrderLengthM: number | null;
  /**
   * Running metres of door width taken off the skirting (gross length − net length). null when the
   * room has no panels item or no scale. Display-only: already reflected in `panelsLengthM`.
   */
  panelsDeductedLengthM: number | null;
  tilingRegularWastePercent: number | null;
  tilingAsWastePercent: number | null;
  claddingWastePercent: number | null;
  panelsWastePercent: number | null;
  tilingRegularOrderM2: number | null;
  tilingAsOrderM2: number | null;
  claddingOrderM2: number | null;
  panelsOrderM2: number | null;
  /** The later work types, one entry each; every field is null when the room has no such item (or no scale). */
  extra: Record<ExtraReportCategory, CategoryQuantity>;
  /**
   * Wall-based work (cladding, painting, plaster) that actually had openings taken off, one entry
   * per category: gross − deducted = net. Empty when nothing was deducted or the page has no scale,
   * so exports list only the rows where a deduction exists.
   */
  openingDeductions: OpeningDeductionSummary[];
  notes: string;
}

export interface OpeningDeductionSummary {
  category: ReportCategory;
  grossM2: number;
  deductedM2: number;
  netM2: number;
}

export interface CategoryQuantity {
  areaM2: number | null;
  wastePercent: number | null;
  orderM2: number | null;
}

export interface ReportCategoryTotal {
  category: ReportColumn;
  /** Counted custom columns only: the number of units, and with waste. */
  count?: number | null;
  orderCount?: number | null;
  quantityM2: number;
  wastePercent: number;
  orderM2: number;
  /** Running metres — only panels have a linear reading; null for every other category. */
  lengthM: number | null;
  /** Running metres to order (length + waste); null for every category but panels. */
  orderLengthM: number | null;
}
