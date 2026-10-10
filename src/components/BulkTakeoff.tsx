import { useEffect, useMemo, useState } from 'react';
import type { Plan, WorkItem, WorkType } from '../types';
import { formatNumber, useT } from '../i18n';
import { useAppStore } from '../store/appStore';
import { bulkRooms, planBulkTakeoff, validBulkConfig, type BulkConflictPolicy, type BulkRoomChange, type BulkWorkConfig } from '../lib/bulkTakeoff';
import { calculateWorkItem, effectiveHeightM, effectiveWastePercent, itemDeductsOpenings, roomMetrics } from '../lib/quantities';
import { WORK_TYPE_ORDER, workTypeDefinition } from '../lib/workTypes';
import { roomProfileLabel } from '../lib/roomProfiles';
import { canAuthorTakeoff } from '../lib/workspaceCapabilities';
import { notify } from '../lib/appDialogs';
import { useBulkTakeoffDialog } from './bulkTakeoffEntry';
import AppModal from './AppModal';
import './BulkTakeoff.css';

const STEPS = ['selectRooms', 'chooseItems', 'configure', 'preview'] as const;
const POLICIES: BulkConflictPolicy[] = ['add-missing', 'update-existing', 'skip-conflicts'];
const POLICY_KEYS = { 'add-missing': 'addMissing', 'update-existing': 'updateExisting', 'skip-conflicts': 'skipConflicts' } as const;
function initialConfig(type: WorkType, plan: Plan): BulkWorkConfig {
  const item: WorkItem = { id: '', type, ...(type === 'tiling' ? { tilingCategory: 'regular' } : {}) };
  return { type, tilingCategory: item.tilingCategory,
    heightM: workTypeDefinition(type)?.height ? effectiveHeightM(item, plan) : undefined,
    wastePercent: effectiveWastePercent(item, plan), deductOpenings: itemDeductsOpenings(item) };
}
export default function BulkTakeoff() {
  const plan = useAppStore(s => s.project);
  const { planId, pageNumber, close } = useBulkTakeoffDialog();
  useEffect(() => { if (planId && plan?.id !== planId) close(); }, [plan?.id, planId, close]);
  if (!plan || plan.id !== planId || !canAuthorTakeoff()) return null;
  return <BulkWorkspace key={plan.id} plan={plan} initialPage={pageNumber} onClose={close} />;
}
function BulkWorkspace({ plan, initialPage, onClose }: { plan: Plan; initialPage: number | null; onClose: () => void }) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [typeFilter, setTypeFilter] = useState('*'), [apartmentFilter, setApartmentFilter] = useState('*');
  const [pageFilter, setPageFilter] = useState(initialPage ? String(initialPage) : '*'), [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [configs, setConfigs] = useState<BulkWorkConfig[]>([]);
  const [policy, setPolicy] = useState<BulkConflictPolicy>('add-missing');
  const [reviewedPlan, setReviewedPlan] = useState<Plan | null>(null);
  const [confirmed, setConfirmed] = useState(false), [error, setError] = useState('');
  const rooms = useMemo(() => bulkRooms(plan), [plan]);
  const visible = rooms.filter(r => (typeFilter === '*' || (r.roomType ?? '') === typeFilter) &&
    (apartmentFilter === '*' || r.apartmentNumber === apartmentFilter) &&
    (pageFilter === '*' || String(r.pageNumber) === pageFilter) &&
    (!search.trim() || `${r.name} ${r.apartmentNumber}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
  const visibleIds = new Set(visible.map(r => r.id));
  const hiddenCount = selected.filter(id => !visibleIds.has(id)).length;
  const types = [...new Set(rooms.map(r => r.roomType ?? ''))];
  const apartments = [...new Set(rooms.map(r => r.apartmentNumber))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const pages = [...new Set(rooms.map(r => r.pageNumber))].sort((a, b) => a - b);
  const snapshot = step === 3 && reviewedPlan ? reviewedPlan : plan;
  const preview = useMemo(() => planBulkTakeoff(snapshot, selected, configs, policy), [snapshot, selected, configs, policy]);
  const stale = step === 3 && reviewedPlan !== plan;
  const settingsValid = configs.length > 0 && configs.every(c => validBulkConfig(c, plan));
  const toggleRoom = (id: string) => setSelected(old => old.includes(id) ? old.filter(x => x !== id) : [...old, id]);
  const patchConfig = (type: WorkType, patch: Partial<BulkWorkConfig>) => setConfigs(old => old.map(c => c.type === type ? { ...c, ...patch } : c));
  const refreshPreview = () => { setReviewedPlan(plan); setConfirmed(false); setError(''); };
  const apply = () => {
    if (stale || !reviewedPlan || !preview.changedCount || (policy === 'update-existing' && !confirmed)) return;
    const result = useAppStore.getState().applyBulkTakeoff(reviewedPlan, selected, configs, policy, confirmed);
    if (result === 'applied') { notify(t('bulkTakeoff.success', { count: preview.changedCount })); onClose(); }
    else setError(t(result === 'stale' ? 'bulkTakeoff.stale' : 'bulkTakeoff.failed'));
  };
  return <AppModal className="bulk-dialog" showClose title={t('bulkTakeoff.title')} onCancel={onClose}>
    <div className="bulk-body">
    <p className="bulk-scope"><strong>{t('bulkTakeoff.scope', { name: plan.name })}</strong></p>
    <p className="muted">{t('bulkTakeoff.scopeNote')}</p>
    <ol className="bulk-steps" aria-label={t('bulkTakeoff.title')}>
      {STEPS.map((key, i) => <li key={key} aria-current={step === i ? 'step' : undefined} className={step === i ? 'active' : ''}>{i + 1}. {t(`bulkTakeoff.${key}`)}</li>)}
    </ol>
    <section className="bulk-content" aria-labelledby="bulk-step-title">
      <h3 id="bulk-step-title">{t(`bulkTakeoff.${STEPS[step]}`)}</h3>
      {step === 0 && <>
        <div className="bulk-filters">
          <label>{t('bulkTakeoff.type')}<select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="*">{t('bulkTakeoff.all')}</option>{types.map(type => <option key={type} value={type}>{roomProfileLabel(type, t) ?? t('rooms.detail.noType')}</option>)}
          </select></label>
          <label>{t('bulkTakeoff.apartment')}<select value={apartmentFilter} onChange={e => setApartmentFilter(e.target.value)}>
            <option value="*">{t('bulkTakeoff.all')}</option>{apartments.map(a => <option key={a} value={a}>{a || t('rooms.unassigned')}</option>)}
          </select></label>
          <label>{t('bulkTakeoff.page')}<select value={pageFilter} onChange={e => setPageFilter(e.target.value)}>
            <option value="*">{t('bulkTakeoff.all')}</option>{pages.map(page => <option key={page} value={page}>{page}</option>)}
          </select></label>
          <label>{t('bulkTakeoff.search')}<input value={search} onChange={e => setSearch(e.target.value)} /></label>
        </div>
        <div className="bulk-selection-actions">
          <button className="btn-secondary" disabled={!visible.length} onClick={() => setSelected(old => [...new Set([...old, ...visible.map(r => r.id)])])}>{t('bulkTakeoff.selectAll')}</button>
          <button className="btn-ghost" disabled={!selected.length} onClick={() => setSelected([])}>{t('bulkTakeoff.clear')}</button>
          <span role="status">{t('bulkTakeoff.selected', { count: selected.length })} · {t('bulkTakeoff.visible', { count: visible.length })}</span>
        </div>
        {!!hiddenCount && <p className="bulk-notice">{t('bulkTakeoff.hidden', { count: hiddenCount })}</p>}
        {!visible.length && <p>{t(rooms.length ? 'bulkTakeoff.empty' : 'bulkTakeoff.noRooms')}</p>}
        <div className="bulk-room-list">{visible.map(r => <label className="bulk-room-row" key={r.id}>
          <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleRoom(r.id)} />
          <span><strong dir="auto">{r.name}</strong><small>{roomProfileLabel(r.roomType, t) ?? t('rooms.detail.noType')}</small></span>
          <span>{r.apartmentNumber ? t('rooms.apartment', { apartment: r.apartmentNumber }) : t('rooms.unassigned')}</span>
          <span>{t('aiDetection.page', { page: r.pageNumber })}</span>
        </label>)}</div>
      </>}
      {step === 1 && <div className="bulk-type-grid">{WORK_TYPE_ORDER.map(type => <label className="bulk-type-choice" key={type}>
        <input type="checkbox" checked={configs.some(c => c.type === type)} onChange={e => setConfigs(old => e.target.checked ? [...old, initialConfig(type, plan)] : old.filter(c => c.type !== type))} />
        <span>{t(`workTypes.${type}`)}</span>
      </label>)}</div>}
      {step === 2 && <>
        <p className="muted">{t('bulkTakeoff.settingsNote')}</p>
        <div className="bulk-config-grid">{configs.map(c => {
          const def = workTypeDefinition(c.type)!;
          return <fieldset key={c.type}><legend>{t(`workTypes.${c.type}`)}</legend>
            {c.type === 'tiling' && <label>{t('rooms.detail.tilingCategory')}<select value={c.tilingCategory ?? 'regular'} onChange={e => {
              const category = e.target.value as 'regular' | 'as';
              const previousDefault = effectiveWastePercent({ ...c, id: '', wastePercent: undefined }, plan);
              patchConfig(c.type, { tilingCategory: category, ...(c.wastePercent === previousDefault ?
                { wastePercent: effectiveWastePercent({ ...c, id: '', tilingCategory: category, wastePercent: undefined }, plan) } : {}) });
            }}>
              <option value="regular">{t('tilingCategories.regular')}</option><option value="as">{t('tilingCategories.as')}</option>
            </select></label>}
            {def.height && <label>{t(`workTypeHeights.${c.type as Exclude<WorkType, 'tiling'>}`)}
              <input type="number" step="0.01" min={def.basis === 'floorAndUpturn' ? 0 : 0.01} value={Number.isFinite(c.heightM) ? c.heightM : ''} onChange={e => patchConfig(c.type, { heightM: e.target.valueAsNumber })} />
              <small>{t('bulkTakeoff.requiredHeight')}</small>
            </label>}
            <label>{t('rooms.detail.waste')}<input type="number" step="1" min="0" max="100" value={Number.isFinite(c.wastePercent) ? c.wastePercent : ''} onChange={e => patchConfig(c.type, { wastePercent: e.target.valueAsNumber })} /></label>
            {!!def.deductedOpeningTypes.length && <label className="bulk-check"><input type="checkbox" checked={c.deductOpenings ?? def.deductsOpenings} onChange={e => patchConfig(c.type, { deductOpenings: e.target.checked })} />
              <span>{t(c.type === 'panels' ? 'rooms.detail.deductDoors' : 'rooms.detail.deductOpenings')}</span>
            </label>}
          </fieldset>;
        })}</div>
        {!settingsValid && <p className="bulk-notice" role="alert">{t('bulkTakeoff.configuration')}</p>}
        <fieldset className="bulk-policies"><legend>{t('bulkTakeoff.policy')}</legend>{POLICIES.map(p => <label key={p}>
          <input type="radio" name="bulk-policy" checked={policy === p} onChange={() => { setPolicy(p); setConfirmed(false); }} />
          <span><strong>{t(`bulkTakeoff.${POLICY_KEYS[p]}`)}</strong><small>{t(`bulkTakeoff.${POLICY_KEYS[p]}Note`)}</small></span>
        </label>)}</fieldset>
      </>}
      {step === 3 && <>
        <div className="bulk-counts" role="status">
          {([['selected', preview.selectedCount], ['updated', preview.changedCount], ['skipped', preview.skippedCount], ['blocked', preview.blockedCount], ['conflicts', preview.conflictCount]] as const).map(([key, count]) =>
            <div key={key}><strong>{count}</strong><span>{key === 'selected' ? t('bulkTakeoff.selectRooms') : t(`bulkTakeoff.${key}`)}</span></div>)}
        </div>
        <p><strong>{t('bulkTakeoff.policy')}:</strong> {t(`bulkTakeoff.${POLICY_KEYS[policy]}`)}</p>
        <ul className="bulk-config-summary">{configs.map(c => <li key={c.type}><strong>{t(`workTypes.${c.type}`)}</strong>: {c.type === 'tiling' && `${t(`tilingCategories.${c.tilingCategory ?? 'regular'}`)} · `}
          {workTypeDefinition(c.type)?.height && <>{t(`workTypeHeights.${c.type as Exclude<WorkType, 'tiling'>}`)}: {formatNumber(effectiveHeightM({ ...c, id: '' }, snapshot))} · </>}
          {t('rooms.detail.waste')}: {formatNumber(effectiveWastePercent({ ...c, id: '' }, snapshot))}%
          {!!workTypeDefinition(c.type)?.deductedOpeningTypes.length && <> · {t('bulkTakeoff.deductions')}: {t(c.deductOpenings ? 'bulkTakeoff.yes' : 'bulkTakeoff.no')}</>}
        </li>)}</ul>
        {stale && <p className="bulk-notice" role="alert">{t('bulkTakeoff.stale')} <button className="btn-secondary" onClick={refreshPreview}>{t('bulkTakeoff.refresh')}</button></p>}
        <p className="muted">{t('bulkTakeoff.blockedNote')}</p>
        <p className="muted">{t('bulkTakeoff.changedQuantityNote')}</p>
        <div className="bulk-table-scroll"><table className="bulk-preview-table"><thead><tr>
          <th>{t('bulkTakeoff.room')}</th><th>{t('bulkTakeoff.page')}</th><th>{t('bulkTakeoff.status')}</th><th>{t('bulkTakeoff.changes')}</th><th>{t('bulkTakeoff.quantities')}</th>
        </tr></thead><tbody>{preview.entries.map(e => <PreviewRow key={e.roomId} entry={e} plan={snapshot} policy={policy} />)}</tbody></table></div>
        {policy === 'update-existing' && <div className="bulk-notice"><p>{t('bulkTakeoff.updateWarning')}</p>
          <label className="bulk-check"><input type="checkbox" checked={confirmed && !stale} disabled={stale} onChange={e => setConfirmed(e.target.checked)} /><span>{t('bulkTakeoff.confirmUpdate')}</span></label>
        </div>}
        {!preview.changedCount && <p role="status">{t('bulkTakeoff.nothing')}</p>}
      </>}
      {error && <p className="bulk-notice" role="alert">{error}</p>}
    </section>
    </div>
    <footer className="bulk-footer"><span>{t('bulkTakeoff.selected', { count: selected.length })}</span><div className="modal-actions">
      <button className="btn-ghost" onClick={onClose}>{t('bulkTakeoff.cancel')}</button>
      {step > 0 && <button className="btn-secondary" onClick={() => { setStep(step - 1); setConfirmed(false); setError(''); }}>{t('bulkTakeoff.back')}</button>}
      {step < 3 ? <button className="btn-primary" disabled={step === 0 ? !selected.length : step === 1 ? !configs.length : !settingsValid} onClick={() => { if (step === 2) refreshPreview(); setStep(step + 1); }}>{t('bulkTakeoff.next')}</button>
        : <button className="btn-primary" disabled={stale || !preview.changedCount || (policy === 'update-existing' && !confirmed)} onClick={apply}>{t('bulkTakeoff.apply', { count: preview.changedCount })}</button>}
    </div></footer>
  </AppModal>;
}
function PreviewRow({ entry: e, plan, policy }: { entry: BulkRoomChange; plan: Plan; policy: BulkConflictPolicy }) {
  const t = useT();
  const room = plan.rooms.find(r => r.id === e.roomId);
  const changes = [...e.additions, ...e.updates.map(u => u.config)];
  const metrics = room ? roomMetrics(room, plan.pages[room.pageNumber]?.calibration ?? null) : null;
  return <tr><td><strong dir="auto">{room?.name ?? e.roomId}</strong><small>{room?.apartmentNumber ? t('rooms.apartment', { apartment: room.apartmentNumber }) : t('rooms.unassigned')}</small></td>
    <td>{room?.pageNumber ?? '—'}</td><td><span className={`bulk-result ${e.status}`}>{t(e.status === 'updated' ? 'bulkTakeoff.willUpdate' : e.status === 'blocked' ? 'bulkTakeoff.willBlock' : 'bulkTakeoff.willSkip')}</span>
      {e.issues.map(issue => <small key={issue}>{t(`bulkTakeoff.${issue}`)}</small>)}
      {e.status === 'skipped' && <small>{t(policy === 'skip-conflicts' && e.conflicts.length ? 'bulkTakeoff.conflictSkipped' : 'bulkTakeoff.unchanged')}</small>}
    </td><td>{e.additions.length > 0 && <div>{t('bulkTakeoff.newItems', { count: e.additions.length })}</div>}{e.updates.length > 0 && <div>{t('bulkTakeoff.updatedItems', { count: e.updates.length })}</div>}
      {e.conflicts.length > 0 && <small>{t('bulkTakeoff.conflicts')}: {e.conflicts.map(type => t(`workTypes.${type}`)).join(', ')}</small>}
    </td><td>{e.status !== 'updated' || !room || !metrics ? '—' : changes.map(c => {
      const item: WorkItem = { ...c, id: '' }, def = workTypeDefinition(c.type)!;
      const calc = calculateWorkItem(item, room, metrics.areaM2, metrics.perimeterM, plan);
      const value = def.unit === 'lm' ? calc.lengthM! : calc.netM2;
      return <div key={c.type}>{t(`workTypes.${c.type}`)}: <bdi>{formatNumber(value)} / {formatNumber(value * (1 + effectiveWastePercent(item, plan) / 100))}</bdi> {t(`units.${def.unit}`)}</div>;
    })}</td></tr>;
}
