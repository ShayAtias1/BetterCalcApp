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
import type { ConcreteKind, RebarLevel } from '../types/structural';
import { calculateConcrete, type ConcreteStatus } from './concrete';
import { calculateRebar, incompleteSpecCount, type RebarLayerCalc, type RebarStatus } from './rebar';
import { resolveMeshProcurement, type MeshProcurementResult, type ResolvedSheetSettings } from './meshSheets';
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

export function buildConcreteSummary(plan: Plan, pages?: ReadonlySet<number>): ConcreteSummary {
  const groups = new Map<string, { row: ConcreteSummaryRow; volume: number; order: number }>();
  let volume = 0;
  let order = 0;
  let missing = 0;

  const elements = concreteOf(plan).filter((e) => !pages || pages.has(e.pageNumber));
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
  /** Internal engineering order length retains waste. Mesh order weight is full-sheet procurement. */
  orderLengthM: number;
  orderWeightKg: number | null;
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
  incompleteSpecCount: number;
}

export interface RebarSummary {
  /** Sorted by page number; only pages that have a row or a missing item. */
  pages: RebarPageSummary[];
  itemCount: number;
  missingItemCount: number;
  incompleteSpecCount: number;
  /** Totals over every calculable layer, all diameters together. */
  lengthM: number;
  weightKg: number;
  orderLengthM: number;
  orderWeightKg: number | null;
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
  orderMissing: boolean;
  estimatedLength: number;
  estimatedWeight: number;
}
const emptyAcc = (): Acc => ({ lines: 0, estimatedLines: 0, length: 0, weight: 0, orderLength: 0, orderWeight: 0, orderMissing: false, estimatedLength: 0, estimatedWeight: 0 });
const basisOf = (a: Acc): RebarBasis | null => (a.lines === 0 ? null : a.estimatedLines === 0 ? 'exact' : a.estimatedLines === a.lines ? 'estimated' : 'mixed');

/**
 * The plan's rebar by page and diameter. Mesh layers and manual bars are treated alike: every
 * net contributing line is read from `calculateRebar`; Mesh purchase weights come from the physical
 * procurement resolver and Bars order weights retain engineering waste. An item that is not calculable adds to no row and no
 * total — it is counted as missing, never as zero — and a calculable item's layers all count (the
 * engine reports no partial totals for an item with an unusable layer).
 *
 * Sums are of unrounded values; each result is rounded once at the end (lengths and weights to 2
 * decimals), so rounding never accumulates.
 */
export function buildRebarSummary(plan: Plan, onlyPages?: ReadonlySet<number>): RebarSummary {
  const perPage = new Map<number, { rows: Map<number, Acc>; missingItems: number; incompleteSpecs: number }>();
  const total = emptyAcc();
  let missingItems = 0;
  let incompleteSpecs = 0;

  const items = rebarOf(plan).filter((i) => !onlyPages || onlyPages.has(i.pageNumber));
  for (const item of items) {
    let page = perPage.get(item.pageNumber);
    if (!page) {
      page = { rows: new Map(), missingItems: 0, incompleteSpecs: 0 };
      perPage.set(item.pageNumber, page);
    }

    const calc = calculateRebar(item, plan.pages[item.pageNumber]?.calibration ?? null);
    const procurement = item.kind === 'mesh' ? resolveMeshProcurement(item, plan.pages[item.pageNumber]?.calibration ?? null) : null;
    if (procurement?.procurementWeightKg === null) total.orderMissing = true;
    if (calc.status !== 'ok') {
      page.missingItems += 1;
      missingItems += 1;
      if (item.kind === 'mesh') {
        const bad = incompleteSpecCount(calc);
        page.incompleteSpecs += bad;
        incompleteSpecs += bad;
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
        const purchase = procurement ? procurement.levels.find((l) => l.level === layer.level)?.layerProcurementWeightsKg[layer.layerId] ?? null : layer.weightKg! * factor;
        a.orderMissing ||= purchase === null;
        a.orderWeight += purchase ?? 0;
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
          orderWeightKg: a.orderMissing ? null : round(a.orderWeight, 2),
          estimatedLengthM: round(a.estimatedLength, 2),
          estimatedWeightKg: round(a.estimatedWeight, 2),
          basis: basisOf(a)!,
        })),
      missingItemCount: p.missingItems,
      incompleteSpecCount: p.incompleteSpecs,
    }));

  return {
    pages,
    itemCount: items.length,
    missingItemCount: missingItems,
    incompleteSpecCount: incompleteSpecs,
    lengthM: round(total.length, 2),
    weightKg: round(total.weight, 2),
    orderLengthM: round(total.orderLength, 2),
    orderWeightKg: total.orderMissing ? null : round(total.orderWeight, 2),
    estimatedLengthM: round(total.estimatedLength, 2),
    estimatedWeightKg: round(total.estimatedWeight, 2),
    basis: basisOf(total),
  };
}

// ---------- item rows and the structural report (what exports print) ----------

/** One concrete element as an export row. Numbers are null where they cannot be known — never 0. */
export interface ConcreteItemRow {
  id: string;
  pageNumber: number;
  /** The user's own mark, '' when automatic — print it with `markLabel` in the report language. */
  mark: string;
  autoNumber?: number;
  kind: ConcreteKind;
  /** As typed (trimmed); '' = unspecified. */
  grade: string;
  footprintM2: number | null;
  /** Thickness (slab) or height; null when not entered. */
  depthM: number | null;
  quantity: number;
  wastePercent: number;
  netM3: number | null;
  orderM3: number | null;
  status: ConcreteStatus;
}

/** Items on `pages` (all when omitted), by page and then in the order they were made. */
export function buildConcreteItems(plan: Plan, pages?: ReadonlySet<number>): ConcreteItemRow[] {
  return concreteOf(plan)
    .map((el, index) => ({ el, index }))
    .filter(({ el }) => !pages || pages.has(el.pageNumber))
    .sort((a, b) => a.el.pageNumber - b.el.pageNumber || a.index - b.index)
    .map(({ el }) => {
      const calc = calculateConcrete(el, plan.pages[el.pageNumber]?.calibration ?? null);
      return {
        id: el.id,
        pageNumber: el.pageNumber,
        mark: el.mark,
        autoNumber: el.autoNumber,
        kind: el.kind,
        grade: el.grade?.trim() ?? '',
        footprintM2: calc.footprintM2,
        depthM: typeof el.depthM === 'number' && Number.isFinite(el.depthM) && el.depthM > 0 ? el.depthM : null,
        quantity: calc.quantity,
        wastePercent: calc.wastePercent,
        netM3: calc.volumeM3,
        orderM3: calc.orderM3,
        status: calc.status,
      };
    });
}

/**
 * One rebar line as an export row: one directional bar group of a mesh level, one uniform level
 * (a single row that says it applies to both directions), or a manual-bars row. A level with two
 * directions gives two rows, a mesh with Top and Bottom gives rows for both (same mark, `level`
 * telling them apart); a mesh with no level at all gives one empty row so it is still listed.
 * Quantities are null when the item is not calculable; `barCount` / `barLengthM` are also null for
 * an estimated line (it has no bars to count) and `barLengthM` for a uniform line (its two
 * directions have different bar lengths — `barCount` is then the bars of both directions together).
 */
export interface RebarItemRow {
  itemId: string;
  pageNumber: number;
  /** The user's own mark, '' when automatic — print it with `markLabel` in the report language. */
  mark: string;
  autoNumber?: number;
  kind: 'mesh' | 'bars';
  /** The reinforcement level of a mesh line; null for manual bars and for a mesh with none. */
  level: RebarLevel | null;
  diameterMm: number | null;
  /** Spacing in centimetres (the unit people specify it in). */
  spacingCm: number | null;
  /** Mesh lines only: 'both' for a uniform specification. */
  direction: 'long' | 'short' | 'both' | null;
  barCount: number | null;
  barLengthM: number | null;
  netLengthM: number | null;
  netWeightKg: number | null;
  wastePercent: number;
  orderLengthM: number | null;
  orderWeightKg: number | null;
  /** The numbers are an area-based estimate, not a bar count. */
  estimated: boolean;
  status: RebarStatus;
}

const positiveOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const spacingCmOf = (spacingM: number | null) => (spacingM === null ? null : Math.round(spacingM * 1000) / 10);

export function buildRebarItems(plan: Plan, pages?: ReadonlySet<number>): RebarItemRow[] {
  const rows: RebarItemRow[] = [];
  const ordered = rebarOf(plan)
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !pages || pages.has(item.pageNumber))
    .sort((a, b) => a.item.pageNumber - b.item.pageNumber || a.index - b.index);

  for (const { item } of ordered) {
    const calc = calculateRebar(item, plan.pages[item.pageNumber]?.calibration ?? null);
    const procurement = item.kind === 'mesh' ? resolveMeshProcurement(item, plan.pages[item.pageNumber]?.calibration ?? null) : null;
    const ok = calc.status === 'ok';
    const factor = 1 + calc.wastePercent / 100;
    const base = { itemId: item.id, pageNumber: item.pageNumber, mark: item.mark, autoNumber: item.autoNumber, kind: item.kind, wastePercent: calc.wastePercent, status: calc.status };
    const none = { level: null, diameterMm: null, spacingCm: null, direction: null, barCount: null, barLengthM: null, netLengthM: null, netWeightKg: null, orderLengthM: null, orderWeightKg: null, estimated: false };

    if (item.kind === 'bars') {
      const l = calc.layers[0];
      rows.push({
        ...base,
        level: null,
        diameterMm: positiveOrNull(item.diameterMm),
        spacingCm: null,
        direction: null,
        barCount: ok ? l.barCount : null,
        barLengthM: ok ? l.cutLengthM : null,
        netLengthM: ok ? l.totalLengthM : null,
        netWeightKg: ok ? l.weightKg : null,
        orderLengthM: ok ? l.totalLengthM! * factor : null,
        orderWeightKg: ok ? l.weightKg! * factor : null,
        estimated: false,
      });
      continue;
    }

    if (calc.layers.length === 0) {
      rows.push({ ...base, ...none });
      continue;
    }
    // One row per directional group — except a uniform level, whose two directions are one row.
    const groups: RebarLayerCalc[][] = [];
    for (const layer of calc.layers) {
      const last = groups.at(-1);
      if (layer.uniform && last && last[0].uniform && last[0].level === layer.level) last.push(layer);
      else groups.push([layer]);
    }
    for (const group of groups) {
      const first = group[0];
      const uniform = !!first.uniform;
      const sum = (pick: (l: RebarLayerCalc) => number | null) => (ok && group.every((l) => pick(l) !== null) ? group.reduce((a, l) => a + pick(l)!, 0) : null);
      const net = sum((l) => l.totalLengthM);
      const weight = sum((l) => l.weightKg);
      const purchases = group.map((l) => procurement?.levels.find((entry) => entry.level === l.level)?.layerProcurementWeightsKg[l.layerId] ?? null);
      const purchase = purchases.every((w) => w !== null) ? purchases.reduce<number>((total, w) => total + w!, 0) : null;
      rows.push({
        ...base,
        level: first.level ?? null,
        diameterMm: positiveOrNull(first.diameterMm),
        spacingCm: spacingCmOf(positiveOrNull(first.spacingM)),
        direction: uniform ? 'both' : first.direction === 'short' ? 'short' : 'long',
        barCount: sum((l) => l.barCount),
        barLengthM: uniform ? null : ok ? first.cutLengthM : null,
        netLengthM: net,
        netWeightKg: weight,
        orderLengthM: net === null ? null : net * factor,
        orderWeightKg: purchase,
        estimated: ok && group.some((l) => l.estimated),
      });
    }
  }
  return rows;
}

/**
 * One row per mesh LEVEL (or manual-bars item): the directional rows of `buildRebarItems` folded
 * together, so a level's two directions are one row with its own net and order weight. The sums are
 * of the item rows' own values (null when any part is null); no weight is calculated here.
 */
export interface RebarLevelRow {
  key: string;
  itemId: string;
  pageNumber: number;
  mark: string;
  autoNumber?: number;
  kind: 'mesh' | 'bars';
  level: RebarLevel | null;
  /** The item rows the level is made of: one per direction (one for uniform and for manual bars). */
  parts: RebarItemRow[];
  netWeightKg: number | null;
  orderWeightKg: number | null;
  estimated: boolean;
  status: RebarStatus;
  /**
   * Mesh levels: the physical sheets this level needs (lib/meshSheets) and the sheet size / overlap
   * they were counted with; `count` is null when there is no layout (free polygon, no size, bad
   * settings). Null for manual bars and for a mesh without a level.
   */
  sheets: { count: number | null; settings: ResolvedSheetSettings } | null;
}

export function buildRebarLevelRows(plan: Plan, pages?: ReadonlySet<number>): RebarLevelRow[] {
  const out: RebarLevelRow[] = [];
  const meshes = new Map(rebarOf(plan).flatMap((i) => (i.kind === 'mesh' ? [[i.id, i] as const] : [])));
  const sheetsOf = new Map<string, MeshProcurementResult>();
  const sheetsFor = (itemId: string, level: RebarLevel | null): RebarLevelRow['sheets'] => {
    const mesh = meshes.get(itemId);
    if (!mesh || level === null) return null;
    let result = sheetsOf.get(itemId);
    if (!result) {
      result = resolveMeshProcurement(mesh, plan.pages[mesh.pageNumber]?.calibration ?? null);
      sheetsOf.set(itemId, result);
    }
    return { count: result.levels.find((l) => l.level === level)?.sheets ?? null, settings: result.settings };
  };
  for (const r of buildRebarItems(plan, pages)) {
    const last = out.at(-1);
    if (last && r.kind === 'mesh' && last.itemId === r.itemId && last.level === r.level) {
      last.parts.push(r);
      last.netWeightKg = last.netWeightKg === null || r.netWeightKg === null ? null : last.netWeightKg + r.netWeightKg;
      last.orderWeightKg = last.orderWeightKg === null || r.orderWeightKg === null ? null : last.orderWeightKg + r.orderWeightKg;
      last.estimated ||= r.estimated;
      continue;
    }
    out.push({ key: `${r.itemId}|${r.level ?? ''}`, itemId: r.itemId, pageNumber: r.pageNumber, mark: r.mark, autoNumber: r.autoNumber, kind: r.kind, level: r.level, parts: [r], netWeightKg: r.netWeightKg, orderWeightKg: r.orderWeightKg, estimated: r.estimated, status: r.status, sheets: sheetsFor(r.itemId, r.level) });
  }
  return out;
}

/**
 * Everything a plan's structural report prints. A section is null when the plan (on those pages) has
 * no item of that kind, so a report of a plan without concrete or rebar has no structural part at all.
 */
export interface StructuralReport {
  concrete: { items: ConcreteItemRow[]; summary: ConcreteSummary } | null;
  /** `items` are the directional rows (Excel); `levels` one row per mesh level / manual-bars item (PDF). */
  rebar: { items: RebarItemRow[]; levels: RebarLevelRow[]; summary: RebarSummary } | null;
}

export function buildStructuralReport(plan: Plan, pages?: ReadonlySet<number>): StructuralReport {
  const concreteItems = buildConcreteItems(plan, pages);
  const rebarItems = buildRebarItems(plan, pages);
  return {
    concrete: concreteItems.length > 0 ? { items: concreteItems, summary: buildConcreteSummary(plan, pages) } : null,
    rebar: rebarItems.length > 0 ? { items: rebarItems, levels: buildRebarLevelRows(plan, pages), summary: buildRebarSummary(plan, pages) } : null,
  };
}

// ---------- project level ----------

/** A plan's contribution to a project structural total. */
export interface ProjectPlanShare {
  planId: string;
  planName: string;
  /** Items (concrete elements, or rebar items) of the plan in this total. */
  itemCount: number;
  missingCount: number;
  volumeM3: number;
  orderM3: number;
}

export interface ProjectConcreteRow {
  kind: ConcreteKind;
  /** As typed (trimmed); '' = unspecified. */
  grade: string;
  elementCount: number;
  missingCount: number;
  volumeM3: number;
  orderM3: number;
  /** Which plans add into the row, in plan order. */
  perPlan: ProjectPlanShare[];
}

export interface ProjectConcrete {
  /** By kind (slab, wall, beam, column), then grade, unspecified last. */
  rows: ProjectConcreteRow[];
  /** One entry per plan that has concrete — its own totals, so a missing item stays attributable. */
  perPlan: ProjectPlanShare[];
  elementCount: number;
  missingCount: number;
  volumeM3: number;
  orderM3: number;
}

export interface ProjectRebarShare {
  planId: string;
  planName: string;
  itemCount: number;
  missingItemCount: number;
  lengthM: number;
  weightKg: number;
  orderLengthM: number;
  orderWeightKg: number | null;
  estimatedLengthM: number;
  estimatedWeightKg: number;
  basis: RebarBasis | null;
}

export interface ProjectRebarRow {
  diameterMm: number;
  lineCount: number;
  lengthM: number;
  weightKg: number;
  orderLengthM: number;
  orderWeightKg: number | null;
  estimatedLengthM: number;
  estimatedWeightKg: number;
  /** exact / mixed / estimated across every plan and page that adds into this diameter. */
  basis: RebarBasis;
  perPlan: ProjectRebarShare[];
}

export interface ProjectRebar {
  /** Diameter ascending. */
  rows: ProjectRebarRow[];
  perPlan: ProjectRebarShare[];
  itemCount: number;
  missingItemCount: number;
  lengthM: number;
  weightKg: number;
  orderLengthM: number;
  orderWeightKg: number | null;
  estimatedLengthM: number;
  estimatedWeightKg: number;
  basis: RebarBasis | null;
  /**
   * Physical mesh sheets across the plans, per sheet configuration (size and overlap): sheets of
   * different configurations are never added into one number. First-seen order.
   */
  sheetGroups: ProjectSheetGroup[];
}

export interface ProjectSheetGroup {
  lengthM: number;
  widthM: number;
  overlapM: number;
  /** Mesh levels counted in this group, and the sheets they need. */
  levels: number;
  sheets: number;
}

export interface ProjectStructural {
  concrete: ProjectConcrete | null;
  rebar: ProjectRebar | null;
}

interface Sums {
  items: number;
  missing: number;
  net: number;
  order: number;
}
const emptySums = (): Sums => ({ items: 0, missing: 0, net: 0, order: 0 });

interface RebarSums {
  lines: number;
  estimatedLines: number;
  missingItems: number;
  items: number;
  length: number;
  weight: number;
  orderLength: number;
  orderWeight: number;
  orderMissing: boolean;
  estimatedLength: number;
  estimatedWeight: number;
}
const emptyRebar = (): RebarSums => ({ lines: 0, estimatedLines: 0, missingItems: 0, items: 0, length: 0, weight: 0, orderLength: 0, orderWeight: 0, orderMissing: false, estimatedLength: 0, estimatedWeight: 0 });
const rebarBasis = (a: RebarSums): RebarBasis | null => (a.lines === 0 ? null : a.estimatedLines === 0 ? 'exact' : a.estimatedLines === a.lines ? 'estimated' : 'mixed');

/**
 * The project's concrete and rebar across all its plans, read from the same per-plan item rows the
 * plan reports use (so every number comes from the calculation engines). Sums are of UNROUNDED values
 * — never of the plans' rounded figures — and each result is rounded once at the end (2 decimals).
 * Plans are not floors and pages are not floors: nothing is grouped by either, and each plan's own
 * share is kept so a total can be traced and a missing item attributed. A section is null when no
 * plan has an item of that kind.
 */
export function buildProjectStructural(plans: Plan[]): ProjectStructural {
  // ----- concrete -----
  const cGroups = new Map<string, { kind: ConcreteKind; grade: string; total: Sums; perPlan: Map<string, { name: string; sums: Sums }> }>();
  const cPlans = new Map<string, { name: string; sums: Sums }>();
  const cTotal = emptySums();

  // ----- rebar -----
  const rGroups = new Map<number, { total: RebarSums; perPlan: Map<string, { name: string; sums: RebarSums }> }>();
  const rPlans = new Map<string, { name: string; sums: RebarSums; missingIds: Set<string>; itemIds: Set<string> }>();
  const rTotal = emptyRebar();
  const rMissing = new Set<string>();
  const rItems = new Set<string>();
  const sheetGroups = new Map<string, ProjectSheetGroup>();

  for (const plan of plans) {
    for (const it of buildConcreteItems(plan)) {
      const key = JSON.stringify([it.kind, it.grade]);
      let g = cGroups.get(key);
      if (!g) {
        g = { kind: it.kind, grade: it.grade, total: emptySums(), perPlan: new Map() };
        cGroups.set(key, g);
      }
      let gp = g.perPlan.get(plan.id);
      if (!gp) {
        gp = { name: plan.name, sums: emptySums() };
        g.perPlan.set(plan.id, gp);
      }
      let pp = cPlans.get(plan.id);
      if (!pp) {
        pp = { name: plan.name, sums: emptySums() };
        cPlans.set(plan.id, pp);
      }
      for (const s of [g.total, gp.sums, pp.sums, cTotal]) {
        s.items += 1;
        if (it.netM3 === null || it.orderM3 === null) s.missing += 1;
        else {
          s.net += it.netM3;
          s.order += it.orderM3;
        }
      }
    }

    for (const level of buildRebarLevelRows(plan)) {
      if (!level.sheets || level.sheets.count === null) continue;
      const { lengthM, widthM, overlapM } = level.sheets.settings;
      const key = JSON.stringify([lengthM, widthM, overlapM]);
      const group = sheetGroups.get(key) ?? { lengthM, widthM, overlapM, levels: 0, sheets: 0 };
      group.levels += 1;
      group.sheets += level.sheets.count;
      sheetGroups.set(key, group);
    }

    for (const row of buildRebarItems(plan)) {
      const itemKey = `${plan.id}|${row.itemId}`;
      let pp = rPlans.get(plan.id);
      if (!pp) {
        pp = { name: plan.name, sums: emptyRebar(), missingIds: new Set(), itemIds: new Set() };
        rPlans.set(plan.id, pp);
      }
      pp.itemIds.add(itemKey);
      rItems.add(itemKey);
      if (row.kind === 'mesh' && row.orderWeightKg === null) { pp.sums.orderMissing = true; rTotal.orderMissing = true; }
      if (row.netLengthM === null || row.netWeightKg === null || row.diameterMm === null) {
        pp.missingIds.add(itemKey);
        rMissing.add(itemKey);
        continue;
      }
      let g = rGroups.get(row.diameterMm);
      if (!g) {
        g = { total: emptyRebar(), perPlan: new Map() };
        rGroups.set(row.diameterMm, g);
      }
      let gp = g.perPlan.get(plan.id);
      if (!gp) {
        gp = { name: plan.name, sums: emptyRebar() };
        g.perPlan.set(plan.id, gp);
      }
      for (const a of [g.total, gp.sums, pp.sums, rTotal]) {
        a.lines += 1;
        a.length += row.netLengthM;
        a.weight += row.netWeightKg;
        a.orderLength += row.orderLengthM ?? 0;
        a.orderMissing ||= row.orderWeightKg === null;
        a.orderWeight += row.orderWeightKg ?? 0;
        if (row.estimated) {
          a.estimatedLines += 1;
          a.estimatedLength += row.netLengthM;
          a.estimatedWeight += row.netWeightKg;
        }
      }
    }
  }

  const planShare = (planId: string, p: { name: string; sums: Sums }): ProjectPlanShare => ({
    planId,
    planName: p.name,
    itemCount: p.sums.items,
    missingCount: p.sums.missing,
    volumeM3: round(p.sums.net, 2),
    orderM3: round(p.sums.order, 2),
  });

  const concrete: ProjectConcrete | null =
    cTotal.items === 0
      ? null
      : {
          rows: [...cGroups.values()]
            .sort(
              (a, b) =>
                (KIND_ORDER.get(a.kind) ?? 0) - (KIND_ORDER.get(b.kind) ?? 0) ||
                Number(a.grade === '') - Number(b.grade === '') ||
                (a.grade < b.grade ? -1 : a.grade > b.grade ? 1 : 0)
            )
            .map((g) => ({
              kind: g.kind,
              grade: g.grade,
              elementCount: g.total.items,
              missingCount: g.total.missing,
              volumeM3: round(g.total.net, 2),
              orderM3: round(g.total.order, 2),
              perPlan: [...g.perPlan.entries()].map(([id, p]) => planShare(id, p)),
            })),
          perPlan: [...cPlans.entries()].map(([id, p]) => planShare(id, p)),
          elementCount: cTotal.items,
          missingCount: cTotal.missing,
          volumeM3: round(cTotal.net, 2),
          orderM3: round(cTotal.order, 2),
        };

  const rebarShare = (planId: string, name: string, a: RebarSums, missingItems: number): ProjectRebarShare => ({
    planId,
    planName: name,
    itemCount: a.items,
    missingItemCount: missingItems,
    lengthM: round(a.length, 2),
    weightKg: round(a.weight, 2),
    orderLengthM: round(a.orderLength, 2),
    orderWeightKg: a.orderMissing ? null : round(a.orderWeight, 2),
    estimatedLengthM: round(a.estimatedLength, 2),
    estimatedWeightKg: round(a.estimatedWeight, 2),
    basis: rebarBasis(a),
  });

  const rebar: ProjectRebar | null =
    rItems.size === 0
      ? null
      : {
          rows: [...rGroups.entries()]
            .sort(([a], [b]) => a - b)
            .map(([diameterMm, g]) => ({
              diameterMm,
              lineCount: g.total.lines,
              lengthM: round(g.total.length, 2),
              weightKg: round(g.total.weight, 2),
              orderLengthM: round(g.total.orderLength, 2),
              orderWeightKg: g.total.orderMissing ? null : round(g.total.orderWeight, 2),
              estimatedLengthM: round(g.total.estimatedLength, 2),
              estimatedWeightKg: round(g.total.estimatedWeight, 2),
              basis: rebarBasis(g.total)!,
              perPlan: [...g.perPlan.entries()].map(([id, p]) => ({ ...rebarShare(id, p.name, p.sums, 0), itemCount: p.sums.lines })),
            })),
          perPlan: [...rPlans.entries()].map(([id, p]) => ({ ...rebarShare(id, p.name, p.sums, p.missingIds.size), itemCount: p.itemIds.size })),
          itemCount: rItems.size,
          missingItemCount: rMissing.size,
          lengthM: round(rTotal.length, 2),
          weightKg: round(rTotal.weight, 2),
          orderLengthM: round(rTotal.orderLength, 2),
          orderWeightKg: rTotal.orderMissing ? null : round(rTotal.orderWeight, 2),
          estimatedLengthM: round(rTotal.estimatedLength, 2),
          estimatedWeightKg: round(rTotal.estimatedWeight, 2),
          basis: rebarBasis(rTotal),
          sheetGroups: [...sheetGroups.values()],
        };

  return { concrete, rebar };
}

/**
 * How a project report treats its finishes summary: 'table' when there are finishes totals, 'skip'
 * when there are none but the project has concrete or rebar (the report is not empty — it just has
 * nothing to say under that heading), and 'empty' only when there is neither, which is when the
 * "no quantities" message is true.
 */
export function finishesSummaryMode(finishesTotalCount: number, structural: ProjectStructural): 'table' | 'skip' | 'empty' {
  if (finishesTotalCount > 0) return 'table';
  return structural.concrete || structural.rebar ? 'skip' : 'empty';
}
