import { useMemo } from 'react';
import { formatNumber, useT } from '../i18n';
import type { Plan } from '../types';
import { buildRebarSummary, type RebarBasis, type RebarSummaryRow } from '../lib/structuralQuantities';
import { round } from '../lib/geometry';
import Icon from './Icon';

type T = ReturnType<typeof useT>;

/** An estimate is shown with "≈" so it can never be read as an exact count; mixed rows say so on their own line. */
const num = (v: number | null, basis: RebarBasis | null, decimals: number) => basis === null || v === null ? '-' : `${basis === 'estimated' ? '≈ ' : ''}${formatNumber(round(v, decimals))}`;

function RowNote({ row, t }: { row: Pick<RebarSummaryRow, 'basis' | 'estimatedLengthM' | 'estimatedWeightKg'>; t: T }) {
  if (row.basis === 'exact') return null;
  return (
    <div className="rebar-summary-note">
      <Icon name="alert" size={12} />
      {row.basis === 'estimated'
        ? t('rebar.summary.estimateOnly')
        : t('rebar.summary.includesEstimate', { length: `${formatNumber(round(row.estimatedLengthM, 1))} ${t('units.lm')}`, weight: `${formatNumber(round(row.estimatedWeightKg, 1))} ${t('units.kg')}` })}
    </div>
  );
}

/**
 * The plan's rebar quantities in the Rebar tab, by page and diameter, mesh layers and manual bars
 * alike. Estimates are marked (≈ and a note), and items that cannot be calculated are counted
 * separately — they are in no row and in no total.
 */
export default function RebarSummary({ plan }: { plan: Plan }) {
  const t = useT();
  const summary = useMemo(() => buildRebarSummary(plan), [plan]);
  if (summary.itemCount === 0) return null;

  const head = (label: string, unit: string) => (
    <span>
      {label}
      <small>{unit}</small>
    </span>
  );
  const lm = t('units.lm');
  const kg = t('units.kg');

  return (
    <div className="concrete-summary rebar-summary">
      <span className="section-label">{t('rebar.summary.title')}</span>
      <div className="rebar-summary-grid concrete-summary-head" aria-hidden="true">
        <span />
        {head(t('rebar.summary.lengthNet'), lm)}
        {head(t('rebar.summary.weightNet'), kg)}
        {head(t('rebar.summary.lengthOrder'), lm)}
        {head(t('rebar.summary.weightOrder'), kg)}
      </div>

      {summary.pages.map((page) => (
        <div key={page.pageNumber} className="concrete-summary-page">
          <div className="concrete-summary-page-title">{t('concrete.page', { page: page.pageNumber })}</div>
          {page.rows.map((r) => (
            <div key={r.diameterMm}>
              <div className="rebar-summary-grid">
                <span className="concrete-summary-label" dir="ltr">{`Ø${r.diameterMm}`}</span>
                <span>{num(r.lengthM, r.basis, 1)}</span>
                <span>{num(r.weightKg, r.basis, 1)}</span>
                <span>{num(r.orderLengthM, r.basis, 1)}</span>
                <span>{num(r.orderWeightKg, r.basis === null ? null : 'exact', 1)}</span>
              </div>
              <RowNote row={r} t={t} />
            </div>
          ))}
          {page.missingItemCount > 0 && (
            <div className="concrete-summary-missing">
              <Icon name="alert" size={12} />
              {t('rebar.summary.missing', { count: page.missingItemCount })}
              {page.incompleteSpecCount > 0 && ` · ${t('rebar.summary.incompleteSpecs', { count: page.incompleteSpecCount })}`}
            </div>
          )}
        </div>
      ))}

      <div className="rebar-summary-grid concrete-summary-total">
        <span>{t('rebar.summary.total')}</span>
        <span>{num(summary.lengthM, summary.basis, 1)}</span>
        <span>{num(summary.weightKg, summary.basis, 1)}</span>
        <span>{num(summary.orderLengthM, summary.basis, 1)}</span>
        <span>{num(summary.orderWeightKg, summary.basis === null ? null : 'exact', 1)}</span>
      </div>
      {summary.basis && summary.basis !== 'exact' && (
        <RowNote row={{ basis: summary.basis, estimatedLengthM: summary.estimatedLengthM, estimatedWeightKg: summary.estimatedWeightKg }} t={t} />
      )}
      {summary.orderWeightKg !== null && summary.orderWeightKg >= 1000 && (
        <p className="muted rebar-summary-tonnes">{t('rebar.summary.tonnes', { weight: formatNumber(round(summary.orderWeightKg / 1000, 2)) })}</p>
      )}
      {summary.missingItemCount > 0 && (
        <div className="concrete-summary-missing">
          <Icon name="alert" size={12} />
          {t('rebar.summary.missing', { count: summary.missingItemCount })}
          {summary.incompleteSpecCount > 0 && ` · ${t('rebar.summary.incompleteSpecs', { count: summary.incompleteSpecCount })}`} - {t('rebar.summary.excluded')}
        </div>
      )}
    </div>
  );
}
