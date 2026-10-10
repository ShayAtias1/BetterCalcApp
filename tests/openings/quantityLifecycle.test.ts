import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_A } from '../takeoff/fixtures.ts';
Object.assign(globalThis,{DOMMatrix:class{},DOMPoint:class{},DOMRect:class{},Path2D:class{}});
const {useAppStore}=await import('../../src/store/appStore.ts');
const s=()=>useAppStore.getState();
after(()=>s().setProject(null));
test('geometry and legacy edits invalidate quantity consent atomically, and undo restores it',()=>{
 s().setProject(structuredClone(PLAN_A));
 const id=s().addPlanOpening({pageNumber:1,geometry:{endpointA:{x:0,y:0},endpointB:{x:10,y:0}},kind:'door',mechanism:'hinged',walkableAccess:'supported',roomIds:['r-master'],widthM:1,heightM:2,sillHeightM:0,quantity:1,source:'manual',legacyRefs:[],quantityReview:{associationsConfirmed:true,distinctLegacyRoomIds:['r-master']}})!;
 const o=()=>s().project!.openings!.find(o=>o.id===id)!;
 s().approvePlanOpening(id);s().updatePlanOpening(id,{geometry:{endpointA:{x:0,y:0},endpointB:{x:20,y:0}}});
 assert.equal(o().approval.status,'draft');assert.equal(o().quantityReview!.associationsConfirmed,false);assert.deepEqual(o().quantityReview!.distinctLegacyRoomIds,[]);
 s().undo();assert.equal(o().approval.status,'approved');assert.equal(o().quantityReview!.associationsConfirmed,true);
 const legacy=structuredClone(s().project!.rooms);s().addOpening('r-master','door');
 assert.equal(o().approval.status,'draft');assert.equal(o().quantityReview!.associationsConfirmed,false);
 s().undo();assert.equal(o().approval.status,'approved');assert.equal(o().quantityReview!.associationsConfirmed,true);assert.deepEqual(s().project!.rooms,legacy);
});

test('manual placement reaches the existing quantity engine only after explicit review; unchanged submissions retain it', async()=>{
 const {calculateWorkItem,roomMetrics,buildRoomSummaries}=await import('../../src/lib/quantities.ts');
 const {openingQuantityFeedback,buildOpeningQuantityReport}=await import('../../src/lib/openingQuantityReport.ts');
 const plan=structuredClone(PLAN_A);
 // A new plan-side door, with no ambiguous historical quantity rows in this room.
 plan.rooms.find(r=>r.id==='r-master')!.openings=[];
 s().setProject(plan);s().setCurrentPage(1);
 s().beginOpeningPlacement('hinged');s().placeOpeningPoint({x:10,y:20});s().placeOpeningPoint({x:74,y:20});
 const id=s().selectedOpeningId!;
 const o=()=>s().project!.openings!.find(o=>o.id===id)!;
 const feedback=()=>openingQuantityFeedback(s().project!,o());
 const calc=()=>{
   const p=s().project!,room=p.rooms.find(r=>r.id==='r-master')!,item=room.workItems.find(w=>w.type==='painting')!;
   const m=roomMetrics(room,p.pages[1].calibration);
   return calculateWorkItem(item,room,m.areaM2,m.perimeterM,p);
 };
 assert.equal(o().widthM,1);assert.deepEqual(feedback().missing,['height','base']);
 s().approvePlanOpening(id);
 assert.equal(feedback().affects,false);assert.equal(calc().deductedM2,0);
 s().updatePlanOpening(id,{heightM:2,sillHeightM:0,quantity:1,roomIds:['r-master'],roomSides:[{roomId:'r-master'},'exterior']});
 s().approvePlanOpening(id);
 assert.equal(calc().deductedM2,0);assert.ok(feedback().reasons.includes('unconfirmedRooms'));
 s().updatePlanOpening(id,{quantityReview:{associationsConfirmed:true,distinctLegacyRoomIds:[]}});
 assert.equal(o().approval.status,'draft');assert.equal(calc().deductedM2,0);
 s().approvePlanOpening(id);
 assert.equal(calc().deductedM2,2);assert.equal(feedback().affects,true);assert.equal(feedback().counted,1);
 const {draggedOpeningGeometry}=await import('../../src/lib/manualOpenings.ts');
 const before=structuredClone(o().geometry)!;
 const grab={x:before.endpointB.x+3,y:before.endpointB.y-2};
 assert.deepEqual(draggedOpeningGeometry(before,grab,grab,'endpointB'),before);
 const moved=draggedOpeningGeometry(before,grab,{x:grab.x+16,y:grab.y},'endpointB');
 assert.deepEqual(moved.endpointA,before.endpointA);
 assert.equal(moved.endpointB.x,before.endpointB.x+16);assert.equal(moved.endpointB.y,before.endpointB.y);
 const p=s().project!,history=s().history.length;
 s().updatePlanOpening(id,{geometry:draggedOpeningGeometry(before,grab,grab,'endpointB')});
 // Equivalent deep objects (as submitted by a released handle / room selector) are not edits.
 s().updatePlanOpening(id,{geometry:structuredClone(o().geometry)!});
 s().updatePlanOpening(id,{widthM:o().widthM,widthSource:o().widthSource});
 s().updatePlanOpening(id,{geometry:structuredClone(o().geometry),roomIds:[...o().roomIds],roomSides:structuredClone(o().roomSides),quantityReview:structuredClone(o().quantityReview),widthM:o().widthM});
 assert.equal(s().project,p);assert.equal(s().history.length,history);assert.equal(o().approval.status,'approved');
 assert.equal(calc().deductedM2,2);
 const report=buildOpeningQuantityReport(p);
 assert.equal(report.work.find(w=>w.itemId==='w3')!.deducted,calc().deductedM2);
 assert.ok(buildRoomSummaries(p).length>0);
 // Actual geometry edits still clear consent and approval; undo/redo recompute immediately.
 s().updatePlanOpening(id,{geometry:{endpointA:{x:10,y:20},endpointB:{x:90,y:20}}});
 assert.equal(calc().deductedM2,0);assert.equal(feedback().affects,false);assert.equal(o().quantityReview!.associationsConfirmed,false);
 s().undo();assert.equal(calc().deductedM2,2);assert.equal(feedback().affects,true);
 s().redo();assert.equal(calc().deductedM2,0);assert.equal(feedback().affects,false);
});

test('live editor audit explains disabled items, legacy precedence, unknown fields and calibration without bypassing them',async()=>{
 const {openingQuantityFeedback}=await import('../../src/lib/openingQuantityReport.ts');
 s().setProject(structuredClone(PLAN_A));
 const id=s().addPlanOpening({pageNumber:1,geometry:{endpointA:{x:1,y:2},endpointB:{x:65,y:2}},kind:'door',mechanism:'hinged',walkableAccess:'supported',roomIds:['r-master'],widthM:1,heightM:2,sillHeightM:0,quantity:1,source:'manual',legacyRefs:[],quantityReview:{associationsConfirmed:true,distinctLegacyRoomIds:[]}})!;
 s().approvePlanOpening(id);
 const p=s().project!,o=p.openings!.find(o=>o.id===id)!;
 const unresolved=openingQuantityFeedback(p,o);
 assert.equal(unresolved.affects,false);assert.ok(unresolved.reasons.includes('legacyUnresolved'));
 const distinct={...o,quantityReview:{associationsConfirmed:true,distinctLegacyRoomIds:['r-master']}};
 const ready={...p,openings:[distinct]};
 assert.equal(openingQuantityFeedback(ready,distinct).affects,true);
 const disabled={...ready,rooms:ready.rooms.map(r=>({...r,workItems:r.workItems.map(w=>({...w,deductOpenings:false}))}))};
 const off=openingQuantityFeedback(disabled,distinct);
 assert.equal(off.affects,false);assert.ok(off.work.every(w=>w.openingAudit.reason==='disabled'));
 const linked={...o,widthM:.9,heightM:2.1,legacyRefs:[{roomId:'r-master',openingId:'o1'}]};
 const historical=openingQuantityFeedback({...p,openings:[linked]},linked);
 assert.equal(historical.affects,false);assert.equal(historical.legacy,true);assert.ok(historical.reasons.includes('legacyPrecedence'));
 const unscaled={...ready,pages:{...ready.pages,1:{...ready.pages[1],calibration:null}}};
 const scale=openingQuantityFeedback(unscaled,distinct);
 assert.equal(scale.affects,false);assert.ok(scale.reasons.includes('uncalibrated'));
 const unknown={...distinct,sillHeightM:null,quantity:null};
 const missing=openingQuantityFeedback({...ready,openings:[unknown]},unknown);
 assert.equal(missing.affects,false);assert.deepEqual(missing.missing,['base','quantity']);
});


test('quantity feedback has matching Hebrew and English messages',async()=>{
 const {en}=await import('../../src/i18n/en.ts'),{he}=await import('../../src/i18n/he.ts');
 assert.deepEqual(Object.keys(en.openingQuantities).sort(),Object.keys(he.openingQuantities).sort());
 for(const value of Object.values(en.openingQuantities)) assert.ok(value.trim());
 for(const value of Object.values(he.openingQuantities)) assert.ok(value.trim());
});
