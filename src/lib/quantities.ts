import { canonicalOpeningDeduction, duplicateOpeningIds, type OpeningAudit } from './openingQuantities';
import type {
  Calibration,
  ExtraReportCategory,
  Opening,
  Plan,
  ReportCategory,
  ReportCategoryTotal,
  Room,
  RoomQuantitySummary,
  WorkItem,
} from '../types';
import { EXTRA_REPORT_CATEGORIES } from '../types';
import { t, type TranslateFn } from '../i18n';
import { polygonAreaM2, polygonPerimeterM, round } from './geometry';
import { projectHeightDefault, projectWasteDefault, workTypeDefinition, WORK_TYPE_DEFINITIONS } from './workTypes';

/** Report order of every category. */
export const ALL_REPORT_CATEGORIES: ReportCategory[] = ['tiling_regular', 'tiling_as', 'cladding', 'panels', ...EXTRA_REPORT_CATEGORIES];

/**
 * Whether a page carries a usable scale. Matches exactly what `roomMetrics` treats as usable, so
 * "the UI says uncalibrated" and "the numbers come out 0" can never disagree.
 * Display-only: no stored data or computed quantity changes based on this.
 */
export function isPageCalibrated(project: Plan, pageNumber: number): boolean {
  return (project.pages[pageNumber]?.calibration?.metersPerPixel ?? 0) > 0;
}

/**
 * Guards every numeric input that reaches a quantity. A cleared number field yields NaN, which
 * `??` does not catch — without this, one empty input turns areas, order quantities and the whole
 * report into NaN, and the bad value is persisted.
 */
function finiteOr(value: number | undefined | null, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A dimension that can only take away or add, never go below zero (a negative width is a typo, not a quantity). */
function nonNegative(value: number | undefined | null): number {
  return Math.max(0, finiteOr(value, 0));
}

export function roomMetrics(room: Room, calibration: Calibration | null) {
  const mpp = calibration?.metersPerPixel ?? 0;
  const areaM2 = mpp ? polygonAreaM2(room.points, mpp) : 0;
  const perimeterM = mpp ? polygonPerimeterM(room.points, room.closed, mpp) : 0;
  return { areaM2, perimeterM };
}

/** Area of one opening row: width × height × quantity. Entered in metres, so it needs no page scale. */
export function openingAreaM2(opening: Opening): number {
  return nonNegative(opening.widthM) * nonNegative(opening.heightM) * nonNegative(opening.quantity);
}

/**
 * Height used by an item that multiplies the perimeter: its own override, else the project default
 * for its type, else the catalogue fallback (projects saved before that default existed).
 */
export function effectiveHeightM(item: WorkItem, project: Plan): number {
  const def = workTypeDefinition(item.type);
  if (!def?.height) return 0;
  return finiteOr(item.heightM, projectHeightDefault(def, project));
}

/** Plan default waste % for AS tiling — falls back to the regular tiling default on older projects. */
export function effectiveTilingAsWastePercent(project: Plan): number {
  return finiteOr(project.defaultTilingAsWastePercent, projectWasteDefault(WORK_TYPE_DEFINITIONS.tiling, project));
}

/** Whether this item has openings taken off it: the type must allow it, then the item's own switch, else the type's default. */
export function itemDeductsOpenings(item: WorkItem): boolean {
  const def = workTypeDefinition(item.type);
  if (!def || def.deductedOpeningTypes.length === 0) return false;
  return item.deductOpenings ?? def.deductsOpenings;
}

/** Everything one work item works out to, before waste. All values are ≥ 0. */
export interface WorkItemCalc {
  /** m² before openings. */
  openingAudit?: OpeningAudit[];
  grossM2: number;
  /** m² taken off for openings; always `grossM2 - netM2`. */
  deductedM2: number;
  /** Net m² — what the report counts. */
  netM2: number;
  /** Perimeter-based work only (skirting): net running metres, before openings, and the door widths taken off. */
  lengthM: number | null;
  grossLengthM: number | null;
  deductedLengthM: number | null;
}

/**
 * The single calculation for a work item, driven by its type's definition in lib/workTypes.
 * `areaM2`/`perimeterM` come from `roomMetrics` — 0 on an uncalibrated page, and so is everything here.
 */
export function calculateWorkItem(item: WorkItem, room: Room, areaM2: number, perimeterM: number, project: Plan): WorkItemCalc {
  const def = workTypeDefinition(item.type);
  const none: WorkItemCalc = { grossM2: 0, deductedM2: 0, netM2: 0, lengthM: null, grossLengthM: null, deductedLengthM: null };
  if (!def) return none;

  const heightM = nonNegative(effectiveHeightM(item, project));
  const openings = itemDeductsOpenings(item)
    ? (room.openings ?? []).filter((o) => def.deductedOpeningTypes.includes(o.type))
    : [];

  const duplicateIds = duplicateOpeningIds(project);
  const canonical = (def.deductedOpeningTypes.length ? project.openings ?? [] : []).filter(o => o.pageNumber === room.pageNumber && o.roomIds.includes(room.id));
  const audit = canonical.map(o => canonicalOpeningDeduction(project,room,item,heightM,o,duplicateIds));
  if (canonical.length) none.openingAudit = audit;
  const canonicalArea = audit.reduce((sum,o)=>sum+o.areaM2,0);
  const canonicalLength = audit.reduce((sum,o)=>sum+o.lengthM,0);
  switch (def.basis) {
    case 'floorArea':
      return { ...none, grossM2: areaM2, netM2: areaM2 };
    case 'floorAndUpturn': {
      const total = areaM2 + perimeterM * heightM;
      return { ...none, grossM2: total, netM2: total };
    }
    case 'wallArea': {
      const grossM2 = perimeterM * heightM;
      // An opening taller than the work (a 2.1 m door in 1.5 m cladding) only removes the part
      // that the work actually covers.
      const openingM2 = canonicalArea + openings.reduce(
        (sum, o) => sum + nonNegative(o.widthM) * Math.min(nonNegative(o.heightM), heightM) * nonNegative(o.quantity),
        0
      );
      if (canonicalArea > 0 && openingM2 > grossM2) audit.push({ openingId: '', reason: 'capped', incomplete: true, areaM2: 0, lengthM: 0 });
      const netM2 = Math.max(0, grossM2 - openingM2);
      return { ...none, grossM2, deductedM2: grossM2 - netM2, netM2 };
    }
    case 'perimeter': {
      const doorWidthsM = canonicalLength + openings.reduce((sum, o) => sum + nonNegative(o.widthM) * nonNegative(o.quantity), 0);
      if (canonicalLength > 0 && doorWidthsM > perimeterM) audit.push({ openingId: '', reason: 'capped', incomplete: true, areaM2: 0, lengthM: 0 });
      const lengthM = Math.max(0, perimeterM - doorWidthsM);
      const grossM2 = perimeterM * heightM;
      const netM2 = lengthM * heightM;
      return {
        ...none,
        grossM2,
        deductedM2: grossM2 - netM2,
        netM2,
        lengthM,
        grossLengthM: perimeterM,
        deductedLengthM: perimeterM - lengthM,
      };
    }
    default:
      return none;
  }
}

/**
 * Plan-level default waste % for an item — the single source of truth for every caller
 * (room detail, report table, Excel and PDF exports all go through here or through the summaries
 * built with it), so regular and AS tiling never diverge by accident.
 */
export function defaultWasteFor(item: WorkItem, project: Plan): number {
  const def = workTypeDefinition(item.type);
  if (!def) return 0;
  if (item.type === 'tiling' && item.tilingCategory === 'as') return effectiveTilingAsWastePercent(project);
  return projectWasteDefault(def, project);
}

/**
 * Waste % actually applied to an item: its own override when that is a usable number, otherwise the
 * project default. The single place this decision is made — room detail, report table and exports
 * all go through here or through the summaries built with it.
 */
export function effectiveWastePercent(item: WorkItem, project: Plan): number {
  return finiteOr(item.wastePercent, defaultWasteFor(item, project));
}

/** Report category an item is tallied under (tiling is split by category); null for an unknown type. */
function reportCategoryOf(item: WorkItem): ReportCategory | null {
  if (!workTypeDefinition(item.type)) return null;
  if (item.type === 'tiling') return item.tilingCategory === 'as' ? 'tiling_as' : 'tiling_regular';
  return item.type;
}

interface Bucket {
  areaM2: number;
  /** Wall-based items only: m² before openings and m² taken off. */
  grossM2: number;
  deductedM2: number;
  wastePercent: number | null;
  orderM2: number;
}

function emptyBucket(): Bucket {
  return { areaM2: 0, grossM2: 0, deductedM2: 0, wastePercent: null, orderM2: 0 };
}

/** Build one summary row per room, matching the contractor-facing quantities report layout. */
export function buildRoomSummaries(project: Plan): RoomQuantitySummary[] {
  return project.rooms.map((room) => {
    const calibration = project.pages[room.pageNumber]?.calibration ?? null;
    const pageCalibrated = isPageCalibrated(project, room.pageNumber);
    const { areaM2, perimeterM } = roomMetrics(room, calibration);

    const buckets: Record<ReportCategory, Bucket> = {
      tiling_regular: emptyBucket(),
      tiling_as: emptyBucket(),
      cladding: emptyBucket(),
      panels: emptyBucket(),
      painting: emptyBucket(),
      plaster: emptyBucket(),
      waterproofing: emptyBucket(),
    };

    // Panels are tallied in running metres as well as m² — same geometry, second reading, and the
    // same per-item waste applied to both. Summed per work item exactly like the areas below.
    let panelsLengthM = 0;
    let panelsOrderLengthM = 0;
    let panelsDeductedLengthM = 0;
    for (const item of room.workItems) {
      const category = reportCategoryOf(item);
      if (!category) continue;
      const calc = calculateWorkItem(item, room, areaM2, perimeterM, project);
      const waste = effectiveWastePercent(item, project);
      if (calc.lengthM != null) {
        panelsLengthM += calc.lengthM;
        panelsOrderLengthM += calc.lengthM * (1 + waste / 100);
        panelsDeductedLengthM += calc.deductedLengthM ?? 0;
      }
      const bucket = buckets[category];
      bucket.areaM2 += calc.netM2;
      if (workTypeDefinition(item.type)?.basis === 'wallArea') {
        bucket.grossM2 += calc.grossM2;
        bucket.deductedM2 += calc.deductedM2;
      }
      bucket.orderM2 += calc.netM2 * (1 + waste / 100);
      if (bucket.wastePercent == null) bucket.wastePercent = waste;
    }

    // Without a scale every number here would be 0 — not a real quantity. They are reported as
    // null so that no consumer can print, sum or formulate them as if they were zero; the
    // `pageCalibrated` flag tells the exports to say why the cells are empty.
    const toArea = (b: Bucket) => (b.wastePercent == null || !pageCalibrated ? null : round(b.areaM2, 2));
    const toWaste = (b: Bucket) => (b.wastePercent == null ? null : b.wastePercent);
    const toOrder = (b: Bucket) => (b.wastePercent == null || !pageCalibrated ? null : round(b.orderM2, 2));

    const extra = Object.fromEntries(
      EXTRA_REPORT_CATEGORIES.map((c) => [
        c,
        { areaM2: toArea(buckets[c]), wastePercent: toWaste(buckets[c]), orderM2: toOrder(buckets[c]) },
      ])
    ) as RoomQuantitySummary['extra'];

    return {
      roomId: room.id,
      apartmentNumber: room.apartmentNumber,
      roomName: room.name,
      pageCalibrated,
      panelsLengthM: buckets.panels.wastePercent == null || !pageCalibrated ? null : round(panelsLengthM, 2),
      panelsOrderLengthM: buckets.panels.wastePercent == null || !pageCalibrated ? null : round(panelsOrderLengthM, 2),
      panelsDeductedLengthM: buckets.panels.wastePercent == null || !pageCalibrated ? null : round(panelsDeductedLengthM, 2),
      tilingRegularAreaM2: toArea(buckets.tiling_regular),
      tilingAsAreaM2: toArea(buckets.tiling_as),
      claddingAreaM2: toArea(buckets.cladding),
      panelsAreaM2: toArea(buckets.panels),
      tilingRegularWastePercent: toWaste(buckets.tiling_regular),
      tilingAsWastePercent: toWaste(buckets.tiling_as),
      claddingWastePercent: toWaste(buckets.cladding),
      panelsWastePercent: toWaste(buckets.panels),
      tilingRegularOrderM2: toOrder(buckets.tiling_regular),
      tilingAsOrderM2: toOrder(buckets.tiling_as),
      claddingOrderM2: toOrder(buckets.cladding),
      panelsOrderM2: toOrder(buckets.panels),
      extra,
      openingDeductions: pageCalibrated
        ? (Object.keys(buckets) as ReportCategory[])
            .filter((c) => buckets[c].deductedM2 > 0)
            .map((c) => ({
              category: c,
              grossM2: round(buckets[c].grossM2, 2),
              deductedM2: round(buckets[c].deductedM2, 2),
              netM2: round(buckets[c].grossM2 - buckets[c].deductedM2, 2),
            }))
        : [],
      notes: room.notes,
    };
  });
}

/** One opening row of a room, with what the report needs to explain it. */
export interface OpeningDetail {
  opening: Opening;
  /** width × height × quantity, in m² (needs no page scale). */
  areaM2: number;
  /**
   * Report categories of this room's work items that deduct this opening, in report order. Empty
   * when nothing in the room deducts it (e.g. a window in a room with only tiling). Skirting takes
   * off the door's width; wall-based work its area, up to the work's own height.
   */
  deductedFrom: ReportCategory[];
}

/** The room's openings with the work they reduce — the same rule `calculateWorkItem` applies. */
export function roomOpeningDetails(room: Room): OpeningDetail[] {
  return (room.openings ?? []).map((opening) => {
    const categories = new Set<ReportCategory>();
    for (const item of room.workItems) {
      const def = workTypeDefinition(item.type);
      const category = reportCategoryOf(item);
      if (!def || !category || !itemDeductsOpenings(item)) continue;
      if (def.deductedOpeningTypes.includes(opening.type)) categories.add(category);
    }
    return {
      opening,
      areaM2: round(openingAreaM2(opening), 2),
      deductedFrom: ALL_REPORT_CATEGORIES.filter((c) => categories.has(c)),
    };
  });
}

/**
 * A room's openings in a few words, counted by type: "2 דלתות · חלון". Counts the `quantity` of
 * each row, so one row of 2 identical windows reads the same as two rows of one.
 */
export function openingCountsText(openings: Opening[], tr: TranslateFn = t): string {
  const counts = new Map<Opening['type'], number>();
  for (const o of openings) {
    const n = nonNegative(o.quantity);
    if (n > 0) counts.set(o.type, (counts.get(o.type) ?? 0) + n);
  }
  return (['door', 'window', 'custom'] as const)
    .filter((type) => counts.has(type))
    .map((type) => {
      const n = counts.get(type)!;
      return n === 1 ? tr(`openingTypes.${type}`) : `${n} ${tr(`openingTypesPlural.${type}`)}`;
    })
    .join(' · ');
}

/**
 * The report categories at least one room uses (has an item of, scale or not), in report order.
 * Screen and PDF tables show a column group only for these.
 */
export function usedReportCategories(summaries: RoomQuantitySummary[]): ReportCategory[] {
  return ALL_REPORT_CATEGORIES.filter((c) => summaries.some((s) => categoryWastePercent(s, c) != null));
}

function categoryWastePercent(s: RoomQuantitySummary, c: ReportCategory): number | null {
  switch (c) {
    case 'tiling_regular':
      return s.tilingRegularWastePercent;
    case 'tiling_as':
      return s.tilingAsWastePercent;
    case 'cladding':
      return s.claddingWastePercent;
    case 'panels':
      return s.panelsWastePercent;
    default:
      return s.extra[c].wastePercent;
  }
}

/**
 * The later work types that at least one room uses. Reports add columns only for these, so a
 * project that never uses them exports exactly as it did before they existed.
 */
export function usedExtraCategories(summaries: RoomQuantitySummary[]): ExtraReportCategory[] {
  return EXTRA_REPORT_CATEGORIES.filter((c) => summaries.some((s) => s.extra[c].wastePercent != null));
}

/** Groups room summaries by apartment number, preserving first-seen order (matches the Excel export's blocks). */
export function groupSummariesByApartment(summaries: RoomQuantitySummary[]): { apartment: string; rooms: RoomQuantitySummary[] }[] {
  const groups = new Map<string, RoomQuantitySummary[]>();
  const order: string[] = [];
  for (const s of summaries) {
    const key = s.apartmentNumber || '';
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(s);
  }
  return order.map((key) => ({ apartment: key, rooms: groups.get(key)! }));
}

/** Totals across all rooms: the original 4 report categories always, the later ones only when used. */
export function buildReportCategoryTotals(project: Plan, summaries: RoomQuantitySummary[]): ReportCategoryTotal[] {
  const totals: Record<ReportCategory, { quantityM2: number; orderM2: number }> = {
    tiling_regular: { quantityM2: 0, orderM2: 0 },
    tiling_as: { quantityM2: 0, orderM2: 0 },
    cladding: { quantityM2: 0, orderM2: 0 },
    panels: { quantityM2: 0, orderM2: 0 },
    painting: { quantityM2: 0, orderM2: 0 },
    plaster: { quantityM2: 0, orderM2: 0 },
    waterproofing: { quantityM2: 0, orderM2: 0 },
  };

  let panelsLengthM = 0;
  let panelsOrderLengthM = 0;
  for (const s of summaries) {
    panelsLengthM += s.panelsLengthM ?? 0;
    panelsOrderLengthM += s.panelsOrderLengthM ?? 0;
    if (s.tilingRegularAreaM2 != null) {
      totals.tiling_regular.quantityM2 += s.tilingRegularAreaM2;
      totals.tiling_regular.orderM2 += s.tilingRegularOrderM2 ?? 0;
    }
    if (s.tilingAsAreaM2 != null) {
      totals.tiling_as.quantityM2 += s.tilingAsAreaM2;
      totals.tiling_as.orderM2 += s.tilingAsOrderM2 ?? 0;
    }
    if (s.claddingAreaM2 != null) {
      totals.cladding.quantityM2 += s.claddingAreaM2;
      totals.cladding.orderM2 += s.claddingOrderM2 ?? 0;
    }
    if (s.panelsAreaM2 != null) {
      totals.panels.quantityM2 += s.panelsAreaM2;
      totals.panels.orderM2 += s.panelsOrderM2 ?? 0;
    }
    for (const c of EXTRA_REPORT_CATEGORIES) {
      const q = s.extra[c];
      if (q.areaM2 != null) {
        totals[c].quantityM2 += q.areaM2;
        totals[c].orderM2 += q.orderM2 ?? 0;
      }
    }
  }

  const defaultWaste: Record<ReportCategory, number> = {
    tiling_regular: projectWasteDefault(WORK_TYPE_DEFINITIONS.tiling, project),
    tiling_as: effectiveTilingAsWastePercent(project),
    cladding: projectWasteDefault(WORK_TYPE_DEFINITIONS.cladding, project),
    panels: projectWasteDefault(WORK_TYPE_DEFINITIONS.panels, project),
    painting: projectWasteDefault(WORK_TYPE_DEFINITIONS.painting, project),
    plaster: projectWasteDefault(WORK_TYPE_DEFINITIONS.plaster, project),
    waterproofing: projectWasteDefault(WORK_TYPE_DEFINITIONS.waterproofing, project),
  };

  const categories: ReportCategory[] = ['tiling_regular', 'tiling_as', 'cladding', 'panels', ...usedExtraCategories(summaries)];
  return categories.map((category) => ({
    category,
    quantityM2: round(totals[category].quantityM2, 2),
    wastePercent: defaultWaste[category],
    orderM2: round(totals[category].orderM2, 2),
    // Only panels carry a linear reading; the other categories have none.
    lengthM: category === 'panels' ? round(panelsLengthM, 2) : null,
    orderLengthM: category === 'panels' ? round(panelsOrderLengthM, 2) : null,
  }));
}
