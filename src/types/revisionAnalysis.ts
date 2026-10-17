// Domain types for AI Revision Compare: locally detected change proposals, their review state, the
// optional AI classification of those proposals, and the record of applying approved changes to a
// takeoff plan. Every coordinate is in the comparison's *source page* native px (the original
// layer), the same space as Compare measurements — and, for a comparison whose original is a
// takeoff plan's PDF, the same space as that plan's rooms.
import type { Point } from './index';
import type { LayerTransform } from './compare';

/** Design revision: the plan was never built, a removed element is only a quantity reduction. During construction: removals are physical demolition. */
export type ComparisonContext = 'design' | 'construction';

/** A straight drawing segment in source-page native px. */
export interface RevisionSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type RevisionChangeKind = 'added' | 'removed' | 'modified';

/** What local geometry evidence suggests. Never authoritative on its own: users approve. */
export type RevisionChangeCategory = 'wall' | 'opening' | 'annotation' | 'other' | 'unknown';

/** 'high' changes are proposed by default; 'medium'/'low' only when the user asks for more. */
export type RevisionSignificance = 'high' | 'medium' | 'low';

export type RevisionChangeStatus = 'pending' | 'approved' | 'rejected' | 'applied';

/** A wall run measured deterministically from a pair of parallel drawing lines. */
export interface RevisionWall {
  side: 'added' | 'removed';
  /** Centre line of the overlapping part of the two lines. */
  centerline: [Point, Point];
  /** Wall footprint (4 corners) — the area drawn on the plan. */
  footprint: Point[];
  lengthPx: number;
  /** 0 when the thickness is unknown (a single face line confirmed manually as a wall). */
  thicknessPx: number;
  /** Confirmed by the user from measured lines, not by parallel-pair evidence. */
  manual?: boolean;
  /** A starting line the editor put down that the user has not moved onto the drawing yet: never measured. */
  placeholder?: boolean;
  /** Wall height entered for this wall; absent = the comparison's default wall height. */
  heightM?: number;
}

/**
 * A wall that moved: its removed and added positions matched as one change. Lengths are the
 * verified (both-faces) lengths of each side; nothing is extrapolated across gaps.
 */
export interface RevisionRelocation {
  beforeLengthPx: number;
  afterLengthPx: number;
  /** Perpendicular distance between the old and new centre lines. */
  offsetPx: number;
}

/** A long changed line that could be a wall face but has no verified partner — offered for manual confirmation. */
export interface RevisionWallCandidate {
  side: 'added' | 'removed';
  /** The drawn pieces of the line, in order; gaps (openings, crossings) are not part of it. */
  pieces: [Point, Point][];
  /** Total drawn length of the pieces. */
  lengthPx: number;
}

/** A door swing found as a quarter arc: the hinge and the closed-leaf jamb are the opening's endpoints. */
export interface RevisionDoor {
  /** Observed opening rectangle, cyclic corners with the first edge along its width. */
  footprint?: Point[];
  footprintShape?: 'rectangle' | 'polygon';
  /** Footprint checked against drawn jamb returns; otherwise a dashed location proposal. */
  geometryVerified?: boolean;
  /** Verified host-wall thickness, in native source-page px. */
  wallThicknessPx?: number;
  /** Verified window sill elevation. Doors start at floor level. */
  sillHeightM?: number;
  /** User confirmed endpoints, height, sill and host-wall thickness for quantity differences. */
  impactVerified?: boolean;
  side: 'added' | 'removed';
  hinge: Point;
  jamb: Point;
  radiusPx: number;
  /** Set by manual correction; absent = a door (what detection finds). */
  opening?: 'door' | 'window';
  /** Opening height entered by the user; absent = the default height for its type. */
  heightM?: number;
  /** A starting line the editor put down that the user has not moved onto the drawing yet: never measured. */
  placeholder?: boolean;
}

export type RevisionAiCategory =
  | 'wall' | 'door' | 'window' | 'room-boundary' | 'opening-other' | 'dimension' | 'text'
  | 'furniture' | 'fixture' | 'hatch' | 'structure' | 'mep' | 'noise' | 'other';

export interface RevisionAiLabel {
  category: RevisionAiCategory;
  changeType: 'added' | 'removed' | 'moved' | 'modified' | 'none';
  meaningful: boolean;
  confidence: number;
  summary: string;
}

export interface RevisionChange {
  id: string;
  /** Source page the change belongs to. */
  pageNumber: number;
  kind: RevisionChangeKind;
  category: RevisionChangeCategory;
  significance: RevisionSignificance;
  /** 0..1 ranking score from local evidence (and AI agreement, once classified). */
  score: number;
  /** Machine-readable evidence codes, shown translated in the review list. */
  evidence: string[];
  /** Short before/after strings of changed plan text (e.g. a dimension "320" → "350"). */
  textChanges?: { before: string[]; after: string[] };
  bbox: { x: number; y: number; width: number; height: number };
  /** Changed drawing lines, capped — for the on-plan marker only. Empty for image-based results. */
  addedSegments: RevisionSegment[];
  removedSegments: RevisionSegment[];
  walls: RevisionWall[];
  doors: RevisionDoor[];
  /** Set when removed and added walls were matched as one relocated wall. */
  relocation?: RevisionRelocation;
  /** Unverified wall-face lines, when no wall could be verified; the user may confirm them as a wall. */
  wallCandidates?: RevisionWallCandidate[];
  /** Total changed line length (px) on each side, for ranking and display. */
  addedLengthPx: number;
  removedLengthPx: number;
  ai?: RevisionAiLabel;
  /** Set when the change was proposed by the full-plan AI analysis. */
  aiProposal?: RevisionAiProposal;
  status: RevisionChangeStatus;
  /** Compare measurements this change created when approved (removed again when unapproved). */
  measurementIds?: string[];
  reviewedAt?: number;
  /** Classification chosen by the user while correcting the change. */
  userType?: RevisionEditType;
  /**
   * Geometry and classification corrected by the user: the walls/doors are user-placed on the
   * calibrated plan and are authoritative for quantities (AI labels no longer veto them).
   */
  edited?: boolean;
  /** Added by the user for a change the detection missed. */
  manual?: boolean;
}

export type AlignmentQualityStatus = 'good' | 'fair' | 'poor';

export interface AlignmentQuality {
  status: AlignmentQualityStatus;
  /** Mean distance (px) of matched drawing to its counterpart after refinement. */
  residualPx: number;
  /** Same, in millimetres on site, when the page is calibrated. */
  residualMm: number | null;
  /** Share of the revised drawing found on the base drawing within tolerance. */
  inlierRatio: number;
  /** Matching tolerance used (px). */
  tolerancePx: number;
  /** Small correction found by local refinement, applied on top of the user's alignment. */
  correction: { dx: number; dy: number; rotationDeg: number };
}

export interface RevisionAiRun {
  /** 'page' = full-plan AI analysis of both revisions; absent/'classify' = labels for existing proposals. */
  task?: 'classify' | 'page';
  requestId: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  requestDigest?: string;
  /** Change ids sent, in image order (C1, C2, …). */
  changeIds: string[];
  estimatedCostUsd?: number;
  submittedAt: number;
  updatedAt: number;
  error?: string;
  /** Full-plan analysis: the prepared raster/tile frame, needed to map tile-local answers to the page. */
  manifest?: RevisionPageManifest;
  /** Full-plan analysis: the revision alignment the images were rendered with. */
  alignment?: LayerTransform;
}

/** Frame of a full-plan revision analysis request (both revisions rendered into the source page frame). */
export interface RevisionPageManifest {
  preparationVersion: 'revision-page-v1';
  comparisonId: string;
  revisionId: string;
  baseRevisionId: string | null;
  pageNumber: number;
  context: ComparisonContext;
  sourceHash: string;
  revisedHash: string;
  nativeWidth: number;
  nativeHeight: number;
  renderScale: number;
  pageDimensions: [number, number];
  overviewDimensions: [number, number];
  tiles: { tileId: string; pageX: number; pageY: number; pageWidth: number; pageHeight: number; tileWidth: number; tileHeight: number }[];
}

export type RevisionAiChangeType =
  | 'wall-added' | 'wall-removed' | 'wall-relocated' | 'door-added' | 'door-removed'
  | 'window-added' | 'window-removed' | 'opening-modified' | 'room-boundary-changed';

/** Classifications offered when the user corrects or adds a change. */
export type RevisionEditType =
  | 'wall-added' | 'wall-removed' | 'wall-relocated' | 'door-added' | 'door-removed'
  | 'window-added' | 'window-removed' | 'opening-modified' | 'other';

/** What the full-plan AI analysis proposed, mapped to source-page px. Location evidence only — never a quantity. */
export interface RevisionAiProposal {
  /** Distinguishes persisted rectangle responses from legacy cached line-only answers. */
  geometryFormat?: 'opening-footprints-v1';
  changeType: RevisionAiChangeType;
  before: [Point, Point] | null;
  after: [Point, Point] | null;
  requiresReview: boolean;
  evidence: string[];
  /** Local check of the proposed geometry against the drawings. */
  verification: 'verified' | 'incomplete' | 'unverified' | 'conflict';
}

export interface RevisionPageAnalysis {
  pageNumber: number;
  /** Fingerprint of everything the result depends on; a different value means the result is stale. */
  inputKey: string;
  method: 'vector' | 'raster';
  /** Base the revision was compared against: null = the original plan. */
  baseRevisionId: string | null;
  createdAt: number;
  alignment: AlignmentQuality;
  /** Created to hold manually added changes only — no detection ran, so `alignment` is not a measurement. */
  manualOnly?: boolean;
  /** Alignment of this revision page the detection used (user alignment + refinement). */
  usedAlignment: LayerTransform;
  changes: RevisionChange[];
  /** How many candidate differences were filtered out as alignment noise, hatching or tiny marks. */
  filteredCount: number;
  ai?: RevisionAiRun;
}

export interface RevisionAnalysis {
  pages: Record<number, RevisionPageAnalysis>;
}

/** One application of approved revision changes to a takeoff plan. Stored on the plan (an append-only ledger). */
export interface RevisionApplication {
  id: string;
  comparisonId: string;
  revisionId: string;
  /** The base the revision was compared against when applied (null = the comparison's original). */
  baseRevisionId: string | null;
  context: ComparisonContext;
  appliedAt: number;
  status: 'applied' | 'reverted';
  revertedAt?: number;
  /** Snapshot of the plan taken immediately before this application (IndexedDB `planVersions`). */
  versionId: string;
  changes: {
    changeId: string;
    pageNumber: number;
    kind: RevisionChangeKind;
    category: RevisionChangeCategory;
    bbox: RevisionChange['bbox'];
  }[];
  /** What the application wrote: plan measurement ids, opening ids and room ids it touched. */
  measurementIds: string[];
  openingIds: string[];
  roomIds: string[];
  /** Items the application could not update safely, left for the user. */
  reviews: { changeId: string; roomId?: string; openingId?: string; reason: string }[];
}

/** A stored copy of a plan, taken before a revision application. */
/**
 * Display only: the revision drawing shown behind a plan's measurements. Coordinates stay in the
 * plan's own (original) page space; each page keeps the alignment the quantities were derived with.
 */
export interface RevisionBackdrop {
  comparisonId: string;
  revisionId: string;
  applicationId: string;
  /** How many of the revision's changes the plan's quantities reflect (absent on older plans). */
  coverage?: { applied: number; total: number };
  /** Plan page number → the revised sheet and the alignment that maps it into the plan's page space. */
  pages: Record<number, { revisedPageNumber: number; alignment: LayerTransform }>;
}

export interface PlanVersion {
  id: string;
  planId: string;
  createdAt: number;
  reason: 'revision-apply' | 'revision-revert';
  label: string;
  plan: unknown;
}
