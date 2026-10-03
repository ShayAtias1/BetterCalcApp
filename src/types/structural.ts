// Concrete and Rebar takeoff: two zone-based domains that live inside a Plan next to — never inside —
// its rooms. The user marks a zone on the plan, then says what exists there; the quantity is
// calculated from the zone's geometry, the page scale and those parameters (lib/concrete, lib/rebar).
// Both arrays are optional on `Plan`: plans saved before they existed simply do not have them, and
// every reader goes through `lib/structuralPlan` so a missing array is an empty one.
//
// All points are native page pixels, like every other persisted point. There is no floor field —
// grouping is by plan and page — and no link between a concrete element and rebar.

import type { Point } from './index';
import type { MarkFields } from '../lib/structuralMarks';

/**
 * A replacement for the zone's measured size, entered by hand in metres. For zones where the drawn
 * outline is not the point (a column given by its section) or the page has no scale. Always a
 * rectangle: `lengthM × widthM`.
 */
export interface SizeOverride {
  lengthM: number;
  widthM: number;
}

// ---------- Concrete ----------

export type ConcreteKind = 'slab' | 'wall' | 'beam' | 'column';

/**
 * One concrete zone. The kind picks the label and the form, not the formula:
 * `volume = footprint area × depthM × quantity`, where `depthM` is the slab's thickness or the
 * wall's, beam's or column's height. A wall or beam is its plan footprint, drawn as a rectangle.
 */
export interface ConcreteElement extends MarkFields {
  id: string;
  pageNumber: number;
  kind: ConcreteKind;
  /** Footprint outline, native page pixels. */
  points: Point[];
  // `mark` / `markManual` / `autoNumber`: the user's own mark, or an automatic number shown as
  // "Slab 01" in the language on screen — see lib/structuralMarks.
  /** Optional concrete grade, free text (e.g. "B30"); empty = unspecified. */
  grade?: string;
  /** Thickness (slab) or height (wall, beam, column) in metres. Undefined = not entered yet, which is "not calculable", not 0. */
  depthM?: number;
  /** How many identical elements this zone stands for. Absent = 1. */
  quantity?: number;
  /** Waste %, 0–100. Absent = 0. */
  wastePercent?: number;
  sizeOverride?: SizeOverride;
}

// ---------- Rebar ----------

/** Which side of a rectangular zone a layer's bars run along. */
export type RebarLayerDirection = 'long' | 'short';

/** One directional bar group: bars of one diameter at one spacing, running one way. (The pre-levels "layer", still the unit the engine calculates.) */
export interface RebarLayer {
  id: string;
  /** Bar diameter in millimetres. */
  diameterMm: number;
  /** The specified spacing, in metres, taken as the MAXIMUM spacing (see lib/rebar for the count rule). */
  spacingM: number;
  direction: RebarLayerDirection;
}

/** The two reinforcement levels of a slab-like zone. These — and only these — are "layers" of steel. */
export type RebarLevel = 'bottom' | 'top';

/** One bar specification: bars of one diameter at one maximum spacing (metres). 0 = not entered yet. */
export interface BarSpec {
  diameterMm: number;
  spacingM: number;
}

/**
 * The reinforcement of ONE level of a mesh zone, in one of two modes:
 *  - uniform:     one specification that applies to BOTH orthogonal directions;
 *  - directional: a specification per direction — along the long side and along the short side of the
 *                 zone — which belong to the same level and may differ in diameter and spacing.
 * A directional level may have only one direction (that is how a single old layer is read); the
 * form always offers both. `extra` only ever holds old layers that could not be placed (a second
 * layer in the same direction) so they keep calculating until the user removes them.
 */
export type MeshReinforcement =
  | { mode: 'uniform'; spec: BarSpec }
  | { mode: 'directional'; long?: BarSpec; short?: BarSpec; extra?: RebarLayer[] };

/**
 * Area reinforcement: a marked zone plus its reinforcement levels. A level that is present is
 * enabled (Bottom, Top, or both); an absent one does not exist. Each level is specified on its own —
 * Top is never assumed to equal Bottom.
 *
 * `layers` is the pre-levels shape (a flat list of directional layers). It is only read from old
 * data: `rebarOf` returns every mesh already converted (see lib/rebarMesh) and nothing writes it.
 */
export interface RebarMesh extends MarkFields {
  id: string;
  kind: 'mesh';
  pageNumber: number;
  points: Point[];
  bottom?: MeshReinforcement;
  top?: MeshReinforcement;
  /** @deprecated pre-levels data only. */
  layers?: RebarLayer[];
  wastePercent?: number;
  sizeOverride?: SizeOverride;
}

/** Bars entered by quantity — no shape on the plan: diameter, how many, how long each. */
export interface RebarBars extends MarkFields {
  id: string;
  kind: 'bars';
  /** The page the row was added on; only used to group the summary. */
  pageNumber: number;
  diameterMm: number;
  count: number;
  lengthM: number;
  wastePercent?: number;
}

export type RebarItem = RebarMesh | RebarBars;
