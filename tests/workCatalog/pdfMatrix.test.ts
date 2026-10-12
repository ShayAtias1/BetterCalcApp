import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PLAN_A} from '../takeoff/fixtures.ts';
import {buildRoomSummaries,buildReportCategoryTotals} from '../../src/lib/quantities.ts';
import {buildQuantitySchedule} from '../../src/lib/quantitySchedule.ts';
import {buildRoomMatrices,buildMaterialRows} from '../../src/lib/quantitySchedulePdf.ts';
import {exportContext} from '../../src/lib/exportLanguage.ts';
import {withCatalogEntries} from '../../src/lib/workCatalog.ts';
import type {WorkCategory,WorkItem} from '../../src/types/index.ts';

for(const language of ['he','en'] as const) test(`${language}: matrix preserves every room reading and its integrated totals without duplicate room breakdowns`,()=>{
 const plan=structuredClone(PLAN_A),before=JSON.stringify(plan);
 const summaries=buildRoomSummaries(plan),totals=buildReportCategoryTotals(plan,summaries),x=exportContext(language);
 const schedule=buildQuantitySchedule(plan,summaries,x.t),matrices=buildRoomMatrices({plan,summaries},x);
 assert.equal(matrices.length,1);
 const matrix=matrices[0];
 assert.equal(matrix.rows.length,summaries.length+1);
 assert.equal(matrix.rows.filter(r=>r.total).length,1);
 matrix.categories.forEach((c,i)=>{
  const original=schedule.find(v=>v.column===c.column)!;
  assert.deepEqual([c.net,c.order,c.areaNet,c.areaOrder],[original.net,original.order,original.areaNet,original.areaOrder]);
  const total=matrix.rows.at(-1)!;
  assert.deepEqual(total.cells.slice(2+i*2,4+i*2).map(cell=>cell.main),[x.number(c.net),x.number(c.order)]);
  for(const room of c.apartments.flatMap(a=>a.rooms)){
   const row=matrix.rows[summaries.findIndex(s=>s.roomId===room.summary.roomId)];
   assert.deepEqual(row.cells.slice(2+i*2,4+i*2).map(cell=>cell.main),room.unavailable?[x.t('exports.common.notCalibrated'),x.t('exports.common.notCalibrated')]:[x.number(room.net!),x.number(room.order!)]);
  }
 });
 assert.deepEqual(buildMaterialRows({plan,summaries},x),[]);
 assert.deepEqual(buildReportCategoryTotals(plan,buildRoomSummaries(plan)),totals);
 assert.equal(JSON.stringify(plan),before);
});

test('many custom categories use bounded matrices; zero-only categories stay hidden and material shares do not duplicate rooms',()=>{
 const plan=structuredClone(PLAN_A);plan.rooms=plan.rooms.slice(0,1);plan.measurements=[];
 const categories:WorkCategory[]=Array.from({length:10},(_,i)=>({id:`custom${i}`,name:`Custom ${i}`,method:'manualCount',unitLabel:'units',createdAt:1,updatedAt:1}));
 const items:WorkItem[]=categories.map((c,i)=>({id:`item${i}`,type:'custom',categoryId:c.id,method:c.method,manualQuantity:i,wastePercent:10}));
 plan.rooms[0].workItems=items;
 const p=withCatalogEntries(plan,{categories,specs:[{id:'variant',categoryId:'custom1',name:'Material A',specification:'Model 20',createdAt:1,updatedAt:1}]});
 p.rooms[0].workItems[1].allocations=[{id:'share',specId:'variant',quantity:0.5}];
 const x=exportContext('en'),summaries=buildRoomSummaries(p),input={plan:p,summaries},before=JSON.stringify(p);
 const matrices=buildRoomMatrices(input,x);
 assert.deepEqual(matrices.map(m=>m.categories.length),[5,4]);
 assert.ok(!matrices.some(m=>m.categories.some(c=>c.info.label==='Custom 0')));
 assert.equal(matrices.flatMap(m=>m.categories).length,9);
 const materials=buildMaterialRows(input,x);
 assert.deepEqual(materials.map(r=>r.cells.slice(0,2)),[['Material A · Model 20',x.number(0.5)],[x.t('workCatalog.sources.unassigned'),x.number(0.5)]]);
 assert.ok(materials.every(r=>r.kind==='type'));
 assert.equal(JSON.stringify(p),before);
});

for(const language of ['he','en'] as const) test(`${language}: details columns restore room opening counts and notes while deductions stay beside their quantities`,()=>{
 const plan=structuredClone(PLAN_A),x=exportContext(language),before=JSON.stringify(plan);
 const summaries=buildRoomSummaries(plan),matrix=buildRoomMatrices({plan,summaries},x)[0];
 const [openings,notes]=matrix.rows[0].cells.slice(-2);
 assert.equal(openings.main,`1 ${x.t('openingQuantities.doors')} / 2 ${x.t('openingQuantities.windows')}`);
 assert.equal(openings.sub,`${x.number(4.77)} ${x.t('units.m2')}`);
 assert.equal(notes.main,'פרקט קיים');
 const paint=matrix.categories.findIndex(c=>c.column==='painting');
 assert.ok(matrix.rows[0].cells[2+paint*2].sub?.includes(x.number(4.77)));
 const uncalibrated=matrix.rows.find(row=>row.cells[1].main==='מחסן')!;
 assert.equal(uncalibrated.cells.at(-1)!.sub,x.t('exports.common.notCalibrated'));
 assert.deepEqual(matrix.rows.at(-1)!.cells.slice(-2),[{main:''},{main:''}]);
 assert.equal(JSON.stringify(plan),before);
});
