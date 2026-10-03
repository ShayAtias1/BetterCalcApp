// Concrete and Rebar takeoff: two zone-based domains that live inside a Plan next to — never inside —
// its rooms. The user marks a zone on the plan, then says what exists there; the quantity is
// calculated from the zone's geometry, the page scale and those parameters (lib/concrete, lib/rebar).
// Both arrays are optional on `Plan`: plans saved before they existed simply do not have them, and
// every reader goes through `lib/structuralPlan` so a missing array is an empty one.
//
// All points are native page pixels, like every other persisted point. There is no floor field —
// grouping is by plan and page — and no link between a concrete element and rebar.

import type { Point } from './index';

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
export interface ConcreteElement {
  id: string;
  pageNumber: number;
  kind: ConcreteKind;
  /** Footprint outline, native page pixels. */
  points: Point[];
  /** Auto-numbered per kind and plan (S01, W01, B01, C01); editable. */
  mark: string;
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

/** One reinforcement layer of a mesh zone: bars of one diameter at one spacing, running one way. */
export interface RebarLayer {
  id: string;
  /** Bar diameter in millimetres. */
  diameterMm: number;
  /** The specified spacing, in metres, taken as the MAXIMUM spacing (see lib/rebar for the count rule). */
  spacingM: number;
  direction: RebarLayerDirection;
}

/** Area reinforcement: a marked zone plus the layers that exist in it. */
export interface RebarMesh {
  id: string;
  kind: 'mesh';
  pageNumber: number;
  points: Point[];
  mark: string;
  layers: RebarLayer[];
  wastePercent?: number;
  sizeOverride?: SizeOverride;
}

/** Bars entered by quantity — no shape on the plan: diameter, how many, how long each. */
export interface RebarBars {
  id: string;
  kind: 'bars';
  /** The page the row was added on; only used to group the summary. */
  pageNumber: number;
  mark: string;
  diameterMm: number;
  count: number;
  lengthM: number;
  wastePercent?: number;
}

export type RebarItem = RebarMesh | RebarBars;
