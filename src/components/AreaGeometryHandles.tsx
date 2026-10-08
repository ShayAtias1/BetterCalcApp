import type { Point } from '../types';
import { isRectangle } from '../lib/zoneGeometry';

/** Same white-filled selection handles as room vertices, at a constant screen size. */
export default function AreaGeometryHandles({ points, color, zoom, touch = false, polygon = false }: { points: Point[]; color: string; zoom: number; touch?: boolean; polygon?: boolean }) {
  const rectangular = !polygon && isRectangle(points);
  return <g className="area-geometry-handles">
    {points.map((point, index) => <g key={index}>
      {touch && <circle cx={point.x} cy={point.y} r={24 / zoom} fill="transparent" pointerEvents="auto" data-geometry-hit={index} />}
      <circle cx={point.x} cy={point.y} r={5 / zoom}
      pointerEvents="all" fill="#fff" stroke={color} strokeWidth={2 / zoom} style={{ cursor: rectangular ? 'nwse-resize' : 'move' }} /></g>)}
  </g>;
}
