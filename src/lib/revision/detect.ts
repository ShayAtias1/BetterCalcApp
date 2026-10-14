import { v4 as uuid } from 'uuid';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { Point } from '../../types';
import type { Comparison, LayerTransform, RevisionLayer } from '../../types/compare';
import { IDENTITY_TRANSFORM } from '../../types/compare';
import type { AlignmentQuality, RevisionPageAnalysis } from '../../types/revisionAnalysis';
import { loadComparePdfBlob } from '../../db/database';
import { loadPdfPlanSource } from '../planSource';
import { applyAlignment } from '../alignment';
import { resolveCompareScale } from '../compareScale';
import { extractVectorPage, transformVectorPage, type VectorPage } from './vectorExtract';
import { createGrid, distanceField, rasterizeSegments, refineAlignment, sampleSegments } from './fields';
import { detectionThresholds, diffVectorPages, type Rect } from './vectorDiff';
import { diffRasterPages, inkGridFromImage, inkSamples } from './rasterDiff';

/**
 * Orchestrates change detection for one source page of one revision:
 * load both drawings → map them into source-page space through the saved alignment → refine the
 * alignment locally and grade it → vector diff (or image diff for scans) → scored proposals.
 *
 * Runs entirely in the browser; nothing leaves the device.
 */

export const DETECTION_VERSION = 'revision-detect-v2';

type Matrix = [number, number, number, number, number, number];

/** The affine matrix equivalent of `applyAlignment` — what the CSS transform draws on screen. */
export function alignmentMatrix(t: LayerTransform, pivot: Point): Matrix {
  const o = applyAlignment({ x: 0, y: 0 }, t, pivot);
  const x = applyAlignment({ x: 1, y: 0 }, t, pivot);
  const y = applyAlignment({ x: 0, y: 1 }, t, pivot);
  return [x.x - o.x, x.y - o.y, y.x - o.x, y.y - o.y, o.x, o.y];
}

/**
 * Folds a small correction C(p) = P + R(rot)(p − P) + d (found in source space) into a layer
 * transform, keeping its scale and its own pivot — so the CSS transform keeps matching.
 */
export function composeCorrection(t: LayerTransform, pivot: Point, P: Point, c: { dx: number; dy: number; rotationDeg: number }): LayerTransform {
  const r = (c.rotationDeg * Math.PI) / 180;
  const vx = pivot.x + t.offsetX - P.x;
  const vy = pivot.y + t.offsetY - P.y;
  const rx = vx * Math.cos(r) - vy * Math.sin(r);
  const ry = vx * Math.sin(r) + vy * Math.cos(r);
  return {
    offsetX: P.x + rx + c.dx - pivot.x,
    offsetY: P.y + ry + c.dy - pivot.y,
    rotationDeg: t.rotationDeg + c.rotationDeg,
    scale: t.scale,
  };
}

function hash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const roundT = (t: LayerTransform) => ({ ox: r3(t.offsetX), oy: r3(t.offsetY), r: r3(t.rotationDeg * 100), s: r3(t.scale * 1000) });

/** The base a revision is compared against: an earlier revision of the chain, or null for the original. */
export function baseRevisionOf(comparison: Comparison, revision: RevisionLayer): RevisionLayer | null {
  if (!revision.baseRevisionId) return null;
  const index = comparison.revisions.findIndex((r) => r.id === revision.id);
  const baseIndex = comparison.revisions.findIndex((r) => r.id === revision.baseRevisionId);
  return baseIndex >= 0 && baseIndex < index ? comparison.revisions[baseIndex] : null;
}

function exclusionsFor(revision: RevisionLayer, pageKey: number): Rect[] {
  return revision.markups
    .filter((m) => m.tool === 'mask' && m.pageNumber === pageKey && m.points.length >= 2)
    .map((m) => {
      const [a, b] = m.points;
      return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
    });
}

/**
 * Everything a page result depends on. The UI compares it with the stored `inputKey` to tell the
 * user a result is out of date (re-aligned, recalibrated, other base, other mapped page…).
 */
export function analysisInputKey(comparison: Comparison, revisionId: string, pageKey: number): string {
  const revision = comparison.revisions.find((r) => r.id === revisionId);
  const page = comparison.pages[pageKey];
  const rp = page?.revisions[revisionId];
  if (!revision) return '';
  const base = baseRevisionOf(comparison, revision);
  const bp = base ? page?.revisions[base.id] : undefined;
  const scale = resolveCompareScale(page, rp);
  return hash(JSON.stringify({
    v: DETECTION_VERSION,
    pageKey,
    orig: page?.originalPageNumber ?? pageKey,
    rev: rp?.revisedPageNumber ?? pageKey,
    a: roundT(rp?.alignment ?? IDENTITY_TRANSFORM),
    base: base ? { id: base.id, page: bp?.revisedPageNumber ?? pageKey, a: roundT(bp?.alignment ?? IDENTITY_TRANSFORM) } : null,
    mpp: r3(scale.metersPerPixel * 1e6),
    ex: exclusionsFor(revision, pageKey).map((r) => [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]),
  }));
}

export async function loadLayerPage(comparisonId: string, layer: string, pageNumber: number): Promise<PDFPageProxy> {
  try {
    const { source } = await loadPdfPlanSource(`compare-detect:${comparisonId}:${layer}`, () => loadComparePdfBlob(comparisonId, layer), pageNumber);
    return source.pdfPage;
  } catch {
    throw new Error('page-missing');
  }
}

function pageCorners(page: PDFPageProxy, m: Matrix): Point[] {
  const vp = page.getViewport({ scale: 1 });
  return [
    { x: 0, y: 0 }, { x: vp.width, y: 0 }, { x: vp.width, y: vp.height }, { x: 0, y: vp.height },
  ].map((p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }));
}

function pivotOf(page: PDFPageProxy): Point {
  const vp = page.getViewport({ scale: 1 });
  return { x: vp.width / 2, y: vp.height / 2 };
}

const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Renders a page into a source-space canvas: canvas px = s × (m applied to the page's native px). */
export async function renderInto(page: PDFPageProxy, width: number, height: number, s: number, m: Matrix | null): Promise<ImageData> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * s));
  canvas.height = Math.max(1, Math.round(height * s));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas-unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const base: Matrix = m ?? [1, 0, 0, 1, 0, 0];
  const transform: Matrix = [base[0] * s, base[1] * s, base[2] * s, base[3] * s, base[4] * s, base[5] * s];
  await page.render({ canvasContext: ctx, canvas, viewport: page.getViewport({ scale: 1 }), transform }).promise;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = canvas.height = 0;
  return image;
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

/**
 * Grades the refined alignment. After a correct alignment matched drawing lies essentially on its
 * counterpart (measured ≤ 0.1 px on the QA fixtures), so a residual above a third of the tolerance
 * means a systematic offset the refinement could not remove. A correction that ran into the edge of
 * the search window without reaching a tight fit means the true offset is larger than the search.
 * Both are 'poor': detection then refuses to propose changes.
 */
function grade(
  residualPx: number,
  inlierRatio: number,
  tol: number,
  mpp: number,
  correction: AlignmentQuality['correction'],
  search: { px: number; step: number },
): AlignmentQuality {
  const atLimit = Math.max(Math.abs(correction.dx), Math.abs(correction.dy)) >= search.px - search.step || Math.abs(correction.rotationDeg) >= 0.14;
  const status = !(residualPx <= 0.35 * tol) || inlierRatio < 0.6 || (atLimit && residualPx > 0.2 * tol)
    ? 'poor'
    : residualPx <= 0.2 * tol && inlierRatio >= 0.85 ? 'good' : 'fair';
  const residual = Number.isFinite(residualPx) ? Math.round(residualPx * 100) / 100 : 999;
  return {
    status,
    residualPx: residual,
    residualMm: mpp > 0 && Number.isFinite(residualPx) ? Math.round(residualPx * mpp * 1000) : null,
    inlierRatio: Math.round(inlierRatio * 1000) / 1000,
    tolerancePx: Math.round(tol * 100) / 100,
    correction: { dx: r3(correction.dx), dy: r3(correction.dy), rotationDeg: r3(correction.rotationDeg) },
  };
}

export interface DetectionOutcome {
  analysis: RevisionPageAnalysis;
  /** The refined alignment to store on the revision page, when refinement moved it. */
  refinedAlignment: LayerTransform | null;
}

/**
 * Everything both detection paths need before comparing: the three pages (original, revised, base),
 * the vector drawings mapped into source-page space, and the refined + graded alignment. The full-
 * plan AI analysis uses it to gate on alignment quality and to verify AI geometry against the
 * drawings; it never limits which parts of the plan the AI inspects.
 */
export interface PreparedRevisionPage {
  W: number;
  H: number;
  mpp: number;
  tol: number;
  method: 'vector' | 'raster';
  quality: AlignmentQuality;
  userAlignment: LayerTransform;
  finalAlignment: LayerTransform;
  analysisBase: Omit<RevisionPageAnalysis, 'changes' | 'filteredCount'>;
  originalPage: PDFPageProxy;
  revisedPage: PDFPageProxy;
  basePage: PDFPageProxy;
  baseMatrix: Matrix | null;
  revMatrix: Matrix;
  /** Base and revised drawings in source-page px (revised through the final alignment). */
  baseV: VectorPage;
  revV: VectorPage;
  revRaw: VectorPage;
  exclusions: Rect[];
}

export async function prepareRevisionPage(
  comparison: Comparison,
  revisionId: string,
  pageKey: number,
  onProgress: (fraction: number, step: 'loading' | 'aligning' | 'comparing' | 'classifying') => void = () => {},
): Promise<PreparedRevisionPage> {
  const revision = comparison.revisions.find((r) => r.id === revisionId);
  if (!revision) throw new Error('revision-missing');
  const base = baseRevisionOf(comparison, revision);
  const page = comparison.pages[pageKey];
  const rp = page?.revisions[revisionId];
  const userAlignment = rp?.alignment ?? IDENTITY_TRANSFORM;
  const mpp = resolveCompareScale(page, rp).metersPerPixel;
  const thresholds = detectionThresholds(mpp);
  const tol = thresholds.tolerancePx;

  onProgress(0.05, 'loading');
  const originalPage = await loadLayerPage(comparison.id, 'original', page?.originalPageNumber ?? pageKey);
  const revisedPage = await loadLayerPage(comparison.id, `revision:${revisionId}`, rp?.revisedPageNumber ?? pageKey);
  const bp = base ? page?.revisions[base.id] : undefined;
  const basePage = base ? await loadLayerPage(comparison.id, `revision:${base.id}`, bp?.revisedPageNumber ?? pageKey) : originalPage;
  const sourceVp = originalPage.getViewport({ scale: 1 });
  const W = sourceVp.width;
  const H = sourceVp.height;
  const P = { x: W / 2, y: H / 2 };
  const revPivot = pivotOf(revisedPage);
  const baseMatrix: Matrix | null = base ? alignmentMatrix(bp?.alignment ?? IDENTITY_TRANSFORM, pivotOf(basePage)) : null;
  const exclusions = exclusionsFor(revision, pageKey);
  const searchPx = Math.min(14, Math.max(6, tol * 4));

  const [baseRaw, revRaw] = await Promise.all([extractVectorPage(basePage), extractVectorPage(revisedPage)]);
  const isVector = (v: VectorPage) => v.curve.length >= 300 && v.imageCoverage < 0.3;
  const method: 'vector' | 'raster' = isVector(baseRaw) && isVector(revRaw) ? 'vector' : 'raster';

  onProgress(0.25, 'aligning');
  await yieldToUI();
  let refined: LayerTransform;
  let quality: AlignmentQuality;
  const baseV = baseMatrix ? transformVectorPage(baseRaw, baseMatrix) : baseRaw;

  if (method === 'vector') {
    const grid = createGrid(W, H);
    rasterizeSegments(grid, baseV.segments);
    const field = distanceField(grid);
    const moving = transformVectorPage(revRaw, alignmentMatrix(userAlignment, revPivot));
    const { xs, ys } = sampleSegments(moving.segments, Math.max(1, grid.cell), 200_000);
    const r = refineAlignment(grid, field, xs, ys, P, tol, searchPx);
    refined = composeCorrection(userAlignment, revPivot, P, r);
    quality = grade(r.residualPx, r.inlierRatio, tol, mpp, r, { px: searchPx, step: Math.max(1, grid.cell) });
  } else {
    const s = Math.min(2, 2400 / Math.max(W, H));
    const baseImg = await renderInto(basePage, W, H, s, baseMatrix);
    const movingImg = await renderInto(revisedPage, W, H, s, alignmentMatrix(userAlignment, revPivot));
    const baseGrid = inkGridFromImage(baseImg, 1 / s);
    const field = distanceField(baseGrid);
    const { xs, ys } = inkSamples(inkGridFromImage(movingImg, 1 / s));
    const rtol = Math.max(tol, (1 / s) * 2);
    const rasterSearch = Math.max(searchPx, (1 / s) * 6);
    const r = refineAlignment(baseGrid, field, xs, ys, P, rtol, rasterSearch);
    refined = composeCorrection(userAlignment, revPivot, P, r);
    quality = grade(r.residualPx, r.inlierRatio, rtol, mpp, r, { px: rasterSearch, step: Math.max(1, baseGrid.cell) });
  }

  const moved = Math.abs(quality.correction.dx) > 0.05 || Math.abs(quality.correction.dy) > 0.05 || Math.abs(quality.correction.rotationDeg) > 0.001;
  const finalAlignment = quality.status === 'poor' || !moved ? userAlignment : refined;
  const finalComparison: Comparison = finalAlignment === userAlignment ? comparison : {
    ...comparison,
    pages: { ...comparison.pages, [pageKey]: { ...page!, revisions: { ...page!.revisions, [revisionId]: { ...rp!, alignment: finalAlignment } } } },
  };
  const analysisBase = {
    pageNumber: pageKey,
    inputKey: analysisInputKey(finalComparison, revisionId, pageKey),
    method,
    baseRevisionId: base?.id ?? null,
    createdAt: Date.now(),
    alignment: quality,
    usedAlignment: finalAlignment,
  };
  const revMatrix = alignmentMatrix(finalAlignment, revPivot);
  return {
    W, H, mpp, tol, method, quality, userAlignment, finalAlignment, analysisBase,
    originalPage, revisedPage, basePage, baseMatrix, revMatrix,
    baseV, revV: transformVectorPage(revRaw, revMatrix), revRaw, exclusions,
  };
}

export async function detectRevisionPage(
  comparison: Comparison,
  revisionId: string,
  pageKey: number,
  onProgress: (fraction: number, step: 'loading' | 'aligning' | 'comparing' | 'classifying') => void = () => {},
): Promise<DetectionOutcome> {
  const prep = await prepareRevisionPage(comparison, revisionId, pageKey, onProgress);
  const { W, H, mpp, tol, method, quality, userAlignment, finalAlignment, analysisBase, revisedPage, basePage, baseMatrix, revMatrix, baseV, revV, exclusions } = prep;
  if (quality.status === 'poor') {
    return { analysis: { ...analysisBase, changes: [], filteredCount: 0 }, refinedAlignment: null };
  }

  onProgress(0.5, 'comparing');
  await yieldToUI();
  const revOutline = pageCorners(revisedPage, revMatrix);
  const baseOutline = baseMatrix ? pageCorners(basePage, baseMatrix) : null;
  const validAreas = baseOutline ? [revOutline, baseOutline] : [revOutline];
  let result;
  if (method === 'vector') {
    result = diffVectorPages({
      base: baseV,
      revised: revV,
      pageWidth: W,
      pageHeight: H,
      validAreas,
      exclusions,
      scale: { metersPerPixel: mpp },
      tolerancePx: tol,
      pageNumber: pageKey,
      newId: uuid,
    });
  } else {
    const s = Math.min(2, 2400 / Math.max(W, H));
    const baseImg = await renderInto(basePage, W, H, s, baseMatrix);
    const revImg = await renderInto(revisedPage, W, H, s, revMatrix);
    await yieldToUI();
    const baseGrid = inkGridFromImage(baseImg, 1 / s);
    const revGrid = inkGridFromImage(revImg, 1 / s);
    const validMask = new Uint8Array(baseGrid.w * baseGrid.h);
    for (let y = 0; y < baseGrid.h; y++) {
      for (let x = 0; x < baseGrid.w; x++) {
        const p = { x: (x + 0.5) / s, y: (y + 0.5) / s };
        if (validAreas.every((poly) => pointInPolygon(p, poly)) && !exclusions.some((r) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height)) {
          validMask[y * baseGrid.w + x] = 1;
        }
      }
    }
    result = diffRasterPages({ base: baseGrid, revised: revGrid, validMask, metersPerPixel: mpp, tolerancePx: tol, pageNumber: pageKey, newId: uuid });
  }
  onProgress(1, 'comparing');
  return {
    analysis: { ...analysisBase, changes: result.changes, filteredCount: result.filteredCount },
    refinedAlignment: finalAlignment === userAlignment ? null : finalAlignment,
  };
}

/**
 * The base and revised drawings in source-page px, mapped with a given revision alignment (the one
 * a full-plan AI request was rendered with) — for verifying the AI's geometry after it answers.
 */
export async function drawingsInSourceSpace(comparison: Comparison, revisionId: string, pageKey: number, alignment: LayerTransform) {
  const revision = comparison.revisions.find((r) => r.id === revisionId);
  if (!revision) throw new Error('revision-missing');
  const base = baseRevisionOf(comparison, revision);
  const page = comparison.pages[pageKey];
  const rp = page?.revisions[revisionId];
  const bp = base ? page?.revisions[base.id] : undefined;
  const originalPage = await loadLayerPage(comparison.id, 'original', page?.originalPageNumber ?? pageKey);
  const revisedPage = await loadLayerPage(comparison.id, `revision:${revisionId}`, rp?.revisedPageNumber ?? pageKey);
  const basePage = base ? await loadLayerPage(comparison.id, `revision:${base.id}`, bp?.revisedPageNumber ?? pageKey) : originalPage;
  const vp = originalPage.getViewport({ scale: 1 });
  const [baseRaw, revRaw] = await Promise.all([extractVectorPage(basePage), extractVectorPage(revisedPage)]);
  const baseMatrix = base ? alignmentMatrix(bp?.alignment ?? IDENTITY_TRANSFORM, pivotOf(basePage)) : null;
  const mpp = resolveCompareScale(page, rp ? { ...rp, alignment } : rp).metersPerPixel;
  const isVector = (v: VectorPage) => v.curve.length >= 300 && v.imageCoverage < 0.3;
  return {
    W: vp.width,
    H: vp.height,
    mpp,
    tol: detectionThresholds(mpp).tolerancePx,
    vector: isVector(baseRaw) && isVector(revRaw),
    baseV: baseMatrix ? transformVectorPage(baseRaw, baseMatrix) : baseRaw,
    revV: transformVectorPage(revRaw, alignmentMatrix(alignment, pivotOf(revisedPage))),
  };
}
