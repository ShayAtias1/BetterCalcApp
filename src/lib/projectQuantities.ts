import { buildOpeningQuantityReport } from './openingQuantityReport';
/**
 * Project-level quantities: every plan is calculated by the same single-plan engine
 * (`buildRoomSummaries` / `buildReportCategoryTotals` in lib/quantities, driven by the work-type
 * catalogue), and this module only adds plans together. Each plan keeps its own calibration, waste
 * and height defaults, so a project total is exactly the sum of what each plan reports on its own.
 */

import type { CustomReportKey, Plan, ReportCategory, ReportColumn, RoomQuantitySummary } from '../types';
import { t, type TranslateFn } from '../i18n';
import { ALL_REPORT_CATEGORIES, buildRoomSummaries, isPageCalibrated, usedCustomColumns } from './quantities';
import { customColumnLabel, customUnitLabel } from './workCatalog';
import { round } from './geometry';

/** One category's numbers for one room, read uniformly from a room summary. null = not calculable / not present. */
export interface RoomCategoryQuantity {
  quantityM2: number | null;
  orderM2: number | null;
  wastePercent: number | null;
  /** Running metres — panels (skirting) and running-metre custom columns only. */
  lengthM: number | null;
  orderLengthM: number | null;
  /** Counted custom columns only. */
  count?: number | null;
  orderCount?: number | null;
  /** A typed quantity: available without a page scale. */
  manual?: boolean;
}

export function isCustomColumn(column: ReportColumn): column is CustomReportKey {
  return column.startsWith('custom:');
}

export function roomCategoryQuantity(s: RoomQuantitySummary, category: ReportColumn): RoomCategoryQuantity {
  const noLength = { lengthM: null, orderLengthM: null };
  if (isCustomColumn(category)) {
    const c = s.custom?.[category];
    if (!c) return { quantityM2: null, orderM2: null, wastePercent: null, ...noLength };
    const area = c.unit === 'm2';
    return {
      quantityM2: area ? c.quantity : c.areaM2,
      orderM2: area ? c.order : c.orderAreaM2,
      wastePercent: c.wastePercent,
      lengthM: c.unit === 'lm' ? c.quantity : null,
      orderLengthM: c.unit === 'lm' ? c.order : null,
      ...(c.unit === 'unit' ? { count: c.quantity, orderCount: c.order } : {}),
      ...(c.manual ? { manual: true } : {}),
    };
  }
  switch (category) {
    case 'tiling_regular':
      return { quantityM2: s.tilingRegularAreaM2, orderM2: s.tilingRegularOrderM2, wastePercent: s.tilingRegularWastePercent, ...noLength };
    case 'tiling_as':
      return { quantityM2: s.tilingAsAreaM2, orderM2: s.tilingAsOrderM2, wastePercent: s.tilingAsWastePercent, ...noLength };
    case 'cladding':
      return { quantityM2: s.claddingAreaM2, orderM2: s.claddingOrderM2, wastePercent: s.claddingWastePercent, ...noLength };
    case 'panels':
      return {
        quantityM2: s.panelsAreaM2,
        orderM2: s.panelsOrderM2,
        wastePercent: s.panelsWastePercent,
        lengthM: s.panelsLengthM,
        orderLengthM: s.panelsOrderLengthM,
      };
    default: {
      const q = s.extra[category];
      return { quantityM2: q.areaM2, orderM2: q.orderM2, wastePercent: q.wastePercent, ...noLength };
    }
  }
}

/**
 * How a category is read in a project summary: skirting by the running metre (its m² is shown
 * alongside), everything else by m².
 */
export function categoryPrimaryUnit(category: ReportCategory, tr: TranslateFn = t): string {
  return tr(category === 'panels' ? 'units.lm' : 'units.m2');
}

/** How a report column is named and read, built-in or custom. */
export interface ReportColumnInfo {
  column: ReportColumn;
  label: string;
  /** The unit the column is read by: m², running metres (skirting, strips, lengths) or counted units. */
  unit: 'm2' | 'lm' | 'unit';
  unitLabel: string;
  /** Whether it has an m² reading (every built-in one does; custom lengths and counts do not). */
  hasArea: boolean;
}

export function reportColumnInfo(column: ReportColumn, summaries: RoomQuantitySummary[], tr: TranslateFn = t): ReportColumnInfo {
  if (!isCustomColumn(column)) {
    return { column, label: tr(`reportCategories.${column}`), unit: column === 'panels' ? 'lm' : 'm2', unitLabel: categoryPrimaryUnit(column, tr), hasArea: true };
  }
  const c = summaries.find((s) => s.custom?.[column])?.custom?.[column];
  if (!c) return { column, label: tr('workCatalog.unnamedCategory'), unit: 'm2', unitLabel: tr('units.m2'), hasArea: true };
  return { column, label: customColumnLabel(c, tr), unit: c.unit, unitLabel: customUnitLabel(c, tr), hasArea: c.unit === 'm2' || c.method === 'perimeter' };
}

/** How a project total's column is named and read. */
export function totalColumnInfo(total: Pick<ProjectCategoryTotal, 'category' | 'info'>, tr: TranslateFn = t): ReportColumnInfo {
  return total.info ?? reportColumnInfo(total.category, [], tr);
}

/** The pair a column is read by — net and to order — in its own unit. */
export function primaryReading(
  q: { quantityM2: number | null; orderM2: number | null; lengthM: number | null; orderLengthM: number | null; count?: number | null; orderCount?: number | null },
  info: Pick<ReportColumnInfo, 'unit'>
): { net: number | null; order: number | null } {
  if (info.unit === 'unit') return { net: q.count ?? null, order: q.orderCount ?? null };
  if (info.unit === 'lm') return { net: q.lengthM, order: q.orderLengthM };
  return { net: q.quantityM2, order: q.orderM2 };
}

/** A room's cell has no number because its page has no scale (typed quantities always have one). */
export function readingUnavailable(s: RoomQuantitySummary, q: RoomCategoryQuantity): boolean {
  return !s.pageCalibrated && !q.manual;
}

export interface CategoryAmount {
  quantityM2: number;
  orderM2: number;
  /** Panels and running-metre custom columns only; null for every other category. */
  lengthM: number | null;
  orderLengthM: number | null;
  /** Counted custom columns only. */
  count?: number | null;
  orderCount?: number | null;
}

export type PlanQuantityStatus = 'empty' | 'no-work' | 'uncalibrated' | 'partial' | 'ready';

/** A plan's status as shown (dictionary `planStatus.<status>`). */
export function planStatusLabel(status: PlanQuantityStatus, tr: TranslateFn = t): string {
  return tr(`planStatus.${status}`);
}

/**
 * A plan's status text for the overview and the project exports. "Partial" has two causes: rooms on
 * uncalibrated sheets, or opening data still incomplete. A plan whose rooms are all calibrated says
 * which one applies instead of reading as uncalibrated. The status itself is unchanged.
 */
export function planStatusText(report: { status: PlanQuantityStatus; uncalibratedRoomCount: number }, tr: TranslateFn = t): string {
  if (report.status === 'partial' && report.uncalibratedRoomCount === 0) return tr('projectOverview.openingsIncompleteStatus');
  return planStatusLabel(report.status, tr);
}

export interface PlanQuantityReport {
  plan: Plan;
  summaries: RoomQuantitySummary[];
  /** This plan's total per category it uses. */
  byCategory: Partial<Record<ReportColumn, CategoryAmount>>;
  roomCount: number;
  /** Pages of this plan that carry a scale. */
  calibratedPageCount: number;
  /** Rooms on a page without a scale — their quantities are missing from every total. */
  uncalibratedRoomCount: number;
  status: PlanQuantityStatus;
}

export interface ProjectCategoryTotal extends CategoryAmount {
  category: ReportColumn;
  /** Custom columns only (built-in ones are described by `totalColumnInfo` without it). */
  info?: ReportColumnInfo;
  label: string;
  unit: string;
  /** Contribution of each plan that uses this category, in plan order. */
  perPlan: ({ planId: string; planName: string } & CategoryAmount)[];
}

export interface ProjectQuantities {
  plans: PlanQuantityReport[];
  openingTotalsIncomplete?: boolean;
  /** Only categories some room in the project actually uses. */
  totals: ProjectCategoryTotal[];
  uncalibratedRoomCount: number;
}

function emptyAmount(info: Pick<ReportColumnInfo, 'unit'>): CategoryAmount {
  const linear = info.unit === 'lm' ? 0 : null;
  return { quantityM2: 0, orderM2: 0, lengthM: linear, orderLengthM: linear, ...(info.unit === 'unit' ? { count: 0, orderCount: 0 } : {}) };
}

function addInto(target: CategoryAmount, q: { quantityM2: number | null; orderM2: number | null; lengthM: number | null; orderLengthM: number | null; count?: number | null; orderCount?: number | null }) {
  target.quantityM2 += q.quantityM2 ?? 0;
  target.orderM2 += q.orderM2 ?? 0;
  if (target.count != null) target.count += q.count ?? 0;
  if (target.orderCount != null) target.orderCount += q.orderCount ?? 0;
  if (target.lengthM != null) target.lengthM += q.lengthM ?? 0;
  if (target.orderLengthM != null) target.orderLengthM += q.orderLengthM ?? 0;
}

function rounded(a: CategoryAmount): CategoryAmount {
  return {
    quantityM2: round(a.quantityM2, 2),
    orderM2: round(a.orderM2, 2),
    lengthM: a.lengthM == null ? null : round(a.lengthM, 2),
    orderLengthM: a.orderLengthM == null ? null : round(a.orderLengthM, 2),
    ...(a.count != null ? { count: round(a.count, 2), orderCount: round(a.orderCount ?? 0, 2) } : {}),
  };
}

export function buildPlanQuantityReport(plan: Plan): PlanQuantityReport {
  const summaries = buildRoomSummaries(plan);
  const byCategory: Partial<Record<ReportColumn, CategoryAmount>> = {};
  const columns: ReportColumn[] = [...ALL_REPORT_CATEGORIES, ...usedCustomColumns(summaries)];
  const infos = new Map(columns.map((c) => [c, reportColumnInfo(c, summaries)]));
  for (const s of summaries) {
    for (const c of columns) {
      const q = roomCategoryQuantity(s, c);
      // A category counts as used once any room has an item of it (waste is set even without a scale).
      if (q.wastePercent == null) continue;
      addInto((byCategory[c] ??= emptyAmount(infos.get(c)!)), q);
    }
  }
  for (const c of Object.keys(byCategory) as ReportColumn[]) byCategory[c] = rounded(byCategory[c]!);

  const uncalibratedRoomCount = summaries.filter((s) => !s.pageCalibrated).length;
  const hasWork = plan.rooms.some((r) => r.workItems.length > 0);
  const status: PlanQuantityStatus =
    plan.rooms.length === 0
      ? 'empty'
      : uncalibratedRoomCount === plan.rooms.length
        ? 'uncalibrated'
        : !hasWork
          ? 'no-work'
          : uncalibratedRoomCount > 0 || buildOpeningQuantityReport(plan).incomplete
            ? 'partial'
            : 'ready';

  return {
    plan,
    summaries,
    byCategory,
    roomCount: plan.rooms.length,
    calibratedPageCount: Object.keys(plan.pages).filter((p) => isPageCalibrated(plan, Number(p))).length,
    uncalibratedRoomCount,
    status,
  };
}

/** Aggregates every plan of a project, per category, keeping each plan's contribution. */
export function buildProjectQuantities(plans: Plan[], tr: TranslateFn = t): ProjectQuantities {
  const reports = plans.map(buildPlanQuantityReport);
  const totals: ProjectCategoryTotal[] = [];
  // Built-in categories in report order, then user-defined ones as first met across the plans.
  const allSummaries = reports.flatMap((r) => r.summaries);
  for (const category of [...ALL_REPORT_CATEGORIES, ...usedCustomColumns(allSummaries)] as ReportColumn[]) {
    const perPlan = reports
      .filter((r) => r.byCategory[category])
      .map((r) => ({ planId: r.plan.id, planName: r.plan.name, ...r.byCategory[category]! }));
    if (perPlan.length === 0) continue;
    const info = reportColumnInfo(category, allSummaries, tr);
    const sum = emptyAmount(info);
    perPlan.forEach((p) => addInto(sum, p));
    totals.push({
      category,
      ...(isCustomColumn(category) ? { info } : {}),
      label: info.label,
      unit: info.unitLabel,
      ...rounded(sum),
      perPlan,
    });
  }
  return { plans: reports, totals, ...(plans.some(plan=>buildOpeningQuantityReport(plan).incomplete)?{openingTotalsIncomplete:true}:{}), uncalibratedRoomCount: reports.reduce((n, r) => n + r.uncalibratedRoomCount, 0) };
}
