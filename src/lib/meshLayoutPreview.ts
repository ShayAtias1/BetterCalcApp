/** V2B presentation geometry only: map V2A's full physical sheets into native plan pixels. */
import type { Calibration, Point } from '../types';
import type { RebarLevel, RebarMesh } from '../types/structural';
import { applyPlacementOverrides, localToPlan, type MeshPlacementOverrides } from './meshLayoutEditing';
import { calculateMeshSheetPlacements, type MeshSheetPlacementLayout } from './meshSheetPlacement';
import { calculateMeshSheets } from './meshSheets';
import { finitePositive, isRectangle, zoneGeometry } from './zoneGeometry';

/** Per visible level, not a procurement limit. Never truncate the proposed grid. */
export const MAX_MESH_PREVIEW_SHEETS = 500;
const MAX_LABELS = 200;

export interface MeshPreviewSheet {
  id: string;
  number: number;
  points: string;
  labelPosition: Point;
}
export interface MeshLayoutPreviewReady {
  status: 'ready';
  automatic: MeshSheetPlacementLayout;
  /** Compact geometry signature, so old overrides cannot attach to a changed proposed grid. */
  sourceKey: string;
  levels: RebarLevel[];
  sheetsByLevel: Partial<Record<RebarLevel, MeshPreviewSheet[]>>;
  /** Native-pixel space between labels; used with zoom to avoid unreadable labels. */
  labelSpacingPx: number;
}
export type MeshLayoutPreview = MeshLayoutPreviewReady | {
  status: 'not-rectangular' | 'no-plan-geometry' | 'too-large' | 'unavailable';
};

/** Select a viewing level, falling back when an edit removes the formerly viewed level. */
export function meshLayoutViewLevel(levels: readonly RebarLevel[], preferred: RebarLevel): RebarLevel | null {
  return levels.includes(preferred) ? preferred : levels[0] ?? null;
}

export function meshPreviewLabelsVisible(preview: MeshLayoutPreviewReady, level: RebarLevel, zoom: number): boolean {
  return (preview.sheetsByLevel[level]?.length ?? 0) <= MAX_LABELS && preview.labelSpacingPx * zoom >= 36;
}

export function prepareMeshLayoutPreview(mesh: RebarMesh, calibration: Calibration | null): MeshLayoutPreview {
  if (!isRectangle(mesh.points)) return { status: mesh.sizeOverride ? 'no-plan-geometry' : 'not-rectangular' };
  // Manual Size can calculate procurement, but never supplies a fictitious page scale or outline.
  const scale = finitePositive(calibration?.metersPerPixel);
  const drawn = zoneGeometry(mesh.points, scale ?? 0);
  if (!drawn?.sides || finitePositive(drawn.sides.longM) === null || finitePositive(drawn.sides.shortM) === null || scale === null) {
    return { status: 'no-plan-geometry' };
  }
  // Check procurement's grid before V2A materializes arrays. This is a rendering limit only.
  const procurement = calculateMeshSheets(mesh, calibration);
  if (procurement.status !== 'ok' || !procurement.plan) return { status: 'unavailable' };
  if (procurement.plan.chosen.sheets > MAX_MESH_PREVIEW_SHEETS) return { status: 'too-large' };
  const layout = calculateMeshSheetPlacements(mesh, calibration);
  if (layout.status !== 'ok') return { status: 'unavailable' };
  const { zoneFrame: frame, metersPerPixel } = layout;
  if (!frame || metersPerPixel === null) return { status: 'no-plan-geometry' };
  return renderMeshLayoutPreview(layout);
}

/** Render the automatic source plus session overrides, without changing V2A. */
export function renderMeshLayoutPreview(layout: MeshSheetPlacementLayout, overrides: Partial<Record<RebarLevel, MeshPlacementOverrides>> = {}): MeshLayoutPreview {
  const frame = layout.zoneFrame;
  const metersPerPixel = layout.metersPerPixel;
  if (!frame || metersPerPixel === null) return { status: 'no-plan-geometry' };
  const mapPoint = (x: number, y: number): Point => localToPlan({ x, y }, frame, metersPerPixel);
  const sheetsByLevel: MeshLayoutPreviewReady['sheetsByLevel'] = {};
  const levels = Object.keys(layout.placementsByLevel) as RebarLevel[];
  for (const level of levels) {
    sheetsByLevel[level] = applyPlacementOverrides(layout.placementsByLevel[level]!, overrides[level] ?? {}).map((p, index) => {
      const corners = [mapPoint(p.x, p.y), mapPoint(p.x + p.width, p.y), mapPoint(p.x + p.width, p.y + p.height), mapPoint(p.x, p.y + p.height)];
      const inset = Math.min(p.width, p.height) * 0.18;
      // Keep identifiers away from the zone's central mark/specification label when possible.
      const candidates = [
        { x: p.x + inset, y: p.y + inset }, { x: p.x + p.width - inset, y: p.y + inset },
        { x: p.x + inset, y: p.y + p.height - inset }, { x: p.x + p.width - inset, y: p.y + p.height - inset },
      ];
      const distanceFromMark = (c: Point) => Math.hypot(c.x - layout.zoneDimensions.longM / 2, c.y - layout.zoneDimensions.shortM / 2);
      const label = candidates.reduce((best, c) => distanceFromMark(c) > distanceFromMark(best) ? c : best);
      return { id: p.id, number: index + 1, points: corners.map((c) => `${c.x},${c.y}`).join(' '), labelPosition: mapPoint(label.x, label.y) };
    });
  }
  const first = layout.placementsByLevel[levels[0]]![0];
  const labelSpacingPx = Math.min(layout.columns > 1 ? first.width - layout.overlapM : first.width, layout.rows > 1 ? first.height - layout.overlapM : first.height) / metersPerPixel;
  // Extremely small scales can overflow pixel mapping even when local geometry is valid.
  if (!Number.isFinite(labelSpacingPx) || Object.values(sheetsByLevel).flat().some((s) => !Number.isFinite(s.labelPosition.x) || !Number.isFinite(s.labelPosition.y) || /NaN|Infinity/.test(s.points))) {
    return { status: 'no-plan-geometry' };
  }
  const sourceKey = JSON.stringify([frame, metersPerPixel, layout.zoneDimensions, layout.sheetDimensions,
    layout.overlapM, layout.orientation, layout.rows, layout.columns, levels.map((level) => layout.placementsByLevel[level]![0].id)]);
  return { status: 'ready', automatic: layout, sourceKey, levels, sheetsByLevel, labelSpacingPx };
}
