import { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { useT } from '../i18n';
import { buildOpeningSchedule, type OpeningReason } from '../lib/openingQuantities';
import { addPlanOpening, reviewPlanOpening } from '../lib/planOpenings';
import { quantityOpeningInput } from '../lib/manualOpenings';
import NumberField from './NumberField';
import type { PlanOpening } from '../types';

/** Unsaved input only: cancellation never creates or removes a persisted opening. */
export default function QuantityOpeningForm({ onClose }: { onClose: () => void }) {
  const t = useT();
  const plan = useAppStore(s => s.project);
  const page = useAppStore(s => s.currentPage);
  const activeApartment = useAppStore(s => s.activeApartmentNumber);
  const [apartment, setApartment] = useState<string | null>(null);
  const [roomId, setRoomId] = useState('');
  const [kind, setKind] = useState<'door' | 'window' | 'custom'>('door');
  const [dimensions, setDimensions] = useState<Pick<PlanOpening, 'widthM' | 'heightM' | 'sillHeightM' | 'quantity'>>({widthM:null,heightM:null,sillHeightM:null,quantity:null});
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [walkable, setWalkable] = useState(false);
  const [legacyIds, setLegacyIds] = useState<string[]>([]);
  const [distinctLegacy, setDistinctLegacy] = useState(false);
  const resetRoomReview = () => {setConfirmed(false);setLegacyIds([]);setDistinctLegacy(false);};
  if (!plan) return null;
  const rooms = plan.rooms.filter(room => room.pageNumber === page);
  const apartments = [...new Set(rooms.map(room => room.apartmentNumber))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const chosen = apartment ?? (apartments.includes(activeApartment) ? activeApartment : apartments[0] ?? '');
  const apartmentRooms = rooms.filter(room => room.apartmentNumber === chosen);
  const valid = apartmentRooms.some(room => room.id === roomId) &&
    dimensions.widthM !== null && dimensions.widthM > 0 && dimensions.heightM !== null && dimensions.heightM > 0 &&
    dimensions.sillHeightM !== null && dimensions.sillHeightM >= 0 && dimensions.quantity !== null && dimensions.quantity > 0 && Number.isInteger(dimensions.quantity);
  const room = apartmentRooms.find(item=>item.id===roomId);
  const input = room ? {...quantityOpeningInput(plan,roomId,kind,dimensions),
    walkableAccess: kind==='door' && walkable ? 'supported' as const : kind==='window' ? 'unsupported' as const : 'unknown' as const,
    legacyRefs: legacyIds.map(openingId=>({roomId,openingId})),
    quantityReview:{associationsConfirmed:confirmed,distinctLegacyRoomIds:distinctLegacy?[roomId]:[]}} : null;
  let blocked: OpeningReason[] = [];
  if(valid && input){
    try {
      const previewId='quantity-form-preview';
      const preview=reviewPlanOpening(addPlanOpening(plan,input,previewId,Date.now()),previewId,'approved',Date.now());
      blocked=buildOpeningSchedule(preview).find(row=>row.id===previewId)!.reasons.filter(reason=>reason!=='legacyPrecedence');
    } catch {blocked=['invalid'];}
  }
  return <section className="opening-method-form" aria-label={t('openingTools.takeoffMethod')}>
    <div className="opening-method-heading">
      <button type="button" className="icon-btn" aria-label={t('common.cancel')} onClick={onClose}>×</button>
    </div>
    <div className="form-grid">
      <label className="form-row">{t('rooms.detail.apartment')}<select value={chosen} onChange={e=>{setApartment(e.target.value);setRoomId('');resetRoomReview();}}>
        {apartments.map(number=><option key={number} value={number}>{number ? t('rooms.apartment',{apartment:number}) : t('rooms.unassigned')}</option>)}
      </select></label>
      <label className="form-row">{t('openingTools.quantityRoom')}<select value={roomId} onChange={e=>{setRoomId(e.target.value);resetRoomReview();}}>
        <option value="">{t('openingTools.chooseRoom')}</option>
        {apartmentRooms.map(room=><option key={room.id} value={room.id}>{room.name || t('rooms.unnamed')}</option>)}
      </select></label>
      <label className="form-row">{t('openingTools.type')}<select value={kind} onChange={e=>{setKind(e.target.value as typeof kind);setWalkable(false);}}>
        {(['door','window','custom'] as const).map(type=><option key={type} value={type}>{t(`openingTypes.${type}`)}</option>)}
      </select></label>
      {(['widthM','heightM','sillHeightM','quantity'] as const).map((key,index)=><label key={key} className="form-row">{t(`openingQuantities.${(['width','height','base','quantity'] as const)[index]}`)}
        <NumberField value={dimensions[key] ?? undefined} step={key==='quantity'?'1':'0.01'} onChange={value=>setDimensions({...dimensions,[key]:value??null})}/>
      </label>)}
    </div>
    {room && <label className="opening-review-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{t('openingQuantities.confirmRooms')}</label>}
    {kind==='door' && <label className="opening-review-check"><input type="checkbox" checked={walkable} onChange={e=>setWalkable(e.target.checked)}/>{t('openingTools.confirmWalkable')}</label>}
    {room && (room.openings?.length??0)>0 && <div className="opening-associations">
      <strong>{t('openingQuantities.legacyLinks')}</strong>
      {(room.openings??[]).map(row=>{
        const linkedElsewhere=(plan.openings??[]).some(other=>other.legacyRefs.some(ref=>ref.roomId===room.id&&ref.openingId===row.id));
        return <label key={row.id}><input type="checkbox" disabled={linkedElsewhere} checked={legacyIds.includes(row.id)} onChange={e=>setLegacyIds(e.target.checked?[...legacyIds,row.id]:legacyIds.filter(id=>id!==row.id))}/>{t(`openingTypes.${row.type}`)} · {row.widthM} × {row.heightM} · {row.quantity}</label>;
      })}
      <label><input type="checkbox" checked={distinctLegacy} onChange={e=>setDistinctLegacy(e.target.checked)}/>{t('openingQuantities.distinctLegacy')}</label>
    </div>}
    {blocked.filter(reason=>reason!=='unconfirmedRooms').map(reason=><p key={reason} className="opening-error">{t(`openingQuantities.${reason}`)}</p>)}
    {room && !((plan.pages[room.pageNumber]?.calibration?.metersPerPixel??0)>0) && <p className="opening-help">{t('openingQuantities.uncalibrated')}</p>}
    {!rooms.length && <p>{t('openingTools.chooseRoom')}</p>}
    {error && <p role="alert" className="opening-error">{error}</p>}
    <div className="opening-actions">
      <button type="button" className="btn-primary" disabled={!valid || !confirmed || blocked.length>0} onClick={()=>{
        try {
          const state=useAppStore.getState();
          if (state.project !== plan || state.currentPage !== page) return;
          if(!input || !confirmed) return;
          const id=state.addApprovedQuantityOpening(input);
          if(id) onClose();
        } catch {setError(t('openingTools.invalid'));}
      }}>{t('openingTools.approveAndAdd')}</button>
      <button type="button" className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
    </div>
  </section>;
}
