/**
 * Quantity summaries of the structural takeoff domains — concrete for now. Independent of the
 * finishes summaries (`RoomQuantitySummary`, `ReportCategory`): nothing here reads or changes them.
 * Every number comes from the calculation engine (`calculateConcrete`); this module only groups and
 * adds. Pure — no store, no persistence.
 *
 * Concrete is grouped by page, concrete kind and grade — a plan is not assumed to be a floor. The grade is
 * the user's own text (trimmed, otherwise untouched, compared exactly); empty means "unspecified".
 *
 * An element that is not calculable (no scale, missing size or thickness/height) is NEVER counted
 * as zero: it is counted in `elementCount` and `missingCount`, and contributes nothing to the
 * volumes, so a total can always be read as "of the elements that could be calculated".
 */

import type { Plan } from '../types';
import type { ConcreteKind } from '../types/structural';
import { calculateConcrete } from './concrete';
import { calculateRebar } from './rebar';
import { round } from './geometry';
import { CONCRETE_KINDS } from './structuralMutations';
import { concreteOf, rebarOf } from './structuralPlan';

export interface ConcreteSummaryRow {
  pageNumber: number;
  kind: ConcreteKind;
  /** The grade as typed (trimmed); '' = unspecified. */
  grade: string;
  elementCount: number;
  /** Elements that could not be calculated; they are in `elementCount` but in no volume. */
  missingCount: number;
  /** Net volume of the calculable elements, m³. */
  volumeM3: number;
  /** The same with waste applied, m³ — what to order. */
  orderM3: number;
}

export interface ConcreteSummary {
  /** Sorted by page, then kind (slab, wall, beam, column), then grade (unspecified last). */
  rows: ConcreteSummaryRow[];
  elementCount: number;
  missingCount: number;
  volumeM3: number;
  orderM3: number;
}

const KIND_ORDER = new Map(CONCRETE_KINDS.map((k, i) => [k, i]));

export function buildConcreteSummary(plan: Plan): ConcreteSummary {
  const groups = new Map<string, { row: ConcreteSummaryRow; volume: number; order: number }>();
  let volume = 0;
  let order = 0;
  let missing = 0;

  const elements = concreteOf(plan);
  for (const el of elements) {
    const grade = el.grade?.trim() ?? '';
    const key = JSON.stringify([el.pageNumber, el.kind, grade]);
    let group = groups.get(key);
    if (!group) {
      group = { row: { pageNumber: el.pageNumber, kind: el.kind, grade, elementCount: 0, missingCount: 0, volumeM3: 0, orderM3: 0 }, volume: 0, order: 0 };
      groups.set(key, group);
    }
    group.row.elementCount += 1;

    const calc = calculateConcrete(el, plan.pages[el.pageNumber]?.calibration ?? null);
    if (calc.volumeM3 === null || calc.orderM3 === null) {
      group.row.missingCount += 1;
      missing += 1;
      continue;
    }
    group.volume += calc.volumeM3;
    group.order += calc.orderM3;
    volume += calc.volumeM3;
    order += calc.orderM3;
  }

  // Round once, from the unrounded sums, so rounding never accumulates.
  const rows = [...groups.values()].map(({ row, volume: v, order: o }) => ({ ...row, volumeM3: round(v, 2), orderM3: round(o, 2) }));
  rows.sort(
    (a, b) =>
      a.pageNumber - b.pageNumber ||
      (KIND_ORDER.get(a.kind) ?? 0) - (KIND_ORDER.get(b.kind) ?? 0) ||
      Number(a.grade === '') - Number(b.grade === '') ||
      // Plain code-unit order: the same on every machine and locale.
      (a.grade < b.grade ? -1 : a.grade > b.grade ? 1 : 0)
  );
  return { rows, elementCount: elements.length, missingCount: missing, volumeM3: round(volume, 2), orderM3: round(order, 2) };
}

// ---------- rebar ----------

/**
 * Whether the quantities behind a number are real bar counts or area estimates:
 * 'exact' — every contributing layer is an exact count; 'estimated' — every one is an estimate;
 * 'mixed' — both kinds are inside the number. Never hidden: a total that contains an estimate says so.
 */
export type RebarBasis = 'exact' | 'mixed' | 'estimated';

/** One diameter on one page, adding every layer of every mesh zone and every manual-bars row of that diameter. */
export interface RebarSummaryRow {
  pageNumber: number;
  diameterMm: number;
  /** How many layers / bar rows add into this row. */
  lineCount: number;
  /** Net length (m) and weight (kg). */
  lengthM: number;
  weightKg: number;
  /** The same with each item's waste applied — what to order. */
  orderLengthM: number;
  orderWeightKg: number;
  /** Of the net values, the part that comes from estimated layers (0 when the row is exact). */
  estimatedLengthM: number;
  estimatedWeightKg: number;
  basis: RebarBasis;
}

export interface RebarPageSummary {
  pageNumber: number;
  /** Diameter ascending. */
  rows: RebarSummaryRow[];
  /** Items on this page that are not calculable — in no row and in no total. */
  missingItemCount: number;
  /** Of those, layers that lack a diameter or spacing. */
  incompleteLayerCount: number;
}

export interface RebarSummary {
  /** Sorted by page number; only pages that have a row or a missing item. */
  pages: RebarPageSummary[];
  itemCount: number;
  missingItemCount: number;
  incompleteLayerCount: number;
  /** Totals over every calculable layer, all diameters together. */
  lengthM: number;
  weightKg: number;
  orderLengthM: number;
  orderWeightKg: number;
  estimatedLengthM: number;
  estimatedWeightKg: number;
  /** null when nothing is calculable. */
  basis: RebarBasis | null;
}

interface Acc {
  lines: number;
  estimatedLines: number;
  length: number;
  weight: number;
  orderLength: number;
  orderWeight: number;
  estimatedLength: number;
  estimatedWeight: number;
}
const emptyAcc = (): Acc => ({ lines: 0, estimatedLines: 0, length: 0, weight: 0, orderLength: 0, orderWeight: 0, estimatedLength: 0, estimatedWeight: 0 });
const basisOf = (a: Acc): RebarBasis | null => (a.lines === 0 ? null : a.estimatedLines === 0 ? 'exact' : a.estimatedLines === a.lines ? 'estimated' : 'mixed');

/**
 * The plan's rebar by page and diameter. Mesh layers and manual bars are treated alike: every
 * contributing line is read from `calculateRebar` (nothing is calculated here), so only the engine's
 * output decides what a diameter's quantity is. An item that is not calculable adds to no row and no
 * total — it is counted as missing, never as zero — and a calculable item's layers all count (the
 * engine reports no partial totals for an item with an unusable layer).
 *
 * Sums are of unrounded values; each result is rounded once at the end (lengths and weights to 2
 * decimals), so rounding never accumulates.
 */
export function buildRebarSummary(plan: Plan): RebarSummary {
  const perPage = new Map<number, { rows: Map<number, Acc>; missingItems: number; incompleteLayers: number }>();
  const total = emptyAcc();
  let missingItems = 0;
  let incompleteLayers = 0;

  const items = rebarOf(plan);
  for (const item of items) {
    let page = perPage.get(item.pageNumber);
    if (!page) {
      page = { rows: new Map(), missingItems: 0, incompleteLayers: 0 };
      perPage.set(item.pageNumber, page);
    }

    const calc = calculateRebar(item, plan.pages[item.pageNumber]?.calibration ?? null);
    if (calc.status !== 'ok') {
      page.missingItems += 1;
      missingItems += 1;
      if (item.kind === 'mesh') {
        const bad = calc.layers.filter((l) => !l.valid).length;
        page.incompleteLayers += bad;
        incompleteLayers += bad;
      }
      continue;
    }

    const factor = 1 + calc.wastePercent / 100;
    for (const layer of calc.layers) {
      const diameter = layer.diameterMm!;
      let acc = page.rows.get(diameter);
      if (!acc) {
        acc = emptyAcc();
        page.rows.set(diameter, acc);
      }
      for (const a of [acc, total]) {
        a.lines += 1;
        a.length += layer.totalLengthM!;
        a.weight += layer.weightKg!;
        a.orderLength += layer.totalLengthM! * factor;
        a.orderWeight += layer.weightKg! * factor;
        if (layer.estimated) {
          a.estimatedLines += 1;
          a.estimatedLength += layer.totalLengthM!;
          a.estimatedWeight += layer.weightKg!;
        }
      }
    }
  }

  const pages: RebarPageSummary[] = [...perPage.entries()]
    .sort(([a], [b]) => a - b)
    .map(([pageNumber, p]) => ({
      pageNumber,
      rows: [...p.rows.entries()]
        .sort(([a], [b]) => a - b)
        .map(([diameterMm, a]) => ({
          pageNumber,
          diameterMm,
          lineCount: a.lines,
          lengthM: round(a.length, 2),
          weightKg: round(a.weight, 2),
          orderLengthM: round(a.orderLength, 2),
          orderWeightKg: round(a.orderWeight, 2),
          estimatedLengthM: round(a.estimatedLength, 2),
          estimatedWeightKg: round(a.estimatedWeight, 2),
          basis: basisOf(a)!,
        })),
      missingItemCount: p.missingItems,
      incompleteLayerCount: p.incompleteLayers,
    }));

  return {
    pages,
    itemCount: items.length,
    missingItemCount: missingItems,
    incompleteLayerCount: incompleteLayers,
    lengthM: round(total.length, 2),
    weightKg: round(total.weight, 2),
    orderLengthM: round(total.orderLength, 2),
    orderWeightKg: round(total.orderWeight, 2),
    estimatedLengthM: round(total.estimatedLength, 2),
    estimatedWeightKg: round(total.estimatedWeight, 2),
    basis: basisOf(total),
  };
}
