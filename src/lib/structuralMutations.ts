/**
 * Plan → plan changes for concrete zones. Pure: the store wraps each in its history and autosave
 * pattern, exactly as it does for rooms. They always read the array through `concreteOf` and
 * never touch rooms or any other part of the plan.
 */

import { v4 as uuid } from 'uuid';
import type { Plan, Point } from '../types';
import type { ConcreteElement, ConcreteKind } from '../types/structural';
import { concreteOf } from './structuralPlan';

/** The letter each kind's automatic mark starts with: S01, W01, B01, C01. */
export const CONCRETE_MARK_PREFIX: Record<ConcreteKind, string> = { slab: 'S', wall: 'W', beam: 'B', column: 'C' };

export const CONCRETE_KINDS: ConcreteKind[] = ['slab', 'wall', 'beam', 'column'];

/**
 * The next automatic mark of a kind: one above the highest `<letter><number>` mark that kind already
 * has in the plan, padded to two digits. Marks the user typed in another shape are ignored, and a
 * deleted element's number is not reused while a higher one remains.
 */
export function nextConcreteMark(elements: ConcreteElement[], kind: ConcreteKind): string {
  const prefix = CONCRETE_MARK_PREFIX[kind];
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  let highest = 0;
  for (const el of elements) {
    if (el.kind !== kind) continue;
    const n = Number(pattern.exec(el.mark.trim())?.[1]);
    if (Number.isFinite(n) && n > highest) highest = n;
  }
  return `${prefix}${String(highest + 1).padStart(2, '0')}`;
}

/**
 * A new, deliberately minimal element for a finished zone: the geometry, the page, the kind and the
 * automatic mark. The vertical dimension is left unset (not calculable until entered) — the form
 * opens straight after.
 */
export function newConcreteElement(plan: Plan, pageNumber: number, kind: ConcreteKind, points: Point[]): ConcreteElement {
  return {
    id: uuid(),
    pageNumber,
    kind,
    points: points.map((p) => ({ x: p.x, y: p.y })),
    mark: nextConcreteMark(concreteOf(plan), kind),
    wastePercent: 0,
  };
}

export function addConcreteElement(plan: Plan, element: ConcreteElement): Plan {
  return { ...plan, concreteElements: [...concreteOf(plan), element] };
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
 * Changes an element's kind and nothing about its zone. The mark follows the kind only while it is
 * still an automatic one — `<old letter><number>` — and is then renumbered for the new kind;
 * a mark the user typed is kept. The vertical dimension stays (thickness and height are the same
 * field). A quantity only belongs to columns, so it is dropped when the new kind is not a column —
 * otherwise a hidden "4" would silently multiply a slab. Same kind or unknown id: the plan unchanged.
 */
export function changeConcreteKind(plan: Plan, id: string, kind: ConcreteKind): Plan {
  const element = concreteOf(plan).find((e) => e.id === id);
  if (!element || element.kind === kind) return plan;
  const wasAutoMark = new RegExp(`^${CONCRETE_MARK_PREFIX[element.kind]}\\d+$`).test(element.mark.trim());
  return updateConcreteElement(plan, id, {
    kind,
    mark: wasAutoMark ? nextConcreteMark(concreteOf(plan), kind) : element.mark,
    ...(kind === 'column' ? {} : { quantity: undefined }),
  });
}

/** Removes the element. Unknown id: the plan unchanged. */
export function removeConcreteElement(plan: Plan, id: string): Plan {
  const elements = concreteOf(plan);
  if (!elements.some((e) => e.id === id)) return plan;
  return { ...plan, concreteElements: elements.filter((e) => e.id !== id) };
}
