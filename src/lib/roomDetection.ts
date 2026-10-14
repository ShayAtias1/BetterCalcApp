import type { Point } from '../types';
import { ROOM_PROFILES, roomProfileName, type RoomProfile, type TilingCategoryKey } from './roomProfiles';
import { t } from '../i18n';
import type { PlanPageSource, PlanTextItem } from './planSource';

/**
 * Heuristic room detection for architectural plans.
 *
 * Pipeline (all pure geometry / raster ops, no external deps so it can run in the browser and be
 * reused by the Compare feature too):
 *   1. Render the plan page to a raster.
 *   2. Binarize into a "wall" mask (dark ink) vs "interior" (light background).
 *   3. Dilate the walls slightly to close small gaps (doorways) so flood-fill doesn't leak between rooms.
 *   4. Connected-component labeling of the interior; drop the border-touching component (the outside)
 *      and components outside a sensible area range.
 *   5. Trace + simplify each component's outer contour into a polygon (converted to native px coords).
 *   6. Match plan text falling inside each polygon against a Hebrew room-name dictionary to name,
 *      classify (regular vs AS tiling) and score confidence.
 *
 * It is intentionally a *starting point*: results are fully editable afterwards, and thresholds are
 * exposed via DetectionOptions for tuning.
 */

/**
 * The room-type catalogue lives in roomProfiles.ts — it is shared with the manual room-type picker.
 * Re-exported here so existing detection-side importers keep working unchanged.
 */
export { ROOM_PROFILES, getRoomProfile } from './roomProfiles';
export type { RoomProfile, TilingCategoryKey } from './roomProfiles';

/** Flat {label, profile} list sorted by label length desc, so the most specific keyword wins. */
const LABEL_INDEX: { label: string; normalized: string; profile: RoomProfile }[] = ROOM_PROFILES.flatMap((profile) =>
  profile.labels.map((label) => ({ label, normalized: normalizeHebrew(label), profile }))
).sort((a, b) => b.normalized.length - a.normalized.length);

function normalizeHebrew(s: string): string {
  // Drop gershayim/quotes and collapse whitespace so ממ"ד / ממ״ד / ממד all compare equal.
  return s.replace(/["'״׳]/g, '').replace(/\s+/g, ' ').trim();
}

export interface DetectedRoom {
  /** Outer contour polygon in native (scale=1) px coordinates. */
  polygon: Point[];
  centroid: Point;
  areaPx: number;
  name: string;
  roomTypeKey: string | null;
  tilingCategory: TilingCategoryKey;
  confidence: 'high' | 'low';
}

export interface DetectionSummary {
  total: number;
  highConfidence: number;
  needsReview: number;
}

export interface DetectionOptions {
  /** 0..255 luminance below which a pixel is treated as wall ink. */
  luminanceThreshold?: number;
  /** Radius (px, at detection scale) to thicken walls by, to close doorway gaps. */
  wallDilation?: number;
  /** Min/max component area as a fraction of the whole page, to reject noise and the building outline. */
  minAreaFraction?: number;
  maxAreaFraction?: number;
  /** Douglas–Peucker simplification tolerance in px (at detection scale). */
  simplifyTolerance?: number;
  onProgress?: (fraction: number, label: string) => void;
}

const DEFAULTS = {
  luminanceThreshold: 150,
  wallDilation: 2,
  minAreaFraction: 0.0015,
  maxAreaFraction: 0.45,
  simplifyTolerance: 2.5,
};

/** Lets the browser paint the progress UI between heavy synchronous phases. */
function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Renders `source` and detects rooms. Returns polygons in the same native px space the viewers use,
 * so results can be dropped straight into `Room.points`.
 */
export async function runRoomDetection(
  source: PlanPageSource,
  options: DetectionOptions = {}
): Promise<{ rooms: DetectedRoom[]; summary: DetectionSummary }> {
  const opts = { ...DEFAULTS, ...options };
  const report = (f: number, label: string) => opts.onProgress?.(f, label);

  const native = source.getNativeSize();
  // Cap the working raster so detection stays fast on large sheets, while keeping enough detail.
  const maxDim = 2200;
  const scale = Math.min(2, maxDim / Math.max(native.width, native.height));

  report(0.05, t('detection.rendering'));
  const canvas = document.createElement('canvas');
  const handle = source.render(canvas, scale);
  await handle.promise;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { rooms: [], summary: { total: 0, highConfidence: 0, needsReview: 0 } };
  const { width: w, height: h } = canvas;
  const image = ctx.getImageData(0, 0, w, h);

  report(0.2, t('detection.walls'));
  await yieldToUI();
  const wall = buildWallMask(image, opts.luminanceThreshold);
  dilate(wall, w, h, opts.wallDilation);

  report(0.4, t('detection.regions'));
  await yieldToUI();
  const { labels, components } = connectedInteriorComponents(wall, w, h);

  const pageArea = w * h;
  const minArea = pageArea * opts.minAreaFraction;
  const maxArea = pageArea * opts.maxAreaFraction;

  report(0.65, t('detection.outlines'));
  await yieldToUI();

  const textItems = await source.getTextItems().catch(() => [] as PlanTextItem[]);

  const rooms: DetectedRoom[] = [];
  for (const comp of components) {
    if (comp.touchesBorder) continue;
    if (comp.area < minArea || comp.area > maxArea) continue;
    const contourPx = traceContour(labels, comp.id, comp.bbox, w, h);
    if (contourPx.length < 3) continue;
    const simplifiedPx = simplifyPolygon(contourPx, opts.simplifyTolerance);
    if (simplifiedPx.length < 3) continue;

    // Convert detection-scale px → native px.
    const polygon = simplifiedPx.map((p) => ({ x: p.x / scale, y: p.y / scale }));
    const centroid = { x: comp.cx / scale, y: comp.cy / scale };

    const match = matchRoomName(polygon, textItems);
    rooms.push({
      polygon,
      centroid,
      areaPx: comp.area / (scale * scale),
      name: match ? match.name : '',
      roomTypeKey: match ? match.profile.key : null,
      tilingCategory: match ? match.profile.tiling : 'regular',
      confidence: match ? 'high' : 'low',
    });
  }

  report(0.9, t('detection.naming'));
  await yieldToUI();

  // Give unnamed rooms a stable temporary name.
  let tempCounter = 0;
  for (const room of rooms) {
    if (!room.name) room.name = t('defaultNames.room', { number: ++tempCounter });
  }

  const summary: DetectionSummary = {
    total: rooms.length,
    highConfidence: rooms.filter((r) => r.confidence === 'high').length,
    needsReview: rooms.filter((r) => r.confidence === 'low').length,
  };
  report(1, t('detection.done'));
  return { rooms, summary };
}

// ---------- raster stages ----------

function buildWallMask(image: ImageData, threshold: number): Uint8Array {
  const { data, width, height } = image;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    // Rec. 601 luma; treat fully-transparent pixels as background.
    const luma = a === 0 ? 255 : 0.299 * r + 0.587 * g + 0.114 * b;
    mask[i] = luma < threshold ? 1 : 0;
  }
  return mask;
}

/** In-place binary dilation by `radius` using a square structuring element (separable passes). */
function dilate(mask: Uint8Array, w: number, h: number, radius: number) {
  if (radius <= 0) return;
  // Horizontal pass.
  let src = mask.slice();
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let d = -radius; d <= radius && !on; d++) {
        const nx = x + d;
        if (nx >= 0 && nx < w && src[row + nx]) on = 1;
      }
      mask[row + x] = on;
    }
  }
  // Vertical pass.
  src = mask.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let d = -radius; d <= radius && !on; d++) {
        const ny = y + d;
        if (ny >= 0 && ny < h && src[ny * w + x]) on = 1;
      }
      mask[y * w + x] = on;
    }
  }
}

interface Component {
  id: number; // label value in the shared `labels` image
  area: number;
  touchesBorder: boolean;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  cx: number;
  cy: number;
}

/**
 * 4-connected flood fill of interior (non-wall) pixels. Writes each pixel's component id into a single
 * shared Int32Array (0 = wall/unassigned), so membership tests stay O(1) without a mask per component.
 */
function connectedInteriorComponents(wall: Uint8Array, w: number, h: number): { labels: Int32Array; components: Component[] } {
  const labels = new Int32Array(w * h);
  const components: Component[] = [];
  const stack: number[] = [];
  // Function-scoped so the hoisted pushNeighbor closure always sees the current component's id.
  let id = 0;

  for (let start = 0; start < wall.length; start++) {
    if (wall[start] || labels[start] !== 0) continue;
    id++;
    let area = 0;
    let touchesBorder = false;
    let sumX = 0;
    let sumY = 0;
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    stack.length = 0;
    stack.push(start);
    labels[start] = id;

    while (stack.length) {
      const idx = stack.pop()!;
      const x = idx % w;
      const y = (idx - x) / w;
      area++;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesBorder = true;

      if (x > 0) pushNeighbor(idx - 1);
      if (x < w - 1) pushNeighbor(idx + 1);
      if (y > 0) pushNeighbor(idx - w);
      if (y < h - 1) pushNeighbor(idx + w);
    }

    components.push({ id, area, touchesBorder, bbox: { minX, minY, maxX, maxY }, cx: sumX / area, cy: sumY / area });
  }
  return { labels, components };

  function pushNeighbor(nIdx: number) {
    if (!wall[nIdx] && labels[nIdx] === 0) {
      labels[nIdx] = id;
      stack.push(nIdx);
    }
  }
}

/** Moore-neighbor boundary tracing of a single labeled component; returns the outer contour as px points. */
function traceContour(labels: Int32Array, compId: number, bbox: Component['bbox'], w: number, h: number): Point[] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === compId;

  // Find the top-left-most filled pixel as the start.
  let sx = -1;
  let sy = -1;
  outer: for (let y = bbox.minY; y <= bbox.maxY; y++) {
    for (let x = bbox.minX; x <= bbox.maxX; x++) {
      if (inside(x, y)) {
        sx = x;
        sy = y;
        break outer;
      }
    }
  }
  if (sx < 0) return [];

  // 8-neighborhood offsets, clockwise starting from "west".
  const N = [
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
  ];
  const contour: Point[] = [{ x: sx, y: sy }];
  let cx = sx;
  let cy = sy;
  let backDir = 0; // came from the west
  const maxSteps = w * h * 4;
  let steps = 0;

  do {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const dir = (backDir + 1 + k) % 8;
      const nx = cx + N[dir][0];
      const ny = cy + N[dir][1];
      if (inside(nx, ny)) {
        cx = nx;
        cy = ny;
        contour.push({ x: cx, y: cy });
        // The new "back" direction points from the new pixel toward the previous one.
        backDir = (dir + 4) % 8;
        found = true;
        break;
      }
    }
    if (!found) break;
    steps++;
  } while ((cx !== sx || cy !== sy) && steps < maxSteps);

  return contour;
}

// ---------- polygon helpers ----------

/** Douglas–Peucker polyline simplification on a closed contour. */
function simplifyPolygon(points: Point[], tolerance: number): Point[] {
  if (points.length <= 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpDistance(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index !== -1) {
      keep[index] = 1;
      stack.push([first, index]);
      stack.push([index, last]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

function perpDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

function pointInPolygon(pt: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Matches the plan text sitting inside `polygon` against the room-name dictionary. */
function matchRoomName(polygon: Point[], textItems: PlanTextItem[]): { name: string; profile: RoomProfile } | null {
  const insideText = textItems
    .filter((t) => pointInPolygon({ x: t.x, y: t.y }, polygon))
    .map((t) => normalizeHebrew(t.str));
  if (insideText.length === 0) return null;
  const joined = insideText.join(' ');

  for (const entry of LABEL_INDEX) {
    if (joined.includes(entry.normalized)) {
      // Prefer the literal recognized text as the room name when it's short and specific.
      const literal = insideText.find((text) => text.includes(entry.normalized));
      const name = literal && literal.length <= entry.normalized.length + 8 ? literal : roomProfileName(entry.profile);
      return { name, profile: entry.profile };
    }
  }
  return null;
}

/**
 * Re-traces one room on an already rendered page image: the enclosed region containing the first
 * usable seed point. Used by AI Revision Compare to propose a room's boundary on the revised plan
 * (rendered into the original page's coordinates). `scale` is image px per native px.
 *
 * Returns null when no seed lands in an enclosed region (open to the page edge, or every seed on a
 * wall) — the caller then leaves the room for manual review instead of guessing.
 */
export function traceRoomAtSeeds(image: ImageData, scale: number, seeds: Point[], options: Pick<DetectionOptions, 'luminanceThreshold' | 'wallDilation' | 'simplifyTolerance'> = {}): Point[] | null {
  const opts = { ...DEFAULTS, ...options };
  const { width: w, height: h } = image;
  const wall = buildWallMask(image, opts.luminanceThreshold);
  dilate(wall, w, h, opts.wallDilation);
  for (const seed of seeds) {
    const sx = Math.round(seed.x * scale);
    const sy = Math.round(seed.y * scale);
    if (sx < 1 || sy < 1 || sx >= w - 1 || sy >= h - 1 || wall[sy * w + sx]) continue;
    // Flood only the seed's component, so a page-sized background never costs a full labelling.
    const labels = new Int32Array(w * h);
    const stack = [sy * w + sx];
    labels[sy * w + sx] = 1;
    let touchesBorder = false;
    let minX = sx, minY = sy, maxX = sx, maxY = sy;
    while (stack.length) {
      const idx = stack.pop()!;
      const x = idx % w;
      const y = (idx - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesBorder = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      for (const n of [x > 0 ? idx - 1 : -1, x < w - 1 ? idx + 1 : -1, y > 0 ? idx - w : -1, y < h - 1 ? idx + w : -1]) {
        if (n >= 0 && !wall[n] && labels[n] === 0) {
          labels[n] = 1;
          stack.push(n);
        }
      }
    }
    if (touchesBorder) return null;
    const contour = traceContour(labels, 1, { minX, minY, maxX, maxY }, w, h);
    if (contour.length < 3) return null;
    const simplified = simplifyPolygon(contour, opts.simplifyTolerance);
    if (simplified.length < 3) return null;
    return simplified.map((p) => ({ x: p.x / scale, y: p.y / scale }));
  }
  return null;
}
