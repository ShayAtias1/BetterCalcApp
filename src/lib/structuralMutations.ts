import { stirrupTemplate } from './stirrupShape';
import { resolveSheetSettings } from './meshSheets';
/**
 * Plan → plan changes for concrete zones. Pure: the store wraps each in its history and autosave
 * pattern, exactly as it does for rooms. They always read the array through `concreteOf` and
 * never touch rooms or any other part of the plan.
 */

import { v4 as uuid } from 'uuid';
import type { Plan, Point, Room } from '../types';
import { polygonAreaPx } from './geometry';
import type { ConcreteElement, ConcreteKind, MeshReinforcement, RebarBars, RebarItem, RebarLevel, RebarMesh, RebarStirrup } from '../types/structural';
import { copyReinforcement, emptyReinforcement } from './rebarMesh';
import { concreteOf, rebarOf } from './structuralPlan';
import { hasManualMark, nextAutoNumber } from './structuralMarks';

export const CONCRETE_KINDS: ConcreteKind[] = ['slab', 'wall', 'beam', 'column'];

/**
 * A new, deliberately minimal element for a finished zone: the geometry, the page, the kind and the
 * automatic mark number. The vertical dimension is left unset (not calculable until entered) — the form
 * opens straight after.
 */
export function newConcreteElement(plan: Plan, pageNumber: number, kind: ConcreteKind, points: Point[]): ConcreteElement {
  return {
    id: uuid(),
    pageNumber,
    kind,
    points: points.map((p) => ({ x: p.x, y: p.y })),
    mark: '',
    autoNumber: nextAutoNumber(concreteOf(plan), kind),
    wastePercent: 0,
  };
}

export function addConcreteElement(plan: Plan, element: ConcreteElement): Plan {
  return { ...plan, concreteElements: [...concreteOf(plan), element] };
}

/**
 * Copies the outlines of existing rooms into new concrete zones of one kind. Only the page and the
 * native points are taken — never the room's name, work items, openings or quantity settings — and
 * every zone gets its own id and the next automatic number of that kind, in the order given. The rooms
 * are not touched. A room without a usable outline (fewer than three points, or no area) is skipped.
 */
export function addConcreteFromRooms(plan: Plan, rooms: Room[], kind: ConcreteKind): { plan: Plan; created: ConcreteElement[] } {
  let next = plan;
  const created: ConcreteElement[] = [];
  for (const room of rooms) {
    if (!Array.isArray(room.points) || room.points.length < 3 || polygonAreaPx(room.points) <= 0) continue;
    const element = newConcreteElement(next, room.pageNumber, kind, room.points);
    created.push(element);
    next = addConcreteElement(next, element);
  }
  return { plan: next, created };
}

/**
 * Merges `patch` into the element; the id never changes. A field patched to `undefined` is removed
 * (clearing the depth or switching off the manual size leaves no key behind). Unknown id: the plan unchanged.
 */
export function updateConcreteElement(plan: Plan, id: string, patch: Partial<Omit<ConcreteElement, 'id'>>): Plan {
  const elements = concreteOf(plan);
  if (!elements.some((e) => e.id === id)) return plan;
  const merge = (e: ConcreteElement): ConcreteElement => {
    const merged: Record<string, unknown> = { ...e, ...patch, id };
    for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
    return merged as unknown as ConcreteElement;
  };
  return { ...plan, concreteElements: elements.map((e) => (e.id === id ? merge(e) : e)) };
}

/**
 * Changes an element's kind and nothing about its zone. An automatic mark follows the kind (it is
 * renumbered for the new kind); a mark the user typed is kept. The vertical dimension stays
 * (thickness and height are the same field). A quantity only belongs to columns, so it is dropped
 * when the new kind is not a column — otherwise a hidden "4" would silently multiply a slab. Same
 * kind or unknown id: the plan unchanged.
 */
export function changeConcreteKind(plan: Plan, id: string, kind: ConcreteKind): Plan {
  const element = concreteOf(plan).find((e) => e.id === id);
  if (!element || element.kind === kind) return plan;
  return updateConcreteElement(plan, id, {
    kind,
    ...(hasManualMark(element) ? {} : { autoNumber: nextAutoNumber(concreteOf(plan).filter((e) => e.id !== id), kind) }),
    ...(kind === 'column' ? {} : { quantity: undefined }),
  });
}

/** Removes the element. Unknown id: the plan unchanged. */
export function removeConcreteElement(plan: Plan, id: string): Plan {
  const elements = concreteOf(plan);
  if (!elements.some((e) => e.id === id)) return plan;
  return { ...plan, concreteElements: elements.filter((e) => e.id !== id) };
}

// ---------- rebar ----------

/** A new mesh zone for a finished outline: geometry, page, automatic mark number and an empty Bottom level. */
export function newRebarMesh(plan: Plan, pageNumber: number, points: Point[]): RebarMesh {
  return {
    id: uuid(),
    kind: 'mesh',
    pageNumber,
    points: points.map((p) => ({ x: p.x, y: p.y })),
    mark: '',
    autoNumber: nextAutoNumber(rebarOf(plan), 'mesh'),
    bottom: emptyReinforcement(),
    wastePercent: 0,
  };
}

/** A new manual-bars row on a page: nothing entered yet, so nothing is calculable. */
export function newRebarBars(plan: Plan, pageNumber: number): RebarBars {
  return { id: uuid(), kind: 'bars', pageNumber, mark: '', autoNumber: nextAutoNumber(rebarOf(plan), 'bars'), diameterMm: 0, count: 0, lengthM: 0, wastePercent: 0 };
}

export function addRebarItem(plan: Plan, item: RebarItem): Plan {
  return { ...plan, rebarItems: [...rebarOf(plan), item] };
}

export type RebarPatch = Partial<Omit<RebarMesh, 'id' | 'kind'>> & Partial<Omit<RebarBars, 'id' | 'kind'>> & Partial<Omit<RebarStirrup, 'id' | 'kind'>>;

/** Merges `patch` into the item (id and kind never change); a field patched to `undefined` is removed. Unknown id: unchanged. */
export function updateRebarItem(plan: Plan, id: string, patch: RebarPatch): Plan {
  const items = rebarOf(plan);
  const current = items.find((i) => i.id === id);
  if (!current) return plan;
  const merged: Record<string, unknown> = { ...current, ...patch, id, kind: current.kind };
  if (current.kind === 'mesh' && 'sheets' in patch) {
    const oldSize = resolveSheetSettings(current.sheets), newSize = resolveSheetSettings(patch.sheets);
    if (oldSize.lengthM !== newSize.lengthM || oldSize.widthM !== newSize.widthM) delete merged.manualLayouts;
  }
  if (current.kind === 'mesh' && merged.manualLayouts) {
    const layouts = { ...(merged.manualLayouts as RebarMesh['manualLayouts']) };
    if (!merged.bottom) delete layouts.bottom;
    if (!merged.top) delete layouts.top;
    merged.manualLayouts = Object.keys(layouts).length ? layouts : undefined;
  }
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return { ...plan, rebarItems: items.map((i) => (i.id === id ? (merged as unknown as RebarItem) : i)) };
}

export function removeRebarItem(plan: Plan, id: string): Plan {
  const items = rebarOf(plan);
  if (!items.some((i) => i.id === id)) return plan;
  return { ...plan, rebarItems: items.filter((i) => i.id !== id) };
}

/** Which levels a mesh should have. Enabling a level starts it empty; disabling one drops its entries. */
export type MeshLevelChoice = 'bottom' | 'top' | 'both';

function meshOf(plan: Plan, id: string): RebarMesh | undefined {
  const item = rebarOf(plan).find((i) => i.id === id);
  return item && item.kind === 'mesh' ? item : undefined;
}

/**
 * Sets which reinforcement levels a mesh has. A level that stays keeps what was entered; a new one
 * starts empty (not calculable until filled in — Top is never copied from Bottom here); a level
 * switched off is removed. Unknown id, not a mesh, or no change: the plan unchanged.
 */
export function setMeshLevels(plan: Plan, id: string, choice: MeshLevelChoice): Plan {
  const mesh = meshOf(plan, id);
  if (!mesh) return plan;
  const wantBottom = choice !== 'top';
  const wantTop = choice !== 'bottom';
  if (!!mesh.bottom === wantBottom && !!mesh.top === wantTop) return plan;
  return updateRebarItem(plan, id, {
    bottom: wantBottom ? mesh.bottom ?? emptyReinforcement() : undefined,
    top: wantTop ? mesh.top ?? emptyReinforcement() : undefined,
  });
}

/** Replaces one level's reinforcement (the form builds it with the lib/rebarMesh helpers). Level not enabled / unknown id: unchanged. */
export function setMeshReinforcement(plan: Plan, id: string, level: RebarLevel, reinforcement: MeshReinforcement): Plan {
  const mesh = meshOf(plan, id);
  if (!mesh || !mesh[level]) return plan;
  return updateRebarItem(plan, id, { [level]: reinforcement });
}

/**
 * "Copy Bottom to Top": the Top level becomes a deep copy of Bottom's reinforcement, and both are
 * enabled. After this they are independent — editing one never touches the other. No Bottom: unchanged.
 */
export function copyBottomToTop(plan: Plan, id: string): Plan {
  const mesh = meshOf(plan, id);
  if (!mesh || !mesh.bottom) return plan;
  return updateRebarItem(plan, id, { top: copyReinforcement(mesh.bottom) });
}

/**
 * Copies the outlines of existing rooms into new mesh zones — the rebar twin of `addConcreteFromRooms`:
 * geometry and page only, new ids, next automatic marks, rooms untouched, unusable outlines skipped.
 */
export function addRebarMeshFromRooms(plan: Plan, rooms: Room[]): { plan: Plan; created: RebarMesh[] } {
  let next = plan;
  const created: RebarMesh[] = [];
  for (const room of rooms) {
    if (!Array.isArray(room.points) || room.points.length < 3 || polygonAreaPx(room.points) <= 0) continue;
    const mesh = newRebarMesh(next, room.pageNumber, room.points);
    created.push(mesh);
    next = addRebarItem(next, mesh);
  }
  return { plan: next, created };
}

export function newRebarStirrup(plan: Plan, pageNumber: number): RebarStirrup {
  return { id: uuid(), kind: 'stirrup', pageNumber, mark: '', autoNumber: nextAutoNumber(rebarOf(plan), 'stirrup'),
    diameterMm: 8, shape: stirrupTemplate('rectangle'), lengthMode: 'automatic', wastePercent: 0, placements: [] };
}
