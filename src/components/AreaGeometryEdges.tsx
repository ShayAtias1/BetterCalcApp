import type { MouseEvent } from 'react';
import type { Point } from '../types';

/** Shared Takeoff edge targets: click + or double-click an edge to insert a vertex. */
export default function AreaGeometryEdges({ points, color, zoom, onInsert }: {
  points: Point[]; color: string; zoom: number;
  onInsert?: (index: number, event: MouseEvent<SVGElement>, midpoint: boolean) => void;
}) {
  return <g className="area-geometry-edges">
    {points.map((a, index) => {
      const b = points[(index + 1) % points.length];
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      return <g key={index} className="area-geometry-edge">
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
        stroke="transparent" strokeWidth={12 / zoom} pointerEvents="stroke" data-polygon-edge={index}
        style={{ cursor: 'copy' }} onMouseDown={onInsert ? e => e.stopPropagation() : undefined}
        onDoubleClick={onInsert ? e => onInsert(index, e, false) : undefined} />
        <g className="area-geometry-add">
        <circle cx={x} cy={y} r={5 / zoom} fill="#fff" stroke={color} strokeWidth={1.5 / zoom}
          pointerEvents="all" data-suggestion-edge={index} style={{ cursor: 'copy' }}
          onMouseDown={onInsert ? e => onInsert(index, e, true) : undefined}>
          <title>Add vertex on edge</title>
        </circle>
        <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={10 / zoom} fill={color} pointerEvents="none">+</text>
        </g>
      </g>;
    })}
  </g>;
}
