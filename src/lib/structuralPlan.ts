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
