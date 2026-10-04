import type { RebarStirrup, StirrupTemplate } from '../types/structural';
import { formatNumber, useT } from '../i18n';
import { prepareStirrupShape, resizeStirrupSegment, stirrupTemplate } from '../lib/stirrupShape';
import { useAppStore } from '../store/appStore';
import { cmToMeters, metersToCm } from '../lib/structuralUnits';
import { round } from '../lib/geometry';
import NumberField from './NumberField';

export default function StirrupShapeBuilder({ item }: { item: RebarStirrup }) {
  const t = useT();
  const update = useAppStore((s) => s.updateRebarItem);
  const model = prepareStirrupShape(item.shape);
  const set = (shape: RebarStirrup['shape']) => update(item.id, { shape });
  return <section className="rebar-level">
    <span className="section-label">{t('rebar.stirrup.shape')}</span>
    <select value={item.shape.template} onChange={(e) => {
      const template = e.target.value as StirrupTemplate;
      set(template === 'custom' ? { ...item.shape, template } : stirrupTemplate(template, model.widthM || 0.3, model.heightM || 0.5));
    }}>
      {(['rectangle', 'u', 'l', 'custom'] as const).map((template) => <option key={template} value={template}>{t(`rebar.stirrup.templates.${template}`)}</option>)}
    </select>
    <svg viewBox="0 0 110 110" width="100%" height="180" direction="ltr" aria-label={t('rebar.stirrup.shape')}>
      <polyline points={model.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#c2410c" strokeWidth="1.5" />
      {model.closed && model.points.length > 2 && <line x1={model.points.at(-1)!.x} y1={model.points.at(-1)!.y} x2={model.points[0].x} y2={model.points[0].y} stroke="#c2410c" strokeWidth="1.5" />}
      {model.segments.map((segment) => <text key={segment.index} x={(segment.normalizedStart.x + segment.normalizedEnd.x) / 2 + 3}
        y={(segment.normalizedStart.y + segment.normalizedEnd.y) / 2 - 3} fontSize="5" fill="#78716c">{formatNumber(round(segment.lengthM * 100, 1))}</text>)}
      {model.points.map((p, index) => <circle key={index} cx={p.x} cy={p.y} r="2" fill="#fff" stroke="#c2410c" />)}
    </svg>
    {item.shape.template !== 'custom' ? <div className="form-grid">
      {(['widthM', 'heightM'] as const).map((field) => <div className="form-row" key={field}>
        <label>{t(field === 'widthM' ? 'concrete.width' : 'concrete.height')} ({t('units.cm')})</label>
        <NumberField value={metersToCm(model[field]) ?? undefined} onChange={(v) => set(stirrupTemplate(item.shape.template,
          field === 'widthM' ? cmToMeters(v) ?? 0 : model.widthM, field === 'heightM' ? cmToMeters(v) ?? 0 : model.heightM))} />
      </div>)}
    </div> : <>
      <label className="wi-check"><input type="checkbox" checked={item.shape.closed} onChange={(e) => set({ ...item.shape, closed: e.target.checked })} />{t('rebar.stirrup.closed')}</label>
      {item.shape.points.map((point, index) => <div key={index} className="form-grid">
        <span>{t('rebar.stirrup.vertex', { number: index + 1 })}</span>
        {(['x', 'y'] as const).map((axis) => <label key={axis}>{axis.toUpperCase()} ({t('units.cm')})
          <input type="number" step="1" value={round(point[axis] * 100, 4)} onChange={(e) => {
            const value = Number(e.target.value); if (!Number.isFinite(value)) return;
            set({ ...item.shape, points: item.shape.points.map((p, i) => i === index ? { ...p, [axis]: value / 100 } : { ...p }) });
          }} /></label>)}
        <button className="btn-ghost small danger" disabled={item.shape.points.length <= (item.shape.closed ? 3 : 2)} onClick={() => set({ ...item.shape, points: item.shape.points.filter((_, i) => i !== index) })}>{t('rebar.stirrup.removeVertex')}</button>
      </div>)}
      <button className="btn-ghost small" onClick={() => { const last = item.shape.points.at(-1) ?? { x: 0, y: 0 }; set({ ...item.shape, points: [...item.shape.points, { x: last.x + 0.1, y: last.y }] }); }}>{t('rebar.stirrup.addVertex')}</button>
      {model.segments.map((segment) => <div className="form-row" key={segment.index}>
        <label>{t('rebar.stirrup.segment', { number: segment.index + 1 })} ({t('units.cm')})</label>
        <NumberField value={metersToCm(segment.lengthM) ?? undefined} onChange={(v) => { if (v) set(resizeStirrupSegment(item.shape, segment.index, cmToMeters(v)!)); }} />
      </div>)}
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
