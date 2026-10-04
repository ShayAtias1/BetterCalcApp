import { FIELD_OPERATION_CANCEL } from '../lib/fieldLifecycle';
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import type { Point } from '../types';
import type { RebarStirrup, StirrupShape, StirrupTemplate } from '../types/structural';
import { formatNumber, useT } from '../i18n';
import { prepareStirrupShape, resizeStirrupSegment, stirrupTemplate } from '../lib/stirrupShape';
import { useAppStore } from '../store/appStore';
import { cmToMeters, metersToCm } from '../lib/structuralUnits';
import { round } from '../lib/geometry';
import NumberField from './NumberField';
import { moveCustomShapePoint, snapNewShapeEndpoint } from '../lib/stirrupShapeEditing';
import type { ShapeDrawingMode } from '../lib/stirrupShapeEditing';

export default function StirrupShapeBuilder({ item }: { item: RebarStirrup }) {
  const { touchInput, reviewOnly } = useWorkspaceLayout();
  const t = useT();
  const update = useAppStore((s) => s.updateRebarItem);
  const [touchEditing, setTouchEditing] = useState(false);
  const contacts = useRef(new Set<number>());
  const blocked = useRef(false);
  const suppressClick = useRef(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedSegment, selectSegment] = useState<number | null>(null);
  const [selectedPoint, selectPoint] = useState<number | null>(null);
  const [preview, setPreview] = useState<StirrupShape | null>(null);
  const [drawingMode, setDrawingMode] = useState<ShapeDrawingMode>('orthogonal');
  const [extension, setExtension] = useState<{
    index: number; shape: StirrupShape; end: Point | null;
    scale: number; minX: number; minY: number;
  } | null>(null);
  // Undo, another shape edit, or a template change abandons an uncommitted leg.
  useEffect(() => { setExtension(null); }, [item.shape]);
  const drag = useRef<{
    index: number; pointerId: number; origin: Point; shape: StirrupShape;
    next: StirrupShape; scale: number; minX: number; minY: number;
  } | null>(null);
  useEffect(() => {
    const cancel = () => {
      const old = drag.current; drag.current = null; setPreview(null); setExtension(null); setTouchEditing(false);
      contacts.current.clear(); blocked.current = false; suppressClick.current = Date.now() + 800;
      if (old && svgRef.current?.hasPointerCapture(old.pointerId)) svgRef.current.releasePointerCapture(old.pointerId);
    };
    window.addEventListener(FIELD_OPERATION_CANCEL, cancel);
    window.addEventListener('blur', cancel);
    const visibility = () => { if (document.hidden) cancel(); };
    document.addEventListener('visibilitychange', visibility);
    let previous = svgRef.current?.getBoundingClientRect();
    const observer = new ResizeObserver(() => {
      const next = svgRef.current?.getBoundingClientRect();
      if (previous && next && (previous.width !== next.width || previous.height !== next.height)) cancel();
      previous = next;
    });
    if (svgRef.current) observer.observe(svgRef.current);
    return () => { window.removeEventListener(FIELD_OPERATION_CANCEL, cancel); window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', visibility); observer.disconnect(); cancel(); };
  }, [item.id, item.shape, reviewOnly]);
  const shape = preview ?? item.shape;
  const prepared = prepareStirrupShape(shape);
  // Keep the preview frame fixed while moving or extending the shape.
  const frame = drag.current ?? extension;
  const normalize = (point: Point) => frame
    ? { x: 15 + (point.x - frame.minX) * frame.scale, y: 15 + (point.y - frame.minY) * frame.scale }
    : point;
  const model = frame ? { ...prepared,
    points: shape.points.map(normalize),
    segments: prepared.segments.map((segment) => ({ ...segment,
      normalizedStart: normalize(segment.start), normalizedEnd: normalize(segment.end) })),
  } : prepared;
  const set = (next: StirrupShape) => {
    if (reviewOnly) return;
    if (touchInput) useAppStore.getState().editStirrupShape(item.id, next);
    else update(item.id, { shape: next });
  };
  const custom = shape.template === 'custom';
  const chooseSegment = (index: number) => { selectSegment(index); selectPoint(null); };
  const semanticFields = shape.template === 'u'
    ? [{ key: 'leftLeg', segment: 0 }, { key: 'base', segment: 1 }, { key: 'rightLeg', segment: 2 }]
    : shape.template === 'l'
      ? [{ key: 'horizontalLeg', segment: 1 }, { key: 'verticalLeg', segment: 0 }]
      : [{ key: 'shapeWidth', segment: 1 }, { key: 'shapeHeight', segment: 0 }];
  const semanticSegment = (index: number) => shape.template === 'rectangle' ? index % 2 : index;
  const dimensionName = (index: number) => custom ? t('rebar.stirrup.segmentLength')
    : t(`rebar.stirrup.${semanticFields.find((field) => field.segment === semanticSegment(index))!.key}`);
  const editDimension = (segment: number, value: number | undefined) => {
    const lengthM = cmToMeters(value);
    if (!lengthM || !Number.isFinite(lengthM)) return;
    const lengths = prepared.segments.map((side) => side.lengthM);
    lengths[segment] = lengthM;
    if (shape.template === 'u') {
      const [left, base, right] = lengths;
      set({ ...shape, points: [{ x: 0, y: 0 }, { x: 0, y: left },
        { x: base, y: left }, { x: base, y: left - right }] });
    } else set(stirrupTemplate(shape.template, lengths[1], lengths[0]));
  };
  const pointerPosition = (event: PointerEvent<SVGElement> | MouseEvent<SVGElement>): Point | null => {
    const svg = event.currentTarget instanceof SVGSVGElement ? event.currentTarget : event.currentTarget.ownerSVGElement;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    return point.matrixTransform(matrix.inverse());
  };
  const startDrag = (event: PointerEvent<SVGCircleElement>, index: number) => {
    if (reviewOnly || (event.pointerType !== 'mouse' && !touchEditing) || blocked.current || !custom || extension || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    selectPoint(index); selectSegment(null);
    const origin = pointerPosition(event);
    if (!origin) return;
    const scale = 70 / Math.max(prepared.widthM, prepared.heightM, 0.01);
    drag.current = { index, pointerId: event.pointerId, origin, shape: item.shape, next: item.shape, scale,
      minX: Math.min(...item.shape.points.map((point) => point.x)),
      minY: Math.min(...item.shape.points.map((point) => point.y)) };
    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
    setPreview(item.shape);
  };
  const moveDrag = (event: PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId || blocked.current) return;
    const position = pointerPosition(event);
    if (!position) return;
    const original = active.shape.points[active.index];
    active.next = moveCustomShapePoint(active.shape, active.index, {
      x: original.x + (position.x - active.origin.x) / active.scale,
      y: original.y + (position.y - active.origin.y) / active.scale,
    }, drawingMode);
    setPreview(active.next);
  };
  const finishDrag = (event: PointerEvent<SVGSVGElement>, cancel = false) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (!cancel) moveDrag(event);
    drag.current = null; setPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancel && prepareStirrupShape(active.next).valid && active.next.points.some((point, index) =>
      point.x !== active.shape.points[index].x || point.y !== active.shape.points[index].y)) set(active.next);
  };
  const extensionEndpoint = (event: PointerEvent<SVGElement> | MouseEvent<SVGElement>) => {
    if (!extension || extension.shape !== item.shape || item.shape.closed) return null;
    const position = pointerPosition(event);
    if (!position) return null;
    const target = { x: extension.minX + (position.x - 15) / extension.scale,
      y: extension.minY + (position.y - 15) / extension.scale };
    return snapNewShapeEndpoint(extension.shape.points[extension.index], target, drawingMode);
  };
  const movePointer = (event: PointerEvent<SVGSVGElement>) => {
    if (!extension) return moveDrag(event);
    const end = extensionEndpoint(event);
    if (end) setExtension({ ...extension, end });
  };
  const placeSegment = (event: MouseEvent<SVGSVGElement>) => {
    if (Date.now() < suppressClick.current || blocked.current) { event.preventDefault(); event.stopPropagation(); return; }
    if (!extension) return;
    event.preventDefault(); event.stopPropagation();
    const end = extensionEndpoint(event);
    if (!end) { setExtension(null); return; }
    const points = extension.shape.points.map((point) => ({ ...point }));
    if (extension.index === 0) points.unshift(end);
    else points.push(end);
    const next = { ...extension.shape, points };
    if (!prepareStirrupShape(next).valid) return;
    set(next); selectPoint(extension.index === 0 ? 0 : points.length - 1);
    selectSegment(null); setExtension(null);
  };
  const selectedEndpoint = custom && !item.shape.closed && selectedPoint !== null
    && (selectedPoint === 0 || selectedPoint === item.shape.points.length - 1);
  const activeSegment = selectedSegment === null ? undefined : model.segments[selectedSegment];
  return <section className="rebar-level" onKeyDown={(event) => { if (event.key === 'Escape') setExtension(null); }}>
    <span className="section-label">{t('rebar.stirrup.shape')}</span>
    <select value={item.shape.template} onChange={(e) => {
      const template = e.target.value as StirrupTemplate;
      selectSegment(null); selectPoint(null);
      set(template === 'custom' ? { ...item.shape, template } : stirrupTemplate(template, model.widthM || 0.3, model.heightM || 0.5));
    }}>
      {(['rectangle', 'u', 'l', 'custom'] as const).map((template) => <option key={template} value={template} disabled={reviewOnly}>{t(`rebar.stirrup.templates.${template}`)}</option>)}
    </select>
    {touchInput && custom && !reviewOnly && <button className="btn-ghost" aria-pressed={touchEditing}
      onClick={() => { setTouchEditing(!touchEditing); drag.current = null; setPreview(null); setExtension(null); }}>{t(touchEditing ? 'adaptive.browse' : 'field.editShape')}</button>}
    <svg ref={svgRef} viewBox="0 0 110 110" width="100%" height="220" direction="ltr" aria-label={t('rebar.stirrup.shape')}
      style={{ touchAction: custom ? 'none' : 'auto', cursor: extension ? 'crosshair' : undefined }}
      onPointerDownCapture={(event) => {
        if (event.pointerType === 'mouse') return;
        contacts.current.add(event.pointerId);
        if (contacts.current.size > 1) {
          const old = drag.current; drag.current = null; setPreview(null); setExtension(null);
          blocked.current = true; suppressClick.current = Date.now() + 800;
          if (old && event.currentTarget.hasPointerCapture(old.pointerId)) event.currentTarget.releasePointerCapture(old.pointerId);
          event.preventDefault(); event.stopPropagation();
        }
      }}
      onPointerUpCapture={(event) => {
        contacts.current.delete(event.pointerId);
        if (blocked.current) {
          event.preventDefault(); event.stopPropagation(); suppressClick.current = Date.now() + 800;
          if (!contacts.current.size) blocked.current = false;
        }
      }}
      onLostPointerCapture={(event) => finishDrag(event, true)}
      onPointerMove={movePointer} onClickCapture={placeSegment}
      onPointerUp={(event) => finishDrag(event)} onPointerCancel={(event) => { finishDrag(event, true); contacts.current.delete(event.pointerId); setExtension(null); if (!contacts.current.size) blocked.current = false; suppressClick.current = Date.now() + 800; }}>
      {model.segments.map((segment) => {
        const selected = selectedSegment === segment.index;
        const color = selected ? '#c2410c' : selectedSegment !== null ? '#a8a29e' : '#c2410c';
        const midpoint = { x: (segment.normalizedStart.x + segment.normalizedEnd.x) / 2,
          y: (segment.normalizedStart.y + segment.normalizedEnd.y) / 2 };
        const vertical = Math.abs(segment.normalizedEnd.y - segment.normalizedStart.y) > Math.abs(segment.normalizedEnd.x - segment.normalizedStart.x);
        const labelX = midpoint.x + (vertical ? (midpoint.x < 50 ? -4 : 4) : 0);
        const labelY = midpoint.y + (vertical ? 0 : (midpoint.y < 50 ? -4 : 7));
        return <g key={segment.index} role="button" tabIndex={0}
          aria-label={`${dimensionName(segment.index)}: ${formatNumber(round(segment.lengthM * 100, 1))} ${t('units.cm')}`}
          aria-pressed={selected} style={{ cursor: 'pointer' }} onClick={() => chooseSegment(segment.index)}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseSegment(segment.index); } }}>
          <title>{dimensionName(segment.index)}</title>
          <line x1={segment.normalizedStart.x} y1={segment.normalizedStart.y}
            x2={segment.normalizedEnd.x} y2={segment.normalizedEnd.y} stroke="transparent" strokeWidth={touchInput ? 24 : 8} />
          <line x1={segment.normalizedStart.x} y1={segment.normalizedStart.y}
            x2={segment.normalizedEnd.x} y2={segment.normalizedEnd.y} stroke={color} strokeWidth={selected ? 2.5 : 1.5} />
          <text x={labelX} y={labelY} fontSize="5" fill={color}
            textAnchor={vertical ? (midpoint.x < 50 ? 'end' : 'start') : 'middle'} dominantBaseline="middle">
            {formatNumber(round(segment.lengthM * 100, 1))}
          </text>
        </g>;
      })}
      {extension?.end && <g pointerEvents="none">
        <line x1={normalize(extension.shape.points[extension.index]).x} y1={normalize(extension.shape.points[extension.index]).y}
          x2={normalize(extension.end).x} y2={normalize(extension.end).y} stroke="#c2410c" strokeWidth="2" strokeDasharray="3 2" />
        <circle cx={normalize(extension.end).x} cy={normalize(extension.end).y} r="2.5" fill="#fff7ed" stroke="#c2410c" />
      </g>}
      {custom && model.points.map((point, index) => <g key={index}>
        {touchInput && <circle cx={point.x} cy={point.y} r={12} fill="transparent"
          onPointerDown={(event) => startDrag(event, index)} onClick={(event) => { event.stopPropagation(); selectPoint(index); selectSegment(null); }} />}
        <circle cx={point.x} cy={point.y}
        r={!shape.closed && (index === 0 || index === shape.points.length - 1) ? 3.5 : 2.5}
        fill={selectedPoint === index ? '#c2410c' : '#fff'} stroke="#c2410c" role="button" tabIndex={0}
        aria-label={t(!shape.closed && (index === 0 || index === shape.points.length - 1) ? 'rebar.stirrup.endpoint' : 'rebar.stirrup.controlPoint')} aria-pressed={selectedPoint === index}
        style={{ cursor: 'grab' }} onPointerDown={(event) => startDrag(event, index)}
        onClick={(event) => { event.stopPropagation(); selectPoint(index); selectSegment(null); }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectPoint(index); selectSegment(null); } }} /></g>)}
      {touchInput && drag.current && preview && <g pointerEvents="none" stroke="#c2410c" fill="none">
        <circle cx={model.points[drag.current.index].x} cy={model.points[drag.current.index].y - 18} r={5} />
        <path d={`M${model.points[drag.current.index].x - 4},${model.points[drag.current.index].y}h8 M${model.points[drag.current.index].x},${model.points[drag.current.index].y - 4}v8`} />
      </g>}
    </svg>
    {!custom ? <div className="form-grid">
      {semanticFields.map((field) => <div className="form-row" key={field.key}
        style={selectedSegment !== null && semanticSegment(selectedSegment) === field.segment ? { background: '#fff7ed', borderRadius: 4 } : undefined}>
        <label>{t(`rebar.stirrup.${field.key}`)} ({t('units.cm')})</label>
        <NumberField value={metersToCm(prepared.segments[field.segment]?.lengthM) ?? undefined}
          onChange={(value) => editDimension(field.segment, value)} />
      </div>)}
    </div> : <>
      <div className="form-row">
        <label>{t('rebar.stirrup.drawingMode')}</label>
        <div className="inline-actions">
          {(['orthogonal', 'free'] as const).map((mode) => <button key={mode} className="btn-ghost small"
            aria-pressed={drawingMode === mode} style={drawingMode === mode ? { background: '#fff7ed', color: '#c2410c' } : undefined}
            onClick={() => {
              setDrawingMode(mode);
              if (extension?.end) setExtension({ ...extension,
                end: snapNewShapeEndpoint(extension.shape.points[extension.index], extension.end, mode) });
            }}>{t(`rebar.stirrup.${mode}`)}</button>)}
        </div>
      </div>
      {extension && <p className="muted">{t('rebar.stirrup.placeEndpoint')}</p>}
      {activeSegment && <div className="form-row">
        <label>{t('rebar.stirrup.segmentLength')} ({t('units.cm')})</label>
        <NumberField key={activeSegment.index} value={metersToCm(activeSegment.lengthM) ?? undefined}
          onChange={(value) => { if (value && Number.isFinite(value)) set(resizeStirrupSegment(item.shape, activeSegment.index, cmToMeters(value)!)); }} />
      </div>}
      <div className="inline-actions">
        {activeSegment && !extension && <button className="btn-ghost small" onClick={() => {
          const segment = activeSegment;
          if (!segment) return;
          const points = item.shape.points.map((point) => ({ ...point }));
          points.splice(segment.index + 1, 0, { x: (segment.start.x + segment.end.x) / 2, y: (segment.start.y + segment.end.y) / 2 });
          set({ ...item.shape, points }); selectPoint(segment.index + 1); selectSegment(null);
        }}>{t('rebar.stirrup.splitSegment')}</button>}
        {selectedEndpoint && !extension && <button className="btn-ghost small" onClick={() => {
          setExtension({ index: selectedPoint!, shape: item.shape, end: null,
            scale: 70 / Math.max(prepared.widthM, prepared.heightM, 0.01),
            minX: Math.min(...item.shape.points.map((point) => point.x)),
            minY: Math.min(...item.shape.points.map((point) => point.y)) });
        }}>{t('rebar.stirrup.addSegment')}</button>}
        {extension && <button className="btn-ghost small" onClick={() => setExtension(null)}>{t('rebar.stirrup.cancelSegment')}</button>}
        {!extension && selectedPoint !== null && selectedPoint < item.shape.points.length && <button className="btn-ghost small danger"
          disabled={item.shape.points.length <= (item.shape.closed ? 3 : 2)} onClick={() => {
            set({ ...item.shape, points: item.shape.points.filter((_, index) => index !== selectedPoint).map((point) => ({ ...point })) });
            selectPoint(null); selectSegment(null);
          }}>{t('rebar.stirrup.removePoint')}</button>}
      </div>
      <label className="wi-check"><input type="checkbox" checked={item.shape.closed} onChange={(e) => {
        setExtension(null); set({ ...item.shape, closed: e.target.checked }); selectSegment(null);
      }} />{t('rebar.stirrup.closed')}</label>
    </>}
    <p>{t('rebar.stirrup.geometricLength')}: {model.geometricLengthM === null ? '-' : formatNumber(round(model.geometricLengthM, 3))} {t('units.m')}</p>
    <label className="wi-check"><input type="checkbox" checked={item.lengthMode === 'manual'} onChange={(e) => update(item.id, {
      lengthMode: e.target.checked ? 'manual' : 'automatic', manualLengthM: e.target.checked ? model.geometricLengthM ?? undefined : undefined,
    })} />{t('rebar.stirrup.manualLength')}</label>
    {item.lengthMode === 'manual' && <div className="form-row"><label>{t('rebar.stirrup.lengthUsed')} ({t('units.m')})</label>
      <NumberField value={item.manualLengthM} onChange={(v) => update(item.id, { manualLengthM: v })} /></div>}
    <p>{t('rebar.stirrup.lengthUsed')}: {item.lengthMode === 'manual' ? item.manualLengthM ?? '-' : model.geometricLengthM ?? '-'} {t('units.m')}</p>
    <p className="muted">{t('rebar.stirrup.geometricHint')}</p>
  </section>;
}
