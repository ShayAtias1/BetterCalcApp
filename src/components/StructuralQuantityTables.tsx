import { Fragment, useMemo } from 'react';
import { formatNumber, useT } from '../i18n';
import type { Plan } from '../types';
import { buildConcreteSummary, buildRebarSummary, type RebarBasis } from '../lib/structuralQuantities';
import Icon from './Icon';

/**
 * Concrete and Rebar in the Quantities panel, in the same table system as the Finishes table
 * (`qty-table qty-grid`): identity columns first, numbers on the end edge, a firmer edge before the
 * order columns, a total row at the bottom. Presentation only - every number comes from the
 * summary builders (lib/structuralQuantities), unchanged.
 */

const DASH = '-';

/** The page number only on the first row of its page, so a page reads as one block of rows. */
const pageCell = (first: boolean, page: number) => (first ? page : '');

export function ConcreteQuantityTable({ plan }: { plan: Plan }) {
  const t = useT();
  const summary = useMemo(() => buildConcreteSummary(plan), [plan]);
  if (summary.elementCount === 0) return null;
  const calculable = (count: number, missing: number) => count > missing;
  const vol = (v: number, ok: boolean) => (ok ? formatNumber(v) : DASH);
  const missingNote = (count: number) => count > 0 && <span className="qty-sub cal-missing">{t('concrete.summary.missing', { count })}</span>;
  const totalOk = calculable(summary.elementCount, summary.missingCount);

  return (
    <div className="quantity-table-wrap">
      <div className="qty-table-scroll">
        <table className="qty-table qty-grid">
          <thead>
            <tr className="qty-col-row qty-single-row">
              <th className="col-page">{t('quantitiesPanel.cols.page')}</th>
              <th>{t('quantitiesPanel.cols.type')}</th>
              <th>{t('quantitiesPanel.cols.grade')}</th>
              <th className="num group-edge">{t('quantitiesPanel.cols.elements')}</th>
              <th className="num group-edge">{t('quantitiesPanel.cols.netM3')}</th>
              <th className="num">{t('quantitiesPanel.cols.orderM3')}</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((r, i) => {
              const ok = calculable(r.elementCount, r.missingCount);
              const firstOfPage = i === 0 || summary.rows[i - 1].pageNumber !== r.pageNumber;
              return (
                <tr key={`${r.pageNumber}|${r.kind}|${r.grade}`} className={firstOfPage && i > 0 ? 'qty-page-start' : undefined}>
                  <td className="col-page">{pageCell(firstOfPage, r.pageNumber)}</td>
                  <td className="qty-id">{t(`concrete.kinds.${r.kind}`)}</td>
                  <td>{r.grade ? <span dir="auto">{r.grade}</span> : <span className="qty-none">{DASH}</span>}</td>
                  <td className="num group-edge">
                    <span className="qty-main">{r.elementCount}</span>
                    {missingNote(r.missingCount)}
                  </td>
                  <td className="num group-edge">{vol(r.volumeM3, ok)}</td>
                  <td className="num order">{vol(r.orderM3, ok)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="col-page" />
              <td className="qty-id" colSpan={2}>{t('concrete.summary.total')}</td>
              <td className="num group-edge">
                <span className="qty-main">{summary.elementCount}</span>
                {missingNote(summary.missingCount)}
              </td>
              <td className="num group-edge">{vol(summary.volumeM3, totalOk)}</td>
              <td className="num order">{vol(summary.orderM3, totalOk)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

const BASIS_KEY = {
  exact: 'quantitiesPanel.basis.exact',
  mixed: 'quantitiesPanel.basis.includesEstimate',
  estimated: 'quantitiesPanel.basis.estimate',
} as const;

export function RebarQuantityTable({ plan }: { plan: Plan }) {
  const t = useT();
  const summary = useMemo(() => buildRebarSummary(plan), [plan]);
  if (summary.itemCount === 0) return null;
  // A mixed or estimated figure carries "≈", like the rest of the rebar UI; a missing one is a dash.
  const num = (v: number, basis: RebarBasis | null) => (basis === null ? DASH : `${basis === 'estimated' ? '≈ ' : ''}${formatNumber(v)}`);
  const status = (basis: RebarBasis | null) =>
    basis === null ? <span className="qty-none">{DASH}</span> : <span className={`qty-status ${basis === 'exact' ? '' : 'estimate'}`}>{t(BASIS_KEY[basis])}</span>;
  const missingText = (items: number, specs: number) => `${t('rebar.summary.missing', { count: items })}${specs > 0 ? ` · ${t('rebar.summary.incompleteSpecs', { count: specs })}` : ''}`;
  const COLS = 8;
  const totalLines = summary.pages.reduce((sum, p) => sum + p.rows.reduce((s, r) => s + r.lineCount, 0), 0);

  return (
    <div className="quantity-table-wrap">
      <div className="qty-table-scroll">
        <table className="qty-table qty-grid">
          <thead>
            <tr className="qty-col-row qty-single-row">
              <th className="col-page">{t('quantitiesPanel.cols.page')}</th>
              <th>{t('quantitiesPanel.cols.diameter')}</th>
              <th className="num">{t('quantitiesPanel.cols.lines')}</th>
              <th className="num group-edge">{t('quantitiesPanel.cols.netLength')} <span className="qty-group-unit">({t('units.lm')})</span></th>
              <th className="num">{t('quantitiesPanel.cols.netWeight')} <span className="qty-group-unit">({t('units.kg')})</span></th>
              <th className="num group-edge">{t('quantitiesPanel.cols.orderLength')} <span className="qty-group-unit">({t('units.lm')})</span></th>
              <th className="num">{t('quantitiesPanel.cols.orderWeight')} <span className="qty-group-unit">({t('units.kg')})</span></th>
              <th className="group-edge">{t('quantitiesPanel.cols.status')}</th>
            </tr>
          </thead>
          <tbody>
            {summary.pages.map((page, pi) => (
              <Fragment key={page.pageNumber}>
                {page.rows.map((r, i) => (
                  <tr key={r.diameterMm} className={i === 0 && pi > 0 ? 'qty-page-start' : undefined}>
                    <td className="col-page">{pageCell(i === 0, page.pageNumber)}</td>
                    <td className="qty-id" dir="ltr">{`Ø${r.diameterMm}`}</td>
                    <td className="num">{r.lineCount}</td>
                    <td className="num group-edge">{num(r.lengthM, r.basis)}</td>
                    <td className="num">{num(r.weightKg, r.basis)}</td>
                    <td className="num group-edge order">{num(r.orderLengthM, r.basis)}</td>
                    <td className="num order">{num(r.orderWeightKg, r.basis)}</td>
                    <td className="group-edge">{status(r.basis)}</td>
                  </tr>
                ))}
                {page.missingItemCount > 0 && (
                  <tr className={`qty-missing-row ${page.rows.length === 0 && pi > 0 ? 'qty-page-start' : ''}`}>
                    <td className="col-page">{pageCell(page.rows.length === 0, page.pageNumber)}</td>
                    <td colSpan={COLS - 1} className="cal-missing">
                      <Icon name="alert" size={12} /> {missingText(page.missingItemCount, page.incompleteSpecCount)}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="col-page" />
              <td className="qty-id">{t('rebar.summary.total')}</td>
              <td className="num">{summary.basis === null ? DASH : totalLines}</td>
              <td className="num group-edge">{num(summary.lengthM, summary.basis)}</td>
              <td className="num">{num(summary.weightKg, summary.basis)}</td>
              <td className="num group-edge order">{num(summary.orderLengthM, summary.basis)}</td>
              <td className="num order">{num(summary.orderWeightKg, summary.basis)}</td>
              <td className="group-edge">{status(summary.basis)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
