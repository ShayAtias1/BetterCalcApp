import type { Point } from '../../types';
import type { RevisionChange, RevisionDoor, RevisionEditType, RevisionWall } from '../../types/revisionAnalysis';
import { OPENING_DEFAULT_SIZES } from '../../config/measurementDefaults';
import { distancePx } from '../geometry';
import { wallFootprintGeometry, isValidAreaPolygon } from '../areaGeometryEditing';
import { isRectangle } from '../zoneGeometry';

export function openingFootprint(d: RevisionDoor): Point[] | null {
  if (d.footprint && isValidAreaPolygon(d.footprint)) return d.footprint;
  return d.wallThicknessPx && d.wallThicknessPx > 0 && distancePx(d.hinge, d.jamb) > 0
    ? wallFromLine(d.side, d.hinge, d.jamb, d.wallThicknessPx).footprint : null;
}
export function openingGeometryNeedsVerification(c: RevisionChange): boolean {
  return c.doors.some(d => d.footprint && (d.geometryVerified !== true || d.impactVerified !== true
    || !(d.heightM && d.heightM > 0) || !(d.wallThicknessPx && d.wallThicknessPx > 0)
    || !d.opening || (d.opening === 'window' && d.sillHeightM == null)));
}

/** User-drawn corners provide the width and thickness without assumed dimensions. */
export function openingFromFootprint(side: EditSide, points: Point[], opening?: 'door' | 'window', shape: 'rectangle' | 'polygon' = isRectangle(points) ? 'rectangle' : 'polygon'): RevisionDoor | null {
  if (!isValidAreaPolygon(points) || (shape === 'rectangle' && !isRectangle(points))) return null;
  const geometry = wallFootprintGeometry(points, [points[0], points[1]]);
  return geometry ? { side, hinge: geometry.centerline[0], jamb: geometry.centerline[1], radiusPx: geometry.lengthPx,
    footprint: points.map(p => ({ ...p })), footprintShape: shape, wallThicknessPx: geometry.thicknessPx, geometryVerified: true,
    impactVerified: false, ...(opening ? { opening } : {}) } : null;
}

/** Shared Takeoff rectangle edit updates the opening's real width and wall thickness. */
export function setOpeningFootprint(c: RevisionChange, index: number, points: Point[]): RevisionChange {
  if (!isValidAreaPolygon(points)) return c;
  const original = c.doors[index];
  if (!original) return c;
  const geometry = wallFootprintGeometry(points, distancePx(original.hinge, original.jamb) > 0
    ? [original.hinge, original.jamb] : [points[0], points[1]]);
  if (!geometry) return c;
  return { ...c, doors: c.doors.map((d, i) => i === index ? { ...d, footprint: points.map(p => ({ ...p })),
    footprintShape: d.footprintShape ?? (isRectangle(points) ? 'rectangle' : 'polygon'),
    hinge: geometry.centerline[0], jamb: geometry.centerline[1], radiusPx: geometry.lengthPx,
    wallThicknessPx: geometry.thicknessPx, geometryVerified: true, impactVerified: false, placeholder: undefined } : d) };
}

/** Resize across the opening's measured axis while retaining every polygon vertex. */
export function setOpeningThickness(c: RevisionChange, index: number, thicknessPx: number | undefined): RevisionChange {
  const d = c.doors[index];
  if (!d) return c;
  const points = openingFootprint(d), length = distancePx(d.hinge, d.jamb);
  if (points && thicknessPx && thicknessPx > 0 && d.wallThicknessPx && d.wallThicknessPx > 0 && length > 0) {
    const nx = -(d.jamb.y-d.hinge.y)/length, ny = (d.jamb.x-d.hinge.x)/length;
    const factor = thicknessPx/d.wallThicknessPx-1;
    return setOpeningFootprint(c,index,points.map(p => {
      const offset = ((p.x-d.hinge.x)*nx+(p.y-d.hinge.y)*ny)*factor;
      return { x:p.x+nx*offset, y:p.y+ny*offset };
    }));
  }
  return { ...c, doors:c.doors.map((door,i) => i===index ? { ...door,wallThicknessPx:thicknessPx,impactVerified:false } : door) };
}

/**
 * Manual correction of detected revision changes. The user's lines replace whatever detection or
 * AI proposed: they are placed on the source page in native px and measured with the page
 * calibration like any other Compare measurement. New walls are drawn as real footprints;
 * opening corrections retain their endpoint editor.
 */

export const EDIT_TYPES: RevisionEditType[] = [
  'wall-added', 'wall-removed', 'wall-relocated',
  'door-added', 'door-removed', 'window-added', 'window-removed', 'opening-modified',
  'other',
];

export type EditFamily = 'wall' | 'opening' | 'other';
export type EditSide = 'added' | 'removed';
/** One editable line of a change: a wall centre line or an opening's two jambs. */
export interface EditElementRef {
  part?: number;
  list: 'walls' | 'doors';
  index: number;
}

export function familyOf(type: RevisionEditType): EditFamily {
  if (type.startsWith('wall')) return 'wall';
  return type === 'other' ? 'other' : 'opening';
}

/** Which sides a classification uses: added-only, removed-only, or both (moved / modified). */
export function sidesOf(type: RevisionEditType): EditSide[] {
  if (type.endsWith('-added')) return ['added'];
  if (type.endsWith('-removed')) return ['removed'];
  return type === 'other' ? [] : ['removed', 'added'];
}

/** The classification a change currently stands for: the user's choice, else read from its evidence. */
export function editTypeOf(c: RevisionChange): RevisionEditType {
  if (c.userType) return c.userType;
  if (c.aiProposal) return c.aiProposal.changeType === 'room-boundary-changed' ? 'other' : c.aiProposal.changeType;
  if (c.category === 'wall' || c.walls.length) {
    if (c.relocation) return 'wall-relocated';
    return c.kind === 'removed' ? 'wall-removed' : 'wall-added';
  }
  if (c.category === 'opening' || c.doors.length) {
    const window = c.doors[0]?.opening === 'window';
    if (c.kind === 'modified') return 'opening-modified';
    return `${window ? 'window' : 'door'}-${c.kind === 'removed' ? 'removed' : 'added'}` as RevisionEditType;
  }
  return 'other';
}

function strip(a: Point, b: Point, half: number): Point[] {
  const len = distancePx(a, b) || 1;
  const nx = (-(b.y - a.y) / len) * half;
  const ny = ((b.x - a.x) / len) * half;
  return [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }];
}

/** A wall from its centre line; an unknown thickness (0) gets a thin display strip only. */
export function wallFromLine(side: EditSide, a: Point, b: Point, thicknessPx: number, placeholder = false): RevisionWall {
  return {
    side,
    centerline: [a, b],
    footprint: strip(a, b, thicknessPx > 0 ? thicknessPx / 2 : 1),
    lengthPx: distancePx(a, b),
    thicknessPx,
    manual: true,
    ...(placeholder ? { placeholder: true } : {}),
  };
}

/** A manually drawn wall has a real footprint before it enters the document. */
export function wallFromFootprint(side: EditSide, points: Point[]): RevisionWall | null {
  if (!isValidAreaPolygon(points)) return null;
  if (points.length !== 4) {
    const index = points.reduce((best, p, i) => distancePx(p, points[(i + 1) % points.length]) > distancePx(points[best], points[(best + 1) % points.length]) ? i : best, 0);
    const geometry = wallFootprintGeometry(points, [points[index], points[(index + 1) % points.length]]);
    return geometry ? { side, footprint: points.map(p => ({ ...p })), ...geometry, manual: true } : null;
  }
  // The quantity engine expects the first edge along the run, regardless of which corner was clicked first.
  const along = distancePx(points[0], points[1]) + distancePx(points[2], points[3]);
  const across = distancePx(points[1], points[2]) + distancePx(points[3], points[0]);
  const footprint = (across > along ? [...points.slice(1), points[0]] : points).map(p => ({ ...p }));
  const geometry = wallFootprintGeometry(footprint, []);
  return geometry ? { side, footprint, ...geometry, manual: true } : null;
}

function openingFromLine(side: EditSide, a: Point, b: Point, opening: 'door' | 'window', heightM?: number, placeholder = false): RevisionDoor {
  return { side, hinge: a, jamb: b, radiusPx: distancePx(a, b), opening, ...(heightM ? { heightM } : {}), ...(placeholder ? { placeholder: true } : {}) };
}

/** True while any line of the change is still a starting line the user has not placed on the drawing. */
export function hasUnplacedLines(c: RevisionChange): boolean {
  return c.walls.some((w) => w.placeholder) || c.doors.some((d) => d.placeholder)
    || (!!c.aiProposal && c.category === 'opening' && sidesOf(editTypeOf(c)).some(side => !c.doors.some(d => d.side === side)))
    || (!!c.userType && familyOf(c.userType) === 'wall' && sidesOf(c.userType).some(side => !c.walls.some(w => w.side === side)));
}

/** A short horizontal placeholder centred on `at`, sized like the element it stands for (px when uncalibrated). */
function placeholder(at: Point, family: EditFamily, opening: 'door' | 'window', mpp: number): [Point, Point] {
  const meters = family === 'wall' ? 1 : OPENING_DEFAULT_SIZES[opening].widthM;
  const half = (mpp > 0 ? meters / mpp : 100) / 2;
  return [{ x: at.x - half, y: at.y }, { x: at.x + half, y: at.y }];
}

const bboxCenter = (c: RevisionChange): Point => ({ x: c.bbox.x + c.bbox.width / 2, y: c.bbox.y + c.bbox.height / 2 });

function linesOf(c: RevisionChange): { side: EditSide; a: Point; b: Point; thicknessPx: number; heightM?: number; placeholder?: boolean }[] {
  return [
    ...c.walls.map((w) => ({ side: w.side, a: w.centerline[0], b: w.centerline[1], thicknessPx: w.thicknessPx, placeholder: w.placeholder })),
    ...c.doors.map((d) => ({ side: d.side, a: d.hinge, b: d.jamb, thicknessPx: 0, heightM: d.heightM, placeholder: d.placeholder })),
  ];
}

/** The perpendicular step between a removed placeholder and its added counterpart (0.5 m, or 30 px). */
const step = (mpp: number) => (mpp > 0 ? 0.5 / mpp : 30);

/**
 * Reclassifies a change, keeping the user's lines where they are: wall ↔ opening lines convert
 * in place, sides follow the new type, and a missing side gets a placeholder next to the other.
 */
export function retypeChange(c: RevisionChange, type: RevisionEditType, mpp: number): RevisionChange {
  const family = familyOf(type);
  const sides = sidesOf(type);
  if (family === 'wall') {
    return { ...c, userType: type, doors: [], walls: c.walls.map(w => ({ ...w, side: sides.length === 1 ? sides[0] : w.side })) };
  }
  const opening: 'door' | 'window' = type.startsWith('window') ? 'window' : c.doors[0]?.opening === 'window' && type === 'opening-modified' ? 'window' : 'door';
  if (family === 'opening' && (c.aiProposal?.geometryFormat === 'opening-footprints-v1' || c.doors.some(d => d.footprint))) return { ...c, userType: type,
    walls: [], doors: c.doors.map(d => ({ ...d, ...(sides.length === 1 ? { side: sides[0] } : {}),
      opening: type === 'opening-modified' ? d.opening : opening })) };
  let lines = family === 'other' ? [] : linesOf(c);
  if (sides.length === 1) lines = lines.map((l) => ({ ...l, side: sides[0] }));
  for (const side of sides) {
    if (lines.some((l) => l.side === side)) continue;
    const other = lines[0];
    if (other) {
      const len = distancePx(other.a, other.b) || 1;
      const nx = (-(other.b.y - other.a.y) / len) * step(mpp);
      const ny = ((other.b.x - other.a.x) / len) * step(mpp);
      // A copy of the other side's line is only a starting position: the user still has to place it.
      lines.push({ ...other, side, a: { x: other.a.x + nx, y: other.a.y + ny }, b: { x: other.b.x + nx, y: other.b.y + ny }, placeholder: true });
    } else {
      const [a, b] = placeholder(bboxCenter(c), family, opening, mpp);
      lines.push({ side, a, b, thicknessPx: 0, placeholder: true });
    }
  }
  return {
    ...c,
    userType: type,
    walls: [],
    doors: family === 'opening' ? lines.map((l) => openingFromLine(l.side, l.a, l.b, opening, l.heightM, !!l.placeholder)) : [],
  };
}

/** Adds one placeholder line on `side`, next to the change's existing geometry. */
export function addElement(c: RevisionChange, side: EditSide, mpp: number): RevisionChange {
  const type = editTypeOf(c);
  const family = familyOf(type);
  if (family === 'other') return c;
  const opening = type.startsWith('window') || c.doors[0]?.opening === 'window' ? 'window' : 'door';
  const count = c.walls.length + c.doors.length;
  const center = bboxCenter(c);
  const [a, b] = placeholder({ x: center.x, y: center.y + count * step(mpp) * 0.6 }, family, opening, mpp);
  return family === 'wall'
    ? { ...c, userType: type, walls: [...c.walls, wallFromLine(side, a, b, 0, true)] }
    : { ...c, userType: type, doors: [...c.doors, openingFromLine(side, a, b, opening, undefined, true)] };
}

export function removeElement(c: RevisionChange, ref: EditElementRef): RevisionChange {
  return ref.list === 'walls'
    ? { ...c, userType: editTypeOf(c), walls: c.walls.filter((_, i) => i !== ref.index) }
    : { ...c, userType: editTypeOf(c), doors: c.doors.filter((_, i) => i !== ref.index) };
}

/**
 * The change line an approved item measures. Items saved before items recorded it are matched by
 * their centre line, which approval copied from the line.
 */
export function elementOfItem(c: RevisionChange, item: { revisionElement?: EditElementRef; centerline?: Point[] }): EditElementRef | null {
  if (item.revisionElement) return item.revisionElement;
  const cl = item.centerline;
  if (!cl || cl.length < 2) return null;
  const same = (a: Point, b: Point) => distancePx(a, b) < 0.5;
  const matches = (a: Point, b: Point) => same(cl[0], a) && same(cl[cl.length - 1], b);
  const wall = c.walls.findIndex((w) => matches(w.centerline[0], w.centerline[1]));
  if (wall >= 0) return { list: 'walls', index: wall };
  const door = c.doors.findIndex((d) => matches(d.hinge, d.jamb));
  return door >= 0 ? { list: 'doors', index: door } : null;
}

export function elementLine(c: RevisionChange, ref: EditElementRef): [Point, Point] | null {
  if (ref.list === 'walls') return c.walls[ref.index]?.centerline ?? null;
  const d = c.doors[ref.index];
  return d ? [d.hinge, d.jamb] : null;
}

/** Moves an element's endpoints; the rest of the element (side, thickness, height) is kept. Moving places it. */
export function setElementLine(c: RevisionChange, ref: EditElementRef, a: Point, b: Point): RevisionChange {
  if (ref.list === 'walls') {
    return { ...c, userType: editTypeOf(c), walls: c.walls.map((w, i) => (i === ref.index ? { ...wallFromLine(w.side, a, b, w.thicknessPx), ...(w.heightM ? { heightM: w.heightM } : {}) } : w)) };
  }
  return { ...c, userType: editTypeOf(c), doors: c.doors.map((d, i) => (i === ref.index ? { ...d, hinge: a, jamb: b, radiusPx: distancePx(a, b), placeholder: undefined, impactVerified: false,
    ...(d.wallThicknessPx && d.footprint ? { footprint: wallFromLine(d.side, a, b, d.wallThicknessPx).footprint } : {}) } : d)) };
}

/** Keep the corrected footprint authoritative. Its end-face midpoints define the wall run;
 * area / run length gives the mean thickness for a tapered or skewed quadrilateral. */
export function setWallFootprint(c: RevisionChange, index: number, points: Point[]): RevisionChange {
  const wall = c.walls[index];
  if (!wall) return c;
  const geometry = wallFootprintGeometry(points, wall.centerline);
  if (!geometry) return c;
  return {
    ...c,
    userType: editTypeOf(c),
    walls: c.walls.map((wall, i) => i === index ? {
      ...wall, footprint: points.map((p) => ({ ...p })), ...geometry, manual: true, placeholder: undefined,
    } : wall),
  };
}

/** A wall's own height (absent = the comparison default); its line stays where it is. */
export function setWallHeight(c: RevisionChange, index: number, heightM: number | undefined): RevisionChange {
  return { ...c, userType: editTypeOf(c), walls: c.walls.map((w, i) => (i === index ? { ...w, heightM } : w)) };
}

export function setOpeningHeight(c: RevisionChange, index: number, heightM: number | undefined): RevisionChange {
  return { ...c, userType: editTypeOf(c), doors: c.doors.map((d, i) => (i === index ? { ...d, heightM, impactVerified: false } : d)) };
}

/** Distance of point p from the infinite line through a, b. */
function lineDistance(a: Point, b: Point, p: Point): number {
  const len = distancePx(a, b);
  if (!len) return distancePx(a, p);
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
}

/**
 * Brings a corrected change back into a consistent state: kind/category from its classification,
 * relocation figures and bbox from the user's lines, and the AI/detection gates lifted — the user
 * has placed the geometry, so it is what gets measured.
 */
export function finalizeEditedChange(c: RevisionChange): RevisionChange {
  const type = editTypeOf(c);
  const family = familyOf(type);
  const kind = type.endsWith('-added') ? 'added' : type.endsWith('-removed') ? 'removed' : 'modified';
  const removed = c.walls.filter((w) => w.side === 'removed');
  const added = c.walls.filter((w) => w.side === 'added');
  const relocation = type === 'wall-relocated' && removed.length && added.length
    ? {
      beforeLengthPx: removed.reduce((sum, w) => sum + w.lengthPx, 0),
      afterLengthPx: added.reduce((sum, w) => sum + w.lengthPx, 0),
      offsetPx: lineDistance(removed[0].centerline[0], removed[0].centerline[1], {
        x: (added[0].centerline[0].x + added[0].centerline[1].x) / 2,
        y: (added[0].centerline[0].y + added[0].centerline[1].y) / 2,
      }),
    }
    : undefined;
  const pts = [...c.walls.flatMap((w) => w.footprint), ...c.doors.flatMap((d) => [d.hinge, d.jamb])];
  let bbox = c.bbox;
  if (pts.length) {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const pad = 6;
    const x = Math.min(...xs) - pad;
    const y = Math.min(...ys) - pad;
    bbox = { x, y, width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y };
  }
  return {
    ...c,
    userType: type,
    kind,
    category: family === 'other' ? 'other' : family,
    relocation,
    wallCandidates: undefined,
    bbox,
    significance: 'high',
    edited: true,
    evidence: c.evidence.includes('manual-edit') ? c.evidence : [...c.evidence, 'manual-edit'],
  };
}

/** The short plan note for a change: what happened, in a few words ("Opening widened", "Wall moved"). */
export function changeNoteKey(c: RevisionChange): string | null {
  if (c.aiProposal?.changeType === 'room-boundary-changed' && !c.userType) return 'revisionAi.note.roomBoundary';
  const type = editTypeOf(c);
  if (type === 'opening-modified') {
    const width = (side: 'added' | 'removed') => c.doors.filter((d) => d.side === side && !d.placeholder).reduce((m, d) => Math.max(m, distancePx(d.hinge, d.jamb)), 0);
    const before = width('removed');
    const after = width('added');
    if (before > 0 && after > 0 && Math.abs(after - before) > Math.max(before, after) * 0.05) return after > before ? 'revisionAi.note.openingWidened' : 'revisionAi.note.openingNarrowed';
  }
  if (type === 'other' && c.category === 'unknown') return null;
  return `revisionAi.note.${type}`;
}
