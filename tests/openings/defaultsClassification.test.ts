import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PLAN_A} from '../takeoff/fixtures.ts';
import {addPlanOpening, updatePlanOpening, reviewPlanOpening} from '../../src/lib/planOpenings.ts';
import {aiOpeningDefaults, mechanismsForOpening, openingAccessDefault, openingKinds} from '../../src/lib/openingOptions.ts';
import {canonicalOpeningDeduction, buildOpeningSchedule} from '../../src/lib/openingQuantities.ts';
import {openingReportTables} from '../../src/lib/openingQuantityReport.ts';
import {exportContext} from '../../src/lib/exportLanguage.ts';
import type {PlanOpening} from '../../src/types/index.ts';
const base=()=>{
 const p=structuredClone(PLAN_A);p.rooms[0].openings=[];
 return addPlanOpening(p,{pageNumber:1,geometry:{endpointA:{x:0,y:0},endpointB:{x:10,y:0}},
  kind:'door',mechanism:'hinged',walkableAccess:'supported',source:'import',roomIds:[p.rooms[0].id],legacyRefs:[],
  widthM:null,heightM:null,sillHeightM:null,quantity:null,...aiOpeningDefaults('door'),
  quantityReview:{associationsConfirmed:true,distinctLegacyRoomIds:[]},label:'A',notes:'Keep'},'opening',1);
};
test('types constrain mechanisms without guessing; passage accessibility changes only with type',()=>{
 let p=base();p=updatePlanOpening(p,'opening',{walkableAccess:'unsupported'},2);
 p=updatePlanOpening(p,'opening',{notes:'Edited'},3);assert.equal(p.openings![0].walkableAccess,'unsupported');
 const dimensions=[p.openings![0].widthM,p.openings![0].heightM,p.openings![0].sillHeightM,p.openings![0].quantity];
 for(const kind of ['window','custom','unknown','open-passage','door'] as const){
  p=updatePlanOpening(p,'opening',{kind},4);const o=p.openings![0];
  assert.equal(o.walkableAccess,openingAccessDefault(kind));assert.equal(o.mechanism,'unknown');
  assert.deepEqual([o.widthM,o.heightM,o.sillHeightM,o.quantity],dimensions);
  assert.deepEqual(o.roomIds,[p.rooms[0].id]);assert.equal(o.label,'A');assert.equal(o.notes,'Edited');
 }
 assert.deepEqual(mechanismsForOpening('door'),['unknown','hinged','sliding','fragmentation-resistant','mamad']);
 assert.deepEqual(mechanismsForOpening('window'),['unknown','tilt-and-turn','sliding','fixed']);
 for(const kind of ['open-passage','custom','unknown'] as const)assert.ok(mechanismsForOpening(kind).every(m=>m==='open'||m==='unknown'));
 p=updatePlanOpening(p,'opening',{mechanism:'sliding'},5);p=updatePlanOpening(p,'opening',{kind:'window'},6);
 assert.equal(p.openings![0].mechanism,'sliding');
});
test('geometry approval cannot turn suggested dimensions into verified deductions or counts',()=>{
 let p=reviewPlanOpening(base(),'opening','approved',2);
 const audit=()=>canonicalOpeningDeduction(p,p.rooms[0],{id:'paint',type:'painting'},3,p.openings![0]);
 assert.equal(audit().reason,'suggestedDimensions');assert.equal(audit().areaM2,0);
 assert.equal(buildOpeningSchedule(p)[0].countedQuantity,null);
 p=updatePlanOpening(p,'opening',{widthM:.8},3);assert.deepEqual(p.openings![0].suggestedDimensions,['heightM','sillHeightM','quantity']);
 p=updatePlanOpening(p,'opening',{heightM:2.1,sillHeightM:0,quantity:1},4);
 assert.deepEqual(p.openings![0].suggestedDimensions,[]);assert.equal(p.openings![0].approval.status,'draft');
 p=reviewPlanOpening(p,'opening','approved',5);assert.equal(audit().areaM2,.8*2.1);assert.equal(buildOpeningSchedule(p)[0].countedQuantity,1);
 const original=p.openings![0];assert.equal(updatePlanOpening(p,'opening',{kind:'door'},6),p);assert.equal(original.approval.status,'approved');
});
test('explicit verification preserves values and resets approval; suggestions and subtypes appear in both report languages',()=>{
 const p=base();
 for(const language of ['he','en'] as const){
  const x=exportContext(language),tables=openingReportTables([p],x);
  assert.ok(tables.flatMap(t=>t.rows.flat()).some(value=>value.includes(x.t('openingQuantities.suggestedDimensions'))));
  for(const kind of openingKinds)for(const mechanism of mechanismsForOpening(kind)){
   const o={...p.openings![0],kind,mechanism} as PlanOpening;
   const table=openingReportTables([{...p,openings:[o]}],x).find(t=>t.title===x.t('openingQuantities.schedule'))!;
   assert.ok(table.rows[0][1]);
   if(mechanism==='mamad')assert.ok(table.rows[0][1].includes(x.t('openingTools.mamad')));
   if(mechanism==='tilt-and-turn')assert.ok(table.rows[0][1].includes(x.t('openingTools.tiltAndTurn')));
  }
 }
 const approved=reviewPlanOpening(p,'opening','approved',2);
 const confirmed=updatePlanOpening(approved,'opening',{suggestedDimensions:[]},3).openings![0];
 assert.equal(confirmed.approval.status,'draft');
 assert.equal(confirmed.widthM,.8);assert.equal(confirmed.quantity,1);assert.deepEqual(confirmed.suggestedDimensions,[]);
});

test('Excel export keeps proposed values visible with review warnings and the selected window mechanism',async()=>{
 const {buildQuantitiesWorkbook}=await import('../../src/lib/exportExcel.ts');
 const {buildRoomSummaries}=await import('../../src/lib/quantities.ts');
 const p=updatePlanOpening(base(),'opening',{kind:'window',mechanism:'tilt-and-turn'},2);
 for(const language of ['he','en'] as const){
  const x=exportContext(language);
  const workbook=buildQuantitiesWorkbook(buildRoomSummaries(p),[],language,undefined,p,new Set([1]));
  const sheet=workbook.getWorksheet(x.t('exports.excel.sheets.openings'))!;
  assert.ok(sheet);
  const texts:string[]=[];sheet.eachRow(row=>row.eachCell(cell=>texts.push(String(cell.value))));
  assert.ok(texts.some(value=>value.includes(x.t('openingTools.tiltAndTurn'))));
  assert.ok(texts.some(value=>value.includes(x.t('openingQuantities.suggestedDimensions'))));
  assert.equal(buildOpeningSchedule(p)[0].countedQuantity,null);
 }
});
