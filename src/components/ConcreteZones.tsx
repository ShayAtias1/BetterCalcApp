import type { ConcreteElement } from '../types/structural';
import { polygonCentroid } from '../lib/geometry';
import { labelDirection } from '../lib/textDirection';
import { CONCRETE_COLOR, concreteZoneLabel } from '../lib/structuralOverlay';
import { formatNumber, useLanguage, useT } from '../i18n';

export { CONCRETE_COLOR };

const HATCH_ID = 'bc-concrete-hatch';

/**
 * Concrete zones of the page on screen, as lightweight overlay shapes in native page pixels: a
 * hatched, dashed outline (rooms are plain tinted fills) with a one-line label — the mark, the
 * thickness or height once entered, and the grade when there is one. Purely visual: no pointer
 * events (selecting happens through the viewer's click handler, in the Concrete tab only) and no
 * embedded vertex handles; the viewer supplies shared direct geometry handles.
 */
export default function ConcreteZones({
  elements,
  selectedId,
  strokeW,
  zoom,
}: {
  elements: ConcreteElement[];
  selectedId: string | null;
  strokeW: number;
  zoom: number;
}) {
  const t = useT();
  const language = useLanguage();
  if (elements.length === 0) return null;

  return (
    <g className="concrete-zones" pointerEvents="none">
      <defs>
        <pattern id={HATCH_ID} width={7 / zoom} height={7 / zoom} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={7 / zoom} stroke={CONCRETE_COLOR} strokeWidth={1 / zoom} strokeOpacity={0.55} />
        </pattern>
      </defs>
      {elements.map((el) => {
        const selected = el.id === selectedId;
        const pts = el.points.map((p) => `${p.x},${p.y}`).join(' ');
        const c = polygonCentroid(el.points);
        const label = concreteZoneLabel(el, t, formatNumber);
        return (
          <g key={el.id}>
            <polygon points={pts} fill={CONCRETE_COLOR} fillOpacity={selected ? 0.22 : 0.1} stroke="none" />
            <polygon points={pts} fill={`url(#${HATCH_ID})`} stroke="none" />
            <polygon
              points={pts}
              fill="none"
              stroke={CONCRETE_COLOR}
              strokeWidth={selected ? strokeW * 1.6 : strokeW}
              strokeDasharray={selected ? undefined : `${6 / zoom} ${3 / zoom}`}
            />
            <text
              x={c.x}
              y={c.y}
              fontSize={10.5 / zoom}
              fill={CONCRETE_COLOR}
              fontWeight={600}
              textAnchor="middle"
              dominantBaseline="middle"
              direction={labelDirection(label, language)}
              paintOrder="stroke"
              stroke="#fff"
              strokeWidth={3 / zoom}
              strokeLinejoin="round"
            >
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
}
