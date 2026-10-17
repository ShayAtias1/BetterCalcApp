import { v4 as uuid } from 'uuid';
import { canEditWork } from '../workspaceCapabilities';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { Measurement, Plan, Point, ReportColumn, Room } from '../../types';
import type { Comparison, RevisionLayer } from '../../types/compare';
import { IDENTITY_TRANSFORM } from '../../types/compare';
import type { ComparisonContext, PlanVersion, RevisionApplication, RevisionBackdrop, RevisionChange } from '../../types/revisionAnalysis';
import { loadComparePdfBlob, loadPdfBlob, loadPlan, loadPlanVersion, savePlanWithVersion } from '../../db/database';
import { loadPdfPlanSource } from '../planSource';
import { pdfFingerprint } from '../ai/preparePage';
import { polygonAreaPx, polygonCentroid, polygonPerimeterPx, distancePx, round, pxToMeters } from '../geometry';
import { traceRoomAtSeeds } from '../roomDetection';
import { addPlanOpening, openingsOf, reviewPlanOpening, updatePlanOpening, withOpeningRoomChanges } from '../planOpenings';
import { openingAccessDefault } from '../openingOptions';
import { allocateWorkItem } from '../workAllocation';
import { buildOpeningQuantityReport } from '../openingQuantityReport';
import { buildPlanQuantityReport, reportColumnInfo, type CategoryAmount } from '../projectQuantities';
import { OPENING_DEFAULT_SIZES } from '../../config/measurementDefaults';
import { t } from '../../i18n';
import { resolveCompareScale } from '../compareScale';
import { alignmentMatrix, baseRevisionOf } from './detect';
import { changeItems, doorsAllowed, wallsAllowed } from './changeItems';
import { isOpeningDifference, openingImpactReady } from './openingImpact';
import { openingGeometryNeedsVerification } from './changeEdit';

/**
 * Applying approved revision changes to the linked takeoff plan.
 *
 * Safety rules:
 * - The plan's PDF must be the comparison's original (same file), so coordinates are shared.
 * - Revision chains apply in order: a revision applies only on top of the revision it was compared
 *   against. The same change never applies twice (by id, and by matching geometry).
 * - Every application first stores a snapshot of the plan (IndexedDB `planVersions`) in the same
 *   transaction as the updated plan, and can be reverted from it.
 * - Quantities come from the existing engines: room work items recalculate from updated room
 *   geometry; demolition/construction items are ordinary area measurements; openings are created as
 *   drafts that the user approves in the openings workflow.
 * - Anything that cannot be determined safely is listed for review and left unchanged.
 */

export type LinkStatus = 'same-file' | 'different-file' | 'missing';

export async function checkPlanLink(comparison: Comparison, planId: string): Promise<LinkStatus> {
  const [planBlob, originalBlob] = await Promise.all([loadPdfBlob(planId), loadComparePdfBlob(comparison.id, 'original')]);
  if (!planBlob || !originalBlob) return 'missing';
  const [a, b] = await Promise.all([pdfFingerprint(planBlob), pdfFingerprint(originalBlob)]);
  return a === b ? 'same-file' : 'different-file';
}

export interface ChainState {
  allowed: boolean;
  /** The revision last applied from this comparison to the plan (null = none, the plan is the original). */
  headRevisionId: string | null;
  reason?: 'base-not-applied' | 'superseded';
}

/** The plan's most recent application that is still in force, from any comparison. */
export function latestApplication(plan: Plan): RevisionApplication | undefined {
  return (plan.revisionApplications ?? []).filter((a) => a.status === 'applied').at(-1);
}

export function appliedApplications(plan: Plan, comparisonId: string): RevisionApplication[] {
  return (plan.revisionApplications ?? []).filter((a) => a.comparisonId === comparisonId && a.status === 'applied');
}

export function chainState(plan: Plan, comparison: Comparison, revision: RevisionLayer): ChainState {
  const applied = appliedApplications(plan, comparison.id);
  const head = applied.length ? applied[applied.length - 1].revisionId : null;
  const base = baseRevisionOf(comparison, revision)?.id ?? null;
  if (revision.id === head || base === head) return { allowed: true, headRevisionId: head };
  if (applied.some((a) => a.revisionId === revision.id)) return { allowed: false, headRevisionId: head, reason: 'superseded' };
  return { allowed: false, headRevisionId: head, reason: 'base-not-applied' };
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t0 = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t0), p.y - (a.y + dy * t0));
}

function distanceToPolygonEdge(p: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, distanceToSegment(p, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

/** Joint-bounding-box sampling of two polygons: sampled cells inside each and inside both. */
function polygonSamples(a: Point[], b: Point[]): { inter: number; union: number; onlyA: number; onlyB: number } {
  const xs = [...a, ...b].map((p) => p.x);
  const ys = [...a, ...b].map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const n = 80;
  let inter = 0;
  let union = 0;
  let onlyA = 0;
  let onlyB = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p = { x: x0 + ((i + 0.5) / n) * (x1 - x0), y: y0 + ((j + 0.5) / n) * (y1 - y0) };
      const ia = pointInPolygon(p, a);
      const ib = pointInPolygon(p, b);
      if (ia && ib) inter++;
      else if (ia) onlyA++;
      else if (ib) onlyB++;
      if (ia || ib) union++;
    }
  }
  return { inter, union, onlyA, onlyB };
}

/** Approximate intersection-over-union of two polygons by sampling their joint bounding box. */
function polygonIou(a: Point[], b: Point[]): number {
  const { inter, union } = polygonSamples(a, b);
  return union ? inter / union : 0;
}

/** Share of the smaller polygon that lies inside the other: 1 when one contains the other. */
function polygonOverlap(a: Point[], b: Point[]): number {
  const { inter, onlyA, onlyB } = polygonSamples(a, b);
  const smaller = Math.min(inter + onlyA, inter + onlyB);
  return smaller ? inter / smaller : 0;
}

/** Outline moved outwards by `d` (inwards when negative), each corner along the bisector of its two edges. */
function polygonOffset(poly: Point[], d: number): Point[] {
  const n = poly.length;
  let signed = 0;
  for (let i = 0; i < n; i++) signed += poly[i].x * poly[(i + 1) % n].y - poly[(i + 1) % n].x * poly[i].y;
  const o = signed >= 0 ? 1 : -1;
  return poly.map((p, i) => {
    const a = poly[(i + n - 1) % n];
    const b = poly[(i + 1) % n];
    const l1 = Math.hypot(p.x - a.x, p.y - a.y) || 1;
    const l2 = Math.hypot(b.x - p.x, b.y - p.y) || 1;
    const n1 = { x: (o * (p.y - a.y)) / l1, y: (-o * (p.x - a.x)) / l1 };
    const n2 = { x: (o * (b.y - p.y)) / l2, y: (-o * (b.x - p.x)) / l2 };
    const k = Math.max(1 + n1.x * n2.x + n1.y * n2.y, 0.25);
    return { x: p.x + ((n1.x + n2.x) * d) / k, y: p.y + ((n1.y + n2.y) * d) / k };
  });
}

/** The outline moved uniformly until it encloses `targetArea`; null when that does not converge. */
function offsetToArea(poly: Point[], targetArea: number): Point[] | null {
  let d = (targetArea - polygonAreaPx(poly)) / Math.max(1, polygonPerimeterPx(poly, true));
  let out = polygonOffset(poly, d);
  for (let i = 0; i < 3; i++) {
    d += (targetArea - polygonAreaPx(out)) / Math.max(1, polygonPerimeterPx(out, true));
    out = polygonOffset(poly, d);
  }
  return Math.abs(polygonAreaPx(out) - targetArea) <= targetArea * 0.002 ? out : null;
}

/** Interior seed points of a polygon, nearest the centroid first. */
function seedsFor(poly: Point[]): Point[] {
  const seeds: Point[] = [];
  const c = polygonCentroid(poly);
  if (pointInPolygon(c, poly)) seeds.push(c);
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const grid: Point[] = [];
  for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
    const p = { x: x0 + (i / 12) * (x1 - x0), y: y0 + (j / 12) * (y1 - y0) };
    if (pointInPolygon(p, poly) && distanceToPolygonEdge(p, poly) > Math.min(x1 - x0, y1 - y0) * 0.08) grid.push(p);
  }
  grid.sort((p, q) => distancePx(p, c) - distancePx(q, c));
  return [...seeds, ...grid.slice(0, 24)];
}

async function layerPage(comparisonId: string, layer: string, pageNumber: number): Promise<PDFPageProxy> {
  const { source } = await loadPdfPlanSource(`compare-detect:${comparisonId}:${layer}`, () => loadComparePdfBlob(comparisonId, layer), pageNumber);
  return source.pdfPage;
}

async function renderPage(page: PDFPageProxy, width: number, height: number, s: number, m: [number, number, number, number, number, number] | null): Promise<ImageData> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * s);
  canvas.height = Math.round(height * s);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas-unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const b = m ?? [1, 0, 0, 1, 0, 0];
  await page.render({ canvasContext: ctx, canvas, viewport: page.getViewport({ scale: 1 }), transform: [b[0] * s, b[1] * s, b[2] * s, b[3] * s, b[4] * s, b[5] * s] }).promise;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = canvas.height = 0;
  return image;
}

export interface RoomUpdate {
  roomId: string;
  name: string;
  beforeAreaM2: number | null;
  afterAreaM2: number | null;
  points: Point[];
}

export type DeltaColumn = ReportColumn | 'area:construction' | 'area:demolition' | 'count:doors' | 'count:windows';

export interface QuantityDelta {
  column: DeltaColumn;
  label: string;
  unitLabel: string;
  before: number;
  after: number;
}

export interface ApplicationPreview {
  plan: Plan;
  nextPlan: Plan;
  application: RevisionApplication;
  /** Changes that update the plan — the only ones the application records and marks applied. */
  changes: RevisionChange[];
  /** Changes already in the plan's ledger (by id). */
  duplicates: RevisionChange[];
  /** Approved changes that would not update the plan; they stay approved and are listed in `reviews`. */
  unapplied: RevisionChange[];
  addedItems: Measurement[];
  removedItems: Measurement[];
  roomUpdates: RoomUpdate[];
  openingsAdded: number;
  openingsRemoved: number;
  reviews: RevisionApplication['reviews'];
  deltas: QuantityDelta[];
}

function primary(a: CategoryAmount | undefined, unit: 'm2' | 'lm' | 'unit'): number {
  if (!a) return 0;
  return unit === 'lm' ? a.lengthM ?? 0 : unit === 'unit' ? a.count ?? 0 : a.quantityM2;
}

export function quantityDeltas(before: Plan, after: Plan): QuantityDelta[] {
  const rb = buildPlanQuantityReport(before);
  const ra = buildPlanQuantityReport(after);
  const columns = new Set([...Object.keys(rb.byCategory), ...Object.keys(ra.byCategory)] as ReportColumn[]);
  const deltas: QuantityDelta[] = [];
  for (const column of columns) {
    const info = reportColumnInfo(column, [...ra.summaries, ...rb.summaries]);
    const b = round(primary(rb.byCategory[column], info.unit), 2);
    const a = round(primary(ra.byCategory[column], info.unit), 2);
    if (a !== b) deltas.push({ column, label: info.label, unitLabel: info.unitLabel, before: b, after: a });
  }
  // Demolition / construction area measurements and approved-opening counts are tallied apart from
  // the room work items, so the preview reads them from their own sources.
  const kindTotal = (plan: Plan, kind: 'construction' | 'demolition') =>
    round((plan.measurements ?? []).filter((m) => m.tool === 'area' && m.areaKind === kind && typeof m.areaM2 === 'number').reduce((sum, m) => sum + (m.areaM2 ?? 0), 0), 2);
  for (const kind of ['construction', 'demolition'] as const) {
    const b = kindTotal(before, kind);
    const a = kindTotal(after, kind);
    if (a !== b) deltas.push({ column: `area:${kind}`, label: t(`areaKinds.${kind}`), unitLabel: 'm²', before: b, after: a });
  }
  const ob = buildOpeningQuantityReport(before);
  const oa = buildOpeningQuantityReport(after);
  for (const [column, key, b, a] of [['count:doors', 'doors', ob.doors, oa.doors], ['count:windows', 'windows', ob.windows, oa.windows]] as const) {
    if (a !== b) deltas.push({ column, label: t(`openingQuantities.${key}`), unitLabel: '', before: b, after: a });
  }
  return deltas;
}

/** Changes of a revision that are approved but not applied yet, across all pages. */
export function pendingApplication(revision: RevisionLayer): RevisionChange[] {
  return Object.values(revision.analysis?.pages ?? {}).flatMap((p) => p.changes.filter((c) => c.status === 'approved'));
}

export async function prepareApplication(comparison: Comparison, revisionId: string, planId: string): Promise<ApplicationPreview> {
  const revision = comparison.revisions.find((r) => r.id === revisionId);
  if (!revision) throw new Error('revision-missing');
  const plan = await loadPlan(planId);
  if (!plan) throw new Error('plan-missing');
  if ((await checkPlanLink(comparison, planId)) !== 'same-file') throw new Error('plan-different-file');
  const chain = chainState(plan, comparison, revision);
  if (!chain.allowed) throw new Error(chain.reason === 'superseded' ? 'chain-superseded' : 'chain-base-not-applied');

  const context: ComparisonContext = comparison.context ?? 'design';
  const now = Date.now();
  const applicationId = uuid();
  const prior = appliedApplications(plan, comparison.id).flatMap((a) => a.changes);
  const candidates = pendingApplication(revision);
  const duplicates: RevisionChange[] = [];
  const changes: RevisionChange[] = [];
  // Only the same change (by id) is already applied. Matching by location would silently skip a
  // different change in the same place — e.g. a later revision of the chain editing an earlier one.
  for (const c of candidates) (prior.some((p) => p.changeId === c.id) ? duplicates : changes).push(c);
  /** Changes that actually wrote something to the plan. */
  const effective = new Set<string>();
  /** Changes left out entirely, with the reason already recorded. */
  const blocked = new Set<string>();

  const reviews: RevisionApplication['reviews'] = [];
  let next: Plan = { ...plan };
  let addedItems: Measurement[] = [];
  let removedItems: Measurement[] = [];
  const removedBy = new Map<string, string>();
  const openingIds: string[] = [];
  let openingsAdded = 0;
  let openingsRemoved = 0;

  const planPageOf = (c: RevisionChange) => comparison.pages[c.pageNumber]?.originalPageNumber ?? c.pageNumber;
  const mppOf = (page: number) => plan.pages[page]?.calibration?.metersPerPixel ?? 0;
  // Items use the comparison's wall height, the one its preview and Changes table were made with.
  const wallHeightM = comparison.wallHeightDefaultM;

  const itemMeasurement = (item: ReturnType<typeof changeItems>[number], page: number, c: RevisionChange): Measurement => ({
    id: uuid(),
    pageNumber: page,
    tool: 'area',
    points: item.points,
    areaKind: item.areaKind,
    areaM2: item.areaM2,
    calcMode: 'wall',
    wallLengthM: item.wallLengthM,
    wallHeightM: item.wallHeightM,
    centerline: item.centerline,
    revisionSource: { comparisonId: comparison.id, revisionId, changeId: c.id, applicationId },
  });
  const doorQueue: { c: RevisionChange; item: ReturnType<typeof changeItems>[number]; page: number }[] = [];

  // 1. Demolition / construction items (and, in a design revision, withdrawal of items a removed wall no longer needs).
  for (const c of changes) {
    if ((isOpeningDifference(c) && !openingImpactReady(c)) || openingGeometryNeedsVerification(c)) {
      reviews.push({ changeId: c.id, reason: t('compare.openingImpact.required') });
      blocked.add(c.id);
      continue;
    }
    const page = planPageOf(c);
    const mpp = mppOf(page);
    if (!(mpp > 0) && (c.walls.length || c.doors.length)) {
      reviews.push({ changeId: c.id, reason: t('revisionAi.review.planUncalibrated', { page }) });
      continue;
    }
    // The comparison previewed this change with its own scale: a plan measured at another scale
    // would receive different quantities than the user approved.
    const cpage = comparison.pages[c.pageNumber];
    const compareScale = resolveCompareScale(cpage, cpage?.revisions[revisionId]);
    if (mpp > 0 && compareScale.state === 'calibrated' && (c.walls.length || c.doors.length) &&
      Math.abs(compareScale.metersPerPixel - mpp) / mpp > 0.01) {
      reviews.push({ changeId: c.id, reason: t('revisionAi.review.calibrationMismatch', { page, diff: round((Math.abs(compareScale.metersPerPixel - mpp) / mpp) * 100, 1) }) });
      blocked.add(c.id);
      continue;
    }
    for (const item of changeItems(c, context, mpp, wallHeightM)) {
      // Door items are checked against the wall items of the whole application below.
      if (item.source === 'door') { doorQueue.push({ c, item, page }); continue; }
      effective.add(c.id);
      addedItems.push(itemMeasurement(item, page, c));
    }
    if (context === 'design' && wallsAllowed(c)) {
      const reach = 0.15 / mpp;
      for (const w of c.walls.filter((x) => x.side === 'removed')) {
        const match = (next.measurements ?? []).find((m) => m.pageNumber === page && m.areaKind === 'construction' && m.revisionSource &&
          m.centerline && m.centerline.length >= 2 &&
          ((distancePx(m.centerline[0], w.centerline[0]) <= reach && distancePx(m.centerline[m.centerline.length - 1], w.centerline[1]) <= reach) ||
           (distancePx(m.centerline[0], w.centerline[1]) <= reach && distancePx(m.centerline[m.centerline.length - 1], w.centerline[0]) <= reach)));
        if (match && !removedItems.includes(match)) {
          removedItems.push(match);
          removedBy.set(match.id, c.id);
          effective.add(c.id);
        }
      }
      // Relocated wall: when the plan tracked the old position, the new position replaces it, so the
      // plan's wall tally changes by exactly the difference. Untracked walls stay untracked.
      const replaced = removedItems.some((m) => m.revisionSource && c.walls.some((w) => w.side === 'removed' &&
        m.centerline?.some((p) => distancePx(p, w.centerline[0]) <= reach || distancePx(p, w.centerline[1]) <= reach)));
      if (c.relocation && replaced) {
        for (const item of changeItems(c, 'construction', mpp, wallHeightM).filter((x) => x.source === 'wall' && x.areaKind === 'construction')) {
          effective.add(c.id);
          addedItems.push({
            id: uuid(),
            pageNumber: page,
            tool: 'area',
            points: item.points,
            areaKind: item.areaKind,
            areaM2: item.areaM2,
            calcMode: 'wall',
            wallLengthM: item.wallLengthM,
            wallHeightM: item.wallHeightM,
            centerline: item.centerline,
            revisionSource: { comparisonId: comparison.id, revisionId, changeId: c.id, applicationId },
          });
        }
      }
    }
  }
  // 2. Room boundaries: re-traced on the revised drawing for rooms next to an approved wall change.
  const roomUpdates: RoomUpdate[] = [];
  /** Changes next to a room that could not be updated reliably: they are withheld whole, never half applied. */
  const roomBlocked = new Set<string>();
  const roomChangesOf = new Map<string, RevisionChange[]>();
  const updatedRooms = new Map<string, Room>();
  const fail = (roomChanges: RevisionChange[], review: RevisionApplication['reviews'][number]) => {
    reviews.push(review);
    for (const c of roomChanges) roomBlocked.add(c.id);
  };
  const wallChanges = changes.filter((c) => !blocked.has(c.id) && ((c.category === 'wall' && wallsAllowed(c)) || c.ai?.category === 'room-boundary'));
  const pagesWithWalls = [...new Set(wallChanges.map(planPageOf))];
  let rooms = next.rooms;
  for (const page of pagesWithWalls) {
    const pageChanges = wallChanges.filter((c) => planPageOf(c) === page);
    const mpp = mppOf(page);
    const reach = mpp > 0 ? 0.3 / mpp : 10;
    const touches = (c: RevisionChange, r: Room) => {
      // A wall longer than the room touches it along its length, not only at its corners.
      const along = (a: Point, b: Point): Point[] => {
        const steps = Math.min(200, Math.ceil(distancePx(a, b) / Math.max(1, reach / 2)));
        return Array.from({ length: steps + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / Math.max(1, steps), y: a.y + ((b.y - a.y) * i) / Math.max(1, steps) }));
      };
      const pts: Point[] = [
        ...c.walls.filter((w) => !w.placeholder).flatMap((w) => [...w.footprint, ...w.centerline.slice(1).flatMap((q, i) => along(w.centerline[i], q))]),
        ...[...c.addedSegments, ...c.removedSegments].flatMap((s) => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }, { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 }]),
      ];
      return pts.some((p) => pointInPolygon(p, r.points) || distanceToPolygonEdge(p, r.points) <= reach);
    };
    const affected = rooms.filter((r) => r.pageNumber === page && r.closed && r.points.length >= 3 && pageChanges.some((c) => touches(c, r)));
    if (!affected.length) continue;
    const sourceKey = pageChanges[0].pageNumber;
    const cpage = comparison.pages[sourceKey];
    const rp = cpage?.revisions[revisionId];
    const analysis = revision.analysis?.pages[sourceKey];
    const original = await layerPage(comparison.id, 'original', cpage?.originalPageNumber ?? sourceKey);
    const revised = await layerPage(comparison.id, `revision:${revisionId}`, rp?.revisedPageNumber ?? sourceKey);
    const vp = original.getViewport({ scale: 1 });
    const rvp = revised.getViewport({ scale: 1 });
    const s = Math.min(2, 2200 / Math.max(vp.width, vp.height));
    const revMatrix = alignmentMatrix(analysis?.usedAlignment ?? rp?.alignment ?? IDENTITY_TRANSFORM, { x: rvp.width / 2, y: rvp.height / 2 });
    // Trace on the drawing the plan currently reflects: the original, or the chain's base revision.
    const base = baseRevisionOf(comparison, revision);
    const bp = base ? cpage?.revisions[base.id] : undefined;
    const basePage = base ? await layerPage(comparison.id, `revision:${base.id}`, bp?.revisedPageNumber ?? sourceKey) : original;
    const bvp = basePage.getViewport({ scale: 1 });
    const baseMatrix = base ? alignmentMatrix(bp?.alignment ?? IDENTITY_TRANSFORM, { x: bvp.width / 2, y: bvp.height / 2 }) : null;
    const [baseImage, revImage] = await Promise.all([
      renderPage(basePage, vp.width, vp.height, s, baseMatrix),
      renderPage(revised, vp.width, vp.height, s, revMatrix),
    ]);
    const areaM2 = (poly: Point[]) => (mpp > 0 ? round(polygonAreaPx(poly) * mpp * mpp, 2) : null);
    for (const room of affected) {
      // The room's reviews and update belong to the changes next to it, not to the page's first change.
      const roomChanges = pageChanges.filter((c) => touches(c, room));
      const changeId = roomChanges[0].id;
      const seeds = seedsFor(room.points);
      // The room must be traceable on the current drawing the same way it was drawn, otherwise its
      // boundary convention (inner face, centre line…) is unknown and a re-trace would change it.
      const before = traceRoomAtSeeds(baseImage, s, seeds);
      if (!before || polygonIou(before, room.points) < 0.85) {
        fail(roomChanges, { changeId, roomId: room.id, reason: t('revisionAi.review.roomNotTraceable', { room: room.name }) });
        continue;
      }
      // A moved wall can put the old centre on its far side: every seed must trace the same space, and
      // the result is accepted only when it overlaps the room's old position (a grown or shrunk room
      // still does; a neighbouring space does not).
      let after: Point[] | null = null;
      let traced = false;
      for (const seed of seeds.slice(0, 8)) {
        const candidate = traceRoomAtSeeds(revImage, s, [seed]);
        if (!candidate) continue;
        traced = true;
        if (polygonOverlap(candidate, room.points) >= 0.7) { after = candidate; break; }
      }
      if (!after) {
        fail(roomChanges, { changeId, roomId: room.id, reason: t(traced ? 'revisionAi.review.roomUnverified' : 'revisionAi.review.roomOpen', { room: room.name }) });
        continue;
      }
      // Both traces carry the same bias (wall dilation, pixel centres), so the change between them is
      // reliable where either absolute area is not. The room keeps its own boundary convention and
      // receives only that change: an edge that did not move stays where the user drew it.
      const areaOld = polygonAreaPx(room.points);
      const areaBefore = polygonAreaPx(before);
      const areaAfter = polygonAreaPx(after);
      const ratio = areaAfter / Math.max(1, areaBefore);
      if (Math.abs(ratio - 1) < 0.01) continue;
      const others = rooms.filter((o) => o.id !== room.id && o.pageNumber === page);
      if (others.some((o) => pointInPolygon(polygonCentroid(o.points), after))) {
        fail(roomChanges, { changeId, roomId: room.id, reason: t('revisionAi.review.roomMerged', { room: room.name }) });
        continue;
      }
      if (ratio < 0.5 || ratio > 2) {
        fail(roomChanges, { changeId, roomId: room.id, reason: t('revisionAi.review.roomTooDifferent', { room: room.name }) });
        continue;
      }
      // The drawn boundary may differ from the traced one only by a small uniform margin; a larger gap
      // means its convention is unknown and a carried-over change would not be trustworthy.
      const points = offsetToArea(after, areaOld + (areaAfter - areaBefore));
      const margin = Math.abs(areaOld - areaBefore) / Math.max(1, polygonPerimeterPx(before, true));
      if (!points || margin > (mpp > 0 ? 0.1 / mpp : 5)) {
        fail(roomChanges, { changeId, roomId: room.id, reason: t('revisionAi.review.roomNotTraceable', { room: room.name }) });
        continue;
      }
      const updated: Room = { ...room, points };
      const overAllocated = room.workItems.some((item) => (allocateWorkItem(item, updated, next)?.over ?? 0) > 0);
      if (overAllocated) {
        fail(roomChanges, { changeId, roomId: room.id, reason: t('revisionAi.review.allocations', { room: room.name }) });
        continue;
      }
      if (ratio < 0.8) reviews.push({ changeId, roomId: room.id, reason: t('revisionAi.review.roomSplit', { room: room.name }) });
      roomUpdates.push({ roomId: room.id, name: room.name, beforeAreaM2: areaM2(room.points), afterAreaM2: areaM2(points), points });
      for (const c of roomChanges) effective.add(c.id);
      roomChangesOf.set(room.id, roomChanges);
      updatedRooms.set(room.id, updated);
      rooms = rooms.map((r) => (r.id === room.id ? updated : r));
    }
  }
  // A room update traced on the revised drawing reflects every change next to it, so it cannot be
  // split between them: when any of those changes is withheld, the update is dropped and the others
  // are withheld with it, until the set is stable. Changes with no failed room are unaffected.
  for (let dropped = true; dropped;) {
    dropped = false;
    for (const u of [...roomUpdates]) {
      const touching = roomChangesOf.get(u.roomId) ?? [];
      if (!touching.some((c) => roomBlocked.has(c.id))) continue;
      roomUpdates.splice(roomUpdates.indexOf(u), 1);
      updatedRooms.delete(u.roomId);
      for (const c of touching) roomBlocked.add(c.id);
      dropped = true;
    }
  }
  rooms = next.rooms.map((r) => updatedRooms.get(r.id) ?? r);
  for (const id of roomBlocked) {
    blocked.add(id);
    effective.delete(id);
    reviews.push({ changeId: id, reason: t('revisionAi.review.roomChangeWithheld') });
  }
  addedItems = addedItems.filter((m) => !roomBlocked.has(m.revisionSource?.changeId ?? ''));
  removedItems = removedItems.filter((m) => !roomBlocked.has(removedBy.get(m.id) ?? ''));

  // Door items: a door lying in a wall item of the same kind already counted in this update, or one
  // an earlier application already recorded, is not counted a second time.
  const doorItemIds = new Set<string>();
  for (const { c, item, page } of doorQueue.filter((q) => !blocked.has(q.c.id))) {
    const mid = { x: (item.centerline[0].x + item.centerline[1].x) / 2, y: (item.centerline[0].y + item.centerline[1].y) / 2 };
    const reach = 0.15 / mppOf(page);
    const sameDoor = (m: Measurement) => m.pageNumber === page && m.areaKind === item.areaKind && !!m.centerline && m.centerline.length >= 2 &&
      ((distancePx(m.centerline[0], item.centerline[0]) <= reach && distancePx(m.centerline[m.centerline.length - 1], item.centerline[1]) <= reach) ||
       (distancePx(m.centerline[0], item.centerline[1]) <= reach && distancePx(m.centerline[m.centerline.length - 1], item.centerline[0]) <= reach));
    const covered = addedItems.some((m) => m.pageNumber === page && m.areaKind === item.areaKind &&
      (doorItemIds.has(m.id) ? sameDoor(m) : pointInPolygon(mid, m.points))) ||
      (next.measurements ?? []).some((m) => !!m.revisionSource && !removedItems.includes(m) && sameDoor(m));
    if (covered) {
      if (!reviews.some((r) => r.changeId === c.id && r.reason === t('revisionAi.review.doorCovered'))) reviews.push({ changeId: c.id, reason: t('revisionAi.review.doorCovered') });
      continue;
    }
    const m = itemMeasurement(item, page, c);
    doorItemIds.add(m.id);
    effective.add(c.id);
    addedItems.push(m);
  }
  const removedIds = new Set(removedItems.map((m) => m.id));
  next = { ...next, measurements: [...(next.measurements ?? []).filter((m) => !removedIds.has(m.id)), ...addedItems] };

  if (roomUpdates.length) next = withOpeningRoomChanges(next, rooms, now);

  // 3. Openings: new doors become draft openings for review; removed doors are withdrawn from the count.
  for (const c of changes.filter((x) => !blocked.has(x.id) && doorsAllowed(x))) {
    const page = planPageOf(c);
    const mpp = mppOf(page);
    for (const d of c.doors.filter((x) => !x.placeholder)) {
      const mid = { x: (d.hinge.x + d.jamb.x) / 2, y: (d.hinge.y + d.jamb.y) / 2 };
      const reach = Math.max(mpp > 0 ? 0.3 / mpp : 10, d.radiusPx * 0.6);
      const existing = openingsOf(next).find((o) => o.pageNumber === page && o.geometry &&
        distancePx({ x: (o.geometry.endpointA.x + o.geometry.endpointB.x) / 2, y: (o.geometry.endpointA.y + o.geometry.endpointB.y) / 2 }, mid) <= reach);
      if (d.side === 'added') {
        if (existing) continue;
        const len = distancePx(d.hinge, d.jamb) || 1;
        const off = mpp > 0 ? 0.3 / mpp : 10;
        const nx = (-(d.jamb.y - d.hinge.y) / len) * off;
        const ny = ((d.jamb.x - d.hinge.x) / len) * off;
        const sideRooms = next.rooms.filter((r) => r.pageNumber === page &&
          (pointInPolygon({ x: mid.x + nx, y: mid.y + ny }, r.points) || pointInPolygon({ x: mid.x - nx, y: mid.y - ny }, r.points)));
        const id = uuid();
        try {
          next = addPlanOpening(next, {
            pageNumber: page,
            geometry: { endpointA: d.hinge, endpointB: d.jamb },
            entryMethod: 'plan',
            notes: t('revisionAi.openingNote', { revision: revision.label }),
            kind: d.opening ?? 'door',
            mechanism: d.opening === 'window' ? 'unknown' : 'hinged',
            walkableAccess: openingAccessDefault(d.opening ?? 'door'),
            roomIds: sideRooms.slice(0, 2).map((r) => r.id),
            ...(sideRooms[0] ? { apartmentNumber: sideRooms[0].apartmentNumber } : {}),
            widthM: mpp > 0 ? round(pxToMeters(len, mpp), 2) : null,
            ...(mpp > 0 ? { widthSource: 'calibration' as const } : {}),
            heightM: d.heightM ?? OPENING_DEFAULT_SIZES[d.opening ?? 'door'].heightM,
            sillHeightM: d.sillHeightM ?? null,
            quantity: 1,
            suggestedDimensions: d.heightM ? [] : ['heightM'],
            source: 'import',
            legacyRefs: [],
          }, id, now);
          openingIds.push(id);
          openingsAdded++;
          effective.add(c.id);
        } catch {
          reviews.push({ changeId: c.id, reason: t('revisionAi.review.openingFailed') });
        }
      } else if (existing) {
        next = updatePlanOpening(next, existing.id, { notes: [existing.notes, t('revisionAi.openingRemovedNote', { revision: revision.label })].filter(Boolean).join('\n') }, now);
        next = reviewPlanOpening(next, existing.id, 'rejected', now);
        openingIds.push(existing.id);
        openingsRemoved++;
        effective.add(c.id);
      } else {
        const room = next.rooms.find((r) => r.pageNumber === page && (pointInPolygon(mid, r.points) || distanceToPolygonEdge(mid, r.points) <= reach));
        if (room?.openings?.length) reviews.push({ changeId: c.id, roomId: room.id, reason: t('revisionAi.review.legacyOpening', { room: room.name }) });
      }
    }
  }

  // A change that wrote nothing is not applied: it stays approved, and the user is told why.
  const applied = changes.filter((c) => effective.has(c.id));
  const unapplied = changes.filter((c) => !effective.has(c.id));
  for (const c of unapplied) {
    if (!reviews.some((r) => r.changeId === c.id)) reviews.push({ changeId: c.id, reason: t('revisionAi.review.noPlanEffect', { page: planPageOf(c) }) });
  }

  const application: RevisionApplication = {
    id: applicationId,
    comparisonId: comparison.id,
    revisionId,
    baseRevisionId: baseRevisionOf(comparison, revision)?.id ?? null,
    context,
    appliedAt: now,
    status: 'applied',
    versionId: uuid(),
    changes: applied.map((c) => ({ changeId: c.id, pageNumber: c.pageNumber, kind: c.kind, category: c.category, bbox: c.bbox })),
    measurementIds: addedItems.map((m) => m.id),
    openingIds,
    roomIds: roomUpdates.map((r) => r.roomId),
    reviews,
  };
  // The revised drawing shown behind the plan keeps the alignment these quantities were derived with.
  const backdropPages: RevisionBackdrop['pages'] = {};
  if (applied.length) {
    // Every plan page gets the revised sheet with the same page mapping and alignment the quantities used;
    // a sheet without its own record is the same-numbered sheet, unaligned, as everywhere else here.
    const pageNumbers = new Set([...Object.keys(plan.pages), ...Object.entries(comparison.pages).map(([key, cp]) => cp?.originalPageNumber ?? key)].map(Number));
    for (const pageNumber of pageNumbers) {
      const entry = Object.entries(comparison.pages).find(([key, cp]) => (cp?.originalPageNumber ?? Number(key)) === pageNumber);
      const rp = entry?.[1]?.revisions[revisionId];
      backdropPages[pageNumber] = {
        revisedPageNumber: rp?.revisedPageNumber ?? pageNumber,
        alignment: revision.analysis?.pages[entry ? Number(entry[0]) : pageNumber]?.usedAlignment ?? rp?.alignment ?? IDENTITY_TRANSFORM,
      };
    }
  }
  // The drawing is the whole revised sheet; the quantities reflect only the changes applied so far.
  const revisionChanges = Object.values(revision.analysis?.pages ?? {}).flatMap((p) => p.changes);
  const reflected = new Set([...prior.map((p) => p.changeId), ...applied.map((c) => c.id)]);
  const coverage = { applied: revisionChanges.filter((c) => reflected.has(c.id)).length, total: revisionChanges.length };
  next = {
    ...next,
    revisionApplications: [...(next.revisionApplications ?? []), application],
    ...(Object.keys(backdropPages).length ? { revisionBackdrop: { comparisonId: comparison.id, revisionId, applicationId, coverage, pages: backdropPages } } : {}),
    updatedAt: now,
  };
  return {
    plan,
    nextPlan: next,
    application,
    changes: applied,
    duplicates,
    unapplied,
    addedItems,
    removedItems,
    roomUpdates,
    openingsAdded,
    openingsRemoved,
    reviews,
    deltas: quantityDeltas(plan, next),
  };
}

/** Writes the prepared application, refusing if the plan changed since the preview was made. */
export async function commitApplication(preview: ApplicationPreview, revisionLabel: string): Promise<void> {
  if (!canEditWork()) throw new Error('editing-locked');
  const current = await loadPlan(preview.plan.id);
  if (!current || current.updatedAt !== preview.plan.updatedAt) throw new Error('plan-changed');
  const version: PlanVersion = {
    id: preview.application.versionId,
    planId: current.id,
    createdAt: preview.application.appliedAt,
    reason: 'revision-apply',
    label: revisionLabel,
    plan: current,
  };
  await savePlanWithVersion(preview.nextPlan, version);
}

/**
 * Restores the plan from the snapshot taken before an application. Only the latest applied
 * application of a comparison can be reverted, so chains unwind in order. The state being replaced
 * is itself kept as a version, and the ledger records the revert.
 */
export async function revertApplication(planId: string, applicationId: string): Promise<RevisionApplication> {
  if (!canEditWork()) throw new Error('editing-locked');
  const plan = await loadPlan(planId);
  if (!plan) throw new Error('plan-missing');
  const app = plan.revisionApplications?.find((a) => a.id === applicationId && a.status === 'applied');
  if (!app) throw new Error('application-missing');
  // The snapshot is the whole plan: restoring it is safe only when no later application — from any
  // comparison — would be wiped with it while its ledger entry still said "applied".
  if (latestApplication(plan)?.id !== app.id) throw new Error('revert-not-latest');
  const version = await loadPlanVersion(app.versionId);
  if (!version || version.planId !== planId) throw new Error('version-missing');
  const restored = version.plan as Plan;
  const now = Date.now();
  const ledger = (plan.revisionApplications ?? []).map((a) => (a.id === app.id ? { ...a, status: 'reverted' as const, revertedAt: now } : a));
  const next: Plan = { ...restored, revisionApplications: ledger, updatedAt: now };
  await savePlanWithVersion(next, { id: uuid(), planId, createdAt: now, reason: 'revision-revert', label: app.revisionId, plan });
  return app;
}

/** True when the plan was edited after the application, so a revert would discard those edits. */
export function editedSince(plan: Plan, app: RevisionApplication): boolean {
  return plan.updatedAt > app.appliedAt + 1000;
}
