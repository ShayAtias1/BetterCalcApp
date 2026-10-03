import type { Plan } from '../types';
import type { ConcreteElement, RebarItem } from '../types/structural';

/**
 * The only way to read a plan's concrete and rebar zones. Plans saved before the feature have no
 * such arrays, and a damaged record could hold something that is not one; both read as empty, so
 * nothing downstream has to care and nothing is written to a plan just because it was opened.
 */
const EMPTY_CONCRETE: ConcreteElement[] = [];
const EMPTY_REBAR: RebarItem[] = [];

export function concreteOf(plan: Pick<Plan, 'concreteElements'>): ConcreteElement[] {
  return Array.isArray(plan.concreteElements) ? plan.concreteElements : EMPTY_CONCRETE;
}

export function rebarOf(plan: Pick<Plan, 'rebarItems'>): RebarItem[] {
  return Array.isArray(plan.rebarItems) ? plan.rebarItems : EMPTY_REBAR;
}

/** Whether the plan has any concrete or rebar item — what makes its structural report worth writing. */
export function hasStructuralData(plan: Pick<Plan, 'concreteElements' | 'rebarItems'>): boolean {
  return concreteOf(plan).length > 0 || rebarOf(plan).length > 0;
}

/** Pages that carry a concrete zone or a rebar item (manual bars count for the page they were added on). */
export function structuralPageNumbers(plan: Pick<Plan, 'concreteElements' | 'rebarItems'>): number[] {
  return [...new Set([...concreteOf(plan).map((e) => e.pageNumber), ...rebarOf(plan).map((i) => i.pageNumber)])].sort((a, b) => a - b);
}

/**
 * A copy of the plan whose concrete and rebar items are only those on `pages` — the structural
 * counterpart of filtering room summaries and area measurements by page before an export. Arrays the
 * plan does not have stay absent. Nothing else changes (calibration included), and nothing is saved.
 */
export function withStructuralPages(plan: Plan, pages: ReadonlySet<number>): Plan {
  const copy: Plan = { ...plan };
  if (Array.isArray(plan.concreteElements)) copy.concreteElements = plan.concreteElements.filter((e) => pages.has(e.pageNumber));
  if (Array.isArray(plan.rebarItems)) copy.rebarItems = plan.rebarItems.filter((i) => pages.has(i.pageNumber));
  return copy;
}
