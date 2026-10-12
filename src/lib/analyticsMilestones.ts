/**
 * Derived analytics facts about a plan, read off the same quantity logic the quantity table and
 * the reports use (`buildRoomSummaries`) — no quantity formula is repeated here. Only counts, flags
 * and work-type enums come out; no names, numbers of m² or geometry.
 */

import type { Plan, RoomQuantitySummary, WorkItemType, WorkType } from '../types';
import { EXTRA_REPORT_CATEGORIES } from '../types';
import { buildRoomSummaries, isPageCalibrated } from './quantities';
import { WORK_TYPE_ORDER } from './workTypes';
import { isPlanReady, markPlanReady, type Ledger } from './analyticsLedger';

function summaryHasQuantity(s: RoomQuantitySummary): boolean {
  const areas = [s.tilingRegularAreaM2, s.tilingAsAreaM2, s.claddingAreaM2, s.panelsAreaM2, ...EXTRA_REPORT_CATEGORIES.map((c) => s.extra[c].areaM2)];
  // null = the page has no scale (not calculable); only a real, positive quantity counts.
  return areas.some((a) => a != null && a > 0);
}

function summaryHasWaste(s: RoomQuantitySummary): boolean {
  const waste = [
    s.tilingRegularWastePercent,
    s.tilingAsWastePercent,
    s.claddingWastePercent,
    s.panelsWastePercent,
    ...EXTRA_REPORT_CATEGORIES.map((c) => s.extra[c].wastePercent),
  ];
  return waste.some((w) => w != null && w > 0);
}

/** Distinct work types in canonical order. */
export function workTypesOf(types: Iterable<WorkItemType>): WorkType[] {
  const set = new Set<WorkItemType>(types);
  return WORK_TYPE_ORDER.filter((t) => set.has(t));
}

export interface PlanQuantityStatus {
  /** A calibrated page holds at least one room whose work items yield a quantity > 0. */
  ready: boolean;
  roomsWithQty: number;
  workTypes: WorkType[];
}

export function planQuantityStatus(plan: Plan): PlanQuantityStatus {
  const summaries = buildRoomSummaries(plan);
  const readyRoomIds = new Set(summaries.filter((s) => s.pageCalibrated && summaryHasQuantity(s)).map((s) => s.roomId));
  const rooms = plan.rooms.filter((r) => readyRoomIds.has(r.id));
  return {
    ready: rooms.length > 0,
    roomsWithQty: rooms.length,
    workTypes: workTypesOf(rooms.flatMap((r) => r.workItems.map((wi) => wi.type))),
  };
}

export function calibratedPageCount(plan: Plan): number {
  return Object.keys(plan.pages).filter((p) => isPageCalibrated(plan, Number(p))).length;
}

/** What a quantity report built from these summaries contains: its work types and whether any waste is applied. */
export function reportContents(plans: { plan: Plan; summaries: RoomQuantitySummary[] }[]): {
  workTypes: WorkType[];
  wasteApplied: boolean;
  roomCount: number;
} {
  const types: WorkItemType[] = [];
  let wasteApplied = false;
  let roomCount = 0;
  for (const { plan, summaries } of plans) {
    const ids = new Set(summaries.map((s) => s.roomId));
    for (const room of plan.rooms) if (ids.has(room.id)) types.push(...room.workItems.map((wi) => wi.type));
    if (summaries.some(summaryHasWaste)) wasteApplied = true;
    roomCount += summaries.length;
  }
  return { workTypes: workTypesOf(types), wasteApplied, roomCount };
}

/**
 * On plan load: a plan that already yields quantities (reopened, duplicated, or finished before
 * analytics existed) is recorded as ready *without* an event — it is not a new activation.
 * Returns true when the ledger changed.
 */
export function baselinePlanReadiness(ledger: Ledger, plan: Plan): boolean {
  if (isPlanReady(ledger, plan.id) || !planQuantityStatus(plan).ready) return false;
  return markPlanReady(ledger, plan.id);
}

/**
 * On save: the plan's status the first time it yields a quantity, recorded in the ledger so it is
 * never returned again for that plan — undo/redo, later saves and reopening all get null.
 */
export function takeQuantitiesReady(ledger: Ledger, plan: Plan): PlanQuantityStatus | null {
  if (isPlanReady(ledger, plan.id)) return null;
  const status = planQuantityStatus(plan);
  if (!status.ready) return null;
  markPlanReady(ledger, plan.id);
  return status;
}
