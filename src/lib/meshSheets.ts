/**
 * Mesh-sheet procurement: how many physical reinforcement sheets a mesh zone needs. An ADDITIONAL
 * result next to engineering rebar quantities (lib/rebar). Engineering bar counts, lengths, net
 * weights and waste stay untouched; physical purchase weight comes from full sheets. Pure; no store, no drawing.
 *
 * ── One dimension ──────────────────────────────────────────────────────────────────────────────
 * The first sheet covers a whole sheet dimension S; every further sheet adds S - overlap:
 *
 *   zone ≤ S : 1
 *   else     : 1 + ceil((zone - S) / (S - overlap))
 *
 * Ratios within COUNT_EPSILON of a whole number count as whole (floating-point noise never adds a
 * sheet). The sheets are laid in a grid, so a rectangle needs `countAlongLong × countAlongShort`.
 *
 * ── Orientation ────────────────────────────────────────────────────────────────────────────────
 * Both are evaluated for a rectangular zone (long side ≥ short side):
 *   'length-along-long' : sheet length along the long side, sheet width along the short side
 *   'width-along-long'  : sheet width along the long side, sheet length along the short side
 * The one needing FEWER sheets is recommended; on a tie, 'length-along-long' (a fixed rule).
 *
 * ── Levels ─────────────────────────────────────────────────────────────────────────────────────
 * Every enabled reinforcement level (Bottom, Top) is one physical mesh layer, so it needs one full
 * set of sheets. Long/Short bar directions are part of ONE level's specification, not extra sheets.
 * Sheets are counted from the geometry alone: a level whose bar specification is still incomplete
 * still needs its sheets.
 *
 * ── Zones that are not rectangles ──────────────────────────────────────────────────────────────
 * No layout is invented. The result is `not-rectangular` and carries no count: an area ÷ sheet-area
 * guess would ignore overlap and cutting waste and would read as a procurement number.
 * A rectangle given by a manual size is exact.
 */

import type { Calibration } from '../types';
import type { MeshSheetSettings, MeshReinforcement, RebarLevel, RebarMesh } from '../types/structural';
import { COUNT_EPSILON, calculateRebar } from './rebar';
import { meshLevels, normalizeMesh } from './rebarMesh';
import { finitePositive, zoneGeometry } from './zoneGeometry';

/** The common real-world sheet: 6.00 m × 2.50 m, overlapped by 80 cm. */
export const DEFAULT_MESH_SHEETS = { lengthM: 6, widthM: 2.5, overlapM: 0.8 } as const;

export interface ResolvedSheetSettings {
  lengthM: number;
  widthM: number;
  overlapM: number;
}

/** The settings in use: each absent field falls back to its default. Reading never writes. */
export function resolveSheetSettings(sheets: MeshSheetSettings | undefined): ResolvedSheetSettings {
  return {
    lengthM: sheets?.lengthM ?? DEFAULT_MESH_SHEETS.lengthM,
    widthM: sheets?.widthM ?? DEFAULT_MESH_SHEETS.widthM,
    overlapM: sheets?.overlapM ?? DEFAULT_MESH_SHEETS.overlapM,
  };
}

/**
 * Why the settings cannot be used, or null when they can. The overlap must be smaller than BOTH sheet
 * dimensions, because both orientations are evaluated.
 */
export function sheetSettingsProblem(s: ResolvedSheetSettings): 'size' | 'overlap' | null {
  if (finitePositive(s.lengthM) === null || finitePositive(s.widthM) === null) return 'size';
  if (typeof s.overlapM !== 'number' || !Number.isFinite(s.overlapM) || s.overlapM < 0 || s.overlapM >= Math.min(s.lengthM, s.widthM)) return 'overlap';
  return null;
}

/** Sheets of dimension `sheetM` (overlapping by `overlapM`) needed to cover `zoneM`. Null for unusable inputs. */
export function sheetsAlong(zoneM: number, sheetM: number, overlapM: number): number | null {
  const zone = finitePositive(zoneM);
  const sheet = finitePositive(sheetM);
  if (zone === null || sheet === null || !Number.isFinite(overlapM) || overlapM < 0 || overlapM >= sheet) return null;
  if (zone <= sheet + COUNT_EPSILON) return 1;
  return 1 + Math.ceil((zone - sheet) / (sheet - overlapM) - COUNT_EPSILON);
}

export type SheetOrientation = 'length-along-long' | 'width-along-long';

export interface SheetOrientationPlan {
  orientation: SheetOrientation;
  /** The sheet dimension that runs along the zone's long side, and the one along its short side. */
  alongLongM: number;
  alongShortM: number;
  countAlongLong: number;
  countAlongShort: number;
  sheets: number;
}

export interface SheetPlan {
  /** The recommended orientation (fewest sheets; tie → length along the long side). */
  chosen: SheetOrientationPlan;
  /** The other orientation, for comparison and a future layout. */
  alternate: SheetOrientationPlan;
}

function orientationPlan(orientation: SheetOrientation, longM: number, shortM: number, s: ResolvedSheetSettings): SheetOrientationPlan | null {
  const alongLongM = orientation === 'length-along-long' ? s.lengthM : s.widthM;
  const alongShortM = orientation === 'length-along-long' ? s.widthM : s.lengthM;
  const countAlongLong = sheetsAlong(longM, alongLongM, s.overlapM);
  const countAlongShort = sheetsAlong(shortM, alongShortM, s.overlapM);
  if (countAlongLong === null || countAlongShort === null) return null;
  return { orientation, alongLongM, alongShortM, countAlongLong, countAlongShort, sheets: countAlongLong * countAlongShort };
}

/** Both orientations of one rectangle (long ≥ short), and which one wins. Null when the inputs are unusable. */
export function planSheetsForRectangle(longM: number, shortM: number, settings: ResolvedSheetSettings): SheetPlan | null {
  if (sheetSettingsProblem(settings) !== null) return null;
  const a = orientationPlan('length-along-long', longM, shortM, settings);
  const b = orientationPlan('width-along-long', longM, shortM, settings);
  if (!a || !b) return null;
  return b.sheets < a.sheets ? { chosen: b, alternate: a } : { chosen: a, alternate: b };
}

/**
 * Why a mesh has no sheet count — never reported as 0:
 * no-scale / missing-size: the zone has no size (same causes as the rebar quantities);
 * no-levels: no reinforcement level is enabled;
 * invalid-settings: sheet size or overlap unusable (`settingsProblem` says which);
 * not-rectangular: the zone is a free polygon; no layout is attempted.
 */
export type MeshSheetsStatus = 'ok' | 'no-scale' | 'missing-size' | 'no-levels' | 'invalid-settings' | 'not-rectangular';

export interface MeshLevelSheets {
  /** Absent on the original automatic result; manual resolution marks each available source. */
  source?: 'automatic' | 'manual';
  level: RebarLevel;
  sheets: number;
  purchasedAreaM2: number;
}

export interface MeshSheetsResult {
  status: MeshSheetsStatus;
  settings: ResolvedSheetSettings;
  settingsProblem: 'size' | 'overlap' | null;
  /** The zone's area; null when the zone has no size. */
  zoneAreaM2: number | null;
  /** The zone's sides (long ≥ short), for a rectangle; null otherwise. */
  sides: { longM: number; shortM: number } | null;
  /** Set when status is 'ok'. */
  plan: SheetPlan | null;
  /** One entry per enabled level, in reading order (Bottom first); empty unless status is 'ok'. */
  levels: MeshLevelSheets[];
  /** Sheets over all levels; null unless status is 'ok'. */
  totalSheets: number | null;
  /** totalSheets × nominal sheet area; null unless status is 'ok'. */
  purchasedAreaM2: number | null;
  /** A rectangle's count is exact; there is no estimate in V1 (non-rectangles have no count at all). */
  basis: 'exact' | null;
}

export function calculateMeshSheets(raw: RebarMesh, calibration: Calibration | null): MeshSheetsResult {
  const mesh = normalizeMesh(raw);
  const settings = resolveSheetSettings(mesh.sheets);
  const settingsProblem = sheetSettingsProblem(settings);
  const zone = zoneGeometry(mesh.points, calibration?.metersPerPixel ?? 0, mesh.sizeOverride);
  const levels = meshLevels(mesh);
  const base = { settings, settingsProblem, zoneAreaM2: zone?.areaM2 ?? null, sides: zone?.sides ?? null, plan: null, levels: [], totalSheets: null, purchasedAreaM2: null, basis: null };

  if (!zone) return { ...base, status: mesh.sizeOverride ? 'missing-size' : 'no-scale' };
  if (levels.length === 0) return { ...base, status: 'no-levels' };
  if (settingsProblem) return { ...base, status: 'invalid-settings' };
  if (!zone.sides) return { ...base, status: 'not-rectangular' };

  const plan = planSheetsForRectangle(zone.sides.longM, zone.sides.shortM, settings);
  if (!plan) return { ...base, status: 'invalid-settings' };
  const sheetArea = settings.lengthM * settings.widthM;
  const perLevel = plan.chosen.sheets;
  return {
    ...base,
    status: 'ok',
    plan,
    levels: levels.map(({ level }) => ({ level, sheets: perLevel, purchasedAreaM2: perLevel * sheetArea })),
    totalSheets: perLevel * levels.length,
    purchasedAreaM2: perLevel * levels.length * sheetArea,
    basis: 'exact',
  };
}

/** Single procurement resolver for forms, reports and exports. V2A remains automatic-only. */
function resolveMeshSheetCounts(raw: RebarMesh, calibration: Calibration | null): MeshSheetsResult {
  const mesh = normalizeMesh(raw);
  const automatic = calculateMeshSheets(mesh, calibration);
  if (!mesh.manualLayouts || Object.keys(mesh.manualLayouts).length === 0 || automatic.settingsProblem || automatic.status === 'no-levels') return automatic;
  const enabled = meshLevels(mesh);
  // Reject malformed/stale saved data rather than silently resize it or report a false quantity.
  for (const { level } of enabled) {
    const manual = mesh.manualLayouts[level];
    if (manual && (manual.lengthM !== automatic.settings.lengthM || manual.widthM !== automatic.settings.widthM ||
      !Array.isArray(manual.sheets) || manual.sheets.some((s) => !s || !s.id || !Number.isFinite(s.x) || !Number.isFinite(s.y) || ![0, 90, 180, 270].includes(s.rotation)) ||
      new Set(manual.sheets.map((s) => s.id)).size !== manual.sheets.length || !Number.isFinite(manual.sheets.length * manual.lengthM * manual.widthM))) {
      return { ...automatic, status: 'invalid-settings', settingsProblem: 'size', levels: [], totalSheets: null, purchasedAreaM2: null, basis: null };
    }
  }
  const levels: MeshLevelSheets[] = enabled.flatMap<MeshLevelSheets>(({ level }) => {
    const manual = mesh.manualLayouts?.[level];
    if (manual) return [{ level, source: 'manual' as const, sheets: manual.sheets.length,
      purchasedAreaM2: manual.sheets.length * manual.lengthM * manual.widthM }];
    const entry = automatic.levels.find((l) => l.level === level);
    return entry ? [{ ...entry, source: 'automatic' as const }] : [];
  });
  const complete = levels.length === enabled.length;
  return { ...automatic, status: complete ? 'ok' : automatic.status, levels,
    totalSheets: complete ? levels.reduce((sum, l) => sum + l.sheets, 0) : null,
    purchasedAreaM2: complete ? levels.reduce((sum, l) => sum + l.purchasedAreaM2, 0) : null };
}


/** A full physical sheet, using the same edge-bar count and kg/m calculation as engineering. */
export function calculatePhysicalMeshSheetWeight(lengthM: number, widthM: number, reinforcement: MeshReinforcement, level: RebarLevel = 'bottom', meshId = 'physical-sheet') {
  const calc = calculateRebar({ id: meshId, mark: '', kind: 'mesh', pageNumber: 1, points: [],
    sizeOverride: { lengthM, widthM }, [level]: reinforcement }, null);
  return { sheetWeightKg: calc.weightKg !== null && Number.isFinite(calc.weightKg) ? calc.weightKg : null,
    layers: calc.layers };
}
export interface MeshLevelProcurement {
  level: RebarLevel;
  source: 'automatic' | 'manual';
  sheets: number | null;
  purchasedAreaM2: number | null;
  settings: ResolvedSheetSettings;
  sheetWeightKg: number | null;
  procurementWeightKg: number | null;
  /** Per-direction contributions for diameter summaries; identity matches the engineering layers. */
  layerProcurementWeightsKg: Record<string, number | null>;
  status: 'ok' | 'unavailable' | 'invalid-spec';
}
export interface MeshProcurementResult extends Omit<MeshSheetsResult, 'levels'> {
  levels: MeshLevelProcurement[];
  procurementWeightKg: number | null;
}

/** Counts and full-sheet purchase weights: the single source for forms, summaries and exports. */
export function resolveMeshProcurement(raw: RebarMesh, calibration: Calibration | null): MeshProcurementResult {
  const mesh = normalizeMesh(raw);
  const quantities = resolveMeshSheetCounts(mesh, calibration);
  const levels = meshLevels(mesh).map(({ level, reinforcement }): MeshLevelProcurement => {
    const count = quantities.levels.find((l) => l.level === level);
    const physical = calculatePhysicalMeshSheetWeight(quantities.settings.lengthM, quantities.settings.widthM, reinforcement, level, mesh.id);
    const sheets = count?.sheets ?? null;
    const weight = sheets === null || physical.sheetWeightKg === null ? null : physical.sheetWeightKg * sheets;
    const procurementWeightKg = weight !== null && Number.isFinite(weight) ? weight : null;
    return { level, source: mesh.manualLayouts?.[level] ? 'manual' : 'automatic', sheets,
      purchasedAreaM2: count?.purchasedAreaM2 ?? null, settings: quantities.settings,
      sheetWeightKg: quantities.settingsProblem ? null : physical.sheetWeightKg, procurementWeightKg,
      layerProcurementWeightsKg: Object.fromEntries(physical.layers.map((l) => [l.layerId,
        procurementWeightKg === null || l.weightKg === null ? null : l.weightKg * sheets!])),
      status: sheets === null ? 'unavailable' : procurementWeightKg === null ? 'invalid-spec' : 'ok' };
  });
  return { ...quantities, levels, procurementWeightKg: levels.length && levels.every((l) => l.procurementWeightKg !== null)
    ? levels.reduce((sum, l) => sum + l.procurementWeightKg!, 0) : null };
}
