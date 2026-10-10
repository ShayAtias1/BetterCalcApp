/**
 * V2A derived mesh layout. Procurement alone chooses the orientation, grid and levels; this module
 * only gives those sheets physical rectangles. Pure, in metres, with no UI, store or saved state.
 */
import type { Calibration, Point } from '../types';
import type { RebarLevel, RebarMesh } from '../types/structural';
import { calculateMeshSheets, type MeshSheetsStatus, type SheetOrientation } from './meshSheets';
import { finitePositive, rectangleLocalFrame, type RectangleLocalFrame } from './zoneGeometry';

export interface MeshSheetPlacement {
  /** Deterministic identity within a mesh: mesh ID, level, zero-based row and column. */
  id: string;
  level: RebarLevel;
  row: number;
  column: number;
  /** Full physical bounds in zone-local metres, AFTER orientation. Never clipped to the zone. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Initial position for future interaction; independent of the current x/y fields. */
  defaultPosition: Point;
  orientation: SheetOrientation;
  /** Nominal sheet rotation in the local frame: 0 or π/2. Bounds above are already rotated. */
  rotationRadians: number;
  /** Nominal unrotated dimensions: X = configured length, Y = configured width, in metres. */
  physicalSheetWidth: number;
  physicalSheetHeight: number;
}

interface PlacementMetadata {
  zoneDimensions: { longM: number; shortM: number } | null;
  sheetDimensions: { lengthM: number; widthM: number } | null;
  overlapM: number | null;
  zoneAreaM2: number | null;
  fromOverride: boolean;
  settingsProblem: 'size' | 'overlap' | null;
}

export interface MeshSheetPlacementLayout extends PlacementMetadata {
  status: 'ok';
  zoneDimensions: { longM: number; shortM: number };
  sheetDimensions: { lengthM: number; widthM: number };
  overlapM: number;
  zoneAreaM2: number;
  orientation: SheetOrientation;
  /** Rows advance along local Y (short side); columns along local X (long side). */
  rows: number;
  columns: number;
  sheetsPerLevel: number;
  totalSheets: number;
  purchasedAreaM2: number;
  /** Only enabled levels have an array. Directions within a level never add arrays. */
  placementsByLevel: Partial<Record<RebarLevel, MeshSheetPlacement[]>>;
  /**
   * Pixel = originPx + (xAxis * localX + yAxis * localY) / metersPerPixel.
   * A Manual Size without scale still has a valid local layout; mapping needs BOTH fields.
   * An override on a non-rectangular/missing outline has no frame, so no pixel mapping is invented.
   */
  zoneFrame: RectangleLocalFrame | null;
  metersPerPixel: number | null;
}

export interface MeshSheetPlacementUnavailable extends PlacementMetadata {
  status: Exclude<MeshSheetsStatus, 'ok'> | 'layout-unavailable';
  /** Additional placement limits; ordinary invalid inputs keep procurement's status/problem. */
  reason: 'non-finite-geometry' | 'unsafe-sheet-count' | 'placement-limit' | null;
  orientation: null;
  rows: null;
  columns: null;
  sheetsPerLevel: null;
  totalSheets: null;
  purchasedAreaM2: null;
  placementsByLevel: null;
  zoneFrame: null;
  metersPerPixel: null;
}

export type MeshSheetPlacementResult = MeshSheetPlacementLayout | MeshSheetPlacementUnavailable;

/** Bound materialized arrays; extremely large grids return unavailable, never a truncated layout. */
export const MAX_MESH_LAYOUT_SHEETS = 100_000;

export function calculateMeshSheetPlacements(mesh: RebarMesh, calibration: Calibration | null): MeshSheetPlacementResult {
  const procurement = calculateMeshSheets(mesh, calibration);
  const { settings, sides, plan } = procurement;
  const sheetDimensions = finitePositive(settings.lengthM) !== null && finitePositive(settings.widthM) !== null
    ? { lengthM: settings.lengthM, widthM: settings.widthM } : null;
  const zoneDimensions = sides && finitePositive(sides.longM) !== null && finitePositive(sides.shortM) !== null ? { ...sides } : null;
  const overlapM = Number.isFinite(settings.overlapM) && settings.overlapM >= 0 ? settings.overlapM : null;
  const zoneAreaM2 = finitePositive(procurement.zoneAreaM2);
  const metadata = { sheetDimensions, zoneDimensions, overlapM, zoneAreaM2, fromOverride: !!mesh.sizeOverride, settingsProblem: procurement.settingsProblem };
  const unavailable = (status: MeshSheetPlacementUnavailable['status'], reason: MeshSheetPlacementUnavailable['reason'] = null): MeshSheetPlacementUnavailable => ({
    ...metadata, status, reason, orientation: null, rows: null, columns: null, sheetsPerLevel: null,
    totalSheets: null, purchasedAreaM2: null, placementsByLevel: null, zoneFrame: null, metersPerPixel: null,
  });
  if (procurement.status !== 'ok') return unavailable(procurement.status);
  if (!plan || !zoneDimensions || !sheetDimensions || overlapM === null || zoneAreaM2 === null || finitePositive(procurement.purchasedAreaM2) === null) {
    return unavailable('layout-unavailable', 'non-finite-geometry');
  }
  const chosen = plan.chosen;
  const counts = [chosen.countAlongLong, chosen.countAlongShort, chosen.sheets, procurement.totalSheets];
  if (!counts.every((n) => n !== null && Number.isSafeInteger(n) && n > 0)) return unavailable('layout-unavailable', 'unsafe-sheet-count');
  if (procurement.totalSheets! > MAX_MESH_LAYOUT_SHEETS) return unavailable('layout-unavailable', 'placement-limit');
  const columns = chosen.countAlongLong;
  const rows = chosen.countAlongShort;
  const stepX = chosen.alongLongM - overlapM;
  const stepY = chosen.alongShortM - overlapM;
  // Ensure full final bounds are representable before creating any placements.
  if (![stepX, stepY, (columns - 1) * stepX + chosen.alongLongM, (rows - 1) * stepY + chosen.alongShortM].every((n) => finitePositive(n) !== null)) {
    return unavailable('layout-unavailable', 'non-finite-geometry');
  }
  const placementsByLevel: MeshSheetPlacementLayout['placementsByLevel'] = {};
  for (const { level } of procurement.levels) {
    const placements: MeshSheetPlacement[] = [];
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const x = column * stepX;
        const y = row * stepY;
        placements.push({
          id: JSON.stringify([mesh.id, level, row, column]), level, row, column, x, y,
          width: chosen.alongLongM, height: chosen.alongShortM, defaultPosition: { x, y },
          orientation: chosen.orientation, rotationRadians: chosen.orientation === 'length-along-long' ? 0 : Math.PI / 2,
          physicalSheetWidth: sheetDimensions.lengthM, physicalSheetHeight: sheetDimensions.widthM,
        });
      }
    }
    placementsByLevel[level] = placements;
  }
  return {
    ...metadata, status: 'ok', zoneDimensions, sheetDimensions, overlapM, zoneAreaM2,
    orientation: chosen.orientation, rows, columns, sheetsPerLevel: chosen.sheets,
    totalSheets: procurement.totalSheets!, purchasedAreaM2: procurement.purchasedAreaM2!, placementsByLevel,
    zoneFrame: rectangleLocalFrame(mesh.points), metersPerPixel: finitePositive(calibration?.metersPerPixel),
  };
}
