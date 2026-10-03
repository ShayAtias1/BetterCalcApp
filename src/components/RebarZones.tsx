import type { RebarItem, RebarMesh } from '../types/structural';
import { polygonCentroid } from '../lib/geometry';
import { labelDirection } from '../lib/textDirection';
import { markLabel } from '../lib/structuralMarks';
import { REBAR_COLOR, rebarZoneRows } from '../lib/structuralOverlay';
import { useLanguage, useT } from '../i18n';

export { REBAR_COLOR };

/**
 * Rebar mesh zones of the page on screen: a lightweight dotted outline with a faint tint and a
 * short label — the mark, then one line per reinforcement level (`Bottom: Ø12 @ 20 — 2 directions`,
 * or `Bottom: Long Ø12@20 | Short Ø10@15`). On a zone too small for that, the mark and a compact
 * B / T tag. Individual bars are never drawn. Purely visual and not interactive: selecting happens through the
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
  const t = useT();
  const language = useLanguage();
  const meshes = items.filter((i): i is RebarMesh => i.kind === 'mesh' && i.points.length >= 3);
  if (meshes.length === 0) return null;

  return (
    <g className="rebar-zones" pointerEvents="none">
      {meshes.map((m) => {
        const selected = m.id === selectedId;
        const pts = m.points.map((p) => `${p.x},${p.y}`).join(' ');
        const c = polygonCentroid(m.points);
        const mark = markLabel(m, t);
        const size = 10.5 / zoom;
        // A zone narrower than about 130 screen pixels cannot hold the full lines: show a B / T tag.
        const xs = m.points.map((p) => p.x);
        const widthPx = (Math.max(...xs) - Math.min(...xs)) * zoom;
        const compact = widthPx < 130;
        const rows = rebarZoneRows(m, t, compact);
        const lineH = size * 1.2;
        const top = c.y - ((rows.length - 1) * lineH) / 2;
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
            {/* The mark reads in its own direction (a typed mark is the user's text); the level lines read in the UI language. */}
            {rows.map((row, i) => (
              <text
                key={i}
                x={c.x}
                y={top + i * lineH}
                fontSize={i === 0 ? size : size * 0.92}
                fill={REBAR_COLOR}
                fontWeight={i === 0 ? 600 : 500}
                textAnchor="middle"
                dominantBaseline="middle"
                direction={i === 0 ? labelDirection(mark, language) : language === 'he' && !compact ? 'rtl' : 'ltr'}
                {...halo}
              >
                {row}
              </text>
            ))}
          </g>
        );
      })}
    </g>
  );
}
