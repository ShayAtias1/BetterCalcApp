import type { Point } from '../../types';
import type { RevisionChange, RevisionDoor } from '../../types/revisionAnalysis';
import { distancePx, round } from '../geometry';
import { wallFromLine } from './changeEdit';

/** Existing openings changed in place or moved: never count their overlapping region twice. */
export function isOpeningDifference(c: RevisionChange): boolean {
  return c.userType === 'opening-modified' || c.aiProposal?.changeType === 'opening-modified'
    || (c.category === 'opening' && c.kind === 'modified')
    || (c.doors.some(d => d.side === 'removed') && c.doors.some(d => d.side === 'added'));
}

export interface OpeningPortion {
  areaKind: 'construction' | 'demolition';
  points: Point[];
  centerline: Point[];
  wallLengthM: number;
  wallHeightM: number;
  areaM2: number;
  element: { list: 'doors'; index: number; part: number };
}

export function openingWallThicknessPx(c: RevisionChange, d: RevisionDoor): number {
  if (d.wallThicknessPx != null) return d.wallThicknessPx;
  const length = distancePx(d.hinge, d.jamb);
  const matches = c.walls.filter(w => !w.placeholder && w.thicknessPx > 0 && length > 0
    && w.centerline.every(p => Math.abs((p.x - d.hinge.x) * (d.jamb.y - d.hinge.y)
      - (p.y - d.hinge.y) * (d.jamb.x - d.hinge.x)) / length <= w.thicknessPx / 2)
    && w.centerline.some(p => ((p.x - d.hinge.x) * (d.jamb.x - d.hinge.x) + (p.y - d.hinge.y) * (d.jamb.y - d.hinge.y)) / length >= -w.thicknessPx)
    && w.centerline.some(p => ((p.x - d.hinge.x) * (d.jamb.x - d.hinge.x) + (p.y - d.hinge.y) * (d.jamb.y - d.hinge.y)) / length <= length + w.thicknessPx));
  const values = matches.map(w => w.thicknessPx);
  return values.length && Math.max(...values) - Math.min(...values) < 0.5 ? values[0] : 0;
}

/** Missing heights/thickness or unconfirmed geometry block approval instead of using defaults. */
export function openingImpactReady(c: RevisionChange): boolean {
  if (!isOpeningDifference(c)) return true;
  if (!c.doors.some(d => d.side === 'removed') || !c.doors.some(d => d.side === 'added')) return false;
  return c.doors.every(d => !d.placeholder && d.impactVerified === true
    && [d.hinge.x, d.hinge.y, d.jamb.x, d.jamb.y, d.heightM, openingWallThicknessPx(c, d)].every(v => typeof v === 'number' && Number.isFinite(v))
    && distancePx(d.hinge, d.jamb) > 0 && d.heightM! > 0 && openingWallThicknessPx(c, d) > 0
    && (d.opening !== 'window' || (typeof d.sillHeightM === 'number' && Number.isFinite(d.sillHeightM) && d.sillHeightM >= 0)));
}

/** Difference of verified opening rectangles in wall elevation (run × height).
 * Same-wall overlapping openings are subtracted; different walls have no shared opening region.
 * Footprints use the measured host-wall thickness, never a fixed display width.
 */
export function openingImpact(c: RevisionChange, mpp: number): { portions: OpeningPortion[]; designDeltaM2: number } {
  const portions: OpeningPortion[] = [];
  if (!isOpeningDifference(c) || !openingImpactReady(c) || !(mpp > 0)) return { portions, designDeltaM2: 0 };
  c.doors.forEach((d, index) => {
    const length = distancePx(d.hinge, d.jamb);
    const ux = (d.jamb.x - d.hinge.x) / length, uy = (d.jamb.y - d.hinge.y) / length;
    const bottom = d.opening === 'window' ? d.sillHeightM! : 0;
    const top = bottom + d.heightM!;
    const blockers = c.doors.flatMap((other, otherIndex) => {
      if (otherIndex === index || (other.side === d.side && otherIndex > index)) return [];
      const project = (p: Point) => (p.x - d.hinge.x) * ux + (p.y - d.hinge.y) * uy;
      const normal = (p: Point) => Math.abs((p.x - d.hinge.x) * uy - (p.y - d.hinge.y) * ux);
      // A nonparallel or displaced wall is a relocation, not the same opening.
      if (normal(other.hinge) > 0.5 || normal(other.jamb) > 0.5) return [];
      const x1 = Math.max(0, Math.min(project(other.hinge), project(other.jamb)));
      const x2 = Math.min(length, Math.max(project(other.hinge), project(other.jamb)));
      const y1 = Math.max(bottom, other.opening === 'window' ? other.sillHeightM! : 0);
      const y2 = Math.min(top, (other.opening === 'window' ? other.sillHeightM! : 0) + other.heightM!);
      return x2 > x1 && y2 > y1 ? [{ x1, x2, y1, y2 }] : [];
    });
    const xs = [...new Set([0, length, ...blockers.flatMap(b => [b.x1, b.x2])])].sort((a, b) => a - b);
    const ys = [...new Set([bottom, top, ...blockers.flatMap(b => [b.y1, b.y2])])].sort((a, b) => a - b);
    let part = 0;
    for (let y = 0; y < ys.length - 1; y++) {
      let run: number | null = null;
      const emit = (end: number) => {
        if (run === null) return;
        const a = { x: d.hinge.x + ux * run, y: d.hinge.y + uy * run };
        const b = { x: d.hinge.x + ux * end, y: d.hinge.y + uy * end };
        const wallLengthM = (end - run) * mpp, wallHeightM = ys[y + 1] - ys[y];
        portions.push({
          areaKind: d.side === 'removed' ? 'construction' : 'demolition',
          points: wallFromLine(d.side, a, b, openingWallThicknessPx(c, d)).footprint,
          centerline: [a, b], wallLengthM: round(wallLengthM, 2), wallHeightM,
          areaM2: round(wallLengthM * wallHeightM, 2), element: { list: 'doors', index, part: part++ },
        });
        run = null;
      };
      for (let x = 0; x < xs.length - 1; x++) {
        const mx = (xs[x] + xs[x + 1]) / 2, my = (ys[y] + ys[y + 1]) / 2;
        const blocked = blockers.some(b => mx > b.x1 && mx < b.x2 && my > b.y1 && my < b.y2);
        if (blocked) emit(xs[x]); else run ??= xs[x];
      }
      emit(length);
    }
  });
  return { portions, designDeltaM2: round(portions.reduce((sum, p) => sum + (p.areaKind === 'construction' ? p.areaM2 : -p.areaM2), 0), 2) };
}
