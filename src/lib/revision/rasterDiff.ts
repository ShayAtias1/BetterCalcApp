import type { RevisionChange, RevisionSignificance } from '../../types/revisionAnalysis';
import { distanceField, lookup, type InkGrid } from './fields';
import { clusterBoxes, detectionThresholds } from './vectorDiff';

/**
 * Image-based fallback for scanned plans (no usable vector drawing). Both pages are rendered into
 * source-page space at the same density; ink with no counterpart within the tolerance is a change.
 *
 * Image results are less reliable than vector ones: they are never proposed as 'high' by local
 * evidence alone and never carry wall or door geometry, so they cannot produce quantities without
 * the user measuring them.
 */

/** Ink mask of a rendered canvas, at `cell` source px per pixel. */
export function inkGridFromImage(image: ImageData, cell: number, threshold = 170): InkGrid {
  const { data, width, height } = image;
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i++) {
    const a = data[i * 4 + 3];
    if (a < 32) continue;
    const luma = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    if (luma < threshold) ink[i] = 1;
  }
  return { cell, w: width, h: height, ink };
}

/** Sample points (source px) of ink pixels, subsampled — the moving set for alignment refinement. */
export function inkSamples(grid: InkGrid, max = 200_000): { xs: Float32Array; ys: Float32Array } {
  let count = 0;
  for (let i = 0; i < grid.ink.length; i++) count += grid.ink[i];
  const stride = Math.max(1, Math.ceil(count / max));
  const xs: number[] = [];
  const ys: number[] = [];
  let k = 0;
  for (let i = 0; i < grid.ink.length; i++) {
    if (!grid.ink[i]) continue;
    if (k++ % stride) continue;
    xs.push(((i % grid.w) + 0.5) * grid.cell);
    ys.push((Math.floor(i / grid.w) + 0.5) * grid.cell);
  }
  return { xs: Float32Array.from(xs), ys: Float32Array.from(ys) };
}

export interface RasterDiffInput {
  base: InkGrid;
  revised: InkGrid;
  /** 1 where both pages exist and the area is not excluded. */
  validMask: Uint8Array;
  metersPerPixel: number;
  tolerancePx: number;
  pageNumber: number;
  newId: () => string;
}

export function diffRasterPages(input: RasterDiffInput): { changes: RevisionChange[]; filteredCount: number } {
  const { base, revised, validMask, metersPerPixel, pageNumber } = input;
  const t = detectionThresholds(metersPerPixel);
  // Scans are noisier: at least two image pixels of tolerance.
  const tol = Math.max(input.tolerancePx, base.cell * 2);
  const baseField = distanceField(base);
  const revField = distanceField(revised);
  const { w, h, cell } = base;
  // side: 1 = added (revised ink without base counterpart), 2 = removed.
  const side = new Uint8Array(w * h);
  for (let i = 0; i < side.length; i++) {
    if (!validMask[i]) continue;
    const x = ((i % w) + 0.5) * cell;
    const y = (Math.floor(i / w) + 0.5) * cell;
    if (revised.ink[i] && lookup(base, baseField, x, y) > tol) side[i] = 1;
    else if (base.ink[i] && lookup(revised, revField, x, y) > tol) side[i] = 2;
  }
  // Remove speckle: a changed pixel needs a changed neighbour on the same side.
  const clean = new Uint8Array(side.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const s = side[i];
      if (!s) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && side[i + dy * w + dx] === s) n++;
      if (n >= 2) clean[i] = s;
    }
  }
  // Connected runs of changed pixels → small boxes, then the shared clustering.
  const seen = new Uint8Array(side.length);
  const boxes: { x0: number; y0: number; x1: number; y1: number; added: number; removed: number }[] = [];
  const stack: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    if (!clean[i] || seen[i]) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, added = 0, removed = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w;
      const y = (j - x) / w;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      if (clean[j] === 1) added++; else removed++;
      for (const nb of [j - 1, j + 1, j - w, j + w]) {
        if (nb < 0 || nb >= clean.length || seen[nb] || !clean[nb]) continue;
        seen[nb] = 1;
        stack.push(nb);
      }
    }
    boxes.push({ x0: x0 * cell, y0: y0 * cell, x1: (x1 + 1) * cell, y1: (y1 + 1) * cell, added, removed });
  }
  const groups = new Map<number, typeof boxes>();
  clusterBoxes(boxes, t.linkPx).forEach((g, i) => groups.set(g, [...(groups.get(g) ?? []), boxes[i]]));

  // A rendered stroke is ~1.5 image pixels wide: changed pixels → approximate changed line length.
  const strokeCells = 1.5;
  let filtered = 0;
  const changes: RevisionChange[] = [];
  for (const list of groups.values()) {
    const added = list.reduce((s, b) => s + b.added, 0);
    const removed = list.reduce((s, b) => s + b.removed, 0);
    const addedLen = (added * cell) / strokeCells;
    const removedLen = (removed * cell) / strokeCells;
    const total = addedLen + removedLen;
    if (total < t.minLengthPx * 2) {
      filtered++;
      continue;
    }
    const x0 = Math.min(...list.map((b) => b.x0));
    const y0 = Math.min(...list.map((b) => b.y0));
    const x1 = Math.max(...list.map((b) => b.x1));
    const y1 = Math.max(...list.map((b) => b.y1));
    const significance: RevisionSignificance = total >= t.mediumLengthPx ? 'medium' : 'low';
    const kind = Math.min(addedLen, removedLen) >= 0.25 * Math.max(addedLen, removedLen) ? 'modified' : addedLen >= removedLen ? 'added' : 'removed';
    changes.push({
      id: input.newId(),
      pageNumber,
      kind,
      category: 'unknown',
      significance,
      score: significance === 'medium' ? 0.4 + Math.min(0.1, total / (t.mediumLengthPx * 40)) : 0.15,
      evidence: ['image-based'],
      bbox: { x: x0 - tol, y: y0 - tol, width: x1 - x0 + tol * 2, height: y1 - y0 + tol * 2 },
      addedSegments: [],
      removedSegments: [],
      walls: [],
      doors: [],
      addedLengthPx: Math.round(addedLen),
      removedLengthPx: Math.round(removedLen),
      status: 'pending',
    });
  }
  changes.sort((a, b) => b.score - a.score);
  if (changes.length > 200) {
    filtered += changes.length - 200;
    changes.length = 200;
  }
  return { changes, filteredCount: filtered };
}
