/**
 * What the plan PDF contains - the user's choice, separate from WHICH pages. Four real sections;
 * "Everything" is only a convenience that selects all of them. Pure state helpers (the dialog and
 * the exporter share them).
 */

import type { Plan } from '../types';
import { concreteOf, rebarOf } from './structuralPlan';

export type ExportSection = 'plan' | 'finishes' | 'concrete' | 'rebar';

/** The document's section order: plan pages first, then the quantity sections. */
export const EXPORT_SECTIONS: readonly ExportSection[] = ['plan', 'finishes', 'concrete', 'rebar'];

export type ExportContent = Record<ExportSection, boolean>;

export const NO_CONTENT: ExportContent = { plan: false, finishes: false, concrete: false, rebar: false };
export const ALL_CONTENT: ExportContent = { plan: true, finishes: true, concrete: true, rebar: true };

export const hasAnyContent = (c: ExportContent): boolean => EXPORT_SECTIONS.some((s) => c[s]);
export const isEverything = (c: ExportContent, available: ExportContent = ALL_CONTENT): boolean => EXPORT_SECTIONS.every((s) => !available[s] || c[s]);

/** "Everything": every section the plan can actually provide. */
export const everything = (available: ExportContent = ALL_CONTENT): ExportContent => ({ ...available });

/** Which sections the plan has anything for (pages are a separate filter). */
export function availableContent(plan: Plan, hasFinishes: boolean, hasPlanPages: boolean): ExportContent {
  return { plan: hasPlanPages, finishes: hasFinishes, concrete: concreteOf(plan).length > 0, rebar: rebarOf(plan).length > 0 };
}
