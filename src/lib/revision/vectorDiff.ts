import type { Point } from '../../types';
import type {
  RevisionChange,
  RevisionChangeCategory,
  RevisionChangeKind,
  RevisionDoor,
  RevisionRelocation,
  RevisionWallCandidate,
  RevisionSegment,
  RevisionSignificance,
  RevisionWall,
} from '../../types/revisionAnalysis';
import type { VectorArc, VectorPage, VectorText } from './vectorExtract';
import { createGrid, distanceField, lookup, rasterizeSegments, sampleSegments, type InkGrid } from './fields';

/**
 * Vector change detection between two drawings already in the same (source page) coordinate space.
 *
 * 1. Every drawing line is sampled; a sample is *matched* when the other drawing has ink within the
 *    tolerance — so small alignment error and different line weights never count as changes.
 * 2. Consecutive unmatched samples form changed runs; runs and changed texts close to each other
 *    are grouped into candidate regions.
 * 3. Each region is scored from geometric evidence: parallel line pairs of wall thickness, door
 *    swing arcs, hatching, text, near-miss offsets. Only regions with strong evidence are "high".
 *
 * Extracted lines are never assumed to be walls: a wall needs two parallel lines at a plausible
 * thickness and length, and even then the user approves it.
 */

export interface DetectionScale {
  /** Metres per source px, 0 when the page is not calibrated. */
  metersPerPixel: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiffInput {
  base: VectorPage;
  revised: VectorPage;
  pageWidth: number;
  pageHeight: number;
  /** Polygons (source px) where both drawings exist; samples outside are ignored. */
  validAreas: Point[][];
  exclusions: Rect[];
  scale: DetectionScale;
  tolerancePx: number;
  pageNumber: number;
  newId: () => string;
}

export interface DiffResult {
  changes: RevisionChange[];
  filteredCount: number;
}

/** Thresholds in px, derived from real-world sizes when the page is calibrated. */
export function detectionThresholds(mpp: number) {
  const px = (m: number, fallback: number, min = 0, max = Infinity) => (mpp > 0 ? Math.min(max, Math.max(min, m / mpp)) : fallback);
  return {
    tolerancePx: px(0.04, 2.5, 1.5, 6),
    linkPx: px(0.35, 15, 8, 60),
    minLengthPx: px(0.3, 12),
    wallMinPx: px(0.4, 20),
    wallThicknessMin: px(0.05, 2),
    wallThicknessMax: px(0.45, 25),
    doorRadiusMin: px(0.55, 12),
    doorRadiusMax: px(1.3, 80),
    mediumLengthPx: px(1.5, 60),
    openingGapMax: px(1.3, 60),
    relocationMaxShift: px(3, 150),
    textSegmentMax: px(0.15, 6),
    hatchSpacingMax: px(0.25, 12),
    cloudArcMax: px(0.3, 14),
  };
}

interface Run {
  side: 'added' | 'removed';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  len: number;
  curve: boolean;
  /** Mean distance (px) of the run's samples to the other drawing, capped. */
  dist: number;
}

interface TextItem {
  side: 'added' | 'removed';
  text: VectorText;
}

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function inRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height;
}

function changedRuns(
  side: 'added' | 'removed',
  page: VectorPage,
  otherGrid: InkGrid,
  otherField: Float32Array,
  spacing: number,
  tol: number,
  valid: (p: Point) => boolean,
): Run[] {
  const { xs, ys, owner } = sampleSegments(page.segments, spacing);
  const runs: Run[] = [];
  let i = 0;
  while (i < xs.length) {
    const seg = owner[i];
    let j = i;
    while (j < xs.length && owner[j] === seg) j++;
    // Samples i..j-1 belong to one segment, in order along it.
    let k = i;
    while (k < j) {
      const d = lookup(otherGrid, otherField, xs[k], ys[k]);
      const p = { x: xs[k], y: ys[k] };
      if (d > tol && Number.isFinite(d) && valid(p)) {
        let end = k;
        let sum = Math.min(d, tol * 20);
        while (end + 1 < j) {
          const dn = lookup(otherGrid, otherField, xs[end + 1], ys[end + 1]);
          if (!(dn > tol && Number.isFinite(dn)) || !valid({ x: xs[end + 1], y: ys[end + 1] })) break;
          end++;
          sum += Math.min(dn, tol * 20);
        }
        const count = end - k + 1;
        if (count >= 2) {
          const len = Math.hypot(xs[end] - xs[k], ys[end] - ys[k]);
          if (len > 0) {
            runs.push({ side, x1: xs[k], y1: ys[k], x2: xs[end], y2: ys[end], len, curve: page.curve[seg] === 1, dist: sum / count });
          }
        }
        k = end + 1;
      } else k++;
    }
    i = j;
  }
  return runs;
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, '').replace(/["'״׳]/g, '');
}

function changedTexts(base: VectorText[], revised: VectorText[], tol: number, valid: (p: Point) => boolean): TextItem[] {
  const out: TextItem[] = [];
  const matches = (t: VectorText, pool: VectorText[]) => {
    const key = normalizeText(t.str);
    const reach = Math.max(tol * 3, t.height * 0.6);
    return pool.some((o) => normalizeText(o.str) === key && Math.abs(o.x - t.x) <= reach && Math.abs(o.y - t.y) <= reach);
  };
  for (const t of revised) if (valid({ x: t.x + t.width / 2, y: t.y + t.height / 2 }) && !matches(t, base)) out.push({ side: 'added', text: t });
  for (const t of base) if (valid({ x: t.x + t.width / 2, y: t.y + t.height / 2 }) && !matches(t, revised)) out.push({ side: 'removed', text: t });
  return out;
}

class UnionFind {
  parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Groups boxes whose gap is at most `link` px. Returns a group index per box. */
export function clusterBoxes(boxes: Box[], link: number): number[] {
  const uf = new UnionFind(boxes.length);
  const bucket = Math.max(link * 2, 1);
  const grid = new Map<string, number[]>();
  boxes.forEach((b, i) => {
    const gx0 = Math.floor((b.x0 - link / 2) / bucket);
    const gy0 = Math.floor((b.y0 - link / 2) / bucket);
    const gx1 = Math.floor((b.x1 + link / 2) / bucket);
    const gy1 = Math.floor((b.y1 + link / 2) / bucket);
    if ((gx1 - gx0 + 1) * (gy1 - gy0 + 1) > 400) {
      // A very long item: compare it against everything later through a coarse list.
      const key = 'long';
      const list = grid.get(key) ?? [];
      list.push(i);
      grid.set(key, list);
      return;
    }
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const key = `${gx}:${gy}`;
        const list = grid.get(key) ?? [];
        list.push(i);
        grid.set(key, list);
      }
    }
  });
  const near = (a: Box, b: Box) => a.x0 - link <= b.x1 && b.x0 - link <= a.x1 && a.y0 - link <= b.y1 && b.y0 - link <= a.y1;
  const longs = grid.get('long') ?? [];
  for (const [key, list] of grid) {
    if (key === 'long') continue;
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) if (near(boxes[list[a]], boxes[list[b]])) uf.union(list[a], list[b]);
      for (const l of longs) if (near(boxes[list[a]], boxes[l])) uf.union(list[a], l);
    }
  }
  for (let a = 0; a < longs.length; a++) for (let b = a + 1; b < longs.length; b++) if (near(boxes[longs[a]], boxes[longs[b]])) uf.union(longs[a], longs[b]);
  return boxes.map((_, i) => uf.find(i));
}

function angleOf(r: Run): number {
  let a = Math.atan2(r.y2 - r.y1, r.x2 - r.x1);
  if (a < 0) a += Math.PI;
  if (a >= Math.PI) a -= Math.PI;
  return a;
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % Math.PI;
  return Math.min(d, Math.PI - d);
}

/** The largest family of evenly spaced parallel short lines — hatching. Returns the member indexes. */
function hatchFamily(runs: Run[], spacingMax: number, maxMemberLength: number): Set<number> {
  // Hatch strokes are short; a line as long as a wall run is a wall face (or other real drawing),
  // even when parallel faces of neighbouring walls and jambs sit at hatch-like spacing.
  const straight = runs.map((r, i) => ({ r, i, a: angleOf(r) })).filter((x) => !x.r.curve && x.r.len < maxMemberLength);
  const bins = new Map<number, typeof straight>();
  for (const s of straight) {
    const key = Math.round((s.a * 180) / Math.PI / 3) % 60;
    const list = bins.get(key) ?? [];
    list.push(s);
    bins.set(key, list);
  }
  let best: typeof straight = [];
  for (const list of bins.values()) if (list.length > best.length) best = list;
  if (best.length < 6) return new Set();
  const a = best[0].a;
  const n = { x: -Math.sin(a), y: Math.cos(a) };
  const offsets = best.map((s) => ((s.r.x1 + s.r.x2) / 2) * n.x + ((s.r.y1 + s.r.y2) / 2) * n.y).sort((p, q) => p - q);
  const lines: number[] = [];
  for (const o of offsets) if (!lines.length || o - lines[lines.length - 1] > 0.75) lines.push(o);
  if (lines.length < 4) return new Set();
  const gaps = lines.slice(1).map((o, i) => o - lines[i]);
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length);
  if (mean > spacingMax || sd / mean > 0.35) return new Set();
  return new Set(best.map((s) => s.i));
}

/**
 * A wall face as drawn: collinear changed pieces on one side, joined across short gaps (an opening,
 * a crossing wall). Only the drawn intervals count as length — a gap is never filled in.
 */
interface FaceLine {
  side: 'added' | 'removed';
  angle: number;
  ux: number;
  uy: number;
  ox: number;
  oy: number;
  /** n·p of every point on the line, n = (-uy, ux). */
  offset: number;
  /** Drawn intervals along u (from o), sorted and disjoint. */
  intervals: [number, number][];
}

function covered(line: FaceLine): number {
  return line.intervals.reduce((s, [a, b]) => s + (b - a), 0);
}

function insertInterval(intervals: [number, number][], lo: number, hi: number, join: number): [number, number][] {
  const all = [...intervals, [lo, hi] as [number, number]].sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const [a, b] of all) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + join) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function faceLines(runs: Run[], side: 'added' | 'removed', t: ReturnType<typeof detectionThresholds>, tol: number, exclude: Set<Run>): FaceLine[] {
  const pieces = runs.filter((r) => r.side === side && !r.curve && !exclude.has(r) && r.len >= tol * 2).sort((a, b) => b.len - a.len);
  if (pieces.length > 600) pieces.length = 600;
  const lines: FaceLine[] = [];
  const maxAngle = (1.5 * Math.PI) / 180;
  for (const r of pieces) {
    const a = angleOf(r);
    const mx = (r.x1 + r.x2) / 2;
    const my = (r.y1 + r.y2) / 2;
    let target: FaceLine | null = null;
    let lo = 0;
    let hi = 0;
    for (const line of lines) {
      if (angleDiff(line.angle, a) > maxAngle) continue;
      if (Math.abs(-line.uy * mx + line.ux * my - line.offset) > tol * 1.5) continue;
      const p1 = (r.x1 - line.ox) * line.ux + (r.y1 - line.oy) * line.uy;
      const p2 = (r.x2 - line.ox) * line.ux + (r.y2 - line.oy) * line.uy;
      const plo = Math.min(p1, p2);
      const phi = Math.max(p1, p2);
      const gap = Math.min(...line.intervals.map(([ia, ib]) => Math.max(0, plo - ib, ia - phi)));
      if (gap > t.openingGapMax) continue;
      target = line;
      lo = plo;
      hi = phi;
      break;
    }
    if (target) {
      target.intervals = insertInterval(target.intervals, lo, hi, tol * 1.5);
    } else {
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const p1 = (r.x1 - r.x1) * ux + (r.y1 - r.y1) * uy;
      const p2 = (r.x2 - r.x1) * ux + (r.y2 - r.y1) * uy;
      lines.push({ side, angle: a, ux, uy, ox: r.x1, oy: r.y1, offset: -uy * r.x1 + ux * r.y1, intervals: [[Math.min(p1, p2), Math.max(p1, p2)]] });
    }
  }
  return lines;
}

function lineAt(line: FaceLine, s: number, off: number): Point {
  return { x: line.ox + line.ux * s - line.uy * off, y: line.oy + line.uy * s + line.ux * off };
}

/**
 * Walls of one side: pairs of parallel face lines at a plausible wall thickness. A pair yields one
 * wall piece per interval where *both* faces are drawn, so an opening or a crossing line splits the
 * wall instead of being measured as wall.
 */
function clipIntervals(intervals: [number, number][], lo: number, hi: number): [number, number][] {
  return intervals.map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)] as [number, number]).filter(([a, b]) => b > a);
}

function wallPairs(runs: Run[], side: 'added' | 'removed', t: ReturnType<typeof detectionThresholds>, tol: number, exclude: Set<Run>): { walls: RevisionWall[]; incomplete: RevisionWallCandidate[] } {
  const lines = faceLines(runs, side, t, tol, exclude).filter((l) => covered(l) >= t.wallMinPx * 0.75);
  const candidates: { i: number; j: number; overlap: number; walls: RevisionWall[]; incomplete?: RevisionWallCandidate }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i];
    for (let j = i + 1; j < lines.length; j++) {
      const b = lines[j];
      if (angleDiff(a.angle, b.angle) > (2.5 * Math.PI) / 180) continue;
      const [b0, b1] = b.intervals[0];
      const bp = lineAt(b, (b0 + b1) / 2, 0);
      const sep = -a.uy * bp.x + a.ux * bp.y - a.offset;
      const absSep = Math.abs(sep);
      if (absSep < t.wallThicknessMin || absSep > t.wallThicknessMax) continue;
      // b's intervals in a's parameter (directions may be opposite across the 0/180° wrap).
      const dir = a.ux * b.ux + a.uy * b.uy >= 0 ? 1 : -1;
      const shift = (b.ox - a.ox) * a.ux + (b.oy - a.oy) * a.uy;
      const mapped = b.intervals.map(([p, q]) => {
        const x = shift + p * dir;
        const y = shift + q * dir;
        return [Math.min(x, y), Math.max(x, y)] as [number, number];
      });
      const pieces: [number, number][] = [];
      for (const [p, q] of a.intervals) {
        for (const [r, s2] of mapped) {
          const lo = Math.max(p, r);
          const hi = Math.min(q, s2);
          if (hi - lo >= tol * 2) pieces.push([lo, hi]);
        }
      }
      const overlap = pieces.reduce((sum, [lo, hi]) => sum + (hi - lo), 0);
      if (overlap < t.wallMinPx * 0.75) continue;
      // Completeness: both faces of one wall are drawn along the same run. Over the faces' combined
      // extent each must be drawn about as much as the other; a face partly missing (e.g. lying on
      // an unrelated existing line, so not "changed") would make the pair — and the wall length —
      // shorter than the wall really is. Small differences (corner returns) are tolerated.
      const w0 = Math.min(a.intervals[0][0], ...mapped.map((m) => m[0]));
      const w1 = Math.max(a.intervals[a.intervals.length - 1][1], ...mapped.map((m) => m[1]));
      const coverA = clipIntervals(a.intervals, w0, w1).reduce((sum, [lo, hi]) => sum + (hi - lo), 0);
      const coverB = clipIntervals(mapped, w0, w1).reduce((sum, [lo, hi]) => sum + (hi - lo), 0);
      const shortfall = Math.max(coverA, coverB) - Math.min(coverA, coverB);
      if (Math.min(coverA, coverB) < 0.85 * Math.max(coverA, coverB) && shortfall > Math.max(absSep * 2, tol * 4)) {
        // Not verified: offer the more completely drawn face for manual confirmation instead.
        const pieces2 = coverA >= coverB
          ? clipIntervals(a.intervals, w0, w1).map(([lo, hi]) => [lineAt(a, lo, 0), lineAt(a, hi, 0)] as [Point, Point])
          : clipIntervals(mapped, w0, w1).map(([lo, hi]) => [lineAt(a, lo, sep), lineAt(a, hi, sep)] as [Point, Point]);
        candidates.push({
          i, j, overlap, walls: [],
          incomplete: { side, pieces: pieces2.filter(([p1, p2]) => Math.hypot(p2.x - p1.x, p2.y - p1.y) >= tol * 2), lengthPx: Math.max(coverA, coverB) },
        });
        continue;
      }
      candidates.push({
        i,
        j,
        overlap,
        walls: pieces.map(([lo, hi]) => ({
          side,
          centerline: [lineAt(a, lo, sep / 2), lineAt(a, hi, sep / 2)],
          footprint: [lineAt(a, lo, 0), lineAt(a, hi, 0), lineAt(a, hi, sep), lineAt(a, lo, sep)],
          lengthPx: hi - lo,
          thicknessPx: absSep,
        })),
      });
    }
  }
  candidates.sort((p, q) => q.overlap - p.overlap);
  const used = new Set<number>();
  const walls: RevisionWall[] = [];
  const incomplete: RevisionWallCandidate[] = [];
  for (const c of candidates) {
    if (used.has(c.i) || used.has(c.j)) continue;
    used.add(c.i);
    used.add(c.j);
    walls.push(...c.walls);
    if (c.incomplete?.pieces.length) incomplete.push(c.incomplete);
  }
  return { walls, incomplete };
}

/** Long unverified face lines, offered to the user as "confirm as wall" when no wall pair exists. */
function wallCandidates(runs: Run[], t: ReturnType<typeof detectionThresholds>, tol: number, exclude: Set<Run>): RevisionWallCandidate[] {
  const out: RevisionWallCandidate[] = [];
  for (const side of ['removed', 'added'] as const) {
    faceLines(runs, side, t, tol, exclude)
      .filter((l) => covered(l) >= t.wallMinPx * 1.25)
      .sort((a, b) => covered(b) - covered(a))
      .slice(0, 4)
      .forEach((l) => out.push({
        side,
        pieces: l.intervals.filter(([a, b]) => b - a >= tol * 2).map(([a, b]) => [lineAt(l, a, 0), lineAt(l, b, 0)] as [Point, Point]),
        lengthPx: covered(l),
      }));
  }
  return out;
}

function wallAngle(w: RevisionWall): number {
  let a = Math.atan2(w.centerline[1].y - w.centerline[0].y, w.centerline[1].x - w.centerline[0].x);
  if (a < 0) a += Math.PI;
  if (a >= Math.PI) a -= Math.PI;
  return a;
}

/**
 * Recognises one wall moved to a new position: removed and added walls parallel to each other,
 * offset sideways (more than the matching tolerance, at most `maxShiftPx`), overlapping along their
 * run and of comparable verified length. Returns nothing when the match is not clear.
 */
export function matchRelocation(walls: RevisionWall[], tolPx: number, maxShiftPx: number): RevisionRelocation | undefined {
  const removed = walls.filter((w) => w.side === 'removed');
  const added = walls.filter((w) => w.side === 'added');
  if (!removed.length || !added.length) return undefined;
  const ref = [...removed].sort((a, b) => b.lengthPx - a.lengthPx)[0];
  const refAngle = wallAngle(ref);
  const parallel = (w: RevisionWall) => angleDiff(wallAngle(w), refAngle) <= (3 * Math.PI) / 180;
  const before = removed.filter(parallel);
  const after = added.filter(parallel);
  if (!after.length) return undefined;
  const ux = Math.cos(refAngle);
  const uy = Math.sin(refAngle);
  const o = ref.centerline[0];
  const along = (p: Point) => (p.x - o.x) * ux + (p.y - o.y) * uy;
  const across = (p: Point) => -uy * (p.x - o.x) + ux * (p.y - o.y);
  const span = (ws: RevisionWall[]) => {
    const v = ws.flatMap((w) => w.centerline.map(along));
    return [Math.min(...v), Math.max(...v)];
  };
  const mid = (w: RevisionWall) => ({ x: (w.centerline[0].x + w.centerline[1].x) / 2, y: (w.centerline[0].y + w.centerline[1].y) / 2 });
  const weightedAcross = (ws: RevisionWall[]) => ws.reduce((s, w) => s + across(mid(w)) * w.lengthPx, 0) / ws.reduce((s, w) => s + w.lengthPx, 0);
  const offset = Math.abs(weightedAcross(after) - weightedAcross(before));
  if (offset < tolPx * 2 || offset > maxShiftPx) return undefined;
  const [b0, b1] = span(before);
  const [a0, a1] = span(after);
  const overlap = Math.min(b1, a1) - Math.max(b0, a0);
  if (overlap < 0.5 * Math.min(b1 - b0, a1 - a0)) return undefined;
  const beforeLengthPx = before.reduce((s, w) => s + w.lengthPx, 0);
  const afterLengthPx = after.reduce((s, w) => s + w.lengthPx, 0);
  if (Math.min(beforeLengthPx, afterLengthPx) < 0.5 * Math.max(beforeLengthPx, afterLengthPx)) return undefined;
  return { beforeLengthPx: Math.round(beforeLengthPx * 10) / 10, afterLengthPx: Math.round(afterLengthPx * 10) / 10, offsetPx: Math.round(offset * 10) / 10 };
}

function arcMidpoint(arc: VectorArc): Point {
  const a0 = Math.atan2(arc.start.y - arc.center.y, arc.start.x - arc.center.x);
  const a1 = Math.atan2(arc.end.y - arc.center.y, arc.end.x - arc.center.x);
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const m = a0 + d / 2;
  return { x: arc.center.x + Math.cos(m) * arc.radius, y: arc.center.y + Math.sin(m) * arc.radius };
}

function doorFromArc(arc: VectorArc, side: 'added' | 'removed', page: VectorPage): RevisionDoor {
  // The leaf is drawn as a line from the hinge to one end of the swing; the other end is the jamb.
  const near = arc.radius * 0.12;
  let leafEnd: Point | null = null;
  const s = page.segments;
  for (let i = 0; i < s.length && !leafEnd; i += 4) {
    if (page.curve[i / 4]) continue;
    const p = { x: s[i], y: s[i + 1] };
    const q = { x: s[i + 2], y: s[i + 3] };
    for (const [h, e] of [[p, q], [q, p]] as const) {
      if (Math.hypot(h.x - arc.center.x, h.y - arc.center.y) > near) continue;
      if (Math.abs(Math.hypot(e.x - arc.center.x, e.y - arc.center.y) - arc.radius) > near * 1.5) continue;
      leafEnd = e;
      break;
    }
  }
  let jamb = arc.start;
  if (leafEnd) {
    const ds = Math.hypot(arc.start.x - leafEnd.x, arc.start.y - leafEnd.y);
    const de = Math.hypot(arc.end.x - leafEnd.x, arc.end.y - leafEnd.y);
    jamb = ds > de ? arc.start : arc.end;
  }
  return { side, hinge: arc.center, jamb, radiusPx: arc.radius };
}

function capSegments(runs: Run[], max = 150): RevisionSegment[] {
  const list = runs.length > max ? [...runs].sort((a, b) => b.len - a.len).slice(0, max) : runs;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return list.map((r) => ({ x1: r1(r.x1), y1: r1(r.y1), x2: r1(r.x2), y2: r1(r.y2) }));
}

export function diffVectorPages(input: DiffInput): DiffResult {
  const { base, revised, pageWidth, pageHeight, scale, tolerancePx: tol } = input;
  const t = detectionThresholds(scale.metersPerPixel);
  const valid = (p: Point) =>
    p.x >= 0 && p.y >= 0 && p.x <= pageWidth && p.y <= pageHeight &&
    input.validAreas.every((poly) => pointInPolygon(p, poly)) &&
    !input.exclusions.some((r) => inRect(p, r));

  const baseGrid = createGrid(pageWidth, pageHeight);
  rasterizeSegments(baseGrid, base.segments);
  const baseField = distanceField(baseGrid);
  const revGrid = createGrid(pageWidth, pageHeight);
  rasterizeSegments(revGrid, revised.segments);
  const revField = distanceField(revGrid);
  const spacing = Math.max(1, baseGrid.cell);

  const runs = [
    ...changedRuns('added', revised, baseGrid, baseField, spacing, tol, valid),
    ...changedRuns('removed', base, revGrid, revField, spacing, tol, valid),
  ];
  const texts = changedTexts(base.texts, revised.texts, tol, valid);

  const unmatchedArcs: { arc: VectorArc; side: 'added' | 'removed' }[] = [];
  for (const arc of revised.arcs) {
    const m = arcMidpoint(arc);
    if (valid(m) && lookup(baseGrid, baseField, m.x, m.y) > tol) unmatchedArcs.push({ arc, side: 'added' });
  }
  for (const arc of base.arcs) {
    const m = arcMidpoint(arc);
    if (valid(m) && lookup(revGrid, revField, m.x, m.y) > tol) unmatchedArcs.push({ arc, side: 'removed' });
  }

  const boxes: Box[] = [
    ...runs.map((r) => ({ x0: Math.min(r.x1, r.x2), y0: Math.min(r.y1, r.y2), x1: Math.max(r.x1, r.x2), y1: Math.max(r.y1, r.y2) })),
    ...texts.map((x) => ({ x0: x.text.x, y0: x.text.y, x1: x.text.x + x.text.width, y1: x.text.y + x.text.height })),
  ];
  const groupOf = clusterBoxes(boxes, t.linkPx);
  const groups = new Map<number, { runs: Run[]; texts: TextItem[]; box: Box }>();
  groupOf.forEach((g, i) => {
    const entry = groups.get(g) ?? { runs: [], texts: [], box: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity } };
    if (i < runs.length) entry.runs.push(runs[i]);
    else entry.texts.push(texts[i - runs.length]);
    const b = boxes[i];
    entry.box = { x0: Math.min(entry.box.x0, b.x0), y0: Math.min(entry.box.y0, b.y0), x1: Math.max(entry.box.x1, b.x1), y1: Math.max(entry.box.y1, b.y1) };
    groups.set(g, entry);
  });

  let filtered = 0;
  const changes: RevisionChange[] = [];
  const clouds: Box[] = [];
  for (const { runs: gRuns, texts: gTexts, box } of groups.values()) {
    const added = gRuns.filter((r) => r.side === 'added');
    const removed = gRuns.filter((r) => r.side === 'removed');
    const addedLen = added.reduce((s, r) => s + r.len, 0);
    const removedLen = removed.reduce((s, r) => s + r.len, 0);
    const totalLen = addedLen + removedLen;
    if (totalLen < t.minLengthPx && gTexts.length === 0) {
      filtered++;
      continue;
    }
    const evidence: string[] = [];
    const pad = tol * 2;
    const inBox = (p: Point) => p.x >= box.x0 - pad && p.x <= box.x1 + pad && p.y >= box.y0 - pad && p.y <= box.y1 + pad;

    // Revision cloud: a loop of small arcs drawn by the architect around a change.
    const curveLen = gRuns.filter((r) => r.curve).reduce((s, r) => s + r.len, 0);
    const smallArcs = unmatchedArcs.filter((u) => u.arc.radius <= t.cloudArcMax && inBox(arcMidpoint(u.arc))).length;
    if (totalLen > 0 && curveLen / totalLen > 0.7 && smallArcs >= 6) {
      clouds.push(box);
      filtered++;
      continue;
    }

    const family = hatchFamily(gRuns, t.hatchSpacingMax, t.wallMinPx);
    const familyRuns = new Set([...family].map((i) => gRuns[i]));
    const addedPairs = wallPairs(gRuns, 'added', t, tol, familyRuns);
    const removedPairs = wallPairs(gRuns, 'removed', t, tol, familyRuns);
    const walls = [...addedPairs.walls, ...removedPairs.walls];
    // Wall pairs whose faces are not completely drawn: no length is reported; the user confirms them.
    const incompleteWalls = [...addedPairs.incomplete, ...removedPairs.incomplete];
    const relocation = matchRelocation(walls, tol, t.relocationMaxShift);
    const doors = unmatchedArcs
      .filter((u) => u.arc.radius >= t.doorRadiusMin && u.arc.radius <= t.doorRadiusMax && inBox(arcMidpoint(u.arc)))
      .map((u) => doorFromArc(u.arc, u.side, u.side === 'added' ? revised : base));
    const nonFamilyLen = gRuns.filter((r) => !familyRuns.has(r)).reduce((s, r) => s + r.len, 0);
    if (family.size && !walls.length && !incompleteWalls.length && !doors.length && nonFamilyLen < t.minLengthPx * 1.5 && gTexts.length === 0) {
      filtered++; // hatching re-drawn with a different phase or density inside unchanged outlines
      continue;
    }
    if (family.size) evidence.push('hatched');

    // Near-miss: changed lines sitting just outside the tolerance from the other drawing.
    const weighted = [...gRuns].sort((a, b) => a.dist - b.dist);
    let acc = 0;
    let medianDist = 0;
    for (const r of weighted) {
      acc += r.len;
      if (acc >= totalLen / 2) {
        medianDist = r.dist;
        break;
      }
    }
    const minorShift = totalLen > 0 && medianDist < tol * 2;
    if (minorShift && !walls.length && !doors.length && gTexts.length === 0) {
      filtered++;
      continue;
    }

    const shortLen = gRuns.filter((r) => r.len <= t.textSegmentMax).reduce((s, r) => s + r.len, 0);
    const textLike = totalLen === 0 || shortLen / totalLen > 0.7;
    let category: RevisionChangeCategory = 'other';
    if (walls.length || incompleteWalls.length) category = 'wall';
    else if (doors.length) category = 'opening';
    else if (gTexts.length && (textLike || totalLen < t.mediumLengthPx)) category = 'annotation';
    else if (textLike && totalLen < t.mediumLengthPx) category = 'annotation';

    const wallLen = walls.reduce((s, w) => s + w.lengthPx, 0) + incompleteWalls.reduce((s, w) => s + w.lengthPx, 0);
    let significance: RevisionSignificance;
    let score: number;
    if (category === 'wall' && wallLen >= t.wallMinPx * 1.25 && !minorShift) {
      significance = 'high';
      score = 0.8 + Math.min(0.15, scale.metersPerPixel > 0 ? (wallLen * scale.metersPerPixel) / 40 : wallLen / 2000);
      evidence.push('parallel-pair');
    } else if (category === 'opening') {
      significance = 'high';
      score = 0.8;
      evidence.push('door-swing');
    } else if (category === 'wall') {
      significance = 'medium';
      score = 0.55;
      evidence.push('parallel-pair');
    } else if (category === 'other' && totalLen >= t.mediumLengthPx) {
      significance = 'medium';
      score = 0.45 + Math.min(0.1, totalLen / (t.mediumLengthPx * 40));
      evidence.push('long-lines');
    } else {
      significance = 'low';
      score = 0.2;
    }
    if (minorShift) evidence.push('minor-shift');
    if (gTexts.length) evidence.push('text-changed');
    if (relocation) evidence.push('relocated');
    // Lines that look like a wall face but have no verified partner: the user may confirm them.
    const candidates = incompleteWalls.length
      ? incompleteWalls
      : category === 'other' && !walls.length ? wallCandidates(gRuns, t, tol, familyRuns) : [];
    if (incompleteWalls.length) evidence.push('incomplete-wall');

    let kind: RevisionChangeKind = addedLen >= removedLen ? 'added' : 'removed';
    if (Math.min(addedLen, removedLen) >= 0.25 * Math.max(addedLen, removedLen) && Math.min(addedLen, removedLen) > 0) kind = 'modified';
    if (relocation) kind = 'modified';
    if (totalLen === 0) kind = gTexts.some((x) => x.side === 'added') && gTexts.some((x) => x.side === 'removed') ? 'modified' : gTexts[0].side;

    const trunc = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);
    changes.push({
      id: input.newId(),
      pageNumber: input.pageNumber,
      kind,
      category,
      significance,
      score: Math.round(score * 1000) / 1000,
      evidence,
      ...(gTexts.length ? {
        textChanges: {
          before: gTexts.filter((x) => x.side === 'removed').slice(0, 4).map((x) => trunc(x.text.str)),
          after: gTexts.filter((x) => x.side === 'added').slice(0, 4).map((x) => trunc(x.text.str)),
        },
      } : {}),
      bbox: { x: box.x0 - pad, y: box.y0 - pad, width: box.x1 - box.x0 + pad * 2, height: box.y1 - box.y0 + pad * 2 },
      addedSegments: capSegments(added),
      removedSegments: capSegments(removed),
      walls,
      doors,
      ...(relocation ? { relocation } : {}),
      ...(candidates.length ? { wallCandidates: candidates } : {}),
      addedLengthPx: Math.round(addedLen),
      removedLengthPx: Math.round(removedLen),
      status: 'pending',
    });
  }

  // A wall moved further than the grouping distance shows up as a removed-wall region and an
  // added-wall region: join a clear match into one relocated-wall change.
  const singleSide = (c: RevisionChange, side: 'added' | 'removed') =>
    c.category === 'wall' && !c.relocation && c.walls.length > 0 && c.walls.every((w) => w.side === side);
  for (let i = 0; i < changes.length; i++) {
    const a = changes[i];
    if (!singleSide(a, 'removed')) continue;
    for (let j = 0; j < changes.length; j++) {
      const b = changes[j];
      if (i === j || !singleSide(b, 'added')) continue;
      const gapX = Math.max(0, b.bbox.x - (a.bbox.x + a.bbox.width), a.bbox.x - (b.bbox.x + b.bbox.width));
      const gapY = Math.max(0, b.bbox.y - (a.bbox.y + a.bbox.height), a.bbox.y - (b.bbox.y + b.bbox.height));
      if (Math.hypot(gapX, gapY) > t.relocationMaxShift) continue;
      const relocation = matchRelocation([...a.walls, ...b.walls], tol, t.relocationMaxShift);
      if (!relocation) continue;
      const x0 = Math.min(a.bbox.x, b.bbox.x);
      const y0 = Math.min(a.bbox.y, b.bbox.y);
      const x1 = Math.max(a.bbox.x + a.bbox.width, b.bbox.x + b.bbox.width);
      const y1 = Math.max(a.bbox.y + a.bbox.height, b.bbox.y + b.bbox.height);
      const rank = { high: 2, medium: 1, low: 0 } as const;
      changes[i] = {
        ...a,
        kind: 'modified',
        significance: rank[a.significance] >= rank[b.significance] ? a.significance : b.significance,
        score: Math.max(a.score, b.score),
        evidence: [...new Set([...a.evidence, ...b.evidence, 'relocated'])],
        bbox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
        addedSegments: [...a.addedSegments, ...b.addedSegments].slice(0, 150),
        removedSegments: [...a.removedSegments, ...b.removedSegments].slice(0, 150),
        walls: [...a.walls, ...b.walls],
        doors: [...a.doors, ...b.doors],
        relocation,
        addedLengthPx: a.addedLengthPx + b.addedLengthPx,
        removedLengthPx: a.removedLengthPx + b.removedLengthPx,
      };
      changes.splice(j, 1);
      if (j < i) i--;
      break;
    }
  }

  // Changes the architect clouded are more likely intentional.
  for (const c of changes) {
    const cx = c.bbox.x + c.bbox.width / 2;
    const cy = c.bbox.y + c.bbox.height / 2;
    if (clouds.some((b) => cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1)) {
      c.evidence.push('revision-cloud');
      c.score = Math.min(1, c.score + 0.1);
      if (c.significance === 'low' && c.category !== 'annotation') c.significance = 'medium';
    }
  }

  changes.sort((a, b) => b.score - a.score);
  if (changes.length > 250) {
    filtered += changes.length - 250;
    changes.length = 250;
  }
  return { changes, filteredCount: filtered };
}

// ---------- Verification of externally proposed geometry (full-plan AI analysis) ----------

export interface DrawingIndex {
  page: VectorPage;
  grid: InkGrid;
  field: Float32Array;
}

/** A drawing with its distance field, for "is this line drawn here?" lookups. */
export function indexDrawing(page: VectorPage, width: number, height: number): DrawingIndex {
  const grid = createGrid(width, height);
  rasterizeSegments(grid, page.segments);
  return { page, grid, field: distanceField(grid) };
}

/** Share of a polyline's samples that lie on ink of the drawing (within the tolerance). */
export function drawnShare(index: DrawingIndex, a: Point, b: Point, tol: number): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(2, Math.floor(len / Math.max(1, index.grid.cell)));
  let on = 0;
  for (let i = 0; i <= n; i++) {
    const t0 = i / n;
    if (lookup(index.grid, index.field, a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0) <= tol) on++;
  }
  return on / (n + 1);
}

/** Crossing annotation ink cannot establish a matching parallel wall face. */
function crossingInkOnly(segments: { a: Point; b: Point; curve: boolean }[], point: Point, ux: number, uy: number, tol: number): boolean {
  let crossing = false;
  for (const { a, b, curve } of segments) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    const along = ((point.x - a.x) * dx + (point.y - a.y) * dy) / length;
    const clamped = Math.max(0, Math.min(length, along));
    if (Math.hypot(point.x - a.x - dx * clamped / length, point.y - a.y - dy * clamped / length) > tol) continue;
    const sine = Math.abs(ux * dy - uy * dx) / length;
    // Curves and parallel support remain matched. Short ticks/returns alone cannot justify a join.
    if (curve || sine < Math.sin(5 * Math.PI / 180)) return false;
    if (sine >= 0.5 && along > tol * 3 && along < length - tol * 3) crossing = true;
    else return false;
  }
  return crossing;
}

/**
 * Looks for the changed wall an approximate centre line points at. Straight drawing lines along it
 * are kept only where the OTHER revision has no line (that is what changed), merged into faces and
 * paired exactly as local detection does (thickness range, minimum run, completeness of both faces).
 *
 * The drawings — not the AI line — define the extent: a change reported only partly (e.g. a long
 * wall crossing tile borders) is still measured over its full drawn length, and an unchanged
 * continuation of the same wall is never counted. Only measured geometry is returned: verified walls,
 * the faces of an incompletely drawn wall for manual confirmation, or a conflict when the drawing
 * shows the wall unchanged.
 */
export function verifyWallNear(
  index: DrawingIndex,
  other: DrawingIndex,
  line: [Point, Point],
  side: 'added' | 'removed',
  mpp: number,
  tol: number,
): { walls: RevisionWall[]; incomplete: RevisionWallCandidate[]; conflict: boolean } {
  const t = detectionThresholds(mpp);
  const [p, q] = line;
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  if (len < 1) return { walls: [], incomplete: [], conflict: false };
  const ux = (q.x - p.x) / len;
  const uy = (q.y - p.y) / len;
  const lateralMax = mpp > 0 ? Math.min(80, Math.max(10, 0.5 / mpp)) : 25;
  const ext = len * 0.25 + lateralMax;
  // Far enough to follow the changed wall beyond a partial report; bounded so a collinear wall
  // across the sheet is not swept in.
  const reach = Math.max(len, mpp > 0 ? 3 / mpp : 150) + ext;
  const angle = Math.atan2(uy, ux) < 0 ? Math.atan2(uy, ux) + Math.PI : Math.atan2(uy, ux);
  const changed: Run[] = [];
  const nearAll: Run[] = [];
  const s = index.page.segments;
  const step = Math.max(1, index.grid.cell);
  for (let i = 0; i < s.length; i += 4) {
    if (index.page.curve[i / 4]) continue;
    const x1 = s[i], y1 = s[i + 1], x2 = s[i + 2], y2 = s[i + 3];
    const segLen = Math.hypot(x2 - x1, y2 - y1);
    if (segLen < tol) continue;
    let a2 = Math.atan2(y2 - y1, x2 - x1);
    if (a2 < 0) a2 += Math.PI;
    if (angleDiff(a2, angle) > (5 * Math.PI) / 180) continue;
    const lat = Math.abs(-uy * ((x1 + x2) / 2 - p.x) + ux * ((y1 + y2) / 2 - p.y));
    if (lat > lateralMax + t.wallThicknessMax) continue;
    const s1 = (x1 - p.x) * ux + (y1 - p.y) * uy;
    const s2 = (x2 - p.x) * ux + (y2 - p.y) * uy;
    const at = (sv: number) => { const k = (sv - s1) / (s2 - s1 || 1); return { x: x1 + (x2 - x1) * k, y: y1 + (y2 - y1) * k }; };
    // Unfiltered, within the reported span: does the drawing show a wall here at all?
    const nlo = Math.max(Math.min(s1, s2), -ext);
    const nhi = Math.min(Math.max(s1, s2), len + ext);
    if (nhi - nlo >= tol) {
      const A = at(nlo), B = at(nhi);
      nearAll.push({ side, x1: A.x, y1: A.y, x2: B.x, y2: B.y, len: nhi - nlo, curve: false, dist: 0 });
    }
    // Inspect existing vector geometry only; no additional raster or AI pass. Restrict support
    // checks to this face's bounds, and retain the distance-field behavior for uncertain ink.
    const inkTolerance = tol + other.grid.cell;
    const counterparts: { a: Point; b: Point; curve: boolean }[] = [];
    const os = other.page.segments;
    for (let j = 0; j < os.length; j += 4) {
      if (Math.max(os[j], os[j + 2]) < Math.min(x1, x2) - inkTolerance
        || Math.min(os[j], os[j + 2]) > Math.max(x1, x2) + inkTolerance
        || Math.max(os[j + 1], os[j + 3]) < Math.min(y1, y2) - inkTolerance
        || Math.min(os[j + 1], os[j + 3]) > Math.max(y1, y2) + inkTolerance) continue;
      counterparts.push({ a: { x: os[j], y: os[j + 1] }, b: { x: os[j + 2], y: os[j + 3] }, curve: !!other.page.curve[j / 4] });
    }
    // Changed parts only: a crossing annotation is not a matching wall face. These samples
    // remain on the actually drawn own face, so gaps/openings are never filled by this check.
    const lo = Math.max(Math.min(s1, s2), -reach);
    const hi = Math.min(Math.max(s1, s2), len + reach);
    if (hi - lo < tol) continue;
    const n = Math.max(1, Math.ceil((hi - lo) / step));
    let runStart: number | null = null;
    for (let k = 0; k <= n; k++) {
      const sv = lo + ((hi - lo) * k) / n;
      const pt = at(sv);
      const absent = lookup(other.grid, other.field, pt.x, pt.y) > tol
        || crossingInkOnly(counterparts, pt, ux, uy, inkTolerance);
      if (absent && runStart === null) runStart = sv;
      if ((!absent || k === n) && runStart !== null) {
        const end = absent ? sv : lo + ((hi - lo) * (k - 1)) / n;
        if (end - runStart >= tol) {
          const A = at(runStart), B = at(end);
          changed.push({ side, x1: A.x, y1: A.y, x2: B.x, y2: B.y, len: end - runStart, curve: false, dist: 0 });
        }
        runStart = null;
      }
    }
  }
  const lateralOf = (pt: Point) => -uy * (pt.x - p.x) + ux * (pt.y - p.y);
  const alongOf = (pt: Point) => (pt.x - p.x) * ux + (pt.y - p.y) * uy;
  const mid = (w: RevisionWall) => ({ x: (w.centerline[0].x + w.centerline[1].x) / 2, y: (w.centerline[0].y + w.centerline[1].y) / 2 });
  const touchesSpan = (w: RevisionWall) => {
    const a = alongOf(w.centerline[0]), b = alongOf(w.centerline[1]);
    return Math.max(a, b) >= -ext && Math.min(a, b) <= len + ext;
  };
  const found = wallPairs(changed, side, t, tol, new Set());
  const near = found.walls.filter((w) => Math.abs(lateralOf(mid(w))) <= lateralMax);
  const anchor = near.filter(touchesSpan);
  if (anchor.length) {
    // The pairing the line points at, followed along its own centre line (same offset and thickness).
    const best = anchor.reduce((b, w) => (Math.abs(lateralOf(mid(w))) < Math.abs(lateralOf(mid(b))) ? w : b));
    const off = lateralOf(mid(best));
    return { walls: near.filter((w) => Math.abs(lateralOf(mid(w)) - off) <= tol * 2 && Math.abs(w.thicknessPx - best.thicknessPx) <= tol), incomplete: [], conflict: false };
  }
  const incomplete = found.incomplete.filter((c) => c.pieces.some(([a, b]) => Math.abs(lateralOf(a)) <= lateralMax + t.wallThicknessMax &&
    Math.max(alongOf(a), alongOf(b)) >= -ext && Math.min(alongOf(a), alongOf(b)) <= len + ext));
  if (incomplete.length) return { walls: [], incomplete: incomplete.slice(0, 1), conflict: false };
  // Nothing changed here, yet a wall is drawn where the line points: the drawings contradict the proposal.
  const drawnHere = wallPairs(nearAll, side, t, tol, new Set()).walls.some((w) => Math.abs(lateralOf(mid(w))) <= lateralMax);
  return { walls: [], incomplete: [], conflict: drawnHere };
}

/** A wall is really gone/new only if the other drawing does not have its faces at the same place. */
export function wallPresentIn(index: DrawingIndex, wall: RevisionWall, tol: number): boolean {
  const f = wall.footprint;
  if (f.length < 4 || wall.thicknessPx <= 0) return drawnShare(index, wall.centerline[0], wall.centerline[1], tol) >= 0.8;
  return drawnShare(index, f[0], f[1], tol) >= 0.8 && drawnShare(index, f[3], f[2], tol) >= 0.8;
}

/** A door swing near an approximate opening segment: the arc gives hinge, jamb and width. */
export function verifyDoorNear(index: DrawingIndex, opening: [Point, Point], side: 'added' | 'removed', mpp: number, other: DrawingIndex | null, tol: number): RevisionDoor | null {
  const t = detectionThresholds(mpp);
  const [a, b] = opening;
  const width = Math.hypot(b.x - a.x, b.y - a.y);
  const reach = mpp > 0 ? Math.min(80, Math.max(10, 0.5 / mpp)) : 25;
  const candidates = index.page.arcs.filter((arc) => arc.radius >= t.doorRadiusMin && arc.radius <= t.doorRadiusMax &&
    Math.min(Math.hypot(arc.center.x - a.x, arc.center.y - a.y), Math.hypot(arc.center.x - b.x, arc.center.y - b.y)) <= reach &&
    (width < 1 || (arc.radius >= width * 0.6 && arc.radius <= width * 1.4)));
  if (!candidates.length) return null;
  const arc = candidates.reduce((best, c) => {
    const d = (x: VectorArc) => Math.min(Math.hypot(x.center.x - a.x, x.center.y - a.y), Math.hypot(x.center.x - b.x, x.center.y - b.y));
    return d(c) < d(best) ? c : best;
  });
  // Present in the other revision too → not an added/removed door.
  if (other && other.page.arcs.some((o) => Math.hypot(o.center.x - arc.center.x, o.center.y - arc.center.y) <= tol * 2 && Math.abs(o.radius - arc.radius) <= arc.radius * 0.15)) return null;
  return doorFromArc(arc, side, index.page);
}
