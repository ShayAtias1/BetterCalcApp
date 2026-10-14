/**
 * Ink grids and distance fields shared by the vector and image-based change detectors.
 *
 * A grid covers the source page at `cell` native px per cell. Its distance field gives, for every
 * cell, the distance (native px) to the nearest ink — so "is there matching drawing within the
 * tolerance?" is one array lookup, which is what makes the comparison tolerant of imperfect
 * alignment instead of pixel-exact.
 */

export interface InkGrid {
  cell: number;
  w: number;
  h: number;
  ink: Uint8Array;
}

export function createGrid(pageWidth: number, pageHeight: number, maxCells = 6_000_000): InkGrid {
  const cell = Math.max(1, Math.sqrt((pageWidth * pageHeight) / maxCells));
  const w = Math.max(1, Math.ceil(pageWidth / cell));
  const h = Math.max(1, Math.ceil(pageHeight / cell));
  return { cell, w, h, ink: new Uint8Array(w * h) };
}

/** Marks the cells a segment passes through (DDA, one cell wide). */
export function rasterizeSegment(grid: InkGrid, x1: number, y1: number, x2: number, y2: number): void {
  const { cell, w, h, ink } = grid;
  const ax = x1 / cell;
  const ay = y1 / cell;
  const bx = x2 / cell;
  const by = y2 / cell;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 1.5));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = Math.floor(ax + (bx - ax) * t);
    const cy = Math.floor(ay + (by - ay) * t);
    if (cx >= 0 && cy >= 0 && cx < w && cy < h) ink[cy * w + cx] = 1;
  }
}

export function rasterizeSegments(grid: InkGrid, segments: Float32Array): void {
  for (let i = 0; i < segments.length; i += 4) rasterizeSegment(grid, segments[i], segments[i + 1], segments[i + 2], segments[i + 3]);
}

/**
 * Two-pass chamfer distance transform (weights 1 / √2), returned in native px. Accurate to a few
 * percent, which is far below the matching tolerance it is compared against.
 */
export function distanceField(grid: InkGrid): Float32Array {
  const { w, h, ink, cell } = grid;
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = ink[i] ? 0 : INF;
  const D = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0 && d[i - 1] + 1 < v) v = d[i - 1] + 1;
      if (y > 0) {
        const up = i - w;
        if (d[up] + 1 < v) v = d[up] + 1;
        if (x > 0 && d[up - 1] + D < v) v = d[up - 1] + D;
        if (x < w - 1 && d[up + 1] + D < v) v = d[up + 1] + D;
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    const row = y * w;
    for (let x = w - 1; x >= 0; x--) {
      const i = row + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < w - 1 && d[i + 1] + 1 < v) v = d[i + 1] + 1;
      if (y < h - 1) {
        const down = i + w;
        if (d[down] + 1 < v) v = d[down] + 1;
        if (x < w - 1 && d[down + 1] + D < v) v = d[down + 1] + D;
        if (x > 0 && d[down - 1] + D < v) v = d[down - 1] + D;
      }
      d[i] = v;
    }
  }
  for (let i = 0; i < d.length; i++) d[i] *= cell;
  return d;
}

/** Distance (native px) from a source-page point to the nearest ink of the field's grid; Infinity outside. */
export function lookup(grid: InkGrid, field: Float32Array, x: number, y: number): number {
  const cx = Math.floor(x / grid.cell);
  const cy = Math.floor(y / grid.cell);
  if (cx < 0 || cy < 0 || cx >= grid.w || cy >= grid.h) return Infinity;
  return field[cy * grid.w + cx];
}

/** Evenly spaced sample points along segments; `owner[i]` is the segment index of sample i. */
export function sampleSegments(segments: Float32Array, spacing: number, maxSamples = 600_000): { xs: Float32Array; ys: Float32Array; owner: Uint32Array } {
  let total = 0;
  for (let i = 0; i < segments.length; i += 4) {
    total += Math.floor(Math.hypot(segments[i + 2] - segments[i], segments[i + 3] - segments[i + 1]) / spacing) + 1;
  }
  const stride = total > maxSamples ? total / maxSamples : 1;
  const step = spacing * stride;
  const xs: number[] = [];
  const ys: number[] = [];
  const owner: number[] = [];
  for (let i = 0, s = 0; i < segments.length; i += 4, s++) {
    const x1 = segments[i];
    const y1 = segments[i + 1];
    const dx = segments[i + 2] - x1;
    const dy = segments[i + 3] - y1;
    const len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.floor(len / step));
    for (let k = 0; k <= n; k++) {
      const t = n === 0 ? 0 : k / n;
      xs.push(x1 + dx * t);
      ys.push(y1 + dy * t);
      owner.push(s);
    }
  }
  return { xs: Float32Array.from(xs), ys: Float32Array.from(ys), owner: Uint32Array.from(owner) };
}

export interface Refinement {
  dx: number;
  dy: number;
  rotationDeg: number;
  /** Mean distance of samples inside the inlier band, after refinement. */
  residualPx: number;
  inlierRatio: number;
}

/**
 * Searches a small translation/rotation correction (around `pivot`) that best lays the moving
 * samples onto the fixed field. Scale is never changed — a revised-layer calibration depends on it.
 *
 * Robust by construction: the score counts samples that land within tolerance, so genuine changes
 * (which match nothing either way) do not pull the alignment.
 */
export function refineAlignment(
  grid: InkGrid,
  field: Float32Array,
  xs: Float32Array,
  ys: Float32Array,
  pivot: { x: number; y: number },
  tolerancePx: number,
  searchPx: number,
): Refinement {
  const n = xs.length;
  const evalSet = (count: number) => {
    const idx: number[] = [];
    const stride = Math.max(1, Math.floor(n / count));
    for (let i = 0; i < n; i += stride) idx.push(i);
    return idx;
  };
  const coarse = evalSet(5000);
  const score = (idx: number[], dx: number, dy: number, rot: number) => {
    const r = (rot * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    let hits = 0;
    let sum = 0;
    for (const i of idx) {
      const rx = xs[i] - pivot.x;
      const ry = ys[i] - pivot.y;
      const d = lookup(grid, field, pivot.x + rx * c - ry * s + dx, pivot.y + rx * s + ry * c + dy);
      if (d <= tolerancePx) {
        hits++;
        sum += d;
      }
    }
    // Hits dominate; the summed distance breaks ties towards the tighter fit.
    return hits - (sum / Math.max(tolerancePx, 1e-6)) * 0.25;
  };

  let best = { dx: 0, dy: 0, rot: 0, s: score(coarse, 0, 0, 0) };
  const coarseStep = Math.max(1, grid.cell);
  for (let rot = -0.15; rot <= 0.1501; rot += 0.03) {
    for (let dy = -searchPx; dy <= searchPx; dy += coarseStep) {
      for (let dx = -searchPx; dx <= searchPx; dx += coarseStep) {
        const s = score(coarse, dx, dy, rot);
        if (s > best.s) best = { dx, dy, rot, s };
      }
    }
  }
  // Fine pass around the best coarse candidate.
  const fine = evalSet(20000);
  let fineBest = { ...best, s: score(fine, best.dx, best.dy, best.rot) };
  for (let rot = best.rot - 0.03; rot <= best.rot + 0.0301; rot += 0.01) {
    for (let dy = best.dy - coarseStep; dy <= best.dy + coarseStep + 1e-6; dy += coarseStep / 4) {
      for (let dx = best.dx - coarseStep; dx <= best.dx + coarseStep + 1e-6; dx += coarseStep / 4) {
        const s = score(fine, dx, dy, rot);
        if (s > fineBest.s) fineBest = { dx, dy, rot, s };
      }
    }
  }

  // Quality over every sample, at the chosen correction.
  const r = (fineBest.rot * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  let inBand = 0;
  let bandSum = 0;
  let inliers = 0;
  let inside = 0;
  for (let i = 0; i < n; i++) {
    const rx = xs[i] - pivot.x;
    const ry = ys[i] - pivot.y;
    const d = lookup(grid, field, pivot.x + rx * c - ry * s + fineBest.dx, pivot.y + rx * s + ry * c + fineBest.dy);
    if (!Number.isFinite(d)) continue;
    inside++;
    if (d <= tolerancePx) inliers++;
    if (d <= tolerancePx * 3) {
      inBand++;
      bandSum += d;
    }
  }
  return {
    dx: fineBest.dx,
    dy: fineBest.dy,
    rotationDeg: Math.abs(fineBest.rot) < 1e-9 ? 0 : fineBest.rot,
    residualPx: inBand ? bandSum / inBand : Infinity,
    inlierRatio: inside ? inliers / inside : 0,
  };
}
