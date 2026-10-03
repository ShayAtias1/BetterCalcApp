import { useMemo } from 'react';
import { useT } from '../i18n';
import { useAppStore } from '../store/appStore';
import {
  buildReportCategoryTotals,
  buildRoomSummaries,
  openingAreaM2,
  openingCountsText,
  usedReportCategories,
} from '../lib/quantities';
import { categoryPrimaryUnit, roomCategoryQuantity } from '../lib/projectQuantities';
import { round } from '../lib/geometry';
import { projectWasteDefault, WORK_TYPE_DEFINITIONS } from '../lib/workTypes';
import {
  EXTRA_REPORT_CATEGORIES,
  PANEL_HEIGHT_M,
} from '../types';
import Icon from './Icon';

const DASH = '-';

/**
 * The contractor-facing quantity report. Lives inside the bottom quantities panel; `showDefaults` is
 * owned by that panel so its toggle can sit in the panel header, away from the export actions.
 *
 * One column group per work type the plan uses (net · to order), identity columns sticky, and the
 * secondary numbers (waste %, skirting m², opening deductions) stacked under the number they explain
 * rather than given columns of their own.
 *
 * Nothing here computes anything: every number comes from lib/quantities, unchanged.
 */
export default function QuantityTable({ showDefaults = false }: { showDefaults?: boolean }) {
  const t = useT();
  const project = useAppStore((s) => s.project);
  const updateProjectMeta = useAppStore((s) => s.updateProjectMeta);

  const summaries = useMemo(() => (project ? buildRoomSummaries(project) : []), [project]);
  const totals = useMemo(() => (project ? buildReportCategoryTotals(project, summaries) : []), [project, summaries]);
  // A column group per work type some room actually uses — none is shown just because it exists.
  const categories = useMemo(() => usedReportCategories(summaries), [summaries]);
  const roomsById = useMemo(() => new Map((project?.rooms ?? []).map((r) => [r.id, r])), [project]);

  if (!project) return null;

  // Rooms on pages with no scale: the summary reports their numbers as null, and they are labelled
  // rather than shown as 0.
  const hasUncalibratedRooms = summaries.some((s) => !s.pageCalibrated);
  const hasAreaMeasurements = (project.measurements ?? []).some((m) => m.tool === 'area' && m.areaKind);

  return (
    <div className="quantity-table-wrap">
      {showDefaults && (
        <div className="defaults-panel">
          <p className="defaults-note">
            {t('quantityTable.defaultsNote')}
          </p>
          <div className="form-row inline">
            <label>{t('quantityTable.claddingHeight')}</label>
            <input
              type="number"
              step="0.05"
              min="0"
              value={project.defaultCladdingHeightM}
              onChange={(e) => updateProjectMeta({ defaultCladdingHeightM: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="form-row inline">
            <label>{t('quantityTable.panelHeight')}</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={project.defaultPanelHeightM ?? PANEL_HEIGHT_M}
              onChange={(e) => updateProjectMeta({ defaultPanelHeightM: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="form-row inline">
            <label>{t('quantityTable.tilingRegularWaste')}</label>
            <input
              type="number"
              step="1"
              min="0"
              max="100"
              value={project.defaultTilingWastePercent}
              onChange={(e) => updateProjectMeta({ defaultTilingWastePercent: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="form-row inline">
            <label>{t('quantityTable.tilingAsWaste')}</label>
            <input
              type="number"
              step="1"
              min="0"
              max="100"
              value={project.defaultTilingAsWastePercent ?? project.defaultTilingWastePercent}
              onChange={(e) => updateProjectMeta({ defaultTilingAsWastePercent: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="form-row inline">
            <label>{t('quantityTable.claddingWaste')}</label>
            <input
              type="number"
              step="1"
              min="0"
              max="100"
              value={project.defaultCladdingWastePercent}
              onChange={(e) => updateProjectMeta({ defaultCladdingWastePercent: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="form-row inline">
            <label>{t('quantityTable.panelsWaste')}</label>
            <input
              type="number"
              step="1"
              min="0"
              max="100"
              value={project.defaultPanelsWastePercent}
              onChange={(e) => updateProjectMeta({ defaultPanelsWastePercent: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="form-row inline">
            <label>{t('quantityTable.wallHeight')}</label>
            <input
              type="number"
              step="0.05"
              min="0"
              value={project.wallHeightDefaultM}
              onChange={(e) => updateProjectMeta({ wallHeightDefaultM: parseFloat(e.target.value) || 0 })}
            />
          </div>
          {EXTRA_REPORT_CATEGORIES.map((c) => {
            const def = WORK_TYPE_DEFINITIONS[c];
            return (
              <div className="form-row inline" key={c}>
                <label>{t('quantityTable.workTypeWaste', { label: t(`workTypes.${def.id}`) })}</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  value={projectWasteDefault(def, project)}
                  onChange={(e) => updateProjectMeta({ [def.wasteDefaultField]: parseFloat(e.target.value) || 0 })}
                />
              </div>
            );
          })}
        </div>
      )}

      {summaries.length === 0 ? (
        <div className="empty-state">
          <Icon name="table" size={28} />
          <p>{hasAreaMeasurements ? t('quantityTable.emptyWithAreas') : t('quantityTable.empty')}</p>
        </div>
      ) : (
        <>
          {categories.length === 0 && (
            <p className="qty-table-hint muted">{t('quantityTable.noWorkItems')}</p>
          )}
          <div className="qty-table-scroll">
            <table className="qty-table qty-grid">
              <thead>
                {/* Grouped by work type: each type the plan uses gets its net and to-order columns
                    side by side, so one work type reads left to right in one place. Waste, the
                    m² reading of skirting and opening deductions sit under the number they explain. */}
                <tr className="qty-group-row">
                  <th className="spacer sticky-col col-apt" />
                  <th className="spacer sticky-col col-room" />
                  {categories.map((c) => (
                    <th key={c} colSpan={2} className="group-edge">
                      {t(`reportCategories.${c}`)} <span className="qty-group-unit">({categoryPrimaryUnit(c)})</span>
                    </th>
                  ))}
                  <th colSpan={2} className="group-edge">
                    {t('quantityTable.details')}
                  </th>
                </tr>
                <tr className="qty-col-row">
                  <th className="sticky-col col-apt">{t('quantityTable.apartment')}</th>
                  <th className="sticky-col col-room">{t('quantityTable.room')}</th>
                  {categories.map((c) => [
                    <th key={`${c}-net`} className="num group-edge">
                      {t('quantityTable.net')}
                    </th>,
                    <th key={`${c}-order`} className="num">
                      {t('quantityTable.order')}
                    </th>,
                  ])}
                  <th className="group-edge">{t('quantityTable.openings')}</th>
                  <th>{t('quantityTable.notes')}</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((s) => {
                  const room = roomsById.get(s.roomId);
                  const openings = room?.openings ?? [];
                  const openingsText = openingCountsText(openings);
                  const openingsArea = round(openings.reduce((sum, o) => sum + openingAreaM2(o), 0), 2);
                  return (
                    <tr key={s.roomId}>
                      <td className="sticky-col col-apt">{s.apartmentNumber || DASH}</td>
                      <td className="sticky-col col-room">{s.roomName}</td>
                      {categories.map((c) => {
                        const q = roomCategoryQuantity(s, c);
                        // The room has no item of this type: a quiet dash, not a number.
                        if (q.wastePercent == null) {
                          return [
                            <td key={`${c}-net`} className="num group-edge qty-none">{DASH}</td>,
                            <td key={`${c}-order`} className="num qty-none">{DASH}</td>,
                          ];
                        }
                        // An unscaled page: say why the cell is blank instead of showing 0.
                        if (!s.pageCalibrated) {
                          return [
                            <td key={`${c}-net`} className="num group-edge">
                              <span className="cal-missing">{t('quantities.notCalibrated')}</span>
                            </td>,
                            <td key={`${c}-order`} className="num">
                              <span className="qty-sub">{t('quantityTable.waste', { percent: q.wastePercent })}</span>
                            </td>,
                          ];
                        }
                        const panels = c === 'panels';
                        const netSub: string[] = [];
                        const orderSub: string[] = [t('quantityTable.waste', { percent: q.wastePercent })];
                        // The deduction reads as one short word under the net; hovering spells out
                        // gross − deduction = net.
                        let netTitle: string | undefined;
                        if (panels) {
                          netSub.push(`${q.quantityM2 ?? 0} ${t('units.m2')}`);
                          orderSub.push(`${q.orderM2 ?? 0} ${t('units.m2')}`);
                          const doors = s.panelsDeductedLengthM ?? 0;
                          if (doors > 0 && q.lengthM != null) {
                            netSub.push(t('quantityTable.deduction', { amount: doors }));
                            netTitle = t('quantityTable.doorsTitle', { gross: round(q.lengthM + doors, 2), doors, net: q.lengthM, unit: t('units.lm') });
                          }
                        } else {
                          const deduction = s.openingDeductions.find((d) => d.category === c);
                          if (deduction) {
                            netSub.push(t('quantityTable.deduction', { amount: deduction.deductedM2 }));
                            netTitle = t('quantityTable.openingsTitle', {
                              gross: deduction.grossM2,
                              deducted: deduction.deductedM2,
                              net: deduction.netM2,
                              unit: t('units.m2'),
                            });
                          }
                        }
                        return [
                          <td key={`${c}-net`} className="num group-edge" title={netTitle}>
                            <span className="qty-main">{panels ? q.lengthM : q.quantityM2}</span>
                            {netSub.length > 0 && <span className="qty-sub">{netSub.join(' · ')}</span>}
                          </td>,
                          <td key={`${c}-order`} className="num order">
                            <span className="qty-main">{panels ? q.orderLengthM : q.orderM2}</span>
                            <span className="qty-sub">{orderSub.join(' · ')}</span>
                          </td>,
                        ];
                      })}
                      <td
                        className={`group-edge qty-openings ${openingsText ? '' : 'qty-none'}`}
                        title={
                          openings
                            .map((o) =>
                              t('quantityTable.openingTitle', { type: t(`openingTypes.${o.type}`), width: o.widthM, height: o.heightM, quantity: o.quantity })
                            )
                            .join('\n') || undefined
                        }
                      >
                        {openingsText ? (
                          <>
                            <span className="qty-main">{openingsText}</span>
                            <span className="qty-sub">
                              {openingsArea} {t('units.m2')}
                            </span>
                          </>
                        ) : (
                          DASH
                        )}
                      </td>
                      <td className={`qty-notes ${s.notes ? '' : 'qty-none'}`} title={s.notes || undefined}>
                        {s.notes || DASH}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {hasUncalibratedRooms && (
            <div className="warning-box">
              {t('quantityTable.uncalibratedWarning')}
            </div>
          )}

          <div className="qty-summary">
            <h4 className="qty-totals-title">{t('quantityTable.total')}</h4>
            <table className="qty-summary-table">
              <thead>
                <tr>
                  <th>{t('quantityTable.totalsHeaders.item')}</th>
                  <th>{t('quantityTable.totalsHeaders.length')}</th>
                  <th>{t('quantityTable.totalsHeaders.net')}</th>
                  <th>{t('quantityTable.totalsHeaders.waste')}</th>
                  <th>{t('quantityTable.totalsHeaders.orderLength')}</th>
                  <th>{t('quantityTable.totalsHeaders.order')}</th>
                </tr>
              </thead>
              <tbody>
                {totals.map((total) => (
                  <tr key={total.category}>
                    <td>{t(`reportCategories.${total.category}`)}</td>
                    <td>{total.lengthM ?? DASH}</td>
                    <td>{total.quantityM2}</td>
                    <td>{total.wastePercent}%</td>
                    <td className="order">{total.orderLengthM ?? DASH}</td>
                    <td className="order">{total.orderM2}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
