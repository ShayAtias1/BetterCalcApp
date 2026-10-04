import type { RebarStirrup } from '../types/structural';
import { formatNumber, useT } from '../i18n';
import { useAppStore } from '../store/appStore';
import { resolveStirrupPlacement } from '../lib/stirrupPlacements';
import { round } from '../lib/geometry';
import { cmToMeters, metersToCm } from '../lib/structuralUnits';
import NumberField from './NumberField';
import Icon from './Icon';

export default function StirrupPlacements({ item }: { item: RebarStirrup }) {
  const t = useT();
  const plan = useAppStore((s) => s.project);
  const start = useAppStore((s) => s.startStirrupPlacement);
  const edit = useAppStore((s) => s.editStirrupPlacement);
  const remove = useAppStore((s) => s.deleteStirrupPlacement);
  const duplicate = useAppStore((s) => s.duplicateStirrupPlacement);
  const select = useAppStore((s) => s.selectStirrupPlacement);
  const selected = useAppStore((s) => s.selectedStirrupPlacementId);
  if (!plan) return null;
  return <section className="rebar-level">
    <span className="section-label">{t('rebar.stirrup.placements')}</span>
    <button className="btn-ghost small" onClick={() => start(item.id, 'line')}>{t('rebar.stirrup.addPlacement')} · {t('rebar.stirrup.line')}</button>
    <button className="btn-ghost small" onClick={() => start(item.id, 'area')}>{t('rebar.stirrup.addPlacement')} · {t('rebar.stirrup.area')}</button>
    {item.placements.map((placement, index) => {
      const result = resolveStirrupPlacement(placement, plan.pages);
      return <div className={`rebar-direction ${selected === placement.id ? 'active' : ''}`} key={placement.id}>
        <div className="rebar-direction-head">
          <button className="btn-ghost small" onClick={() => select(item.id, placement.id)}>{t(placement.kind === 'line' ? 'rebar.stirrup.line' : 'rebar.stirrup.area')} {index + 1} · {t('concrete.page', { page: placement.pageNumber })}</button>
          <button className="icon-btn" title={t('rebar.stirrup.duplicatePlacement')} aria-label={t('rebar.stirrup.duplicatePlacement')} onClick={() => duplicate(item.id, placement.id)}><Icon name="copy" /></button>
          <button className="icon-btn danger" title={t('rebar.stirrup.deletePlacement')} aria-label={t('rebar.stirrup.deletePlacement')} onClick={() => remove(item.id, placement.id)}><Icon name="trash" /></button>
        </div>
        {placement.kind === 'line' && <div className="form-row"><label>{t('rebar.stirrup.spacing')} ({t('units.cm')})</label>
          <NumberField value={metersToCm(placement.spacingM) ?? undefined} onChange={(v) => edit(item.id, { ...placement, spacingM: cmToMeters(v) ?? 0 }, true)} /></div>}
        {placement.kind === 'area' && <div className="form-grid">
          {(['spacingXM', 'spacingYM'] as const).map((axis) => <div className="form-row" key={axis}>
            <label>{t(axis === 'spacingXM' ? 'rebar.stirrup.spacingX' : 'rebar.stirrup.spacingY')} ({t('units.cm')})</label>
            <NumberField value={metersToCm(placement[axis]) ?? undefined} onChange={(v) => edit(item.id, { ...placement, [axis]: cmToMeters(v) ?? 0 }, true)} />
          </div>)}
        </div>}
        <label className="wi-check"><input type="checkbox" checked={placement.quantityMode === 'manual'} onChange={(e) => edit(item.id, { ...placement,
          quantityMode: e.target.checked ? 'manual' : 'automatic', manualQuantity: e.target.checked ? result.quantity ?? 0 : undefined })} />{t('rebar.stirrup.manualQuantity')}</label>
        {placement.quantityMode === 'manual' && <NumberField value={placement.manualQuantity} step="1" onChange={(v) => edit(item.id, { ...placement, manualQuantity: v ?? 0 }, true)} />}
        {placement.kind === 'area' && <p className="muted">{result.areaM2 === null ? '-' : formatNumber(round(result.areaM2, 2))} {t('units.m2')}{result.countX !== null ? ` · ${result.countX} × ${result.countY}` : ''}</p>}
        <p className="muted">{result.distributionLengthM === null ? '' : `${formatNumber(round(result.distributionLengthM, 2))} ${t('units.m')} · `}{t('rebar.stirrup.quantity')}: {result.quantity ?? '-'}</p>
        {result.status !== 'ok' && <p className="cal-missing">{t(result.status === 'no-scale' ? 'concrete.noScale' : 'rebar.invalidInput')}</p>}
      </div>;
    })}
  </section>;
}
