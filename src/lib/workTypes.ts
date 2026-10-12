/**
 * The work-type catalogue: what each work type measures, in which unit, with which defaults and how
 * openings affect it. `lib/quantities.ts` reads everything from here — no work type is special-cased
 * by label, unit or default value anywhere else. Labels are in the dictionary under the type's id
 * (`workTypes.<id>`, and `workTypeHeights.<id>` for its height input).
 */

import type { CalculationMethod, OpeningType, Plan, WorkItem, WorkItemType, WorkType } from '../types';
import { MEASUREMENT_DEFAULTS } from '../config/measurementDefaults';

/** A quantity's unit, as a dictionary key under `units`: square metres, running metres or units (counted). */
export type QuantityUnit = 'm2' | 'lm' | 'unit';

/**
 * - floorArea: the room polygon's area.
 * - wallArea: perimeter × height, minus applicable openings (each clipped to that height).
 * - perimeter: running metres along the perimeter, minus applicable opening widths; the m² reading
 *   is that length × the strip height.
 * - floorAndUpturn: floor area plus a perimeter strip turned up the walls (perimeter × height).
 * - manual: the quantity typed on the item (`WorkItem.manualQuantity`), in the definition's unit.
 */
export type CalculationBasis = 'floorArea' | 'wallArea' | 'perimeter' | 'floorAndUpturn' | 'manual';

/** Plan fields that hold the user's per-project default waste %. */
export type WasteDefaultField =
  | 'defaultTilingWastePercent'
  | 'defaultCladdingWastePercent'
  | 'defaultPanelsWastePercent'
  | 'defaultPaintingWastePercent'
  | 'defaultPlasterWastePercent'
  | 'defaultWaterproofingWastePercent';

/** Plan fields that hold a per-project default height. */
type HeightDefaultField = 'defaultCladdingHeightM' | 'defaultPanelHeightM' | 'wallHeightDefaultM';

export interface WorkTypeDefinition {
  id: WorkItemType;
  /** Unit of the item's primary quantity. */
  unit: QuantityUnit;
  basis: CalculationBasis;
  /** Waste % when neither the item nor the project sets one. */
  defaultWastePercent: number;
  /** Where the project keeps its own default waste % for this type (built-in types only). */
  wasteDefaultField?: WasteDefaultField;
  /** Whether openings are deducted unless the item says otherwise (`WorkItem.deductOpenings`). */
  deductsOpenings: boolean;
  /** Opening types that reduce this work. Empty = openings never affect it. */
  deductedOpeningTypes: OpeningType[];
  /** Height input for types that multiply the perimeter; absent for floor-only types. */
  height?: {
    /** Plan default used when the item has no height of its own. */
    projectField?: HeightDefaultField;
    /** Used when the project has no usable default either (older projects). */
    fallbackM: number;
  };
}

export const WORK_TYPE_DEFINITIONS: Record<WorkType, WorkTypeDefinition> = {
  tiling: {
    id: 'tiling',
    unit: 'm2',
    basis: 'floorArea',
    defaultWastePercent: 0,
    wasteDefaultField: 'defaultTilingWastePercent',
    deductsOpenings: false,
    deductedOpeningTypes: [],
  },
  cladding: {
    id: 'cladding',
    unit: 'm2',
    basis: 'wallArea',
    defaultWastePercent: 0,
    wasteDefaultField: 'defaultCladdingWastePercent',
    deductsOpenings: true,
    deductedOpeningTypes: ['door', 'window', 'custom'],
    height: { projectField: 'defaultCladdingHeightM', fallbackM: MEASUREMENT_DEFAULTS.claddingHeightM },
  },
  panels: {
    id: 'panels',
    unit: 'lm',
    basis: 'perimeter',
    defaultWastePercent: 0,
    wasteDefaultField: 'defaultPanelsWastePercent',
    // Skirting stops at door openings; windows sit above it and never reduce it.
    deductsOpenings: true,
    deductedOpeningTypes: ['door'],
    height: { projectField: 'defaultPanelHeightM', fallbackM: MEASUREMENT_DEFAULTS.panelHeightM },
  },
  painting: {
    id: 'painting',
    unit: 'm2',
    basis: 'wallArea',
    defaultWastePercent: 0,
    wasteDefaultField: 'defaultPaintingWastePercent',
    deductsOpenings: true,
    deductedOpeningTypes: ['door', 'window', 'custom'],
    height: { projectField: 'wallHeightDefaultM', fallbackM: MEASUREMENT_DEFAULTS.wallHeightM },
  },
  plaster: {
    id: 'plaster',
    unit: 'm2',
    basis: 'wallArea',
    defaultWastePercent: 0,
    wasteDefaultField: 'defaultPlasterWastePercent',
    deductsOpenings: true,
    deductedOpeningTypes: ['door', 'window', 'custom'],
    height: { projectField: 'wallHeightDefaultM', fallbackM: MEASUREMENT_DEFAULTS.wallHeightM },
  },
  waterproofing: {
    id: 'waterproofing',
    unit: 'm2',
    basis: 'floorAndUpturn',
    defaultWastePercent: 0,
    wasteDefaultField: 'defaultWaterproofingWastePercent',
    deductsOpenings: false,
    deductedOpeningTypes: [],
    height: { fallbackM: MEASUREMENT_DEFAULTS.waterproofingUpturnM },
  },
};

/** Order of the "+" buttons in the room panel. */
export const WORK_TYPE_ORDER: WorkType[] = ['tiling', 'cladding', 'panels', 'painting', 'plaster', 'waterproofing'];

/** Tolerates a work type this build doesn't know (a project saved by a newer version): it counts as nothing. */
export function workTypeDefinition(type: WorkItemType): WorkTypeDefinition | undefined {
  return Object.hasOwn(WORK_TYPE_DEFINITIONS, type) ? WORK_TYPE_DEFINITIONS[type as WorkType] : undefined;
}

export const CALCULATION_METHODS: CalculationMethod[] = ['floorArea', 'wallArea', 'ceilingArea', 'perimeter', 'manualArea', 'manualLength', 'manualCount'];

const WALL_OPENINGS: OpeningType[] = ['door', 'window', 'custom'];

/**
 * The calculation of a user-defined category, by method — the same bases the built-in types use, so
 * a custom wall finish deducts openings exactly like paint, and a custom strip like skirting.
 * The ceiling is measured as the room's floor area; it is reported as its own surface.
 */
export const METHOD_DEFINITIONS: Record<CalculationMethod, WorkTypeDefinition> = {
  floorArea: { id: 'custom', unit: 'm2', basis: 'floorArea', defaultWastePercent: 0, deductsOpenings: false, deductedOpeningTypes: [] },
  ceilingArea: { id: 'custom', unit: 'm2', basis: 'floorArea', defaultWastePercent: 0, deductsOpenings: false, deductedOpeningTypes: [] },
  wallArea: {
    id: 'custom', unit: 'm2', basis: 'wallArea', defaultWastePercent: 0, deductsOpenings: true, deductedOpeningTypes: WALL_OPENINGS,
    height: { projectField: 'wallHeightDefaultM', fallbackM: MEASUREMENT_DEFAULTS.wallHeightM },
  },
  perimeter: {
    id: 'custom', unit: 'lm', basis: 'perimeter', defaultWastePercent: 0, deductsOpenings: true, deductedOpeningTypes: ['door'],
    height: { projectField: 'defaultPanelHeightM', fallbackM: MEASUREMENT_DEFAULTS.panelHeightM },
  },
  manualArea: { id: 'custom', unit: 'm2', basis: 'manual', defaultWastePercent: 0, deductsOpenings: false, deductedOpeningTypes: [] },
  manualLength: { id: 'custom', unit: 'lm', basis: 'manual', defaultWastePercent: 0, deductsOpenings: false, deductedOpeningTypes: [] },
  manualCount: { id: 'custom', unit: 'unit', basis: 'manual', defaultWastePercent: 0, deductsOpenings: false, deductedOpeningTypes: [] },
};

export function isCalculationMethod(value: unknown): value is CalculationMethod {
  return typeof value === 'string' && (CALCULATION_METHODS as string[]).includes(value);
}

/**
 * The definition an item calculates with: its built-in type's, or its own method's for a custom
 * item. undefined only for a type this build does not know, or a custom item without a valid
 * method — which the UI and reports flag instead of counting as zero.
 */
export function workItemDefinition(item: Pick<WorkItem, 'type' | 'method'>): WorkTypeDefinition | undefined {
  if (item.type === 'custom') return isCalculationMethod(item.method) ? METHOD_DEFINITIONS[item.method] : undefined;
  return workTypeDefinition(item.type);
}

/** The method a built-in type corresponds to, for labelling reports ('floorAndUpturn' has no custom equivalent). */
export function builtInMethodKey(type: WorkType): CalculationMethod | 'floorAndUpturn' {
  const basis = WORK_TYPE_DEFINITIONS[type].basis;
  return basis === 'floorAndUpturn' ? 'floorAndUpturn' : basis === 'manual' ? 'manualArea' : basis;
}

/** Plan default waste % for a work type (before the AS-tiling special case in lib/quantities). */
export function projectWasteDefault(def: WorkTypeDefinition, project: Plan): number {
  if (!def.wasteDefaultField) return def.defaultWastePercent;
  const v = project[def.wasteDefaultField];
  return typeof v === 'number' && Number.isFinite(v) ? v : def.defaultWastePercent;
}

/** Plan default height for a work type, or its catalogue fallback. */
export function projectHeightDefault(def: WorkTypeDefinition, project: Plan): number {
  if (!def.height) return 0;
  const v = def.height.projectField ? project[def.height.projectField] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : def.height.fallbackM;
}
