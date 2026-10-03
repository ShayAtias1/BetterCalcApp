/**
 * Quantity summaries of the structural takeoff domains — concrete for now. Independent of the
 * finishes summaries (`RoomQuantitySummary`, `ReportCategory`): nothing here reads or changes them.
 * Every number comes from the calculation engine (`calculateConcrete`); this module only groups and
 * adds. Pure — no store, no persistence.
 *
 * Grouping is by page, concrete kind and grade — a plan is not assumed to be a floor. The grade is
 * the user's own text (trimmed, otherwise untouched, compared exactly); empty means "unspecified".
 *
 * An element that is not calculable (no scale, missing size or thickness/height) is NEVER counted
 * as zero: it is counted in `elementCount` and `missingCount`, and contributes nothing to the
 * volumes, so a total can always be read as "of the elements that could be calculated".
 */

import type { Plan } from '../types';
import type { ConcreteKind } from '../types/structural';
import { calculateConcrete } from './concrete';
import { round } from './geometry';
import { CONCRETE_KINDS } from './structuralMutations';
import { concreteOf } from './structuralPlan';

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
