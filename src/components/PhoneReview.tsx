import { useMemo, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { useT, formatNumber, type TranslateFn } from '../i18n';
import type { Plan } from '../types';
import type { PlanFocus } from '../store/planFocusStore';
import { showOnPlan } from '../lib/showOnPlan';
import { buildRoomSummaries, usedReportCategories } from '../lib/quantities';
import { categoryPrimaryUnit, roomCategoryQuantity } from '../lib/projectQuantities';
import { buildConcreteItems, buildRebarLevelRows } from '../lib/structuralQuantities';
import { concreteOf, rebarOf, rebarItemsOnPages } from '../lib/structuralPlan';
import { markLabel } from '../lib/structuralMarks';

interface ReviewItem {
  key: string;
  name: string;
  type: 'room' | 'concrete' | 'mesh' | 'bars' | 'individual' | 'stirrup';
  specification: string;
  quantities: string[];
  target: PlanFocus;
  planName: string;
}
const amount = (value: number | null, unit: string) => value === null ? '—' : `${formatNumber(value)} ${unit}`;

/** Presentation rows from the same builders as the reports; no mobile calculation or saved model. */
function reviewItems(plan: Plan, t: TranslateFn, quantityPage?: number): ReviewItem[] {
  if (quantityPage !== undefined) {
    const pages = new Set([quantityPage]);
    // Read-only sheet projection. Stirrup filtering uses the report helper; Individual Bars
    // retain only this sheet's native bars before entering the existing quantity builder.
    const regular = rebarItemsOnPages(plan, pages).filter((i) => i.kind !== 'bars' || i.drawnBars === undefined);
    const individual = rebarOf(plan).flatMap((item) => {
      if (item.kind !== 'bars' || item.drawnBars === undefined) return [];
      const drawnBars = item.drawnBars.filter((bar) => bar.pageNumber === quantityPage);
      return drawnBars.length ? [{ ...item, pageNumber: quantityPage, drawnBars }] : [];
    });
    plan = { ...plan, rebarItems: [...regular, ...individual] };
  }
  const rows: ReviewItem[] = [];
  const target = (pageNumber: number, domain: PlanFocus['domain'], itemId: string, points: PlanFocus['points']): PlanFocus => ({ planId: plan.id, pageNumber, domain, itemId, points });
  const summaries = buildRoomSummaries(plan);
  for (const room of plan.rooms) {
    const summary = summaries.find((s) => s.roomId === room.id)!;
    const quantities = usedReportCategories([summary]).map((category) => {
      const q = roomCategoryQuantity(summary, category);
      const net = category === 'panels' ? q.lengthM : q.quantityM2;
      const order = category === 'panels' ? q.orderLengthM : q.orderM2;
      return `${t(`reportCategories.${category}`)}: ${amount(net, categoryPrimaryUnit(category, t))} · ${t('phoneReview.order')}: ${amount(order, categoryPrimaryUnit(category, t))}`;
    });
    if (!summary.pageCalibrated) quantities.push(t('quantities.notCalibrated'));
    rows.push({ key: `${plan.id}:${room.id}`, name: room.name, type: 'room', specification: [room.apartmentNumber, room.notes, ...room.workItems.map((w) => t(`workTypes.${w.type}`))].filter(Boolean).join(' · '), quantities, target: target(room.pageNumber, 'room', room.id, room.points), planName: plan.name });
  }
  const concrete = concreteOf(plan);
  for (const row of buildConcreteItems(plan)) {
    const element = concrete.find((e) => e.id === row.id)!;
    const status = row.status === 'ok' ? '' : row.status === 'no-scale' ? t('quantities.notCalibrated') : t('phoneReview.incomplete');
    rows.push({ key: `${plan.id}:${row.id}`, name: markLabel(row, t), type: 'concrete', specification: [t(`concrete.kinds.${row.kind}`), row.grade, `${row.depthM ?? '—'} m`].filter(Boolean).join(' · '), quantities: [`${t('phoneReview.net')}: ${amount(row.netM3, t('units.m3'))}`, `${t('phoneReview.order')}: ${amount(row.orderM3, t('units.m3'))}`, status].filter(Boolean), target: target(row.pageNumber, 'concrete', row.id, element.points), planName: plan.name });
  }
  const levels = buildRebarLevelRows(plan);
  for (const item of rebarOf(plan)) {
    const itemRows = levels.filter((r) => r.itemId === item.id);
    const quantities = itemRows.flatMap((r) => {
      const label = r.level ? t(r.level === 'bottom' ? 'rebar.levelBottom' : 'rebar.levelTop') : '';
      return [
        `${label} ${t('phoneReview.net')}: ${amount(r.netWeightKg, t('units.kg'))}`,
        `${label} ${t('phoneReview.order')}: ${amount(r.orderWeightKg, t('units.kg'))}`,
        ...(r.sheets ? [`${t('phoneReview.sheets')}: ${r.sheets.count ?? '—'}`] : []),
        ...(r.estimated ? [t('phoneReview.estimated')] : []),
        ...(r.status !== 'ok' ? [r.status === 'no-scale' ? t('quantities.notCalibrated') : t('phoneReview.incomplete')] : []),
      ];
    });
    const specification = itemRows.flatMap((r) => r.parts.map((part) => [part.diameterMm === null ? '' : `Ø${part.diameterMm} mm`, part.spacingCm === null ? '' : `${part.spacingCm} cm`, part.barCount === null ? '' : `${part.barCount} × ${part.barLengthM ?? '—'} m`].filter(Boolean).join(' · '))).filter(Boolean).join(' / ');
    const common = { name: markLabel(item, t), specification, quantities, planName: plan.name };
    if (item.kind === 'bars' && item.drawnBars !== undefined) {
      const sheets = [...new Set(item.drawnBars.map((b) => b.pageNumber))];
      // One row per occupied sheet; item totals stay labelled as item totals across sheets.
      for (const page of sheets.length ? sheets : [item.pageNumber]) {
        const bars = item.drawnBars.filter((b) => b.pageNumber === page);
        rows.push({ ...common, quantities: [t(quantityPage === undefined ? 'phoneReview.itemTotals' : 'phoneReview.sheetItemTotals'), ...quantities], key: `${plan.id}:${item.id}:${page}`, type: 'individual', target: { ...target(page, 'rebar', item.id, bars.flatMap((b) => [b.start, b.end])), barId: bars[0]?.id } });
      }
    } else if (item.kind === 'stirrup' && item.placements.length) {
      for (const placement of item.placements) rows.push({ ...common, quantities: [t(quantityPage === undefined ? 'phoneReview.itemTotals' : 'phoneReview.sheetItemTotals'), ...quantities], key: `${plan.id}:${item.id}:${placement.id}`, type: 'stirrup', target: { ...target(placement.pageNumber, 'rebar', item.id, placement.kind === 'area' ? placement.points : [placement.start, placement.end]), placementId: placement.id } });
    } else {
      const points = item.kind === 'mesh' ? item.points : item.kind === 'bars' ? item.barsZone?.points ?? [] : [];
      const page = item.kind === 'bars' ? item.barsZone?.pageNumber ?? item.pageNumber : item.pageNumber;
      rows.push({ ...common, key: `${plan.id}:${item.id}`, type: item.kind, target: target(page, 'rebar', item.id, points) });
    }
  }
  return rows;
}

export default function PhoneReview({ domain, quantities = false, onShowPlan }: {
  domain: 'room' | 'concrete' | 'rebar'; quantities?: boolean; onShowPlan: () => void;
}) {
  const t = useT();
  const current = useAppStore((s) => s.project);
  const savedPlans = useAppStore((s) => s.projectPlans);
  const page = useAppStore((s) => s.currentPage);
  const [scope, setScope] = useState<'sheet' | 'plan' | 'project'>(quantities ? 'sheet' : 'project');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const items = useMemo(() => {
    if (!current) return [];
    const plans = scope === 'project' ? [...savedPlans.filter((p) => p.id !== current.id), current] : [current];
    return plans.flatMap((plan) => reviewItems(plan, t, quantities && scope === 'sheet' ? page : undefined)).filter((row) =>
      row.target.domain === domain && (scope !== 'sheet' || row.target.pageNumber === page) &&
      (domain !== 'rebar' || type === 'all' || row.type === type) &&
      `${row.name} ${row.specification} ${row.planName} ${row.target.pageNumber}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  }, [current, savedPlans, scope, page, domain, type, search, t, quantities]);
  const labels = { room: 'workspace.tabs.rooms', concrete: 'workspace.tabs.concrete', mesh: 'adaptive.mesh', bars: 'rebar.bars', individual: 'phoneReview.individual', stirrup: 'adaptive.stirrups' } as const;
  const locate = async (item: ReviewItem) => {
    if (busy) return;
    setBusy(true); setError(false);
    try { if (await showOnPlan(item.target)) onShowPlan(); else setError(true); }
    catch { setError(true); }
    finally { setBusy(false); }
  };
  return <div className="phone-review">
    <div className="phone-review-filters">
      <label>{t('phoneReview.scope')}<select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
        <option value="sheet">{t('phoneReview.currentSheet')}</option><option value="plan">{t('phoneReview.currentPlan')}</option><option value="project">{t('phoneReview.project')}</option>
      </select></label>
      <label>{t('phoneReview.search')}<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      {domain === 'rebar' && <label>{t('phoneReview.type')}<select value={type} onChange={(e) => setType(e.target.value)}>
        <option value="all">{t('adaptive.allRebar')}</option>{(['mesh', 'bars', 'individual', 'stirrup'] as const).map((kind) => <option key={kind} value={kind}>{t(labels[kind])}</option>)}
      </select></label>}
    </div>
    {error && <p role="alert">{t('phoneReview.openFailed')}</p>}
    {items.length === 0 && <p className="muted">{t('phoneReview.empty')}</p>}
    {items.map((item) => <article className="phone-review-card" key={item.key}>
      <button className="phone-review-item" aria-expanded={quantities || expanded === item.key} onClick={() => setExpanded(expanded === item.key ? null : item.key)}>
        <strong dir="auto">{item.name}</strong><span>{t(labels[item.type])}</span>
        <small dir="auto">{item.planName} · {t('adaptive.sheet')} {item.target.pageNumber}</small>
        <span dir="auto">{item.specification || '—'}</span>
      </button>
      {(quantities || expanded === item.key) && <div className="phone-review-details">
        {item.quantities.map((line, index) => <p key={index} dir="auto">{line}</p>)}
        {!item.target.points.length && <p className="muted">{t('phoneReview.noGeometry')}</p>}
        <button className="btn-primary" disabled={busy} onClick={() => void locate(item)}>{t('phoneReview.showOnPlan')}</button>
      </div>}
    </article>)}
  </div>;
}
