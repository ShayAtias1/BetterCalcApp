import type { Plan } from '../types';
import type { ConcreteElement, RebarItem } from '../types/structural';
import { withMarkFields } from './structuralMarks';

/**
 * The only way to read a plan's concrete and rebar zones. Plans saved before the feature have no
 * such arrays, and a damaged record could hold something that is not one; both read as empty, so
 * nothing downstream has to care and nothing is written to a plan just because it was opened.
 * Items saved with an older mark shape (letter marks such as `S01`) are returned in the current one;
 * see lib/structuralMarks.
 */
const EMPTY_CONCRETE: ConcreteElement[] = [];
const EMPTY_REBAR: RebarItem[] = [];

// Normalising is memoised on the stored array, so readers get stable identities and an
// already-current plan costs one pass and no allocation.
const concreteCache = new WeakMap<ConcreteElement[], ConcreteElement[]>();
const rebarCache = new WeakMap<RebarItem[], RebarItem[]>();

function normalized<T>(stored: T[], cache: WeakMap<T[], T[]>, fix: (item: T) => T): T[] {
  const hit = cache.get(stored);
  if (hit) return hit;
  const fixed = stored.map(fix);
  const result = fixed.some((item, i) => item !== stored[i]) ? fixed : stored;
  cache.set(stored, result);
  return result;
}

export function concreteOf(plan: Pick<Plan, 'concreteElements'>): ConcreteElement[] {
  return Array.isArray(plan.concreteElements) ? normalized(plan.concreteElements, concreteCache, withMarkFields) : EMPTY_CONCRETE;
}

export function rebarOf(plan: Pick<Plan, 'rebarItems'>): RebarItem[] {
  return Array.isArray(plan.rebarItems) ? normalized(plan.rebarItems, rebarCache, withMarkFields) : EMPTY_REBAR;
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
