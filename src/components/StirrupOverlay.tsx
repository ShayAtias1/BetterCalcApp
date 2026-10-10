import { memo } from 'react';
import type { RebarStirrup, StirrupPlacement } from '../types/structural';
import type { Plan } from '../types';
import { rebarOf } from '../lib/structuralPlan';
import { prepareStirrupPlacement } from '../lib/stirrupPlacements';
import { formatNumber, useLanguage, useT } from '../i18n';
import { REBAR_COLOR } from '../lib/structuralOverlay';
import { labelDirection } from '../lib/textDirection';

export default function StirrupOverlay({ plan, pageNumber, selectedItemId, selectedPlacementId, zoom }: {
  plan: Plan; pageNumber: number; selectedItemId: string | null; selectedPlacementId: string | null; zoom: number;
}) {
  return <g pointerEvents="none">
    {rebarOf(plan).flatMap((item) => item.kind !== 'stirrup' ? [] : item.placements.filter((p) => p.pageNumber === pageNumber).map((placement) => {
      return <PlacementOverlay key={`${item.id}|${placement.id}`} item={item} placement={placement} pages={plan.pages}
        selected={item.id === selectedItemId && placement.id === selectedPlacementId} zoom={zoom} />;
    }))}
  </g>;
}

// Pan and another item's preview keep this placement's geometry/model intact.
const PlacementOverlay = memo(function PlacementOverlay({ item, placement, pages, selected, zoom }: {
  item: RebarStirrup; placement: StirrupPlacement; pages: Plan['pages']; selected: boolean; zoom: number;
}) {
  const t = useT(), language = useLanguage();
      const model = prepareStirrupPlacement(item, placement, pages, t, formatNumber, zoom);
      return <g>
        {placement.kind === 'area' && <polygon points={placement.points.map((p) => `${p.x},${p.y}`).join(' ')} fill={REBAR_COLOR} fillOpacity={0.03} stroke={REBAR_COLOR} strokeWidth={(selected ? 2.5 : 1.5) / zoom} strokeDasharray={`${3 / zoom} ${3 / zoom}`} />}
        {placement.kind === 'line' && <line x1={placement.start.x} y1={placement.start.y} x2={placement.end.x} y2={placement.end.y} stroke={REBAR_COLOR} strokeWidth={(selected ? 3 : 1.5) / zoom} />}
        {model.anchors.map((anchor, index) => model.glyphs ? <g key={index} transform={`translate(${anchor.x - 6 / zoom} ${anchor.y - 6 / zoom}) scale(${0.12 / zoom})`}>
          {model.shape.segments.map((segment) => <line key={segment.index} x1={segment.normalizedStart.x} y1={segment.normalizedStart.y} x2={segment.normalizedEnd.x} y2={segment.normalizedEnd.y} stroke={REBAR_COLOR} strokeWidth="8" />)}
        </g> : <circle key={index} cx={anchor.x} cy={anchor.y} r={2 / zoom} fill={REBAR_COLOR} />)}
        {selected && placement.kind === 'line' && [placement.start, placement.end].map((p, index) => <circle key={index} cx={p.x} cy={p.y} r={5 / zoom} fill="#fff" stroke={REBAR_COLOR} strokeWidth={2 / zoom} />)}
        <text x={model.center.x} y={model.center.y - 12 / zoom} fontSize={10.5 / zoom} fill={REBAR_COLOR} textAnchor="middle" direction={labelDirection(model.label, language)} paintOrder="stroke" stroke="#fff" strokeWidth={3 / zoom}>{model.label}</text>
      </g>;
});
