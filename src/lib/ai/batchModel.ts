import type { Plan, WorkType } from '../../types';
import type { AiJobRecord } from './contracts';
import { buildProjectQuantities } from '../projectQuantities';
import { isPageCalibrated, roomMetrics } from '../quantities';

export const CALCULATIONS = ['area','perimeter','flooring','cladding','skirting'] as const;
export type Calculation = typeof CALCULATIONS[number];
export interface BatchPage {
  planId:string; planName:string; pageNumber:number; sourceHash:string;
  reviewKey:string; requestId?:string;
  status:'queued'|'processing'|'completed'|'failed'; error?:string;
}
export interface AiBatch {
  id:string; projectId:string; createdAt:number; updatedAt:number;
  calculations:Calculation[]; pages:BatchPage[];
  state:'paused'|'running'|'completed';
}
export const finishType:Partial<Record<Calculation,WorkType>>={flooring:'tiling',cladding:'cladding',skirting:'panels'};
export function reusableJob(jobs:AiJobRecord[],page:Pick<BatchPage,'planId'|'pageNumber'|'sourceHash'>){
  return jobs.filter(j=>j.planId===page.planId&&j.pageNumber===page.pageNumber&&j.sourceHash===page.sourceHash&&j.status==='COMPLETED'&&j.mode!=='one-click-v1').sort((a,b)=>b.updatedAt-a.updatedAt)[0];
}
export function batchCost(jobs:AiJobRecord[],newPages:number){
  const costs=jobs.filter(j=>j.mode!=='one-click-v1').map(j=>j.metrics?.estimatedCostUsd).filter((c):c is number=>typeof c==='number'&&Number.isFinite(c)&&c>0);
  // Existing checkpoint documentation reports an observed mean of $0.076/page.
  const observations=costs.length?costs:[0.076];
  return {low:Math.min(...observations)*0.5*newPages,high:Math.max(...observations)*2*newPages,samples:costs.length};
}
/** Ordinary Rooms only; proposals never enter either engine. Scope filters before aggregation. */
export function batchQuantities(batch:AiBatch,plans:Plan[]){
  const scoped=plans.map(plan=>({...plan,rooms:plan.rooms.filter(room=>batch.pages.some(p=>p.planId===plan.id&&p.pageNumber===room.pageNumber)).map(room=>({...room,workItems:room.workItems.filter(w=>w.type!=='cladding'||Number.isFinite(w.heightM)&&w.heightM!>0)}))}));
  const report=buildProjectQuantities(scoped);
  const requestedCategories=batch.calculations.flatMap(c=>c==='flooring'?['tiling_regular','tiling_as']:c==='cladding'?['cladding']:c==='skirting'?['panels']:[]);
  return {report:{...report,totals:report.totals.filter(t=>requestedCategories.includes(t.category))},
    pages:batch.pages.map(page=>{
      const plan=plans.find(p=>p.id===page.planId),rooms=plan?.rooms.filter(r=>r.pageNumber===page.pageNumber)??[];
      const calibrated=!!plan&&isPageCalibrated(plan,page.pageNumber);
      const missing=batch.calculations.filter(c=>finishType[c]&&rooms.some(r=>!r.workItems.some(w=>w.type===finishType[c]) || c==='cladding'&&r.workItems.some(w=>w.type==='cladding'&&(!Number.isFinite(w.heightM)||!(w.heightM!>0)))));
      const metrics=calibrated?rooms.map(r=>roomMetrics(r,plan!.pages[page.pageNumber].calibration)):[];
      return {page,rooms,calibrated,missing,
        area:calibrated&&rooms.length?metrics.reduce((n,m)=>n+m.areaM2,0):null,
        perimeter:calibrated&&rooms.length?metrics.reduce((n,m)=>n+m.perimeterM,0):null};
    })};
}
