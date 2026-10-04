import type { Point } from '../types';
import { isRectangle } from '../lib/zoneGeometry';

/** Same white-filled selection handles as room vertices, at a constant screen size. */
export default function AreaGeometryHandles({ points, color, zoom }: { points: Point[]; color: string; zoom: number }) {
  const rectangular = isRectangle(points);
  return <g className="area-geometry-handles">
    {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={5 / zoom}
      fill="#fff" stroke={color} strokeWidth={2 / zoom} style={{ cursor: rectangular ? 'nwse-resize' : 'move' }} />)}
  </g>;
}
