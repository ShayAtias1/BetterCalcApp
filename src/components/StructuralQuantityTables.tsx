import { useMemo } from 'react';
import { formatNumber, useT } from '../i18n';
import type { Plan } from '../types';
import { buildConcreteItems, buildConcreteSummary, buildRebarLevelRows, buildRebarSummary, type RebarItemRow, type RebarLevelRow } from '../lib/structuralQuantities';
import { markLabel } from '../lib/structuralMarks';
import { metersToCm } from '../lib/structuralUnits';
import { round } from '../lib/geometry';

/**
 * Concrete and Rebar in the Quantities panel, in the same table system as the Finishes table
 * (`qty-table qty-grid`) as a bill of quantities: one detail row per item, then one total row.
 * Presentation only - the rows come from the item builders the exports use and the totals from the
 * summary builders (lib/structuralQuantities), unchanged. A mesh is one row per reinforcement level
 * (its two directions are part of the specification, never separate rows); its quantity is the
 * physical sheet count from lib/meshSheets.
 */

const DASH = '-';

/** The page number only on the first row of its page, so a page reads as one block of rows. */
const pageCell = (first: boolean, page: number) => (first ? page : '');

/** The short status words are the ones the plan reports use; 'ok' needs none. */
const concreteStatusKey = {
  'no-scale': 'exports.structural.status.noScale',
  'missing-size': 'exports.structural.status.missingSize',
} as const;
const rebarStatusKey = {
  'no-scale': 'exports.structural.status.noScale',
  'missing-size': 'exports.structural.status.missingSize',
  'no-layers': 'exports.structural.status.noLayers',
  'invalid-input': 'exports.structural.status.invalidInput',
} as const;

export function ConcreteQuantityTable({ plan }: { plan: Plan }) {
  const t = useT();
  const items = useMemo(() => buildConcreteItems(plan), [plan]);
  const summary = useMemo(() => buildConcreteSummary(plan), [plan]);
  if (items.length === 0) return null;
  const vol = (v: number | null) => (v === null ? DASH : formatNumber(round(v, 2)));
  const totalOk = summary.elementCount > summary.missingCount;
  const statusText = (r: (typeof items)[number]) =>
    r.status === 'ok' ? '' : r.status === 'missing-depth' ? t(r.kind === 'slab' ? 'exports.structural.status.missingThickness' : 'exports.structural.status.missingHeight') : t(concreteStatusKey[r.status]);
  // A slab's thickness is read in centimetres (as it is typed); a wall's, beam's or column's height in metres.
  const dimension = (r: (typeof items)[number]) =>
    r.depthM === null ? DASH : r.kind === 'slab' ? `${formatNumber(metersToCm(r.depthM)!)} ${t('units.cm')}` : `${formatNumber(round(r.depthM, 2))} ${t('units.m')}`;

  return (
    <div className="quantity-table-wrap">
      <div className="qty-table-scroll">
        <table className="qty-table qty-grid">
          <thead>
            <tr className="qty-col-row qty-single-row">
              <th className="col-page">{t('quantitiesPanel.cols.page')}</th>
              <th>{t('quantitiesPanel.cols.type')}</th>
              <th>{t('quantitiesPanel.cols.mark')}</th>
              <th>{t('quantitiesPanel.cols.grade')}</th>
              <th className="num">{t('quantitiesPanel.cols.dimension')}</th>
              <th className="num group-edge">{t('quantitiesPanel.cols.netM3')}</th>
              <th className="num">{t('quantitiesPanel.cols.orderM3')}</th>
              <th className="group-edge">{t('quantitiesPanel.cols.status')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r, i) => {
              const firstOfPage = i === 0 || items[i - 1].pageNumber !== r.pageNumber;
              const status = statusText(r);
              return (
                <tr key={r.id} className={firstOfPage && i > 0 ? 'qty-page-start' : undefined}>
                  <td className="col-page">{pageCell(firstOfPage, r.pageNumber)}</td>
                  <td className="qty-id">{t(`concrete.kinds.${r.kind}`)}</td>
                  <td dir="auto">{markLabel(r, t)}</td>
                  <td>{r.grade ? <span dir="auto">{r.grade}</span> : <span className="qty-none">{DASH}</span>}</td>
                  <td className="num">{dimension(r)}</td>
                  <td className="num group-edge">{vol(r.netM3)}</td>
                  <td className="num order">{vol(r.orderM3)}</td>
                  <td className="group-edge">{status ? <span className="cal-missing">{status}</span> : null}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="col-page" />
              <td className="qty-id" colSpan={4}>
                {t('concrete.summary.total')}
                {summary.missingCount > 0 && <span className="qty-sub cal-missing">{t('concrete.summary.missing', { count: summary.missingCount })}</span>}
              </td>
              <td className="num group-edge">{totalOk ? vol(summary.volumeM3) : DASH}</td>
              <td className="num order">{totalOk ? vol(summary.orderM3) : DASH}</td>
              <td className="group-edge" />
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
  const details = useMemo(() => buildRebarLevelRows(plan), [plan]);
  const summary = useMemo(() => buildRebarSummary(plan), [plan]);
  if (details.length === 0) return null;

  const weight = (v: number | null, estimated: boolean) => (v === null ? DASH : <span dir="ltr">{`${estimated ? '≈ ' : ''}${formatNumber(round(v, 2))}`}</span>);
  const notation = (r: RebarItemRow) => (r.diameterMm === null ? null : r.spacingCm === null ? `Ø${r.diameterMm}` : `Ø${r.diameterMm} @ ${r.spacingCm}`);
  const specification = (d: RebarLevelRow) => {
    if (d.kind === 'bars') return notation(d.parts[0]) ?? DASH;
    const first = d.parts[0];
    if (first.level === null) return DASH;
    if (first.direction === 'both') {
      const n = notation(first);
      return n ? `${n} ${t('units.cm')} - ${t('rebar.bothDirections')}` : DASH;
    }
    return d.parts.map((p) => `${t(p.direction === 'short' ? 'rebar.overlay.short' : 'rebar.overlay.long')} ${notation(p) ?? DASH}`).join(' | ');
  };
  const quantity = (d: RebarLevelRow) => {
    if (d.kind === 'bars') {
      const count = d.parts[0].barCount;
      return count === null ? DASH : t('quantitiesPanel.barsQty', { count });
    }
    const n = d.sheets?.count;
    return n === null || n === undefined ? DASH : t('quantitiesPanel.sheetsQty', { count: n });
  };
  const statusCell = (d: RebarLevelRow) =>
    d.status === 'ok' ? (
      <span className={`qty-status ${d.estimated ? 'estimate' : ''}`}>{t(d.estimated ? BASIS_KEY.estimated : BASIS_KEY.exact)}</span>
    ) : (
      <span className="cal-missing">{t(rebarStatusKey[d.status])}</span>
    );
  const total = summary.basis;

  return (
    <div className="quantity-table-wrap">
      <div className="qty-table-scroll">
        <table className="qty-table qty-grid">
          <thead>
            <tr className="qty-col-row qty-single-row">
              <th className="col-page">{t('quantitiesPanel.cols.page')}</th>
              <th>{t('quantitiesPanel.cols.type')}</th>
              <th>{t('quantitiesPanel.cols.mark')}</th>
              <th>{t('quantitiesPanel.cols.level')}</th>
              <th>{t('quantitiesPanel.cols.specification')}</th>
              <th className="num">{t('quantitiesPanel.cols.quantity')}</th>
              <th className="num group-edge">{t('quantitiesPanel.cols.netWeight')} <span className="qty-group-unit">({t('units.kg')})</span></th>
              <th className="num">{t('quantitiesPanel.cols.orderWeight')} <span className="qty-group-unit">({t('units.kg')})</span></th>
              <th className="group-edge">{t('quantitiesPanel.cols.status')}</th>
            </tr>
          </thead>
          <tbody>
            {details.map((d, i) => {
              const firstOfPage = i === 0 || details[i - 1].pageNumber !== d.pageNumber;
              return (
                <tr key={d.key} className={firstOfPage && i > 0 ? 'qty-page-start' : undefined}>
                  <td className="col-page">{pageCell(firstOfPage, d.pageNumber)}</td>
                  <td className="qty-id">{t(d.kind === 'mesh' ? 'rebar.mesh' : 'rebar.bars')}</td>
                  <td dir="auto">{markLabel(d, t)}</td>
                  <td>{d.level === null ? <span className="qty-none">{DASH}</span> : t(d.level === 'bottom' ? 'rebar.levelBottom' : 'rebar.levelTop')}</td>
                  <td className="qty-spec">{specification(d)}</td>
                  <td className="num">{quantity(d)}</td>
                  <td className="num group-edge">{weight(d.netWeightKg, d.estimated)}</td>
                  <td className="num order">{weight(d.orderWeightKg, d.estimated)}</td>
                  <td className="group-edge">{statusCell(d)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="col-page" />
              <td className="qty-id" colSpan={5}>
                {t('rebar.summary.total')}
                {summary.missingItemCount > 0 && <span className="qty-sub cal-missing">{t('rebar.summary.missing', { count: summary.missingItemCount })}</span>}
              </td>
              <td className="num group-edge">{total === null ? DASH : weight(summary.weightKg, total === 'estimated')}</td>
              <td className="num order">{total === null ? DASH : weight(summary.orderWeightKg, total === 'estimated')}</td>
              <td className="group-edge">
                {total === null ? null : <span className={`qty-status ${total === 'exact' ? '' : 'estimate'}`}>{t(BASIS_KEY[total])}</span>}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
