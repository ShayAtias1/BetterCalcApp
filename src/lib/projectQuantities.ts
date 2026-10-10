import { buildOpeningQuantityReport } from './openingQuantityReport';
/**
 * Project-level quantities: every plan is calculated by the same single-plan engine
 * (`buildRoomSummaries` / `buildReportCategoryTotals` in lib/quantities, driven by the work-type
 * catalogue), and this module only adds plans together. Each plan keeps its own calibration, waste
 * and height defaults, so a project total is exactly the sum of what each plan reports on its own.
 */

import type { Plan, ReportCategory, RoomQuantitySummary } from '../types';
import { t, type TranslateFn } from '../i18n';
import { ALL_REPORT_CATEGORIES, buildRoomSummaries, isPageCalibrated } from './quantities';
import { round } from './geometry';

/** One category's numbers for one room, read uniformly from a room summary. null = not calculable / not present. */
export interface RoomCategoryQuantity {
  quantityM2: number | null;
  orderM2: number | null;
  wastePercent: number | null;
  /** Running metres — panels (skirting) only. */
  lengthM: number | null;
  orderLengthM: number | null;
}

export function roomCategoryQuantity(s: RoomQuantitySummary, category: ReportCategory): RoomCategoryQuantity {
  const noLength = { lengthM: null, orderLengthM: null };
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

export interface CategoryAmount {
  quantityM2: number;
  orderM2: number;
  /** Panels only; null for every other category. */
  lengthM: number | null;
  orderLengthM: number | null;
}

export type PlanQuantityStatus = 'empty' | 'no-work' | 'uncalibrated' | 'partial' | 'ready';

/** A plan's status as shown (dictionary `planStatus.<status>`). */
export function planStatusLabel(status: PlanQuantityStatus, tr: TranslateFn = t): string {
  return tr(`planStatus.${status}`);
}

export interface PlanQuantityReport {
  plan: Plan;
  summaries: RoomQuantitySummary[];
  /** This plan's total per category it uses. */
  byCategory: Partial<Record<ReportCategory, CategoryAmount>>;
  roomCount: number;
  /** Pages of this plan that carry a scale. */
  calibratedPageCount: number;
  /** Rooms on a page without a scale — their quantities are missing from every total. */
  uncalibratedRoomCount: number;
  status: PlanQuantityStatus;
}

export interface ProjectCategoryTotal extends CategoryAmount {
  category: ReportCategory;
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

function emptyAmount(category: ReportCategory): CategoryAmount {
  const linear = category === 'panels' ? 0 : null;
  return { quantityM2: 0, orderM2: 0, lengthM: linear, orderLengthM: linear };
}

function addInto(target: CategoryAmount, q: { quantityM2: number | null; orderM2: number | null; lengthM: number | null; orderLengthM: number | null }) {
  target.quantityM2 += q.quantityM2 ?? 0;
  target.orderM2 += q.orderM2 ?? 0;
  if (target.lengthM != null) target.lengthM += q.lengthM ?? 0;
  if (target.orderLengthM != null) target.orderLengthM += q.orderLengthM ?? 0;
}

function rounded(a: CategoryAmount): CategoryAmount {
  return {
    quantityM2: round(a.quantityM2, 2),
    orderM2: round(a.orderM2, 2),
    lengthM: a.lengthM == null ? null : round(a.lengthM, 2),
    orderLengthM: a.orderLengthM == null ? null : round(a.orderLengthM, 2),
  };
}

export function buildPlanQuantityReport(plan: Plan): PlanQuantityReport {
  const summaries = buildRoomSummaries(plan);
  const byCategory: Partial<Record<ReportCategory, CategoryAmount>> = {};
  for (const s of summaries) {
    for (const c of ALL_REPORT_CATEGORIES) {
      const q = roomCategoryQuantity(s, c);
      // A category counts as used once any room has an item of it (waste is set even without a scale).
      if (q.wastePercent == null) continue;
      addInto((byCategory[c] ??= emptyAmount(c)), q);
    }
  }
  for (const c of Object.keys(byCategory) as ReportCategory[]) byCategory[c] = rounded(byCategory[c]!);

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
  for (const category of ALL_REPORT_CATEGORIES) {
    const perPlan = reports
      .filter((r) => r.byCategory[category])
      .map((r) => ({ planId: r.plan.id, planName: r.plan.name, ...r.byCategory[category]! }));
    if (perPlan.length === 0) continue;
    const sum = emptyAmount(category);
    perPlan.forEach((p) => addInto(sum, p));
    totals.push({
      category,
      label: tr(`reportCategories.${category}`),
      unit: categoryPrimaryUnit(category, tr),
      ...rounded(sum),
      perPlan,
    });
  }
  return { plans: reports, totals, ...(plans.some(plan=>buildOpeningQuantityReport(plan).incomplete)?{openingTotalsIncomplete:true}:{}), uncalibratedRoomCount: reports.reduce((n, r) => n + r.uncalibratedRoomCount, 0) };
}
