// Domain types for the Drawing Overlay & Revision Compare feature.
import type { Point } from './index';
import type { ComparisonContext, RevisionAnalysis } from './revisionAnalysis';

/**
 * A page calibration in Revision Compare. Same shape as the takeoff side's `Calibration`, plus the
 * coordinate space the pixel distance was measured in — the comparison canvas has two of them (the
 * source page's native px and the revised PDF's own native px), and a value is only interpretable
 * together with the one it came from. Absent on data saved before this field existed.
 */
export interface CompareCalibration {
  /** Distance in px between the two calibration points, in the space named by `space`. */
  pixelDistance: number;
  /** Real-world distance in meters entered by the user. */
  realDistanceMeters: number;
  /** meters per pixel, derived: realDistanceMeters / pixelDistance — in the space named by `space`. */
  metersPerPixel: number;
  space?: 'original' | 'revised';
}

export type CompareLayer = 'original' | 'revised';

export type CompareToolMode = 'select' | 'pan' | 'calibrate' | 'measure' | 'markup' | 'align' | 'export-region';

/** A rectangular crop window, in the original layer's native px space, used to limit PDF export to part of the plan. */
export interface ExportRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Labels for these ids live in the dictionary (src/i18n), shared with the takeoff app.
export type MarkupTool = 'cloud' | 'arrow' | 'rectangle' | 'text' | 'dimension' | 'mask';

export type MeasureTool = 'distance' | 'area' | 'perimeter';

/** Area-measurement classification, used to tally demolition vs. new-construction quantities. */
export type AreaKind = 'demolition' | 'construction';

export const DEFAULT_AREA_KIND_COLORS: Record<AreaKind, string> = {
  demolition: '#eab308',
  construction: '#16a34a',
};

/** How the user draws an area measurement: click a closed polygon, or drag a rectangle's two opposite corners. */
export type AreaShape = 'polygon' | 'rectangle' | 'line';

/**
 * How an area measurement's square-meter value is derived: 'footprint' is the drawn shape's own
 * area (the default); 'wall' is for a wall being demolished/built, where the plan only shows the
 * wall's run in 2D — the user traces its centerline (an open polyline) and the tool multiplies the
 * traced length by a wall height (which can't be read off a 2D plan) to get the actual surface area.
 */
export type AreaCalcMode = 'footprint' | 'wall';

export type CompareViewMode = 'overlay' | 'swipe' | 'blink';

/** Transform applied to the revised layer on top of the shared viewport pan/zoom, expressed in the original layer's native px space. */
export interface LayerTransform {
  offsetX: number;
  offsetY: number;
  rotationDeg: number;
  scale: number;
}

export const IDENTITY_TRANSFORM: LayerTransform = { offsetX: 0, offsetY: 0, rotationDeg: 0, scale: 1 };

export interface AlignmentPointPair {
  originalPoint: Point;
  revisedPoint: Point;
}

export interface Markup {
  id: string;
  /** Source page this markup was drawn on. Its points are in that page's native px. */
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

export interface Measurement {
  id: string;
  /** Source page this measurement was taken on. Its points are in that page's native px. */
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
  /** For calcMode === 'wall': the traced centerline length in meters (areaM2 = wallLengthM * wallHeightM). */
  wallLengthM?: number;
  /** For calcMode === 'wall': the wall height used for this specific measurement — starts from the comparison's default, editable per-measurement. */
  wallHeightM?: number;
  /**
   * For a wall item created from a detected revision change: the measured centre line. When present
   * its length (not the longest polygon edge) is the wall's run, so it can be recalculated exactly.
   */
  centerline?: Point[];
  /** The detected revision change this item was created from, when approved in AI Revision Compare. */
  revisionChangeId?: string;
  /** Which line of that change the item measures — edits of the item are written back to it. */
  revisionElement?: { list: 'walls' | 'doors'; index: number; part?: number };
}

/** Placeholder for future automatic change detection (out of scope for now). */
export interface DetectedChange {
  id: string;
  kind: 'line-added' | 'line-removed' | 'dimension-changed' | 'area-changed';
  points: Point[];
  description: string;
}

/** One uploaded "revised" plan compared against the shared original. A comparison can hold several. */
export interface RevisionLayer {
  id: string;
  label: string;
  fileName: string;
  opacity: number;
  visible: boolean;
  colorTint: string;
  /** When true, render this layer with the PDF's own colors instead of the flat tint. */
  useSourceColors: boolean;
  /** Markups and measurements belong to this specific revision — they don't show up when a different revision is active. */
  markups: Markup[];
  measurements: Measurement[];
  /**
   * What this revision is compared against for change detection: undefined/null = the original,
   * otherwise an earlier revision of this comparison (a sequential revision chain).
   */
  baseRevisionId?: string | null;
  /** Locally detected (and optionally AI-classified) change proposals, per source page. */
  analysis?: RevisionAnalysis;
}

/** Per-page data for one revision: its own page mapping, calibration and alignment against the original. */
export interface RevisionPageData {
  /** Which page of this revision's PDF is shown against the source page that owns this record. */
  revisedPageNumber: number;
  revisedCalibration: CompareCalibration | null;
  alignment: LayerTransform;
  alignmentPoints: AlignmentPointPair[];
  /** How `alignment` was produced, so the UI can report the alignment state honestly. */
  alignmentMethod?: 'points' | 'manual';
}

export interface ComparisonPage {
  originalPageNumber: number;
  originalCalibration: CompareCalibration | null;
  /** Keyed by RevisionLayer.id. */
  revisions: Record<string, RevisionPageData>;
}

export interface Comparison {
  id: string;
  /**
   * The takeoff project this comparison belongs to (types/index.ts `Project`). Absent only on
   * comparisons saved before projects held comparisons, until migrated on load.
   */
  projectId?: string;
  name: string;
  apartmentNumber: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  originalFileName: string;
  originalOpacity: number;
  originalVisible: boolean;
  originalColorTint: string;
  originalUseSourceColors: boolean;
  pages: Record<number, ComparisonPage>;
  /** Uploaded revised plans, all compared against the same original. */
  revisions: RevisionLayer[];
  /** The revision currently shown/aligned/calibrated as the "revised" layer. */
  activeRevisionId: string;
  /** Customizable per comparison; defaults to DEFAULT_AREA_KIND_COLORS. */
  areaKindColors: Record<AreaKind, string>;
  /** Default wall height (meters) used to seed new 'wall' calc-mode area measurements; editable per-measurement afterward. Global to the comparison, fixed (not per-revision) for now. */
  wallHeightDefaultM: number;
  autoDetectedChanges?: DetectedChange[];
  /** Design revision (quantity differences only) or during construction (demolition + construction). Absent = design. */
  context?: ComparisonContext;
  /** The takeoff plan approved changes are applied to. Optional: a comparison can stay standalone. */
  linkedPlanId?: string;
}
