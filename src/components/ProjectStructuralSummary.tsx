import { formatNumber, useT } from '../i18n';
import type { ProjectStructural, RebarBasis } from '../lib/structuralQuantities';
import { round } from '../lib/geometry';
import Icon from './Icon';

const num = (v: number, basis: RebarBasis | null, decimals: number) => `${basis === 'estimated' ? '≈ ' : ''}${formatNumber(round(v, decimals))}`;

/**
 * The project's concrete and rebar totals across all its plans — compact, totals only. The detailed
 * schedules (every element, layer and bars row) are in the Excel and PDF exports. Estimates are marked
 * with ≈ and a note, and items that cannot be calculated are counted, never added as zero.
 */
export default function ProjectStructuralSummary({ structural }: { structural: ProjectStructural }) {
  const t = useT();
  const { concrete, rebar } = structural;
  if (!concrete && !rebar) return null;
  const noGrade = t('concrete.summary.noGrade');
  const lm = t('units.lm');
  const kg = t('units.kg');

  return (
    <div className="home-panel project-structural">
      <div className="home-panel-text">
        <h2>{t('projectOverview.structural.title')}</h2>
        <p className="muted">{t('projectOverview.structural.intro')}</p>
      </div>

      {concrete && (
        <div className="concrete-summary project-structural-block">
          <span className="section-label">
            {t('projectOverview.structural.concrete')} ({t('units.m3')})
          </span>
          <div className="concrete-summary-grid concrete-summary-head" aria-hidden="true">
            <span />
            <span>{t('projectOverview.structural.elements')}</span>
            <span>{t('projectOverview.structural.net')}</span>
            <span>{t('projectOverview.structural.order')}</span>
          </div>
          {concrete.rows.map((r) => {
            const calculable = r.elementCount > r.missingCount;
            return (
              <div className="concrete-summary-grid" key={`${r.kind}|${r.grade}`}>
                <span className="concrete-summary-label">
                  {t(`concrete.kinds.${r.kind}`)} · {r.grade ? <span dir="auto">{r.grade}</span> : <span className="muted">{noGrade}</span>}
                </span>
                <span>{r.elementCount}</span>
                <span>{calculable ? formatNumber(r.volumeM3) : '—'}</span>
                <span>{calculable ? formatNumber(r.orderM3) : '—'}</span>
              </div>
            );
          })}
          <div className="concrete-summary-grid concrete-summary-total">
            <span>{t('exports.common.grandTotal')}</span>
            <span>{concrete.elementCount}</span>
            <span>{formatNumber(concrete.volumeM3)}</span>
            <span>{formatNumber(concrete.orderM3)}</span>
          </div>
          {concrete.missingCount > 0 && (
            <div className="concrete-summary-missing">
              <Icon name="alert" size={12} />
              {t('exports.structural.missing', { count: concrete.missingCount })}
            </div>
          )}
        </div>
      )}

      {rebar && (
        <div className="concrete-summary rebar-summary project-structural-block">
          <span className="section-label">{t('projectOverview.structural.rebar')}</span>
          <div className="rebar-summary-grid concrete-summary-head" aria-hidden="true">
            <span />
            <span>
              {t('rebar.summary.lengthNet')}
              <small>{lm}</small>
            </span>
            <span>
              {t('rebar.summary.weightNet')}
              <small>{kg}</small>
            </span>
            <span>
              {t('rebar.summary.lengthOrder')}
              <small>{lm}</small>
            </span>
            <span>
              {t('rebar.summary.weightOrder')}
              <small>{kg}</small>
            </span>
          </div>
          {rebar.rows.map((r) => (
            <div key={r.diameterMm}>
              <div className="rebar-summary-grid">
                <span className="concrete-summary-label" dir="ltr">{`Ø${r.diameterMm}`}</span>
                <span>{num(r.lengthM, r.basis, 1)}</span>
                <span>{num(r.weightKg, r.basis, 1)}</span>
                <span>{num(r.orderLengthM, r.basis, 1)}</span>
                <span>{num(r.orderWeightKg, r.basis, 1)}</span>
              </div>
              {r.basis !== 'exact' && (
                <div className="rebar-summary-note">
                  <Icon name="alert" size={12} />
                  {r.basis === 'estimated'
                    ? t('rebar.summary.estimateOnly')
                    : t('exports.structural.estimateNote', { length: `${formatNumber(round(r.estimatedLengthM, 1))} ${lm}`, weight: `${formatNumber(round(r.estimatedWeightKg, 1))} ${kg}` })}
                </div>
              )}
            </div>
          ))}
          <div className="rebar-summary-grid concrete-summary-total">
            <span>{t('exports.common.grandTotal')}</span>
            <span>{num(rebar.lengthM, rebar.basis, 1)}</span>
            <span>{num(rebar.weightKg, rebar.basis, 1)}</span>
            <span>{num(rebar.orderLengthM, rebar.basis, 1)}</span>
            <span>{num(rebar.orderWeightKg, rebar.basis, 1)}</span>
          </div>
          {rebar.basis === 'mixed' && (
            <div className="rebar-summary-note">
              <Icon name="alert" size={12} />
              {t('exports.structural.estimateNote', { length: `${formatNumber(round(rebar.estimatedLengthM, 1))} ${lm}`, weight: `${formatNumber(round(rebar.estimatedWeightKg, 1))} ${kg}` })}
            </div>
          )}
          {rebar.orderWeightKg >= 1000 && <p className="muted rebar-summary-tonnes">{t('rebar.summary.tonnes', { weight: formatNumber(round(rebar.orderWeightKg / 1000, 2)) })}</p>}
          {rebar.missingItemCount > 0 && (
            <div className="concrete-summary-missing">
              <Icon name="alert" size={12} />
              {t('exports.structural.missing', { count: rebar.missingItemCount })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
