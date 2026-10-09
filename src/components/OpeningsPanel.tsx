import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { useOpeningsAiUi } from '../lib/ai/openingsUi';
import { useT } from '../i18n';
import { confirmDialog } from '../lib/appDialogs';
import { measuredOpeningWidth, openingClassification, openingPresets, presetOf, suggestOpeningRooms, type OpeningPreset } from '../lib/manualOpenings';
import { buildOpeningQuantityReport, openingQuantityFeedback } from '../lib/openingQuantityReport';
import { validatePlanOpening } from '../lib/planOpenings';
import type { PlanOpening, PlanOpeningPatch } from '../types';
import NumberField from './NumberField';
import Icon from './Icon';
import { OPEN_OPENINGS_REVIEW } from './AiReviewWindow';
import OpeningRoomSelector from './OpeningRoomSelector';
import type { OpeningRoomSide } from '../types/openings';
import './Openings.css';
type TextKey = Exclude<keyof typeof import('../i18n/he').he.openingTools, 'additionalRooms'>;

export default function OpeningsPanel({ readOnly = false, editorOnly = false, hideAiEditor = false }: { readOnly?: boolean; editorOnly?: boolean; hideAiEditor?: boolean }) {
  const t = useT();
  const text = (key: TextKey) => t(`openingTools.${key}`);
  const state = useAppStore();
  const aiScope = useOpeningsAiUi();
  const [preset, setPreset] = useState<OpeningPreset>('hinged');
  const [error, setError] = useState('');
  const selectedIds = state.selectedOpeningIds;
  const setSelectedIds = (ids: string[]) => state.setPlanSelection([], ids);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const latest = useAppStore.getState();
      if (latest.openingPlacement || latest.selectedOpeningId) {
        latest.cancelOpeningPlacement();
        latest.selectPlanOpening(null);
        setError('');
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  useEffect(() => { setError(''); }, [state.selectedOpeningId]);
  const plan = state.project;
  if (!plan) return null;
  const openings = (plan.openings ?? []).filter(o => o.pageNumber === state.currentPage);
  const selection = openings.filter(o => selectedIds.includes(o.id)).map(o => o.id);
  const toggleSelection = (id: string) => {
    state.setToolMode('select'); state.setOverlayVisible('finishes', true);
    setSelectedIds(selectedIds.includes(id) ? selectedIds.filter(selected => selected !== id) : [...selectedIds, id]);
  };
  const editOpening = (item: PlanOpening) => {
    setError(''); state.selectPlanOpening(item.id); state.setToolMode('select'); state.setOverlayVisible('finishes', true);
    if (hideAiEditor && item.aiDetection && aiScope.planId === plan.id && aiScope.pageNumber === state.currentPage && aiScope.sourceHash === item.aiDetection.sourceHash) {
      window.dispatchEvent(new Event(OPEN_OPENINGS_REVIEW));
    }
  };
  const selected = openings.find(o => o.id === state.selectedOpeningId);
  const inAiReview = selected?.aiDetection && aiScope.planId === plan.id && aiScope.pageNumber === state.currentPage && aiScope.sourceHash === selected.aiDetection.sourceHash;
  const o = hideAiEditor && inAiReview ? undefined : selected;
  const patch = (change: PlanOpeningPatch) => {
    if (!o || readOnly) return false;
    try { state.updatePlanOpening(o.id, change); setError(''); return true; } catch { setError(text('invalid')); return false; }
  };
  const rooms = plan.rooms.filter(r => r.pageNumber === state.currentPage);
  const suggested = o ? suggestOpeningRooms(plan, o) : [];
  const sides: [OpeningRoomSide, OpeningRoomSide] = o?.roomSides ?? [o?.roomIds[0] ? { roomId: o.roomIds[0] } : null, o?.roomIds[1] ? { roomId: o.roomIds[1] } : null];
  const associateSides = async (next: [OpeningRoomSide, OpeningRoomSide]) => {
    if (!o || readOnly) return false;
    if (o.roomIds.length <= 2 && JSON.stringify(next) === JSON.stringify(sides)) return true;
    const ids = next.flatMap(side => side && typeof side === 'object' ? [side.roomId] : []);
    if (new Set(ids).size !== ids.length) { setError(text('maxRooms')); return false; }
    if (o.roomIds.length > 2 && !await confirmDialog(text('associationChangeConfirm'))) return false;
    // A confirmation dialog may outlive a page/selection change. Never edit its replacement.
    const latest = useAppStore.getState();
    if (latest.project?.id !== plan.id || latest.selectedOpeningId !== o.id || latest.project.openings?.find(item => item.id === o.id) !== o) return false;
    return patch({ roomIds: ids, roomSides: next, legacyRefs: o.legacyRefs.filter(ref => ids.includes(ref.roomId)), apartmentNumber: undefined });
  };
  const typeKey = (opening: PlanOpening): TextKey => opening.kind === 'door' && opening.mechanism === 'unknown' ? 'unclassifiedDoor' : opening.kind === 'custom' ? 'custom' : presetOf(opening);
  const validation = o ? validatePlanOpening(plan, o) : null;
  const quantityReport = buildOpeningQuantityReport(plan, undefined, new Set([state.currentPage]));
  const feedback = o ? openingQuantityFeedback(plan, o, quantityReport) : null;
  const openingLocation = (item: PlanOpening) => {
    const associated = item.roomIds.flatMap(id => {
      const room = plan.rooms.find(room => room.id === id);
      return room ? [room] : [];
    });
    const apartments = new Set(associated.map(room => room.apartmentNumber));
    const roomNames = associated.map(room => room.name || t('rooms.unnamed'));
    const apartment = associated.length ? associated[0].apartmentNumber : item.apartmentNumber;
    const location = apartments.size > 1
      ? associated.map(room => [room.apartmentNumber ? t('rooms.apartment', {apartment:room.apartmentNumber}) : '', room.name || t('rooms.unnamed')].filter(Boolean).join(' · ')).join(' / ')
      : [apartment ? t('rooms.apartment', {apartment}) : '', roomNames.join(' / ')].filter(Boolean).join(' · ');
    const exterior = item.roomSides?.includes('exterior') ? text('exterior') : '';
    return [location, exterior].filter(Boolean).join(' · ') || text('unassignedSide');
  };
  const quantityStatus = (item: PlanOpening) => {
    const status = openingQuantityFeedback(plan, item, quantityReport);
    return t(`openingQuantities.${status.affects ? status.reasons.includes('capped') ? 'capped' : 'affectsQuantities' : status.legacy ? 'legacyPrecedence' : 'noDeduction'}`);
  };
  return <section className="openings-panel" aria-label={text('title')}>
    {!editorOnly && !readOnly && <div className="opening-creation-methods">
      <div className="opening-actions">
          <select aria-label={text('type')} value={preset} onChange={e => setPreset(e.target.value as OpeningPreset)}>
            {openingPresets.map(p => <option key={p} value={p}>{text(p)}</option>)}
          </select>
          <button className="btn-primary" onClick={() => { setError(''); state.beginOpeningPlacement(preset); }}>{text('planMethod')}</button>
      </div>
      <button className="btn-secondary" onClick={() => {try {state.beginQuantityOpening(preset);setError('');} catch {setError(text('invalid'));}}}>{text('takeoffMethod')}</button>
    </div>}
    {state.openingPlacement && <div role="status" className="opening-placement-note opening-cancel-bar">
      <span>{text(state.openingPlacement.start ? 'second' : 'first')}</span>
      <button className="btn-secondary" onClick={state.cancelOpeningPlacement}>{text('cancel')} · Esc</button>
    </div>}
    {!editorOnly && <>
    {!openings.length && <p className="opening-help">{text('empty')}</p>}
    {openings.length > 0 && <h3 className="opening-list-heading section-label">{text('listHeading')}</h3>}
    {!readOnly && selection.length > 0 && <div className="room-apartment-assignment">
      <div className="room-assignment-actions">
        <label className="room-assignment-select-all"><input type="checkbox" checked={selection.length === openings.length}
          ref={input => { if (input) input.indeterminate = selection.length > 0 && selection.length < openings.length; }}
          onChange={event => setSelectedIds(event.target.checked ? openings.map(o => o.id) : [])} />{t('openingListSelection.selectAll')}</label>
        <button className="btn-secondary small danger" onClick={async () => {
          if (!await confirmDialog(t('openingListSelection.confirm', { count: selection.length }), { destructive: true })) return;
          const latest = useAppStore.getState();
          if (latest.project !== plan || latest.currentPage !== state.currentPage) return;
          latest.removePlanOpenings(selection); setSelectedIds([]);
        }}>{t('openingListSelection.delete')}</button>
      </div>
      <span className="muted" role="status">{t('openingListSelection.selected', { count: selection.length })}</span>
    </div>}
    <div className="opening-list" aria-label={text('allPage')}>
      {openings.map(item => <div key={item.id} className={`opening-list-row ${o?.id === item.id ? 'selected' : ''}`}>
        <button type="button" className="btn-ghost opening-list-item" onClick={() => editOpening(item)}>
          <span className="opening-list-label"><span>{item.label || text(typeKey(item))}</span><small>{openingLocation(item)}{item.aiDetection?` · AI · ${text(item.approval.status)}`:''}</small></span>
        </button>
        {!readOnly && <div className="opening-list-row-actions">
          <button type="button" className="icon-btn" title={t('openingListSelection.edit')} aria-label={`${t('openingListSelection.edit')} · ${item.label || text(typeKey(item))}`} onClick={() => editOpening(item)}><Icon name="edit" /></button>
          <button type="button" className="icon-btn" title={text('duplicate')} aria-label={`${text('duplicate')} · ${item.label || text(typeKey(item))}`} onClick={event=>{
            event.stopPropagation();
            try {state.duplicatePlanOpening(item.id);setError('');} catch {setError(text('invalid'));}
          }}><Icon name="copy" /></button>
          <button type="button" className="icon-btn danger" title={text('delete')} aria-label={`${text('delete')} · ${item.label || text(typeKey(item))}`} onClick={async event=>{
            event.stopPropagation();
            if(await confirmDialog(text('deleteConfirm'),{destructive:true})){
              const latest=useAppStore.getState();
              if(latest.project?.id===plan.id) latest.removePlanOpening(item.id);
            }
          }}><Icon name="trash" /></button>
          <input type="checkbox" className="room-assignment-checkbox" aria-label={t('openingListSelection.select', { name: item.label || text(typeKey(item)) })}
            checked={selectedIds.includes(item.id)} onChange={() => toggleSelection(item.id)} />
        </div>}
      </div>)}
    </div>
    </>}
    {!editorOnly && o && <div className="opening-editor-header">
      <button type="button" className="icon-btn" aria-label={text('backToOpenings')} title={text('backToOpenings')} onClick={()=>{
        state.cancelOpeningPlacement();
        state.selectPlanOpening(null);
        setError('');
      }}>×</button>
    </div>}
    {o && <fieldset key={o.id} disabled={readOnly} className="opening-editor">
      {o.aiDetection && <div className="opening-placement-note"><strong>{o.approval.status==='draft'?t('openingAi.draft'):text(o.approval.status)}</strong>
        <p>{[...(o.aiDetection.provenance?.original.evidence??o.aiDetection.deferred?.evidence??[]),...(o.aiDetection.provenance?.original.ambiguities??[])].join(' · ')}</p>
        {!o.geometry && <><p>{t('openingAi.deferred')}</p><button type="button" className="btn-secondary" onClick={()=>state.beginOpeningEndpointEdit(o.id)}>{t('openingAi.place')}</button></>}
      </div>}
      {feedback && <div className="opening-quantity-feedback" aria-label={t('openingQuantities.eligibility')}>
        <strong role="status">{quantityStatus(o)}</strong>
        <p>{t('openingQuantities.counted')}: {feedback.counted ?? '—'}</p>
        {feedback.missing.length > 0 && <p>{t('openingQuantities.missing')}: {feedback.missing.map(key => t(`openingQuantities.${key}`)).join(' / ')}</p>}
        {feedback.reasons.length > 0 && <ul>{feedback.reasons.map(reason => <li key={reason}>{t(`openingQuantities.${reason}`)}</li>)}</ul>}
        {feedback.work.length === 0 && o.roomIds.length > 0 && <p>{t('openingQuantities.noWorkItems')}</p>}
        {feedback.work.length > 0 && <ul>{feedback.work.map(item => <li key={`${item.roomId}-${item.itemId}`}>
          <strong>{plan.rooms.find(room => room.id === item.roomId)?.name} · {t(`workTypes.${item.type}`)}</strong>: {' '}
          {item.openingAudit.reason ? t(`openingQuantities.${item.openingAudit.reason}`) : item.capped ? t('openingQuantities.capped') :
            `${t('openingQuantities.deducted')}: ${Number((item.unit === 'lm' ? item.openingAudit.lengthM : item.openingAudit.areaM2).toFixed(2))} ${t(`units.${item.unit}`)}`}
        </li>)}</ul>}
      </div>}
      <div className="form-grid">
        <label className="form-row">{text('type')}<select value={typeKey(o)} onChange={e => patch(e.target.value === 'custom' ? {kind:'custom',mechanism:'unknown',walkableAccess:'unknown'} : openingClassification(e.target.value as OpeningPreset))}>
          {openingPresets.map(p => <option key={p} value={p}>{text(p)}</option>)}
          {typeKey(o) === 'unclassifiedDoor' && <option value="unclassifiedDoor">{text('unclassifiedDoor')}</option>}
          <option value="custom">{text('custom')}</option>
        </select></label>
        <label className="form-row">{text('mechanism')}<select value={o.mechanism} onChange={e => patch({ mechanism: e.target.value as PlanOpening['mechanism'] })}>
          {(['hinged','sliding','fixed','open','unknown'] as const).map(m => <option key={m} value={m}>{text(m === 'unknown' ? 'unknownMechanism' : m)}</option>)}
        </select></label>
        <label className="form-row">{text('access')}<select value={o.walkableAccess} onChange={e => patch({ walkableAccess: e.target.value as PlanOpening['walkableAccess'] })}>
          {(['supported','unsupported','unknown'] as const).map(v => <option key={v} value={v}>{text(v === 'unknown' ? 'unknownAccess' : v)}</option>)}
        </select></label>
        <label className="form-row">{text('label')}<input value={o.label ?? ''} onChange={e => patch({ label: e.target.value })} /></label>
        {(['widthM','heightM','sillHeightM'] as const).map((key, index) => <label className="form-row" key={key}>{text((['width','height','sill'] as const)[index])}
          <NumberField value={o[key] ?? undefined} onChange={value => {
            if (value !== undefined && (key === 'sillHeightM' ? value < 0 : value <= 0)) { setError(text('invalid')); return; }
            patch({ [key]: value ?? null, ...(key === 'widthM' ? { widthSource: 'manual' as const } : {}) });
          }} />
        </label>)}
      </div>
      {o.geometry && <>
      <button className="btn-secondary small" disabled={measuredOpeningWidth(plan,o.pageNumber,o.geometry) === null} onClick={() => patch({ widthM: measuredOpeningWidth(plan,o.pageNumber,o.geometry), widthSource: 'calibration' })}>{text('measured')}</button>
      {measuredOpeningWidth(plan,o.pageNumber,o.geometry) === null && <p className="opening-help">{text('noCalibration')}</p>}</>}
      <label className="form-row">{t('openingQuantities.quantity')}<NumberField step="1" value={o.quantity ?? undefined} onChange={value=>{
        if(value!==undefined&&(!Number.isInteger(value)||value<=0)){setError(text('invalid'));return;}
        patch({quantity:value??null});
      }}/></label>
      <label className="form-row">{text('notes')}<textarea rows={2} value={o.notes ?? ''} onChange={e => patch({ notes: e.target.value })} /></label>
      {o.geometry && <><button className="btn-secondary small opening-reposition" onClick={() => state.beginOpeningEndpointEdit(o.id)}>{text('reposition')}</button>
      <details className="opening-advanced"><summary>{text('advanced')}</summary>
        {o.geometry && <div className="form-grid opening-coordinate-grid" dir="ltr">{(['endpointA','endpointB'] as const).flatMap((endpoint,i) => (['x','y'] as const).map(axis => <label className="form-row" key={endpoint+axis}>{i === 0 ? 'A' : 'B'} {axis}
          <input type="number" step="any" value={o.geometry![endpoint][axis]} onChange={e => {
            if (!e.target.value.trim()) return;
            const value=Number(e.target.value); if (!Number.isFinite(value)) return;
            patch({ geometry: { ...o.geometry!, [endpoint]: { ...o.geometry![endpoint], [axis]: value } } });
          }} />
        </label>))}</div>}
      </details>
</>}
      <div className="opening-associations"><strong>{text('rooms')}</strong>
        <div className="opening-side-grid">
          {sides.map((side, index) => <OpeningRoomSelector key={`${o.id}-${index}`} label={text(index === 0 ? 'sideA' : 'sideB')}
            value={side} rooms={rooms} otherRoomId={sides[1 - index] && typeof sides[1 - index] === 'object' ? (sides[1 - index] as { roomId: string }).roomId : undefined}
            onChange={value => associateSides(index === 0 ? [value, sides[1]] : [sides[0], value])} />)}
        </div>
        {o.roomIds.length > 2 && <p className="opening-help">{t('openingTools.additionalRooms', { names: o.roomIds.slice(2).map(id => rooms.find(room => room.id === id)?.name || id).join(', ') })}</p>}
      </div>
      <label className="opening-review-check"><input type="checkbox" disabled={o.roomIds.length===0} checked={o.quantityReview?.associationsConfirmed??false} onChange={e=>patch({quantityReview:{associationsConfirmed:e.target.checked,distinctLegacyRoomIds:o.quantityReview?.distinctLegacyRoomIds??[]}})}/>{t('openingQuantities.confirmRooms')}</label>
      {rooms.filter(room=>o.roomIds.includes(room.id)&&(room.openings?.length??0)>0).map(room=><div key={room.id} className="opening-associations">
        <strong>{room.name} - {t('openingQuantities.legacyLinks')}</strong>
        {(room.openings??[]).map(row=>{
          const linkedElsewhere=(plan.openings??[]).some(other=>other.id!==o.id&&other.legacyRefs.some(ref=>ref.roomId===room.id&&ref.openingId===row.id));
          const linked=o.legacyRefs.some(ref=>ref.roomId===room.id&&ref.openingId===row.id);
          return <label key={row.id}><input type="checkbox" disabled={linkedElsewhere} checked={linked} onChange={e=>patch({legacyRefs:e.target.checked?[...o.legacyRefs,{roomId:room.id,openingId:row.id}]:o.legacyRefs.filter(ref=>ref.roomId!==room.id||ref.openingId!==row.id)})}/>{t(`openingTypes.${row.type}`)} - {row.widthM} x {row.heightM} - {row.quantity}</label>;
        })}
        <label><input type="checkbox" checked={o.quantityReview?.distinctLegacyRoomIds.includes(room.id)??false} onChange={e=>patch({quantityReview:{associationsConfirmed:o.quantityReview?.associationsConfirmed??false,distinctLegacyRoomIds:e.target.checked?[...(o.quantityReview?.distinctLegacyRoomIds??[]),room.id]:(o.quantityReview?.distinctLegacyRoomIds??[]).filter(id=>id!==room.id)}})}/>{t('openingQuantities.distinctLegacy')}</label>
      </div>)}
      {suggested.length > 0 && JSON.stringify([...suggested].sort()) !== JSON.stringify([...o.roomIds].sort()) && <div className="opening-placement-note">
        {text('suggestion')}: {suggested.map(id=>rooms.find(r=>r.id===id)?.name).join(' / ')}
        <button className="btn-secondary small" onClick={() => void associateSides([suggested[0] ? { roomId: suggested[0] } : null, suggested[1] ? { roomId: suggested[1] } : null])}>{text('acceptSuggestion')}</button>
      </div>}
      {!editorOnly && <div className="opening-actions">
        {o.approval.status !== 'approved' && <button className="btn-primary small" disabled={!validation?.canApprove} onClick={()=>{
          try {
            state.approvePlanOpening(o.id);
            const latest=useAppStore.getState();
            if(latest.project?.id===plan.id && latest.selectedOpeningId===o.id && latest.project.openings?.find(item=>item.id===o.id)?.approval.status==='approved'){
              latest.cancelOpeningPlacement();
              latest.selectPlanOpening(null);
              setError('');
            }
          } catch {setError(text('invalid'));}
        }}>{text('approve')}</button>}
        {o.approval.status !== 'draft' && <button className="btn-secondary small" onClick={()=>state.draftPlanOpening(o.id)}>{text('returnDraft')}</button>}
        <button className="btn-secondary small" onClick={()=>state.duplicatePlanOpening(o.id)}>{text('duplicate')}</button>
        <button className="btn-ghost small danger" onClick={async()=>{if(await confirmDialog(text('deleteConfirm'),{destructive:true})) state.removePlanOpening(o.id);}}>{text('delete')}</button>
      </div>}
    </fieldset>}
    {error && <p role="alert" className="opening-error">{error}</p>}
  </section>;
}
