import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { NewPlanOpening } from '../../src/types/index.ts';
import { PLAN_A } from '../takeoff/fixtures.ts';
import { openingsOf } from '../../src/lib/planOpenings.ts';
import { buildRoomSummaries } from '../../src/lib/quantities.ts';
Object.assign(globalThis,{DOMMatrix:class{},DOMPoint:class{},DOMRect:class{},Path2D:class{}});
const {useAppStore}=await import('../../src/store/appStore.ts');
const s=()=>useAppStore.getState();
after(()=>s().setProject(null));
const input:NewPlanOpening={pageNumber:1,geometry:{endpointA:{x:10,y:20},endpointB:{x:50,y:20}},kind:'door',mechanism:'hinged',walkableAccess:'supported',roomIds:['r-master'],apartmentNumber:'7',widthM:null,heightM:null,sillHeightM:null,quantity:null,source:'legacy',legacyRefs:[{roomId:'r-master',openingId:'o1'}]};

test('CRUD/review actions autosave-mark, undo/redo and preserve quantities',()=>{
 s().setProject(structuredClone(PLAN_A));const quantities=buildRoomSummaries(s().project!);
 const id=s().addPlanOpening(input)!;assert.ok(s().dirty);assert.equal(s().history.length,1);
 s().undo();assert.equal(openingsOf(s().project!).length,0);s().redo();assert.equal(openingsOf(s().project!).length,1);
 s().approvePlanOpening(id);assert.equal(openingsOf(s().project!)[0].approval.status,'approved');
 s().updatePlanOpening(id,{heightM:2});assert.equal(openingsOf(s().project!)[0].approval.status,'draft');
 s().undo();assert.equal(openingsOf(s().project!)[0].heightM,null);assert.equal(openingsOf(s().project!)[0].approval.status,'approved');
 s().redo();assert.equal(openingsOf(s().project!)[0].heightM,2);
 assert.deepEqual(buildRoomSummaries(s().project!),quantities);
 s().removePlanOpening(id);assert.equal(openingsOf(s().project!).length,0);s().undo();assert.equal(openingsOf(s().project!).length,1);
 const before=s().project,history=s().history.length;
 assert.throws(()=>s().addPlanOpening({...input,widthM:NaN}));assert.equal(s().project,before);assert.equal(s().history.length,history);
});

test('apartment duplication remaps links and keeps geometry/dimensions independent, undo is atomic',()=>{
 s().setProject(structuredClone(PLAN_A));s().addPlanOpening(input);s().approvePlanOpening(openingsOf(s().project!)[0].id);
 const before=s().project!;const count=s().duplicateApartment('7','99');assert.ok(count>0);
 const p=s().project!;assert.equal(openingsOf(p).length,2);
 const copied=openingsOf(p)[1];const room=p.rooms.find(r=>r.id===copied.roomIds[0])!;
 assert.equal(room.apartmentNumber,'99');assert.equal(copied.apartmentNumber,'99');
 assert.equal(copied.legacyRefs[0].openingId,room.openings![0].id);assert.equal(copied.approval.status,'draft');
 assert.deepEqual(copied.geometry,openingsOf(before)[0].geometry);assert.notEqual(copied.geometry,openingsOf(before)[0].geometry);
 const totals=buildRoomSummaries(p);const original=totals.filter(r=>before.rooms.some(room=>room.id===r.roomId));
 assert.deepEqual(original,buildRoomSummaries(before));
 s().undo();assert.deepEqual(s().project,before);s().redo();assert.equal(openingsOf(s().project!).length,2);
});

test('room copy translates only canonical geometry; room/legacy changes invalidate approval',()=>{
 s().setProject(structuredClone(PLAN_A));const id=s().addPlanOpening(input)!;const roomId=s().duplicateRoom('r-master')!;
 const copied=openingsOf(s().project!).find(o=>o.roomIds.includes(roomId))!;assert.equal(copied.geometry!.endpointA.x,40);
 s().approvePlanOpening(id);s().updateOpening('r-master','o1',{widthM:1.1});assert.equal(openingsOf(s().project!)[0].approval.status,'draft');
 assert.equal(openingsOf(s().project!)[0].widthM,null);
 s().approvePlanOpening(id);s().assignRoomsToApartment(['r-master'],'8');assert.equal(openingsOf(s().project!)[0].apartmentNumber,'8');assert.equal(openingsOf(s().project!)[0].approval.status,'draft');
 s().deleteRoom('r-master');assert.deepEqual(openingsOf(s().project!)[0].roomIds,[]);assert.deepEqual(openingsOf(s().project!)[0].legacyRefs,[]);
 s().undo();assert.deepEqual(openingsOf(s().project!)[0].roomIds,['r-master']);
});

test('legacy operations produce identical quantities with or without canonical data',()=>{
 const mutate=()=>{s().updateOpening('r-master','o1',{widthM:1.25,heightM:2.2,quantity:2});s().removeOpening('r-master','o2');s().addOpening('r-master','window');};
 s().setProject(structuredClone(PLAN_A));mutate();const expected=buildRoomSummaries(s().project!);
 s().setProject(structuredClone(PLAN_A));s().addPlanOpening(input);mutate();
 // The legacy add action allocates a new identity; normalize only its id for comparison.
 const normalize=(summaries:ReturnType<typeof buildRoomSummaries>)=>summaries.map(r=>({...r}));
 assert.deepEqual(normalize(buildRoomSummaries(s().project!)),normalize(expected));
});
