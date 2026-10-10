import type { Plan, PlanOpening, Room, WorkItem } from '../types';
import { openingsOf, validatePlanOpening } from './planOpenings';
import { workTypeDefinition } from './workTypes';
export type OpeningReason = 'notApproved' | 'unconfirmedRooms' | 'unassociated' | 'unknownDimensions' | 'unknownQuantity' | 'unknownType' | 'duplicate' | 'invalid' | 'legacyPrecedence' | 'legacyConflict' | 'legacyUnresolved' | 'disabled' | 'notApplicable' | 'outsideHeight' | 'uncalibrated' | 'capped';
export interface OpeningAudit { openingId: string; reason: OpeningReason | null; incomplete: boolean; areaM2: number; lengthM: number }
export interface OpeningScheduleRow {
 id: string; source: 'canonical' | 'legacy'; label: string; kind: PlanOpening['kind']; mechanism: PlanOpening['mechanism'];
 pageNumber: number; roomIds: string[]; widthM: number | null; heightM: number | null; baseM: number | null;
 quantity: number | null; countedQuantity: number | null; countKind: PlanOpening['kind']; reasons: OpeningReason[];
}
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const validCount=(n:unknown):n is number=>positive(n)&&Number.isInteger(n);
const validBase=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const refKey=(roomId:string,id:string)=>JSON.stringify([roomId,id]);
export function openingLegacyType(o:PlanOpening) { return o.kind==='open-passage'?'door':o.kind==='unknown'?null:o.kind; }
/** Exact coincident canonical geometry is ambiguous: one approved representative only.
 * No fuzzy snapping, no destructive merge, and historical legacy rows remain intact. */
export function duplicateOpeningIds(plan:Plan):Set<string> {
 const seen=new Map<string,PlanOpening[]>(),seenIds=new Set<string>(),duplicates=new Set<string>();
 const ordered=[...openingsOf(plan)].sort((a,b)=>Number(b.approval.status==='approved')-Number(a.approval.status==='approved')||a.createdAt-b.createdAt||a.id.localeCompare(b.id));
 for(const o of ordered){if(seenIds.has(o.id))duplicates.add(o.id);seenIds.add(o.id);if(!o.geometry)continue;const points=[o.geometry.endpointA,o.geometry.endpointB].map(p=>`${p.x},${p.y}`).sort();const key=JSON.stringify([o.pageNumber,points]);const previous=seen.get(key)??[];
   // A door and a transom can share jambs but occupy disjoint vertical intervals.
   const overlaps=(other:PlanOpening)=>!validBase(o.sillHeightM)||!positive(o.heightM)||!validBase(other.sillHeightM)||!positive(other.heightM)||
     Math.min(o.sillHeightM+o.heightM,other.sillHeightM+other.heightM)>Math.max(o.sillHeightM,other.sillHeightM);
   if(previous.some(overlaps))duplicates.add(o.id);else seen.set(key,[...previous,o]);}
 return duplicates;
}
function linkedRows(plan:Plan,o:PlanOpening) { return o.legacyRefs.flatMap(ref=>{const row=plan.rooms.find(r=>r.id===ref.roomId)?.openings?.find(x=>x.id===ref.openingId);return row?[row]:[];}); }
function legacyConflict(plan:Plan,o:PlanOpening):boolean {
 const rows=linkedRows(plan,o),type=openingLegacyType(o);
 return rows.some(r=>r.type!==type||r.quantity!==o.quantity||r.widthM!==o.widthM||r.heightM!==o.heightM)|| (rows.length>0 && o.sillHeightM!==null && o.sillHeightM!==0);
}
function legacyUnresolved(o:PlanOpening,room:Room):boolean {
 const linked=new Set(o.legacyRefs.map(r=>refKey(r.roomId,r.openingId)));
 return !(o.quantityReview?.distinctLegacyRoomIds??[]).includes(room.id) && (room.openings??[]).some(r=>!linked.has(refKey(room.id,r.id)));
}
export function canonicalOpeningDeduction(plan:Plan,room:Room,item:WorkItem,height:number,o:PlanOpening,duplicates=duplicateOpeningIds(plan)):OpeningAudit {
 const result=(reason:OpeningReason|null,incomplete=false,areaM2=0,lengthM=0):OpeningAudit=>({openingId:o.id,reason,incomplete,areaM2,lengthM});
 const def=workTypeDefinition(item.type);
 if(!def || !(item.deductOpenings??def.deductsOpenings))return result('disabled');
 const type=openingLegacyType(o);
 if(type!==null&&!def.deductedOpeningTypes.includes(type))return result('notApplicable');
 if(o.legacyRefs.some(ref=>ref.roomId===room.id)) return result(legacyConflict(plan,o)?'legacyConflict':'legacyPrecedence',legacyConflict(plan,o));
 if(o.approval.status!=='approved')return result('notApproved',true);
 if(duplicates.has(o.id))return result('duplicate',true);
 if(validatePlanOpening(plan,o).errors.length>0)return result('invalid',true);
 if(type===null)return result('unknownType',true);
 if(!o.roomIds.length)return result('unassociated',true);
 if(!o.quantityReview?.associationsConfirmed)return result('unconfirmedRooms',true);
 if(linkedRows(plan,o).some(r=>r.type!==type||r.quantity!==o.quantity||r.widthM!==o.widthM||r.heightM!==o.heightM))return result('legacyConflict',true);
 if(legacyUnresolved(o,room))return result('legacyUnresolved',true);
 if(!validCount(o.quantity))return result('unknownQuantity',true);
 if(!positive(o.widthM)||!positive(o.heightM)||!validBase(o.sillHeightM))return result('unknownDimensions',true);
 if(!(plan.pages[room.pageNumber]?.calibration?.metersPerPixel!>0))return result('uncalibrated',true);
 const overlap=Math.max(0,Math.min(o.sillHeightM+o.heightM,height)-o.sillHeightM);
 if(overlap===0)return result('outsideHeight');
 if(def.basis==='perimeter'){
   // Skirting stops at a floor-access opening, not at a raised window or threshold.
   if(o.walkableAccess!=='supported')return result('notApplicable',o.walkableAccess==='unknown');
   if(o.sillHeightM>0)return result('outsideHeight');
   return result(null,false,o.widthM*o.quantity*height,o.widthM*o.quantity);
 }
 return def.basis==='wallArea'?result(null,false,o.widthM*overlap*o.quantity):result('notApplicable');
}
export function buildOpeningSchedule(plan:Plan):OpeningScheduleRow[] {
 const canonical=openingsOf(plan),duplicates=duplicateOpeningIds(plan),linked=new Set(canonical.flatMap(o=>o.legacyRefs.map(r=>refKey(r.roomId,r.openingId))));
 const rows:OpeningScheduleRow[]=canonical.map(o=>{
   const reasons:OpeningReason[]=[];
   if(o.approval.status!=='approved')reasons.push('notApproved');
   if(validatePlanOpening(plan,o).errors.length)reasons.push('invalid');
   if(duplicates.has(o.id))reasons.push('duplicate');
   if(!validCount(o.quantity))reasons.push('unknownQuantity');
   if(o.kind==='unknown')reasons.push('unknownType');
   if(!o.roomIds.length)reasons.push('unassociated');
   else if(!o.quantityReview?.associationsConfirmed)reasons.push('unconfirmedRooms');
   if(!positive(o.widthM)||!positive(o.heightM)||!validBase(o.sillHeightM))reasons.push('unknownDimensions');
   if(!o.roomIds.length && plan.rooms.some(room=>(room.openings?.length??0)>0))reasons.push('legacyUnresolved');
   if(o.roomIds.some(id=>{const room=plan.rooms.find(r=>r.id===id);return room&&legacyUnresolved(o,room);}))reasons.push('legacyUnresolved');
   const legacy=linkedRows(plan,o);
   let countedQuantity:number|null=null,countKind=o.kind;
   if(legacy.length){
     reasons.push(legacyConflict(plan,o)?'legacyConflict':'legacyPrecedence');
     // Explicit links identify a single physical group across room faces. Historical counts
     // remain authoritative only when all linked rows agree; disagreements stay unresolved.
     if(legacy.every(r=>validCount(r.quantity)&&r.quantity===legacy[0].quantity&&r.type===legacy[0].type)&&!duplicates.has(o.id)){
       countedQuantity=legacy[0].quantity;countKind=legacy[0].type;
     }
   } else if(o.approval.status==='approved'&&validCount(o.quantity)&&o.kind!=='unknown'&&!reasons.some(r=>['duplicate','invalid','legacyUnresolved'].includes(r)))countedQuantity=o.quantity;
   return {id:o.id,source:'canonical',label:o.label??'',kind:o.kind,mechanism:o.mechanism,pageNumber:o.pageNumber,roomIds:[...o.roomIds],widthM:o.widthM,heightM:o.heightM,baseM:o.sillHeightM,quantity:o.quantity,countedQuantity,countKind,reasons};
 });
 for(const room of plan.rooms)for(const o of room.openings??[])if(!linked.has(refKey(room.id,o.id)))rows.push({id:refKey(room.id,o.id),source:'legacy',label:'',kind:o.type,mechanism:'unknown',pageNumber:room.pageNumber,roomIds:[room.id],widthM:o.widthM,heightM:o.heightM,baseM:null,quantity:o.quantity,countedQuantity:validCount(o.quantity)?o.quantity:null,countKind:o.type,reasons:['legacyPrecedence',...(!validCount(o.quantity)?['unknownQuantity' as const]:[])]});
 return rows;
}
