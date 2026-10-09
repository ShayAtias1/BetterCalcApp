import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {PLAN_A} from '../takeoff/fixtures.ts';
import {quantityOpeningInput} from '../../src/lib/manualOpenings.ts';
import {buildOpeningQuantityReport} from '../../src/lib/openingQuantityReport.ts';
Object.assign(globalThis,{DOMMatrix:class{},DOMPoint:class{},DOMRect:class{},Path2D:class{}});
const {useAppStore}=await import('../../src/store/appStore.ts');
const s=()=>useAppStore.getState();
after(()=>s().setProject(null));
const complete=(plan:typeof PLAN_A)=>({...quantityOpeningInput(plan,'r-master','door',{widthM:1,heightM:2,sillHeightM:0,quantity:1}),walkableAccess:'supported' as const,quantityReview:{associationsConfirmed:true,distinctLegacyRoomIds:[]}});

test('one explicit quantity-form approval creates an approved entry without opening another editor; undo removes the whole entry',()=>{
 const p=structuredClone(PLAN_A);p.rooms=p.rooms.filter(r=>r.id==='r-master');p.rooms[0].openings=[];s().setProject(p);
 const id=s().addApprovedQuantityOpening(complete(p))!;
 const o=s().project!.openings!.find(o=>o.id===id)!;
 assert.equal(o.approval.status,'approved');assert.equal(o.geometry,null);assert.equal(s().selectedOpeningId,null);assert.equal(s().openingPlacement,null);
 const report=buildOpeningQuantityReport(s().project!);
 assert.equal(report.doors,1);assert.equal(report.work.find(w=>w.itemId==='w3')!.deducted,2);assert.equal(report.work.find(w=>w.itemId==='w2')!.deducted,1);
 assert.equal(s().history.length,1);assert.equal(s().dirty,true);
 s().undo();assert.equal(s().project!.openings,undefined);assert.deepEqual(s().project!.rooms,p.rooms);
 s().redo();assert.equal(s().project!.openings![0].approval.status,'approved');assert.equal(s().selectedOpeningId,null);
});

test('failed single-form review leaves no partial draft or history; legacy rows retain precedence and no double deduction',()=>{
 s().setProject(structuredClone(PLAN_A));const p=s().project!,before=structuredClone(p);
 const input=complete(p);
 for(const invalid of [
  {...input,quantityReview:{associationsConfirmed:false,distinctLegacyRoomIds:[]}},
  {...input,heightM:null},
  {...input,sillHeightM:null},
  {...input,quantity:null},
  input,
  {...input,legacyRefs:[{roomId:'r-master',openingId:'o1'}]},
 ]){
  assert.throws(()=>s().addApprovedQuantityOpening(invalid));
  assert.equal(s().project,p);assert.deepEqual(s().project,before);assert.equal(s().history.length,0);assert.equal(s().dirty,false);
 }
 const matching={...input,widthM:.9,heightM:2.1,legacyRefs:[{roomId:'r-master',openingId:'o1'}],quantityReview:{associationsConfirmed:true,distinctLegacyRoomIds:['r-master']}};
 const beforeDeductions=buildOpeningQuantityReport(p).work.find(w=>w.itemId==='w3')!.deducted;
 const id=s().addApprovedQuantityOpening(matching)!;
 assert.equal(s().project!.openings!.find(o=>o.id===id)!.approval.status,'approved');
 assert.deepEqual(s().project!.rooms,p.rooms);
 assert.equal(buildOpeningQuantityReport(s().project!).work.find(w=>w.itemId==='w3')!.deducted,beforeDeductions);
});
