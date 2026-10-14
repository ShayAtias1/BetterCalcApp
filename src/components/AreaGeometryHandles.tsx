import type { MouseEvent } from 'react';
import type { Point } from '../types';
import { isRectangle } from '../lib/zoneGeometry';

/** Same white-filled selection handles as room vertices, at a constant screen size. */
export default function AreaGeometryHandles({ points, color, zoom, touch = false, polygon = false, onHandleMouseDown }: { points: Point[]; color: string; zoom: number; touch?: boolean; polygon?: boolean; onHandleMouseDown?: (index: number, event: MouseEvent<SVGCircleElement>) => void }) {
  const rectangular = !polygon && isRectangle(points);
  return <g className="area-geometry-handles">
    {points.map((point, index) => <g key={index}>
      {touch && <circle cx={point.x} cy={point.y} r={24 / zoom} fill="transparent" pointerEvents="auto" data-geometry-hit={index} onMouseDown={onHandleMouseDown ? (event) => onHandleMouseDown(index, event) : undefined} />}
      <circle cx={point.x} cy={point.y} r={5 / zoom}
      onMouseDown={onHandleMouseDown ? (event) => onHandleMouseDown(index, event) : undefined}
      pointerEvents="all" fill="#fff" stroke={color} strokeWidth={2 / zoom} style={{ cursor: rectangular ? 'nwse-resize' : 'move' }} /></g>)}
  </g>;
}
