import type { RebarItem, RebarMesh } from '../types/structural';
import { polygonCentroid } from '../lib/geometry';
import { rebarNotation } from '../lib/rebar';
import { labelDirection } from '../lib/textDirection';
import { useLanguage } from '../i18n';

/** One colour for every rebar zone: a rust orange, apart from the room and concrete colours. */
export const REBAR_COLOR = '#c2410c';

/**
 * Rebar mesh zones of the page on screen: a lightweight dotted outline with a faint tint and a
 * two-line label — the mark, and the layers in notation (`Ø12 @ 200`, two layers as `… / …`).
 * Individual bars are never drawn. Purely visual and not interactive: selecting happens through the
 * viewer's click handler, in the Rebar tab only. Manual bars have no shape, so no overlay.
 */
export default function RebarZones({
  items,
  selectedId,
  strokeW,
  zoom,
}: {
  items: RebarItem[];
  selectedId: string | null;
  strokeW: number;
  zoom: number;
}) {
  const language = useLanguage();
  const meshes = items.filter((i): i is RebarMesh => i.kind === 'mesh' && i.points.length >= 3);
  if (meshes.length === 0) return null;

  return (
    <g className="rebar-zones" pointerEvents="none">
      {meshes.map((m) => {
        const selected = m.id === selectedId;
        const pts = m.points.map((p) => `${p.x},${p.y}`).join(' ');
        const c = polygonCentroid(m.points);
        const notation = rebarNotation(m.layers);
        const size = 10.5 / zoom;
        const halo = { paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 / zoom, strokeLinejoin: 'round' as const };
        return (
          <g key={m.id}>
            <polygon points={pts} fill={REBAR_COLOR} fillOpacity={selected ? 0.18 : 0.07} stroke="none" />
            <polygon
              points={pts}
              fill="none"
              stroke={REBAR_COLOR}
              strokeWidth={selected ? strokeW * 1.6 : strokeW}
              strokeDasharray={selected ? undefined : `${1.5 / zoom} ${3.5 / zoom}`}
              strokeLinecap="round"
            />
            {/* The mark is the user's text and reads in its own direction; the notation is always left-to-right. */}
            <text x={c.x} y={notation ? c.y - size * 0.6 : c.y} fontSize={size} fill={REBAR_COLOR} fontWeight={600} textAnchor="middle" dominantBaseline="middle" direction={labelDirection(m.mark, language)} {...halo}>
              {m.mark}
            </text>
            {notation && (
              <text x={c.x} y={c.y + size * 0.75} fontSize={size * 0.95} fill={REBAR_COLOR} textAnchor="middle" dominantBaseline="middle" direction="ltr" {...halo}>
                {notation}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
