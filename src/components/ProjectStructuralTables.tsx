import { formatNumber, useLanguage, useT } from '../i18n';
import type { ProjectConcrete, ProjectRebar, RebarBasis } from '../lib/structuralQuantities';
import { round } from '../lib/geometry';
import { basisText } from '../lib/structuralExportText';
import { exportContext } from '../lib/exportLanguage';

/**
 * The project's concrete and rebar totals as aggregate tables in the same table system as the plan
 * Quantities panel (`qty-table qty-grid`): rows, then one total row. Presentation only - every number
 * comes from `buildProjectStructural`. Item detail stays in the plan Quantities and the exports.
 */

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

export function ProjectRebarTable({ rebar }: { rebar: ProjectRebar }) {
  const t = useT();
  const x = exportContext(useLanguage());
  const lm = t('units.lm');
  const kg = t('units.kg');
  const status = (basis: RebarBasis | null) =>
    basis === null ? <span className="qty-none">{DASH}</span> : <span className={`qty-status ${basis === 'exact' ? '' : 'estimate'}`}>{basisText(basis, x)}</span>;
  const head = (label: string, unit: string, edge = false) => (
    <th className={`num ${edge ? 'group-edge' : ''}`}>
      {label} <span className="qty-group-unit">({unit})</span>
    </th>
  );
  return (
    <div className="quantity-table-wrap">
      <div className="qty-table-scroll">
        <table className="qty-table qty-grid">
          <thead>
            <tr className="qty-col-row qty-single-row">
              <th>{t('rebar.diameter')}</th>
              {head(t('rebar.summary.lengthNet'), lm, true)}
              {head(t('rebar.summary.weightNet'), kg)}
              {head(t('rebar.summary.lengthOrder'), lm, true)}
              {head(t('rebar.summary.weightOrder'), kg)}
              <th className="group-edge">{t('quantitiesPanel.cols.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rebar.rows.map((r) => (
              <tr key={r.diameterMm}>
                <td className="qty-id" dir="ltr">{`Ø${r.diameterMm}`}</td>
                <td className="num group-edge">{num(r.lengthM, r.basis)}</td>
                <td className="num">{num(r.weightKg, r.basis)}</td>
                <td className="num group-edge order">{num(r.orderLengthM, r.basis)}</td>
                <td className="num order">{num(r.orderWeightKg, r.basis)}</td>
                <td className="group-edge">{status(r.basis)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="qty-id">{t('rebar.summary.total')}</td>
              <td className="num group-edge">{num(rebar.lengthM, rebar.basis)}</td>
              <td className="num">{num(rebar.weightKg, rebar.basis)}</td>
              <td className="num group-edge order">{num(rebar.orderLengthM, rebar.basis)}</td>
              <td className="num order">{num(rebar.orderWeightKg, rebar.basis)}</td>
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
