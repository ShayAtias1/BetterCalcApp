import type { Plan, PlanOpening } from '../types';
import { buildOpeningSchedule, type OpeningAudit, type OpeningScheduleRow } from './openingQuantities';
import { calculateWorkItem, roomMetrics } from './quantities';
import { workTypeDefinition } from './workTypes';
import type { ExportContext } from './exportLanguage';
export interface OpeningWorkReport {
 roomId:string; itemId:string; type:Plan['rooms'][number]['workItems'][number]['type']; unit:'m2'|'lm'; gross:number; deducted:number; net:number;
 audit:OpeningAudit[];
}
export function buildOpeningQuantityReport(plan:Plan, roomScope?:Set<string>, pageScope?:Set<number>) {
 const schedule=buildOpeningSchedule(plan).filter(row=>(!pageScope||pageScope.has(row.pageNumber))&&(!roomScope||row.roomIds.length===0||row.roomIds.some(id=>roomScope.has(id))));
 const work:OpeningWorkReport[]=[];
 for(const room of plan.rooms){
  if(roomScope&&!roomScope.has(room.id)||pageScope&&!pageScope.has(room.pageNumber))continue;
  const metrics=roomMetrics(room,plan.pages[room.pageNumber]?.calibration??null);
  for(const item of room.workItems){
   const def=workTypeDefinition(item.type);if(!def||!['wallArea','perimeter'].includes(def.basis))continue;
   const calc=calculateWorkItem(item,room,metrics.areaM2,metrics.perimeterM,plan);
   work.push({roomId:room.id,itemId:item.id,type:item.type,unit:def.unit,gross:calc.grossLengthM??calc.grossM2,deducted:calc.deductedLengthM??calc.deductedM2,net:calc.lengthM??calc.netM2,audit:calc.openingAudit??[]});
  }
 }
 const incomplete=schedule.some(r=>r.reasons.some(reason=>!['legacyPrecedence'].includes(reason)))||work.some(w=>w.audit.some(a=>a.incomplete));
 const count=(kind:OpeningScheduleRow['kind'])=>schedule.filter(r=>r.countKind===kind).reduce((sum,r)=>sum+(r.countedQuantity??0),0);
 return {schedule,work,incomplete,doors:count('door'),windows:count('window')};
}
export interface OpeningReportTable { title:string; headers:string[]; widths:number[]; rows:string[][] }
/** Shared text/data layout for the UI, plan/project PDF and Excel. Numbers come from the
 * existing quantity engine; this layer only formats approved/legacy precedence and audit reasons. */
export function openingReportTables(plans:Plan[],x:ExportContext,roomScope?:Set<string>,pageScope?:Set<number>):OpeningReportTable[] {
 const {t}=x,txt=(k:keyof typeof import('../i18n/he').he.openingQuantities)=>t(`openingQuantities.${k}`);
 const fmt=(n:number|null)=>n===null?'-':x.number(n);
 const reports=plans.map(plan=>({plan,report:buildOpeningQuantityReport(plan,roomScope,pageScope)}));
 if(!reports.some(r=>r.report.schedule.length))return [];
 const typeLabel=(row:OpeningScheduleRow)=>row.kind==='door'&&['hinged','sliding'].includes(row.mechanism)?t(`openingTools.${row.mechanism as 'hinged'|'sliding'}`):row.kind==='open-passage'?t('openingTools.passage'):row.kind==='door'?t('openingQuantities.door'):t(`openingTools.${row.kind==='custom'?'custom':row.kind==='window'?'window':'unknown'}`);
 const tables:OpeningReportTable[]=[{
 title:txt('counts'),headers:[t('exports.common.plan'),txt('doors'),txt('windows'),txt('status')],widths:[24,12,12,40],
 rows:[...reports.map(({plan,report:r})=>[plan.name,fmt(r.doors),fmt(r.windows),txt(r.incomplete?'partial':'complete')]),...(plans.length>1?[[txt('total'),fmt(reports.reduce((n,r)=>n+r.report.doors,0)),fmt(reports.reduce((n,r)=>n+r.report.windows,0)),txt(reports.some(r=>r.report.incomplete)?'partial':'complete')]]:[])],
 },{
 title:txt('schedule'),headers:[t('exports.common.plan'),txt('type'),txt('width'),txt('height'),txt('base'),txt('quantity'),txt('counted'),txt('rooms'),txt('status')],widths:[18,20,10,10,10,10,10,24,45],
 rows:reports.flatMap(({plan,report:r})=>r.schedule.map(row=>[`${plan.name} / ${row.pageNumber}`,`${typeLabel(row)}${row.label?' · '+row.label:''}`,fmt(row.widthM),fmt(row.heightM),fmt(row.baseM),fmt(row.quantity),fmt(row.countedQuantity),row.roomIds.map(id=>plan.rooms.find(r=>r.id===id)?.name??id).join(' / ')||txt('unassociated'),(row.reasons.map(reason=>t(`openingQuantities.${reason}`)).join('; ')||txt('complete'))+(row.countedQuantity!==null&&row.countKind!==row.kind?' / '+txt('counted')+': '+typeLabel({...row,kind:row.countKind,mechanism:'unknown'}):'')])),
 }];
 // Old legacy-only exports already explain their deductions. This detailed additional ledger
 // is needed when canonical objects exist; it includes both historical and canonical amounts.
 if(plans.some(p=>p.openings?.length)){
  tables.push({title:txt('deductions'),headers:[t('exports.common.plan'),txt('rooms'),t('exports.common.item'),txt('gross'),txt('deducted'),txt('net'),txt('unit')],widths:[20,20,24,12,12,12,10],rows:reports.flatMap(({plan,report:r})=>r.work.map(w=>{const calibrated=(plan.pages[plan.rooms.find(room=>room.id===w.roomId)!.pageNumber]?.calibration?.metersPerPixel??0)>0;return [plan.name,plan.rooms.find(room=>room.id===w.roomId)?.name??w.roomId,t(`workTypes.${w.type}`),calibrated?fmt(w.gross):t('exports.common.notCalibrated'),calibrated?fmt(w.deducted):'-',calibrated?fmt(w.net):'-',t(`units.${w.unit}`)];}))});
  tables.push({title:txt('exclusions'),headers:[t('exports.common.plan'),txt('rooms'),txt('type'),t('exports.common.item'),txt('status')],widths:[20,22,24,20,55],rows:reports.flatMap(({plan,report:r})=>r.work.flatMap(w=>w.audit.filter(a=>a.reason).map(a=>[plan.name,plan.rooms.find(room=>room.id===w.roomId)?.name??w.roomId,plan.openings?.find(o=>o.id===a.openingId)?.label||a.openingId||'-',t(`workTypes.${w.type}`),t(`openingQuantities.${a.reason!}`)])))});
 }
 return tables.filter(table=>table.rows.length>0);
}

export function roomOpeningDisplay(plan:Plan,roomId:string,x:ExportContext) {
 const rows=buildOpeningSchedule(plan).filter(row=>row.roomIds.includes(roomId));
 const kinds=['door','window','custom','open-passage'] as const;
 const text=kinds.flatMap(kind=>{
  const count=rows.filter(row=>row.countKind===kind).reduce((n,row)=>n+(row.countedQuantity??0),0);
  if(!count)return [];
  const label=kind==='door'?x.t('openingQuantities.doors'):kind==='window'?x.t('openingQuantities.windows'):x.t(kind==='custom'?'openingTools.custom':'openingTools.passage');
  return [`${x.number(count)} ${label}`];
 }).join(' / ');
 let areaM2:number|null=0;
 for(const row of rows.filter(r=>r.countedQuantity!==null)){
  if(row.widthM===null||row.heightM===null){areaM2=null;break;}
  areaM2+=row.widthM*row.heightM*row.countedQuantity!;
 }
 return {text,areaM2:areaM2===null?null:Math.round(areaM2*100)/100,partial:rows.some(r=>r.reasons.some(reason=>reason!=='legacyPrecedence'))};
}

/** Live editor diagnostics consume the same schedule and item audits as exports.
 * Approval describes the opening; it does not imply eligibility for finish deductions. */
export function openingQuantityFeedback(plan: Plan, opening: PlanOpening, report = buildOpeningQuantityReport(plan)) {
 const schedule = report.schedule.find(row => row.source === 'canonical' && row.id === opening.id);
 const missing: ('width' | 'height' | 'base' | 'quantity')[] = [];
 if (!(opening.widthM !== null && Number.isFinite(opening.widthM) && opening.widthM > 0)) missing.push('width');
 if (!(opening.heightM !== null && Number.isFinite(opening.heightM) && opening.heightM > 0)) missing.push('height');
 if (!(opening.sillHeightM !== null && Number.isFinite(opening.sillHeightM) && opening.sillHeightM >= 0)) missing.push('base');
 if (!(opening.quantity !== null && Number.isInteger(opening.quantity) && opening.quantity > 0)) missing.push('quantity');
 const work = report.work.flatMap(item => {
   const audit = item.audit.find(a => a.openingId === opening.id);
   if (!audit) return [];
   return [{...item, openingAudit: audit, capped: item.audit.some(a => a.reason === 'capped')}];
 });
 const reasons = new Set(schedule?.reasons ?? []);
 for (const roomId of opening.roomIds) {
   const room = plan.rooms.find(r => r.id === roomId);
   if (room && !((plan.pages[room.pageNumber]?.calibration?.metersPerPixel ?? 0) > 0)) reasons.add('uncalibrated');
 }
 for (const item of work) {
   if (item.openingAudit.reason) reasons.add(item.openingAudit.reason);
   if (item.capped && (item.openingAudit.areaM2 > 0 || item.openingAudit.lengthM > 0)) reasons.add('capped');
 }
 const affects = work.some(item => item.openingAudit.areaM2 > 0 || item.openingAudit.lengthM > 0);
 const legacy = work.some(item => ['legacyPrecedence', 'legacyConflict'].includes(item.openingAudit.reason ?? ''));
 return {missing, work, reasons: [...reasons], affects, legacy, counted: schedule?.countedQuantity ?? null};
}

export interface OpeningPdfOptions { includeOpeningDetails?: boolean }

/** PDF-only presentation: one physical schedule, no repeated counts or exclusion ledger.
 * Excel and on-screen audit tables keep their existing detail. */
export function openingPdfSchedule(plans: Plan[], x: ExportContext, options: OpeningPdfOptions = {}, pageScope?: Set<number>): OpeningReportTable | null {
 if (!options.includeOpeningDetails) return null;
 const table = openingReportTables(plans,x,undefined,pageScope).find(t=>t.title===x.t('openingQuantities.schedule'));
 if (!table) return null;
 const columns=[0,1,2,3,4,6,7,8];
 return {...table,headers:columns.map(i=>table.headers[i]),widths:columns.map(i=>table.widths[i]),rows:table.rows.map(row=>columns.map(i=>row[i]))};
}

/** Actual nonzero room-side deductions, aggregated once per work item, before waste. */
export function openingPdfDeductions(plans: Plan[], x: ExportContext): OpeningReportTable | null {
 const rows=plans.flatMap(plan=>buildOpeningQuantityReport(plan).work.filter(w=>w.deducted>0 && (plan.pages[plan.rooms.find(r=>r.id===w.roomId)!.pageNumber]?.calibration?.metersPerPixel??0)>0).map(w=>[
   plan.name,plan.rooms.find(r=>r.id===w.roomId)?.name??w.roomId,x.t(`workTypes.${w.type}`),x.number(w.gross),x.number(w.deducted),x.number(w.net),x.t(`units.${w.unit}`)
 ]));
 if(!rows.length)return null;
 return {title:x.t('openingQuantities.deductions'),headers:[x.t('exports.common.plan'),x.t('openingQuantities.rooms'),x.t('exports.common.item'),x.t('openingQuantities.gross'),x.t('openingQuantities.deducted'),x.t('openingQuantities.net'),x.t('openingQuantities.unit')],widths:[20,20,24,12,12,12,10],rows};
}
