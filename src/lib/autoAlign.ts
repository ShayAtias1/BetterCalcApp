import { create } from 'zustand';
import type { Point } from '../types';
import type { Comparison, LayerTransform } from '../types/compare';
import { IDENTITY_TRANSFORM } from '../types/compare';
import { useCompareStore } from '../store/compareStore';
import { notify } from './appDialogs';
import { t } from '../i18n';
import { resolveCompareScale } from './compareScale';
import { alignmentMatrix, baseRevisionOf, loadLayerPage, renderInto } from './revision/detect';
import { distanceField, lookup, type InkGrid } from './revision/fields';
import { inkGridFromImage, inkSamples } from './revision/rasterDiff';
import { detectionThresholds } from './revision/vectorDiff';

/**
 * One-click alignment of the active revision page onto its base (the original, or an earlier
 * revision through its own alignment). Both pages are rendered locally to ink masks; a robust
 * symmetric chamfer score is minimised over translation, rotation and uniform scale — first on a
 * coarse grid from several starting guesses (current alignment, identity, ink bounding boxes at
 * 0/90/180/270°), then on the fine grid. The result is applied only when enough drawing matches in
 * both directions; otherwise the current alignment is kept. Runs entirely in the browser.
 */

export type AutoAlignOutcome =
  | { status: 'aligned'; transform: LayerTransform }
  | { status: 'unchanged' }
  | { status: 'failed' };

interface Level {
  base: InkGrid;
  baseField: Float32Array;
  rev: InkGrid;
  revField: Float32Array;
  /** Revised ink, revised-page native px. */
  rx: Float32Array;
  ry: Float32Array;
  /** Base ink, source-page native px. */
  bx: Float32Array;
  by: Float32Array;
}

const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function poolGrid(g: InkGrid, k: number): InkGrid {
  const w = Math.ceil(g.w / k);
  const h = Math.ceil(g.h / k);
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < g.h; y++) {
    const row = Math.floor(y / k) * w;
    for (let x = 0; x < g.w; x++) if (g.ink[y * g.w + x]) ink[row + Math.floor(x / k)] = 1;
  }
  return { cell: g.cell * k, w, h, ink };
}

function every(xs: Float32Array, ys: Float32Array, max: number): { xs: Float32Array; ys: Float32Array } {
  const stride = Math.max(1, Math.ceil(xs.length / max));
  if (stride === 1) return { xs, ys };
  const n = Math.ceil(xs.length / stride);
  const ox = new Float32Array(n);
  const oy = new Float32Array(n);
  for (let i = 0, k = 0; i < xs.length; i += stride, k++) {
    ox[k] = xs[i];
    oy[k] = ys[i];
  }
  return { xs: ox, ys: oy };
}

function makeLevel(base: InkGrid, rev: InkGrid, r: { xs: Float32Array; ys: Float32Array }, b: { xs: Float32Array; ys: Float32Array }, max: number): Level {
  const rs = every(r.xs, r.ys, max);
  const bs = every(b.xs, b.ys, max);
  return { base, baseField: distanceField(base), rev, revField: distanceField(rev), rx: rs.xs, ry: rs.ys, bx: bs.xs, by: bs.ys };
}

/**
 * Symmetric truncated chamfer distance: revised ink mapped into source space against the base
 * field, and base ink mapped back into revised-page space against the revised field. The backward
 * half stops the search from shrinking the revision into a dense patch of the base.
 */
function score(level: Level, tr: LayerTransform, pivot: Point, T: number): number {
  const rad = (tr.rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const k = tr.scale;
  let fwd = 0;
  for (let i = 0; i < level.rx.length; i++) {
    const dx = level.rx[i] - pivot.x;
    const dy = level.ry[i] - pivot.y;
    const d = lookup(level.base, level.baseField, pivot.x + tr.offsetX + k * (dx * c - dy * s), pivot.y + tr.offsetY + k * (dx * s + dy * c));
    fwd += d < T ? d : T;
  }
  let bwd = 0;
  for (let i = 0; i < level.bx.length; i++) {
    const dx = level.bx[i] - pivot.x - tr.offsetX;
    const dy = level.by[i] - pivot.y - tr.offsetY;
    // Distances in revised space are scaled back to source px so both halves are comparable.
    const d = lookup(level.rev, level.revField, pivot.x + (dx * c + dy * s) / k, pivot.y + (-dx * s + dy * c) / k) * k;
    bwd += d < T ? d : T;
  }
  return fwd / Math.max(1, level.rx.length) + bwd / Math.max(1, level.bx.length);
}

function patternSearch(level: Level, start: LayerTransform, pivot: Point, T: number, steps: { t: number; r: number; s: number }, minT: number): { tr: LayerTransform; score: number } {
  let best = start;
  let bestScore = score(level, start, pivot, T);
  let { t: st, r: sr, s: ss } = steps;
  for (let iter = 0; st >= minT && iter < 400; iter++) {
    const moves: LayerTransform[] = [
      { ...best, offsetX: best.offsetX + st }, { ...best, offsetX: best.offsetX - st },
      { ...best, offsetY: best.offsetY + st }, { ...best, offsetY: best.offsetY - st },
      { ...best, rotationDeg: best.rotationDeg + sr }, { ...best, rotationDeg: best.rotationDeg - sr },
      { ...best, scale: best.scale * (1 + ss) }, { ...best, scale: best.scale / (1 + ss) },
    ];
    let improved = false;
    for (const m of moves) {
      if (m.scale < 0.2 || m.scale > 5) continue;
      const sc = score(level, m, pivot, T);
      if (sc < bestScore - 1e-9) {
        best = m;
        bestScore = sc;
        improved = true;
      }
    }
    if (!improved) {
      st /= 2;
      sr /= 2;
      ss /= 2;
    }
  }
  return { tr: best, score: bestScore };
}

/** Robust (2nd–98th percentile) ink bounding box. */
function inkBox(xs: ArrayLike<number>, ys: ArrayLike<number>) {
  const sx = Float32Array.from(xs).sort();
  const sy = Float32Array.from(ys).sort();
  const q = (a: Float32Array, p: number) => a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * p)))];
  const x0 = q(sx, 0.02);
  const x1 = q(sx, 0.98);
  const y0 = q(sy, 0.02);
  const y1 = q(sy, 0.98);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

function startGuesses(level: Level, pivot: Point, current: LayerTransform): LayerTransform[] {
  const guesses: LayerTransform[] = [current, IDENTITY_TRANSFORM];
  const bb = inkBox(level.bx, level.by);
  for (const rot of [0, 90, 180, 270]) {
    const rad = (rot * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const mx = new Float32Array(level.rx.length);
    const my = new Float32Array(level.rx.length);
    for (let i = 0; i < level.rx.length; i++) {
      const dx = level.rx[i] - pivot.x;
      const dy = level.ry[i] - pivot.y;
      mx[i] = pivot.x + dx * c - dy * s;
      my[i] = pivot.y + dx * s + dy * c;
    }
    const rb = inkBox(mx, my);
    const fit = Math.min(5, Math.max(0.2, Math.sqrt((bb.w * bb.h) / (rb.w * rb.h))));
    for (const scale of fit === 1 ? [1] : [fit, 1]) {
      guesses.push({
        offsetX: bb.cx - (pivot.x + scale * (rb.cx - pivot.x)),
        offsetY: bb.cy - (pivot.y + scale * (rb.cy - pivot.y)),
        rotationDeg: rot > 180 ? rot - 360 : rot,
        scale,
      });
    }
  }
  return guesses;
}

/** Share of ink within tolerance in each direction, and the mean distance of near matches. */
function validate(level: Level, tr: LayerTransform, pivot: Point, tol: number) {
  const rad = (tr.rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const k = tr.scale;
  let fIn = 0, fAll = 0, bandSum = 0, band = 0;
  for (let i = 0; i < level.rx.length; i++) {
    const dx = level.rx[i] - pivot.x;
    const dy = level.ry[i] - pivot.y;
    const d = lookup(level.base, level.baseField, pivot.x + tr.offsetX + k * (dx * c - dy * s), pivot.y + tr.offsetY + k * (dx * s + dy * c));
    if (!Number.isFinite(d)) continue;
    fAll++;
    if (d <= tol) fIn++;
    if (d <= tol * 3) {
      band++;
      bandSum += d;
    }
  }
  let bIn = 0, bAll = 0;
  for (let i = 0; i < level.bx.length; i++) {
    const dx = level.bx[i] - pivot.x - tr.offsetX;
    const dy = level.by[i] - pivot.y - tr.offsetY;
    const d = lookup(level.rev, level.revField, pivot.x + (dx * c + dy * s) / k, pivot.y + (-dx * s + dy * c) / k) * k;
    if (!Number.isFinite(d)) continue;
    bAll++;
    if (d <= tol) bIn++;
  }
  const forward = fAll ? fIn / fAll : 0;
  const backward = bAll ? bIn / bAll : 0;
  const residual = band ? bandSum / band : Infinity;
  // Revisions change part of the drawing, so most — not all — ink must match both ways.
  const ok = forward >= 0.55 && backward >= 0.55 && fAll > 0.5 * level.rx.length && residual <= 0.45 * tol;
  return { ok, forward, backward, residual };
}

export async function autoAlignRevisionPage(comparison: Comparison, revisionId: string, pageKey: number): Promise<AutoAlignOutcome> {
  const revision = comparison.revisions.find((r) => r.id === revisionId);
  if (!revision) return { status: 'failed' };
  const base = baseRevisionOf(comparison, revision);
  const page = comparison.pages[pageKey];
  const rp = page?.revisions[revisionId];
  const bp = base ? page?.revisions[base.id] : undefined;
  const current = rp?.alignment ?? IDENTITY_TRANSFORM;

  const originalPage = await loadLayerPage(comparison.id, 'original', page?.originalPageNumber ?? pageKey);
  const revisedPage = await loadLayerPage(comparison.id, `revision:${revisionId}`, rp?.revisedPageNumber ?? pageKey);
  const basePage = base ? await loadLayerPage(comparison.id, `revision:${base.id}`, bp?.revisedPageNumber ?? pageKey) : originalPage;
  const src = originalPage.getViewport({ scale: 1 });
  const rvp = revisedPage.getViewport({ scale: 1 });
  const bvp = basePage.getViewport({ scale: 1 });
  const pivot = { x: rvp.width / 2, y: rvp.height / 2 };
  const baseMatrix = base ? alignmentMatrix(bp?.alignment ?? IDENTITY_TRANSFORM, { x: bvp.width / 2, y: bvp.height / 2 }) : null;

  const s = Math.min(2, 2000 / Math.max(src.width, src.height, rvp.width, rvp.height));
  const baseImg = await renderInto(basePage, src.width, src.height, s, baseMatrix);
  const revImg = await renderInto(revisedPage, rvp.width, rvp.height, s, null);
  await yieldToUI();
  const baseGrid = inkGridFromImage(baseImg, 1 / s);
  const revGrid = inkGridFromImage(revImg, 1 / s);
  const revInk = inkSamples(revGrid, 40_000);
  const baseInk = inkSamples(baseGrid, 40_000);
  if (revInk.xs.length < 200 || baseInk.xs.length < 200) return { status: 'failed' };

  const fineCell = baseGrid.cell;
  const coarse = makeLevel(poolGrid(baseGrid, 4), poolGrid(revGrid, 4), revInk, baseInk, 3000);
  const coarseCell = coarse.base.cell;
  await yieldToUI();

  // Coarse: every starting guess, wide truncation so far-off guesses still feel the gradient.
  const coarseResults: { tr: LayerTransform; score: number }[] = [];
  for (const guess of startGuesses(coarse, pivot, current)) {
    coarseResults.push(patternSearch(coarse, guess, pivot, coarseCell * 15, { t: coarseCell * 4, r: 1, s: 0.02 }, coarseCell / 4));
    await yieldToUI();
  }
  coarseResults.sort((a, b) => a.score - b.score);

  // Fine: polish the two best candidates on the full-resolution grid.
  const fine = makeLevel(baseGrid, revGrid, revInk, baseInk, 20_000);
  await yieldToUI();
  let best: { tr: LayerTransform; score: number } | null = null;
  for (const cand of coarseResults.slice(0, 2)) {
    const r = patternSearch(fine, cand.tr, pivot, fineCell * 6, { t: fineCell * 2, r: 0.2, s: 0.004 }, fineCell / 8);
    if (!best || r.score < best.score) best = r;
    await yieldToUI();
  }
  if (!best) return { status: 'failed' };

  const mpp = resolveCompareScale(page, rp).metersPerPixel;
  const tol = Math.max(detectionThresholds(mpp).tolerancePx, fineCell * 2);
  const found = validate(fine, best.tr, pivot, tol);
  if (!found.ok) return { status: 'failed' };

  const tr = best.tr;
  const unchanged = Math.abs(tr.offsetX - current.offsetX) < 0.5 && Math.abs(tr.offsetY - current.offsetY) < 0.5
    && Math.abs(tr.rotationDeg - current.rotationDeg) < 0.01 && Math.abs(tr.scale - current.scale) < 1e-4;
  if (unchanged) return { status: 'unchanged' };
  // Never replace a valid alignment with one that matches less of the drawing.
  const before = validate(fine, current, pivot, tol);
  if (before.ok && before.forward + before.backward >= found.forward + found.backward) return { status: 'unchanged' };
  const round = (v: number, f: number) => Math.round(v * f) / f;
  return {
    status: 'aligned',
    transform: {
      offsetX: round(tr.offsetX, 1000),
      offsetY: round(tr.offsetY, 1000),
      rotationDeg: round(((tr.rotationDeg + 540) % 360) - 180, 10000),
      scale: round(tr.scale, 1e6),
    },
  };
}

/** Shared by every place that offers auto align (dock menu, inspector), so they show one busy state. */
export const useAutoAlignUi = create<{ running: boolean }>(() => ({ running: false }));

const sameTransform = (a: LayerTransform, b: LayerTransform) =>
  a.offsetX === b.offsetX && a.offsetY === b.offsetY && a.rotationDeg === b.rotationDeg && a.scale === b.scale;

/**
 * The toolbar action: aligns the current sheet of the active revision, applies the result as one
 * undo step, and reports. Dropped silently when the user switched sheet/revision or moved the layer
 * while it ran.
 */
export async function runAutoAlign(): Promise<void> {
  if (useAutoAlignUi.getState().running) return;
  const { comparison, currentPageKey } = useCompareStore.getState();
  if (!comparison || comparison.revisions.length === 0) return;
  useAutoAlignUi.setState({ running: true });
  try {
    await autoAlignCurrent(comparison, currentPageKey);
  } finally {
    useAutoAlignUi.setState({ running: false });
  }
}

async function autoAlignCurrent(comparison: Comparison, currentPageKey: number): Promise<void> {
  const revisionId = comparison.activeRevisionId;
  const startAlignment = comparison.pages[currentPageKey]?.revisions[revisionId]?.alignment ?? IDENTITY_TRANSFORM;
  let outcome: AutoAlignOutcome;
  try {
    outcome = await autoAlignRevisionPage(comparison, revisionId, currentPageKey);
  } catch {
    outcome = { status: 'failed' };
  }
  const latest = useCompareStore.getState();
  const now = latest.comparison;
  if (!now || now.id !== comparison.id || now.activeRevisionId !== revisionId || latest.currentPageKey !== currentPageKey) return;
  if (!sameTransform(now.pages[currentPageKey]?.revisions[revisionId]?.alignment ?? IDENTITY_TRANSFORM, startAlignment)) return;
  if (outcome.status === 'aligned') {
    latest.setAlignmentTransform(currentPageKey, outcome.transform, 'manual', true);
    notify(t('compare.autoAlign.success'));
  } else if (outcome.status === 'unchanged') {
    notify(t('compare.autoAlign.unchanged'));
  } else {
    notify(t('compare.autoAlign.failed'));
  }
}
