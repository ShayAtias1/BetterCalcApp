import { useMemo } from 'react';
import { formatNumber, useLanguage, useT } from '../i18n';
import { buildWorkBreakdown, planUsesWorkBreakdown } from '../lib/workAllocation';
import type { Plan } from '../types';
import './WorkCatalog.css';

const DASH = '—';

/**
 * Category → work item breakdown of the open plan, shown under the quantity table once the plan
 * splits a quantity or uses a custom category. Each category's first row is its calculated total;
 * the rows under it divide that total and never add to it.
 */
export default function WorkBreakdownTable({ plan }: { plan: Plan }) {
  const t = useT();
  const language = useLanguage();
  const used = planUsesWorkBreakdown(plan);
  const breakdown = useMemo(() => (used ? buildWorkBreakdown([plan], t) : null), [plan, t, used]);
  if (!breakdown || (breakdown.groups.length === 0 && breakdown.invalidItems === 0)) return null;
  const fmt = (n: number | null) => (n === null ? DASH : formatNumber(n, language));
  const uncalculated = breakdown.groups.reduce((n, g) => n + g.uncalculated, 0);
  const over = breakdown.groups.some((g) => g.over > 0);

  return (
    <section className="work-breakdown" aria-label={t('workCatalog.breakdownTitle')}>
      <h4 className="work-breakdown-title">{t('workCatalog.breakdownTitle')}</h4>
      <div className="qty-table-scroll">
        <table className="qty-table work-breakdown-table">
          <thead>
            <tr>
              <th>{t('workCatalog.headers.category')}</th>
              <th>{t('workCatalog.headers.item')}</th>
              <th className="num">{t('workCatalog.headers.quantity')}</th>
              <th>{t('workCatalog.headers.unit')}</th>
              <th className="num">{t('workCatalog.headers.area')}</th>
              <th className="num">{t('workCatalog.headers.order')}</th>
              <th>{t('workCatalog.headers.source')}</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.groups.flatMap((g) => [
              <tr key={g.key} className="wb-category">
                <td dir="auto">{g.label}</td>
                <td>{t('workCatalog.total')} · {t(`workCatalog.methods.${g.method}`)}</td>
                <td className="num">{fmt(g.total.quantity)}</td>
                <td>{g.unitLabel}</td>
                <td className="num">{fmt(g.total.areaM2)}</td>
                <td className="num">{fmt(g.total.order)}</td>
                <td />
              </tr>,
              ...g.lines.map((l) => (
                <tr key={`${g.key}:${l.specId ?? ''}`} className={l.specId === null ? 'wb-unassigned' : ''}>
                  <td />
                  <td className="wb-item" dir="auto">{l.label}{l.specification ? ` · ${l.specification}` : ''}</td>
                  <td className="num">{fmt(l.amount.quantity)}</td>
                  <td>{g.unitLabel}</td>
                  <td className="num">{fmt(l.amount.areaM2)}</td>
                  <td className="num">{fmt(l.amount.order)}</td>
                  <td>{t(`workCatalog.sources.${l.specId === null ? 'unassigned' : l.source}`)}</td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      {over && <p className="work-breakdown-note" role="alert">{t('workCatalog.overWarning')}</p>}
      {uncalculated > 0 && <p className="work-breakdown-note">{t('workCatalog.uncalculatedNote', { count: uncalculated })}</p>}
      {breakdown.invalidItems > 0 && <p className="work-breakdown-note">{t('workCatalog.invalidNote', { count: breakdown.invalidItems })}</p>}
    </section>
  );
}
