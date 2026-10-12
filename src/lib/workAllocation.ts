/**
 * Splitting a work item's quantity between work items / specifications ("White paint 5 m², Grey
 * paint the rest"), and the category → work item breakdown the quantity table and the exports show.
 *
 * The calculated quantity (or the typed one, for a manual method) is the baseline. Allocations only
 * divide it: a category's total is always the sum of its baselines, never the sum of its shares, so
 * nothing is counted twice. Manual shares are as typed; one share may be the automatic remainder;
 * whatever no share covers is reported as unassigned, and shares beyond the baseline as over-allocated.
 */

import type { Plan, ReportCategory, Room, WorkItem } from '../types';
import { t as globalT, type TranslateFn } from '../i18n';
import { round } from './geometry';
import { calculateWorkItem, effectiveHeightM, effectiveWastePercent, isPageCalibrated, itemPrimaryQuantity, reportCategoryOf, roomMetrics, ALL_REPORT_CATEGORIES } from './quantities';
import { builtinTypeOf, categoryDefaultMethod, customColumnLabel, customReportKey, itemMethod, itemUnitLabel, planCategory, planSpec, workItemLabel } from './workCatalog';
import { workItemDefinition, type QuantityUnit, type WorkTypeDefinition } from './workTypes';
import type { CalculationMethod } from '../types';

export type MethodKey = CalculationMethod | 'floorAndUpturn';

/** An item's primary quantity: running metres for strips and lengths, units for counts, else net m². */
export const primaryQuantity = itemPrimaryQuantity;

/** A manual quantity needs no scale; everything measured needs a calibrated page. */
export function itemIsCalculable(def: WorkTypeDefinition, plan: Plan, room: Room): boolean {
  return def.basis === 'manual' || isPageCalibrated(plan, room.pageNumber);
}

export interface AllocationLine {
  id: string;
  specId: string;
  /** Typed by the user (true) or the automatic remainder (false). */
  manual: boolean;
  /** The share; null for the remainder while the baseline cannot be calculated. */
  quantity: number | null;
}

export interface ItemAllocation {
  def: WorkTypeDefinition;
  /** The quantity being split; null when it cannot be calculated yet (page not calibrated). */
  baseline: number | null;
  unit: QuantityUnit;
  lines: AllocationLine[];
  manualTotal: number;
  /** Quantity no share covers (no remainder share); null when the baseline is unknown. */
  unassigned: number | null;
  /** Manual shares beyond the baseline (0 when within it). */
  over: number;
  hasRemainder: boolean;
}

const shareOf = (q: unknown) => (typeof q === 'number' && Number.isFinite(q) ? Math.max(0, q) : null);

/** Splits one work item. null only when the item cannot be calculated at all (unknown type / method). */
export function allocateWorkItem(item: WorkItem, room: Room, plan: Plan): ItemAllocation | null {
  const def = workItemDefinition(item);
  if (!def) return null;
  const { areaM2, perimeterM } = roomMetrics(room, plan.pages[room.pageNumber]?.calibration ?? null);
  const calc = calculateWorkItem(item, room, areaM2, perimeterM, plan);
  const baseline = itemIsCalculable(def, plan, room) ? primaryQuantity(def, calc) : null;
  const allocations = (Array.isArray(item.allocations) ? item.allocations : []).filter((a) => a && typeof a.specId === 'string');
  // Only the first share without a number is the remainder; any further one counts as 0.
  const remainderIndex = allocations.findIndex((a) => shareOf(a.quantity) === null);
  const manualTotal = allocations.reduce((sum, a, i) => sum + (i === remainderIndex ? 0 : shareOf(a.quantity) ?? 0), 0);
  const free = baseline === null ? null : Math.max(0, baseline - manualTotal);
  const lines = allocations.map((a, i): AllocationLine => ({
    id: a.id,
    specId: a.specId,
    manual: i !== remainderIndex,
    quantity: i === remainderIndex ? free : shareOf(a.quantity) ?? 0,
  }));
  return {
    def,
    baseline,
    unit: def.unit,
    lines,
    manualTotal,
    unassigned: free === null ? null : remainderIndex >= 0 ? 0 : free,
    over: baseline === null ? 0 : Math.max(0, manualTotal - baseline),
    hasRemainder: remainderIndex >= 0,
  };
}

/** Whether a plan uses the catalog at all — the breakdown (UI and exports) is shown only then. */
export function planUsesWorkBreakdown(plan: Plan): boolean {
  return plan.rooms.some((room) => room.workItems.some((w) => w.type === 'custom' || (Array.isArray(w.allocations) && w.allocations.length > 0)));
}

export interface BreakdownAmount {
  quantity: number;
  order: number;
  /** Strips (perimeter method) only: the m² reading (running metres × height), and with waste. */
  areaM2: number | null;
  orderAreaM2: number | null;
}

export type BreakdownSource = 'auto' | 'manual' | 'mixed';

export interface BreakdownLine {
  /** null: the part of the category assigned to no work item. */
  specId: string | null;
  label: string;
  specification: string;
  amount: BreakdownAmount;
  source: BreakdownSource;
}

export interface BreakdownGroup {
  key: string;
  label: string;
  method: MethodKey;
  unit: QuantityUnit;
  unitLabel: string;
  /** The calculated total of the category: the sum of its items' baselines. */
  total: BreakdownAmount;
  lines: BreakdownLine[];
  /** Sum of manual shares beyond their items' baselines. */
  over: number;
  /** Items left out because their page has no scale. */
  uncalculated: number;
}

export interface BreakdownRoomRow {
  planName: string;
  apartment: string;
  room: string;
  category: string;
  item: string;
  specification: string;
  /** null: not calculable (page not calibrated). */
  quantity: number | null;
  unitLabel: string;
  waste: number;
  order: number | null;
  source: 'auto' | 'manual' | 'unassigned';
}

export interface WorkBreakdown {
  groups: BreakdownGroup[];
  rooms: BreakdownRoomRow[];
  /** Custom items whose method is missing or unknown — shown as a warning, never as zero. */
  invalidItems: number;
}

const emptyAmount = (strip: boolean): BreakdownAmount => ({ quantity: 0, order: 0, areaM2: strip ? 0 : null, orderAreaM2: strip ? 0 : null });

function addAmount(target: BreakdownAmount, quantity: number, waste: number, heightM: number) {
  const factor = 1 + waste / 100;
  target.quantity += quantity;
  target.order += quantity * factor;
  if (target.areaM2 !== null) {
    target.areaM2 += quantity * heightM;
    target.orderAreaM2! += quantity * heightM * factor;
  }
}

const roundAmount = (a: BreakdownAmount): BreakdownAmount => ({
  quantity: round(a.quantity, 2),
  order: round(a.order, 2),
  areaM2: a.areaM2 === null ? null : round(a.areaM2, 2),
  orderAreaM2: a.orderAreaM2 === null ? null : round(a.orderAreaM2, 2),
});

/** The group a work item is reported in: the same column as in the main reports (built-in, or category + method). */
function groupKeyOf(item: WorkItem): string | null {
  return reportCategoryOf(item) ?? customReportKey(item);
}

/** A custom group's label: its category, and its method when that differs from the category's own. */
function customGroupLabel(item: WorkItem, plan: Plan, tr: TranslateFn): string {
  const categoryId = item.categoryId!;
  const builtinType = builtinTypeOf(categoryId);
  return customColumnLabel({
    categoryName: builtinType ? null : planCategory(plan, categoryId)?.name ?? null,
    builtinType,
    method: item.method!,
    showMethod: item.method !== categoryDefaultMethod(categoryId, plan),
  }, tr);
}

/**
 * Category → work item breakdown of the given plans (rooms limited by `includeRoom`), in report
 * order: the built-in categories first, then custom ones as first met. Built-in category totals equal
 * the existing report's totals; custom categories appear only here.
 */
export function buildWorkBreakdown(plans: Plan[], tr: TranslateFn = globalT, includeRoom: (plan: Plan, room: Room) => boolean = () => true): WorkBreakdown {
  const groups = new Map<string, BreakdownGroup & { lineMap: Map<string, BreakdownLine> }>();
  const rooms: BreakdownRoomRow[] = [];
  let invalidItems = 0;

  for (const plan of plans) {
    for (const room of plan.rooms) {
      if (!includeRoom(plan, room)) continue;
      for (const item of room.workItems) {
        const key = groupKeyOf(item);
        const allocation = key ? allocateWorkItem(item, room, plan) : null;
        if (!key || !allocation) {
          if (item.type === 'custom') invalidItems++;
          continue;
        }
        const method = itemMethod(item)!;
        const strip = allocation.def.basis === 'perimeter';
        const unitLabel = itemUnitLabel(item, plan, tr);
        let group = groups.get(key);
        if (!group) {
          const builtin = ALL_REPORT_CATEGORIES.includes(key as ReportCategory);
          group = {
            key,
            label: builtin ? tr(`reportCategories.${key as ReportCategory}`) : customGroupLabel(item, plan, tr),
            method, unit: allocation.unit, unitLabel, total: emptyAmount(strip), lines: [], over: 0, uncalculated: 0, lineMap: new Map(),
          };
          groups.set(key, group);
        }
        const waste = effectiveWastePercent(item, plan);
        const heightM = strip ? effectiveHeightM(item, plan) : 0;
        const roomBase = {
          planName: plan.name, apartment: room.apartmentNumber, room: room.name, category: group.label, unitLabel, waste,
        };
        if (allocation.baseline === null) {
          group.uncalculated++;
          rooms.push({ ...roomBase, item: workItemLabel(item, plan, tr), specification: '', quantity: null, order: null, source: 'auto' });
          continue;
        }
        addAmount(group.total, allocation.baseline, waste, heightM);
        group.over += allocation.over;
        const parts: { specId: string | null; quantity: number; source: 'auto' | 'manual' }[] = allocation.lines.map((l) => ({
          specId: l.specId, quantity: l.quantity ?? 0, source: l.manual ? 'manual' : 'auto',
        }));
        // A work item with its own method (e.g. "Ceiling paint") is its own quantity when nothing splits it.
        if (allocation.lines.length === 0 && item.specId) parts.push({ specId: item.specId, quantity: allocation.baseline, source: 'auto' });
        else if ((allocation.unassigned ?? 0) > 0 || allocation.lines.length === 0) parts.push({ specId: null, quantity: allocation.unassigned ?? allocation.baseline, source: 'auto' });
        for (const part of parts) {
          const spec = planSpec(plan, part.specId);
          const lineKey = part.specId ?? '';
          let line = group.lineMap.get(lineKey);
          if (!line) {
            line = {
              specId: part.specId,
              label: part.specId === null ? tr('workCatalog.unassigned') : spec?.name || tr('workCatalog.unknownItem'),
              specification: spec?.specification ?? '',
              amount: emptyAmount(strip),
              source: part.source,
            };
            group.lineMap.set(lineKey, line);
            group.lines.push(line);
          } else if (line.source !== part.source) {
            line.source = 'mixed';
          }
          addAmount(line.amount, part.quantity, waste, heightM);
          rooms.push({
            ...roomBase,
            item: part.specId === null ? tr('workCatalog.unassigned') : spec?.name || tr('workCatalog.unknownItem'),
            specification: spec?.specification ?? '',
            quantity: round(part.quantity, 2),
            order: round(part.quantity * (1 + waste / 100), 2),
            source: part.specId === null ? 'unassigned' : part.source,
          });
        }
      }
    }
  }

  const rank = (key: string) => {
    const i = ALL_REPORT_CATEGORIES.indexOf(key as ReportCategory);
    return i < 0 ? ALL_REPORT_CATEGORIES.length : i;
  };
  const ordered = [...groups.values()].sort((a, b) => rank(a.key) - rank(b.key));
  return {
    groups: ordered.map((g): BreakdownGroup => ({
      key: g.key, label: g.label, method: g.method, unit: g.unit, unitLabel: g.unitLabel, uncalculated: g.uncalculated,
      total: roundAmount(g.total),
      over: round(g.over, 2),
      // The unassigned part reads last, after the named work items. A category nobody split has no
      // lines at all: an "unassigned" row would only repeat its total.
      lines: g.lines.some((l) => l.specId !== null)
        ? [...g.lines.filter((l) => l.specId !== null), ...g.lines.filter((l) => l.specId === null)].map((l) => ({ ...l, amount: roundAmount(l.amount) }))
        : [],
    })),
    rooms,
    invalidItems,
  };
}
