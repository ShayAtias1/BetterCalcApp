import { v4 as uuid } from 'uuid';
import { normalizeRevisionWallGeometry } from './wallGeometry';
import type { Point } from '../../types';
import type { Comparison, LayerTransform } from '../../types/compare';
import { IDENTITY_TRANSFORM } from '../../types/compare';
import type {
  RevisionAiChangeType,
  RevisionAiLabel,
  RevisionAiProposal,
  RevisionChange,
  RevisionPageManifest,
  RevisionSegment,
  RevisionWall,
  RevisionDoor,
  RevisionWallCandidate,
} from '../../types/revisionAnalysis';
import { loadComparePdfBlob } from '../../db/database';
import { ViewerPdfDocument } from '../pdfViewerSource';
import { aiTiles } from '../ai/contracts';
import { pdfFingerprint } from '../ai/preparePage';
import { alignmentMatrix, baseRevisionOf } from './detect';
import { detectionThresholds, drawnShare, indexDrawing, matchRelocation, verifyDoorNear, verifyWallNear, type DrawingIndex } from './vectorDiff';
import { isRectangle } from '../zoneGeometry';
import { wallFootprintGeometry } from '../areaGeometryEditing';
import type { VectorPage } from './vectorExtract';
import { sameChange } from './changeMatch';

/**
 * Full-plan AI revision analysis (task `revision-page-v1`).
 *
 * The AI inspects BOTH complete revisions — nothing local decides where it looks. They are rendered
 * with the proven takeoff preparation (PDFium, 5500 px longest side, four overlapping tiles) into the
 * same source-page frame: the base as is, the revision through its alignment. The model answers in
 * tile-local normalized coordinates (the AI Lab finding: tile frames map reliably where full-page
 * coordinates drifted), which map back to source-page px exactly as the openings task does.
 *
 * AI geometry is location evidence only. Each proposal is checked against the vector drawings: a
 * wall is "verified" only when a parallel pair of drawn faces at wall thickness is found there (and
 * is absent from the other revision), a door only when its swing arc is drawn there. Only verified
 * geometry produces quantities; everything else needs the user's confirmation or manual measurement.
 */

export const REVISION_PAGE_TASK = 'revision-page-v1';
const OVERVIEW_MAX = 2200;
const IMAGE_ORDER = ['BEFORE_PAGE', 'AFTER_PAGE', 'BEFORE_TILE_A', 'AFTER_TILE_A', 'BEFORE_TILE_B', 'AFTER_TILE_B', 'BEFORE_TILE_C', 'AFTER_TILE_C', 'BEFORE_TILE_D', 'AFTER_TILE_D'] as const;

type Matrix = [number, number, number, number, number, number];

export interface RevisionPageSubmission {
  task: typeof REVISION_PAGE_TASK;
  requestId: string;
  manifest: RevisionPageManifest;
  images: { name: string; width: number; height: number; base64: string }[];
}

function blobBase64(blob: Blob): Promise<string> {
  if (blob.size > 20_000_000) throw new Error('ai-image-too-large');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('ai-image-encoding'));
    reader.readAsDataURL(blob);
  });
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('ai-image-encoding'))), 'image/png'));
}

async function pageRaster(blob: Blob, pageNumber: number) {
  const document = await ViewerPdfDocument.open(() => Promise.resolve(blob), new AbortController().signal);
  try {
    const page = await document.getPage(pageNumber);
    const raster = await page.prepareAiRaster();
    return { ...raster, bitmap: await createImageBitmap(raster.png) };
  } finally {
    document.dispose();
  }
}

/**
 * Draws a revision's own 5500 px raster into the source frame: canvas = sourceScale × M(revision px),
 * where M is the alignment matrix (revision native → source native). White outside the revision page.
 */
function warpInto(target: CanvasRenderingContext2D, bitmap: ImageBitmap, rasterScale: number, m: Matrix | null, sourceScale: number) {
  const k = sourceScale / rasterScale;
  const b: Matrix = m ?? [1, 0, 0, 1, 0, 0];
  target.save();
  target.setTransform(b[0] * k, b[1] * k, b[2] * k, b[3] * k, b[4] * sourceScale, b[5] * sourceScale);
  target.imageSmoothingQuality = 'high';
  target.drawImage(bitmap, 0, 0);
  target.restore();
}

function canvas2d(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width !== width || canvas.height !== height) throw new Error('ai-canvas-unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

/** Renders both complete revisions into the source frame and cuts the ten request images. Nothing is sent here. */
export async function prepareRevisionPageRequest(comparison: Comparison, revisionId: string, pageKey: number, alignment: LayerTransform): Promise<RevisionPageSubmission> {
  const revision = comparison.revisions.find((r) => r.id === revisionId);
  if (!revision) throw new Error('revision-missing');
  const base = baseRevisionOf(comparison, revision);
  const page = comparison.pages[pageKey];
  const rp = page?.revisions[revisionId];
  const bp = base ? page?.revisions[base.id] : undefined;
  const [originalBlob, revisedBlob, baseBlob] = await Promise.all([
    loadComparePdfBlob(comparison.id, 'original'),
    loadComparePdfBlob(comparison.id, `revision:${revisionId}`),
    base ? loadComparePdfBlob(comparison.id, `revision:${base.id}`) : Promise.resolve(undefined),
  ]);
  if (!originalBlob || !revisedBlob || (base && !baseBlob)) throw new Error('pdf-missing');

  const original = await pageRaster(originalBlob, page?.originalPageNumber ?? pageKey);
  const W = original.width;
  const H = original.height;
  const sourceScale = original.scale;
  const before = canvas2d(W, H);
  const after = canvas2d(W, H);
  const rasters = [original.bitmap];
  try {
    if (base && baseBlob) {
      const b = await pageRaster(baseBlob, bp?.revisedPageNumber ?? pageKey);
      rasters.push(b.bitmap);
      warpInto(before.ctx, b.bitmap, b.scale, alignmentMatrix(bp?.alignment ?? IDENTITY_TRANSFORM, { x: b.nativeWidth / 2, y: b.nativeHeight / 2 }), sourceScale);
    } else {
      before.ctx.drawImage(original.bitmap, 0, 0);
    }
    const r = await pageRaster(revisedBlob, rp?.revisedPageNumber ?? pageKey);
    rasters.push(r.bitmap);
    warpInto(after.ctx, r.bitmap, r.scale, alignmentMatrix(alignment, { x: r.nativeWidth / 2, y: r.nativeHeight / 2 }), sourceScale);

    const tiles = aiTiles(W, H);
    const ok = Math.min(1, OVERVIEW_MAX / Math.max(W, H));
    const overviewDimensions: [number, number] = [Math.max(1, Math.round(W * ok)), Math.max(1, Math.round(H * ok))];
    const images: RevisionPageSubmission['images'] = [];
    const cut = async (name: string, source: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number) => {
      const out = canvas2d(dw, dh);
      out.ctx.drawImage(source, sx, sy, sw, sh, 0, 0, dw, dh);
      images.push({ name, width: dw, height: dh, base64: await blobBase64(await toPng(out.canvas)) });
      out.canvas.width = out.canvas.height = 0;
    };
    await cut('BEFORE_PAGE', before.canvas, 0, 0, W, H, overviewDimensions[0], overviewDimensions[1]);
    await cut('AFTER_PAGE', after.canvas, 0, 0, W, H, overviewDimensions[0], overviewDimensions[1]);
    for (const tile of tiles) {
      await cut(`BEFORE_${tile.tileId}`, before.canvas, tile.pageX, tile.pageY, tile.pageWidth, tile.pageHeight, tile.tileWidth, tile.tileHeight);
      await cut(`AFTER_${tile.tileId}`, after.canvas, tile.pageX, tile.pageY, tile.pageWidth, tile.pageHeight, tile.tileWidth, tile.tileHeight);
    }
    const manifest: RevisionPageManifest = {
      preparationVersion: 'revision-page-v1',
      comparisonId: comparison.id,
      revisionId,
      baseRevisionId: base?.id ?? null,
      pageNumber: pageKey,
      context: comparison.context ?? 'design',
      sourceHash: await pdfFingerprint(originalBlob),
      revisedHash: await pdfFingerprint(revisedBlob),
      nativeWidth: original.nativeWidth,
      nativeHeight: original.nativeHeight,
      renderScale: sourceScale,
      pageDimensions: [W, H],
      overviewDimensions,
      tiles,
    };
    if (images.map((i) => i.name).join() !== IMAGE_ORDER.join()) throw new Error('ai-image-order');
    return { task: REVISION_PAGE_TASK, requestId: `revision-${uuid()}`, manifest, images };
  } finally {
    for (const b of rasters) b.close();
    before.canvas.width = before.canvas.height = after.canvas.width = after.canvas.height = 0;
  }
}

// ---------- answer → proposals ----------

interface RawPoint { x: number; y: number }
interface RawSegment { a: RawPoint; b: RawPoint }
interface RawOpening { corners: RawPoint[]; kind: 'door' | 'window' | 'unknown'; heightM: number | null; sillHeightM: number | null }
interface RawChange {
  changeId: string;
  changeType: RevisionAiChangeType;
  geometryTile: 'TILE_A' | 'TILE_B' | 'TILE_C' | 'TILE_D';
  before: RawSegment | null;
  after: RawSegment | null;
  /** Optional only for cached responses from the legacy line-only contract. */
  beforeOpening?: RawOpening | null;
  afterOpening?: RawOpening | null;
  bbox: { x1: number; y1: number; x2: number; y2: number };
  confidence: number;
  requiresReview: boolean;
  summary: string;
  evidence: string[];
}

const CHANGE_TYPES: RevisionAiChangeType[] = ['wall-added', 'wall-removed', 'wall-relocated', 'door-added', 'door-removed', 'window-added', 'window-removed', 'opening-modified', 'room-boundary-changed'];
const unit = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const isPoint = (p: unknown): p is RawPoint => !!p && typeof p === 'object' && unit((p as RawPoint).x) && unit((p as RawPoint).y);
const isSegment = (s: unknown): s is RawSegment | null => s === null || (!!s && typeof s === 'object' && isPoint((s as RawSegment).a) && isPoint((s as RawSegment).b));
const isOpening = (s: RawOpening | null | undefined) => s == null || (Array.isArray(s.corners) && s.corners.length === 4 && s.corners.every(isPoint)
  && ['door', 'window', 'unknown'].includes(s.kind) && (s.heightM === null || (Number.isFinite(s.heightM) && s.heightM > 0))
  && (s.sillHeightM === null || (Number.isFinite(s.sillHeightM) && s.sillHeightM >= 0)));

/** Validates the answer as a whole (the server already checked the schema); malformed items are dropped, not repaired. */
export function parseRevisionPageResult(result: unknown): { changes: RawChange[]; coverageNotes: string[] } {
  const data = result as { changes?: unknown; coverageNotes?: unknown };
  if (!data || !Array.isArray(data.changes)) throw new Error('ai-invalid-result');
  const changes = data.changes.filter((c): c is RawChange => {
    const x = c as RawChange;
    return !!x && typeof x.changeId === 'string' && CHANGE_TYPES.includes(x.changeType) && ['TILE_A', 'TILE_B', 'TILE_C', 'TILE_D'].includes(x.geometryTile) &&
      isSegment(x.before) && isSegment(x.after) && isOpening(x.beforeOpening) && isOpening(x.afterOpening) && !!x.bbox && unit(x.bbox.x1) && unit(x.bbox.y1) && unit(x.bbox.x2) && unit(x.bbox.y2) &&
      x.bbox.x1 <= x.bbox.x2 && x.bbox.y1 <= x.bbox.y2 && unit(x.confidence) && typeof x.requiresReview === 'boolean';
  });
  return { changes, coverageNotes: Array.isArray(data.coverageNotes) ? data.coverageNotes.filter((n): n is string => typeof n === 'string').slice(0, 10) : [] };
}

/** Tile-local normalized → source-page native px (the openings mapping). */
export function tileToNative(p: RawPoint, tileId: string, m: RevisionPageManifest): Point {
  const tile = m.tiles.find((t) => t.tileId === tileId);
  if (!tile) throw new Error('ai-unknown-tile');
  return { x: (tile.pageX + p.x * tile.pageWidth) / m.renderScale, y: (tile.pageY + p.y * tile.pageHeight) / m.renderScale };
}

function label(c: RawChange): RevisionAiLabel {
  const category: RevisionAiLabel['category'] = c.changeType.startsWith('wall') ? 'wall' : c.changeType.startsWith('door') ? 'door'
    : c.changeType.startsWith('window') ? 'window' : c.changeType === 'opening-modified' ? 'opening-other' : 'room-boundary';
  const changeType: RevisionAiLabel['changeType'] = c.changeType.endsWith('added') ? 'added' : c.changeType.endsWith('removed') ? 'removed'
    : c.changeType === 'wall-relocated' ? 'moved' : 'modified';
  return { category, changeType, meaningful: true, confidence: c.confidence, summary: (c.summary ?? '').slice(0, 200) };
}

export interface VerificationDrawings {
  W: number;
  H: number;
  mpp: number;
  tol: number;
  vector: boolean;
  baseV: VectorPage;
  revV: VectorPage;
}

/**
 * Builds change proposals from the AI answer, verifying each one locally. AI coordinates position
 * the marker; quantities come only from geometry measured in the drawings.
 */
export function buildAiChanges(raw: RawChange[], manifest: RevisionPageManifest, drawings: VerificationDrawings): RevisionChange[] {
  const { mpp, tol } = drawings;
  const t = detectionThresholds(mpp);
  const baseIdx: DrawingIndex | null = drawings.vector ? indexDrawing(drawings.baseV, drawings.W, drawings.H) : null;
  const revIdx: DrawingIndex | null = drawings.vector ? indexDrawing(drawings.revV, drawings.W, drawings.H) : null;
  const seg = (s: RawSegment | null, tile: string): [Point, Point] | null => (s ? [tileToNative(s.a, tile, manifest), tileToNative(s.b, tile, manifest)] : null);
  const out: RevisionChange[] = [];
  for (const c of raw) {
    const before = seg(c.before, c.geometryTile);
    const after = seg(c.after, c.geometryTile);
    const p1 = tileToNative({ x: c.bbox.x1, y: c.bbox.y1 }, c.geometryTile, manifest);
    const p2 = tileToNative({ x: c.bbox.x2, y: c.bbox.y2 }, c.geometryTile, manifest);
    const pad = tol * 2;
    const bbox = { x: Math.min(p1.x, p2.x) - pad, y: Math.min(p1.y, p2.y) - pad, width: Math.abs(p2.x - p1.x) + pad * 2, height: Math.abs(p2.y - p1.y) + pad * 2 };
    const isWall = c.changeType.startsWith('wall');
    const isDoor = c.changeType.startsWith('door');
    let walls: RevisionWall[] = [];
    let doors: RevisionDoor[] = [];
    let candidates: RevisionWallCandidate[] = [];
    let verification: RevisionAiProposal['verification'] = 'unverified';
    let conflict = false;
    if (baseIdx && revIdx && isWall) {
      const sides: { line: [Point, Point] | null; side: 'removed' | 'added'; own: DrawingIndex; other: DrawingIndex }[] = [
        { line: before, side: 'removed', own: baseIdx, other: revIdx },
        { line: after, side: 'added', own: revIdx, other: baseIdx },
      ];
      for (const s of sides) {
        if (!s.line) continue;
        const found = verifyWallNear(s.own, s.other, s.line, s.side, mpp, tol);
        if (found.conflict) conflict = true;
        walls = [...walls, ...found.walls];
        candidates = [...candidates, ...found.incomplete];
      }
      const expected = (before ? 1 : 0) + (after ? 1 : 0);
      const verifiedSides = new Set(walls.map((w) => w.side)).size;
      verification = conflict ? 'conflict' : verifiedSides === expected && expected > 0 && !candidates.length ? 'verified' : walls.length || candidates.length ? 'incomplete' : 'unverified';
    } else if (baseIdx && revIdx && isDoor) {
      const line = c.changeType === 'door-added' ? after : before;
      const side = c.changeType === 'door-added' ? 'added' : 'removed';
      const door = line ? verifyDoorNear(side === 'added' ? revIdx : baseIdx, line, side, mpp, side === 'added' ? baseIdx : revIdx, tol) : null;
      if (door) {
        doors = [door];
        verification = 'verified';
      }
    }
    if (!isWall && c.changeType !== 'room-boundary-changed') {
      const rectangles: RevisionDoor[] = [];
      for (const [rawOpening, side, own] of [
        [c.beforeOpening, 'removed', baseIdx], [c.afterOpening, 'added', revIdx],
      ] as const) {
        if (!rawOpening) continue;
        const footprint = rawOpening.corners.map(p => tileToNative(p, c.geometryTile, manifest));
        // Validation is in native pixels: normalized tile axes may have different scales.
        if (!isRectangle(footprint)) continue;
        const geometry = wallFootprintGeometry(footprint, []);
        if (!geometry) continue;
        const verified = !!own && drawnShare(own, footprint[3], footprint[0], tol) >= 0.75
          && drawnShare(own, footprint[1], footprint[2], tol) >= 0.75;
        rectangles.push({ side, hinge: geometry.centerline[0], jamb: geometry.centerline[1], radiusPx: geometry.lengthPx,
          footprint, wallThicknessPx: geometry.thicknessPx, geometryVerified: verified, impactVerified: false,
          ...(rawOpening.kind !== 'unknown' ? { opening: rawOpening.kind } : {}),
          ...(rawOpening.heightM != null ? { heightM: rawOpening.heightM } : {}),
          ...(rawOpening.sillHeightM != null ? { sillHeightM: rawOpening.sillHeightM } : {}) });
      }
      if (c.beforeOpening !== undefined || c.afterOpening !== undefined) {
        doors = rectangles;
        const expected = c.changeType === 'opening-modified' ? 2 : 1;
        verification = rectangles.length === expected && rectangles.every(d => d.geometryVerified) && !c.requiresReview ? 'verified' : rectangles.length ? 'incomplete' : 'unverified';
      }
    }
    const relocation = c.changeType === 'wall-relocated' && verification === 'verified' ? matchRelocation(walls, tol, t.relocationMaxShift) : undefined;
    const markers = (s: [Point, Point] | null): RevisionSegment[] => (s ? [{ x1: s[0].x, y1: s[0].y, x2: s[1].x, y2: s[1].y }] : []);
    const kind = c.changeType.endsWith('added') ? 'added' : c.changeType.endsWith('removed') ? 'removed' : 'modified';
    const strong = verification === 'verified' || (c.confidence >= 0.6 && !c.requiresReview && verification !== 'conflict');
    out.push({
      id: uuid(),
      pageNumber: manifest.pageNumber,
      kind,
      category: isWall ? 'wall' : c.changeType === 'room-boundary-changed' ? 'other' : 'opening',
      significance: strong ? 'high' : 'medium',
      score: Math.round((c.confidence * 0.6 + (verification === 'verified' ? 0.4 : verification === 'incomplete' ? 0.2 : 0)) * 1000) / 1000,
      evidence: ['ai-detected', `geometry-${verification}`, ...(relocation ? ['relocated'] : [])],
      bbox,
      // Markers show where the AI located the change; they are never measured.
      addedSegments: markers(after),
      removedSegments: markers(before),
      walls,
      doors,
      ...(relocation ? { relocation } : {}),
      ...(candidates.length ? { wallCandidates: candidates } : {}),
      addedLengthPx: 0,
      removedLengthPx: 0,
      ai: label(c),
      aiProposal: { changeType: c.changeType, before, after, requiresReview: c.requiresReview || verification !== 'verified', evidence: (c.evidence ?? []).slice(0, 6), verification,
        ...(c.beforeOpening !== undefined || c.afterOpening !== undefined ? { geometryFormat: 'opening-footprints-v1' as const } : {}) },
      status: 'pending',
    });
  }
  return dedupe(out.map(c => normalizeRevisionWallGeometry(c)));
}

/** Duplicate AI fragments may have disjoint boxes but verify to the same complete wall.
 * Only identical verified footprints qualify: adjacent or disconnected geometry is not inferred.
 */
function sameVerifiedWall(a: RevisionChange, b: RevisionChange): boolean {
  if (a.category !== 'wall' || b.category !== 'wall' || a.kind !== b.kind
    || a.aiProposal?.changeType !== b.aiProposal?.changeType
    || a.aiProposal?.verification !== 'verified' || b.aiProposal?.verification !== 'verified'
    || !a.walls.length || a.walls.length !== b.walls.length) return false;
  // More than one piece of a side may mean an actual opening/structural break; keep those separate.
  if (new Set(a.walls.map(w => w.side)).size !== a.walls.length) return false;
  return a.walls.every(w => b.walls.some(other => other.side === w.side
    && Math.abs(other.thicknessPx - w.thicknessPx) < 1e-6
    && w.footprint.length === other.footprint.length
    && w.footprint.every(p => other.footprint.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6))));
}

/** The same physical change reported from two overlapping tiles: keep the better-evidenced one. */
function dedupe(changes: RevisionChange[]): RevisionChange[] {
  const rank = (c: RevisionChange) => (c.aiProposal?.verification === 'verified' ? 2 : c.aiProposal?.verification === 'incomplete' ? 1 : 0) + c.score;
  const kept: RevisionChange[] = [];
  for (const c of [...changes].sort((a, b) => rank(b) - rank(a))) {
    if (kept.some((k) => sameVerifiedWall(k, c) || sameChange(k, c))) continue;
    kept.push(c);
  }
  return kept;
}
