/** V2C geometry only. Positions are zone-local metres; rotation is relative to V2A. */
import type { Point } from '../types';
import type { MeshSheetPlacement } from './meshSheetPlacement';
import type { RectangleLocalFrame } from './zoneGeometry';

export interface MeshPlacementOverride {
  placementId: string;
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
}
export type MeshPlacementOverrides = Record<string, MeshPlacementOverride>;

export function applyPlacementOverrides(automatic: readonly MeshSheetPlacement[], overrides: MeshPlacementOverrides): MeshSheetPlacement[] {
  return automatic.map((p) => {
    const override = overrides[p.id];
    if (!override) return p;
    const swapped = override.rotation === 90 || override.rotation === 270;
    return { ...p, x: override.x, y: override.y, width: swapped ? p.height : p.width, height: swapped ? p.width : p.height,
      rotationRadians: p.rotationRadians + override.rotation * Math.PI / 180 };
  });
}

export function localToPlan(point: Point, frame: RectangleLocalFrame, metersPerPixel: number): Point {
  return { x: frame.originPx.x + (frame.xAxis.x * point.x + frame.yAxis.x * point.y) / metersPerPixel,
    y: frame.originPx.y + (frame.xAxis.y * point.x + frame.yAxis.y * point.y) / metersPerPixel };
}
export function planToLocal(point: Point, frame: RectangleLocalFrame, metersPerPixel: number): Point {
  const x = point.x - frame.originPx.x, y = point.y - frame.originPx.y;
  return { x: (x * frame.xAxis.x + y * frame.xAxis.y) * metersPerPixel,
    y: (x * frame.yAxis.x + y * frame.yAxis.y) * metersPerPixel };
}
export function movePlacement(placement: MeshSheetPlacement, rotation: MeshPlacementOverride['rotation'], start: Point, current: Point): MeshPlacementOverride {
  return { placementId: placement.id, x: placement.x + current.x - start.x, y: placement.y + current.y - start.y, rotation };
}
export function rotatePlacement(placement: MeshSheetPlacement, rotation: MeshPlacementOverride['rotation'] = 0): MeshPlacementOverride {
  return { placementId: placement.id, x: placement.x + (placement.width - placement.height) / 2,
    y: placement.y + (placement.height - placement.width) / 2, rotation: ((rotation + 90) % 360) as MeshPlacementOverride['rotation'] };
}
