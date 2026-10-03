/**
 * Mesh-sheet procurement: how many physical reinforcement sheets a mesh zone needs. An ADDITIONAL
 * result next to the rebar quantities (lib/rebar) — it never changes bar counts, lengths, weights or
 * waste, and overlap is not waste. Pure; no store, no drawing.
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
import type { MeshSheetSettings, RebarLevel, RebarMesh } from '../types/structural';
import { COUNT_EPSILON } from './rebar';
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
