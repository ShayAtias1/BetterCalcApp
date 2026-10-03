import { useMemo } from 'react';
import { formatNumber, useT } from '../i18n';
import type { Plan } from '../types';
import { buildConcreteSummary, type ConcreteSummaryRow } from '../lib/structuralQuantities';
import Icon from './Icon';

/**
 * The plan's concrete quantities in the Concrete tab: per page, then kind and grade, with the net
 * and the to-order volume. Elements that cannot be calculated are flagged on their row and in the
 * total — they are never added as zero.
 */
export default function ConcreteSummary({ plan }: { plan: Plan }) {
  const t = useT();
  const summary = useMemo(() => buildConcreteSummary(plan), [plan]);
  if (summary.elementCount === 0) return null;

  const m3 = t('units.m3');
  const volume = (v: number, calculable: boolean) => (calculable ? formatNumber(v) : '—');

  const pages = [...new Set(summary.rows.map((r) => r.pageNumber))];
  const rowCalculable = (r: ConcreteSummaryRow) => r.elementCount > r.missingCount;

  return (
    <div className="concrete-summary">
      <span className="section-label">
        {t('concrete.summary.title')} ({m3})
      </span>
      <div className="concrete-summary-grid concrete-summary-head" aria-hidden="true">
        <span />
        <span>{t('concrete.summary.elements')}</span>
        <span>{t('concrete.summary.net')}</span>
        <span>{t('concrete.summary.order')}</span>
      </div>
      {pages.map((page) => (
        <div key={page} className="concrete-summary-page">
          <div className="concrete-summary-page-title">{t('concrete.page', { page })}</div>
          {summary.rows
            .filter((r) => r.pageNumber === page)
            .map((r) => (
              <div key={`${r.kind}|${r.grade}`}>
                <div className="concrete-summary-grid">
                  <span className="concrete-summary-label">
                    {t(`concrete.kinds.${r.kind}`)} ·{' '}
                    {r.grade ? <span dir="auto">{r.grade}</span> : <span className="muted">{t('concrete.summary.noGrade')}</span>}
                  </span>
                  <span>{r.elementCount}</span>
                  <span>{volume(r.volumeM3, rowCalculable(r))}</span>
                  <span>{volume(r.orderM3, rowCalculable(r))}</span>
                </div>
                {r.missingCount > 0 && (
                  <div className="concrete-summary-missing">
                    <Icon name="alert" size={12} />
                    {t('concrete.summary.missing', { count: r.missingCount })}
                  </div>
                )}
              </div>
            ))}
        </div>
      ))}
      <div className="concrete-summary-grid concrete-summary-total">
        <span>{t('concrete.summary.total')}</span>
        <span>{summary.elementCount}</span>
        <span>{formatNumber(summary.volumeM3)}</span>
        <span>{formatNumber(summary.orderM3)}</span>
      </div>
      {summary.missingCount > 0 && (
        <div className="concrete-summary-missing">
          <Icon name="alert" size={12} />
          {t('concrete.summary.missing', { count: summary.missingCount })} — {t('concrete.summary.excluded')}
        </div>
      )}
    </div>
  );
}
