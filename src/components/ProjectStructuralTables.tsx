import { useMemo } from 'react';
import type { Plan } from '../types';
import { buildRebarLevelRows, type ProjectConcrete, type ProjectRebar, type RebarBasis } from '../lib/structuralQuantities';
import { markLabel } from '../lib/structuralMarks';
import { formatNumber, useLanguage, useT } from '../i18n';
import { round } from '../lib/geometry';
import { basisText, levelText, levelSpecification, levelQuantity, levelStatus } from '../lib/structuralExportText';
import { exportContext } from '../lib/exportLanguage';

/** Project structural BOQ: Concrete aggregates and Rebar item/level rows from existing builders. */

const DASH = '-';
/** An estimate carries "≈" so it can never be read as an exact figure; a figure that cannot be known is a dash. */
const num = (v: number, basis: RebarBasis | null) => (basis === null ? DASH : `${basis === 'estimated' ? '≈ ' : ''}${formatNumber(round(v, 2))}`);

export function ProjectConcreteTable({ concrete }: { concrete: ProjectConcrete }) {
  const t = useT();
  const missing = (count: number) => (count > 0 ? <span className="qty-sub cal-missing">{t('exports.structural.missingShort', { count })}</span> : null);
  const vol = (v: number, ok: boolean) => (ok ? formatNumber(round(v, 2)) : DASH);
  const totalOk = concrete.elementCount > concrete.missingCount;
  return (
    <div className="quantity-table-wrap">
      <div className="qty-table-scroll">
        <table className="qty-table qty-grid">
          <thead>
            <tr className="qty-col-row qty-single-row">
              <th>{t('exports.structural.headers.type')}</th>
              <th>{t('exports.structural.headers.grade')}</th>
              <th className="num group-edge">{t('exports.structural.headers.elements')}</th>
              <th className="num group-edge">{t('quantitiesPanel.cols.netM3')}</th>
              <th className="num">{t('quantitiesPanel.cols.orderM3')}</th>
            </tr>
          </thead>
          <tbody>
            {concrete.rows.map((r) => {
              const ok = r.elementCount > r.missingCount;
              return (
                <tr key={`${r.kind}|${r.grade}`}>
                  <td className="qty-id">{t(`concrete.kinds.${r.kind}`)}</td>
                  <td>{r.grade ? <span dir="auto">{r.grade}</span> : <span className="qty-none">{DASH}</span>}</td>
                  <td className="num group-edge">
                    <span className="qty-main">{r.elementCount}</span>
                    {missing(r.missingCount)}
                  </td>
                  <td className="num group-edge">{vol(r.volumeM3, ok)}</td>
                  <td className="num order">{vol(r.orderM3, ok)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="qty-id" colSpan={2}>{t('concrete.summary.total')}</td>
              <td className="num group-edge">
                <span className="qty-main">{concrete.elementCount}</span>
                {missing(concrete.missingCount)}
              </td>
              <td className="num group-edge">{totalOk ? vol(concrete.volumeM3, true) : DASH}</td>
              <td className="num order">{totalOk ? vol(concrete.orderM3, true) : DASH}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export function ProjectRebarTable({ rebar, plans }: { rebar: ProjectRebar; plans: Plan[] }) {
  const t = useT();
  const x = exportContext(useLanguage());
  const details = useMemo(() => plans.flatMap((plan) => buildRebarLevelRows(plan).map((row) => ({ planId: plan.id, planName: plan.name, row }))), [plans]);
  const weight = (v: number | null, estimated: boolean) => v === null ? DASH : num(v, estimated ? 'estimated' : 'exact');
  const length = (v: number | null) => v === null ? DASH : `${formatNumber(round(v, 2))} ${t('units.m')}`;
  const status = (basis: RebarBasis | null) =>
    basis === null ? <span className="qty-none">{DASH}</span> : <span className={`qty-status ${basis === 'exact' ? '' : 'estimate'}`}>{basisText(basis, x)}</span>;
  return (
    <div className="quantity-table-wrap">
      <div className="qty-table-scroll">
        <table className="qty-table qty-grid">
          <thead>
            <tr className="qty-col-row qty-single-row">
              <th>{t('exports.common.plan')}</th>
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
            {details.map(({ planId, planName, row: d }) => (
              <tr key={`${planId}|${d.key}`}>
                <td dir="auto">{planName}</td>
                <td className="col-page">{d.pageNumber}</td>
                <td className="qty-id">{t(d.kind === 'mesh' ? 'rebar.mesh' : 'rebar.bars')}</td>
                <td dir="auto">{markLabel(d, t)}</td>
                <td>{levelText(d.level, x) || DASH}</td>
                <td className="qty-spec" dir="auto">{levelSpecification(d, x)}</td>
                <td className="num">
                  {levelQuantity(d, x)}
                  {d.kind === 'bars' && <>
                    <span className="qty-sub">{t('rebar.barLength')}: <span dir="ltr">{length(d.parts[0].barLengthM)}</span></span>
                    <span className="qty-sub">{t('rebar.totalLength')}: <span dir="ltr">{length(d.parts[0].netLengthM)}</span></span>
                  </>}
                </td>
                <td className="num group-edge" dir="ltr">{weight(d.netWeightKg, d.estimated)}</td>
                <td className="num order" dir="ltr">{weight(d.orderWeightKg, d.estimated)}</td>
                <td className="group-edge"><span className={d.status !== 'ok' ? 'cal-missing' : `qty-status ${d.estimated ? 'estimate' : ''}`}>{levelStatus(d, x)}</span></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="qty-id" colSpan={7}>{t('rebar.summary.total')}</td>
              <td className="num group-edge" dir="ltr">{num(rebar.weightKg, rebar.basis)}</td>
              <td className="num order" dir="ltr">{num(rebar.orderWeightKg, rebar.basis)}</td>
              <td className="group-edge">
                {status(rebar.basis)}
                {rebar.missingItemCount > 0 && <span className="qty-sub cal-missing">{t('exports.structural.missingShort', { count: rebar.missingItemCount })}</span>}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
