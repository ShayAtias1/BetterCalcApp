import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_A, MPP } from '../takeoff/fixtures.ts';
import { buildRoomSummaries } from '../../src/lib/quantities.ts';
import { suggestOpeningRooms, openingClassification } from '../../src/lib/manualOpenings.ts';
import { en } from '../../src/i18n/en.ts';
import { he } from '../../src/i18n/he.ts';
Object.assign(globalThis,{DOMMatrix:class{},DOMPoint:class{},DOMRect:class{},Path2D:class{}});
const {useAppStore}=await import('../../src/store/appStore.ts');
const s=()=>useAppStore.getState();
after(()=>s().setProject(null));
const selected=()=>s().project!.openings!.find(o=>o.id===s().selectedOpeningId)!;
const place=()=>{s().beginOpeningPlacement('hinged');s().placeOpeningPoint({x:10,y:20});s().placeOpeningPoint({x:50,y:20});return selected();};

test('two-point placement is cancelable, creates one history step, measures width only and preserves quantities',()=>{
 s().setProject(structuredClone(PLAN_A));const before=buildRoomSummaries(s().project!);
 s().beginOpeningPlacement('sliding');s().placeOpeningPoint({x:10,y:20});
 assert.equal(s().project!.openings,undefined);assert.equal(s().dirty,false);assert.equal(s().history.length,0);
 s().cancelOpeningPlacement();assert.equal(s().openingPlacement,null);
 const o=place();assert.equal(o.widthM,40*MPP);assert.equal(o.heightM,null);assert.equal(o.quantity,1);assert.equal(o.sillHeightM,null);
 assert.deepEqual(o.roomIds,[]);assert.equal(s().history.length,1);assert.ok(s().dirty);
 assert.deepEqual(buildRoomSummaries(s().project!),before);
 s().undo();assert.equal(s().project!.openings,undefined);assert.equal(s().selectedOpeningId,null);
 s().redo();assert.equal(s().project!.openings!.length,1);
 s().setCurrentPage(2);s().beginOpeningPlacement('unknown');s().placeOpeningPoint({x:0,y:0});s().placeOpeningPoint({x:40,y:0});
 assert.equal(selected().widthM,null);assert.equal(selected().heightM,null);assert.equal(selected().kind,'unknown');
});

test('geometry edits and recalibration follow measured widths, preserve typed widths, and invalidate approval',()=>{
 s().setProject(structuredClone(PLAN_A));const o=place();s().approvePlanOpening(o.id);
 s().updatePlanOpening(o.id,{geometry:{endpointA:{x:10,y:20},endpointB:{x:90,y:20}}});
 assert.equal(selected().widthM,80*MPP);assert.equal(selected().approval.status,'draft');
 s().undo();assert.equal(s().project!.openings![0].widthM,40*MPP);assert.equal(s().project!.openings![0].approval.status,'approved');
 s().selectPlanOpening(o.id);s().addCalibrationPoint({x:0,y:0});s().addCalibrationPoint({x:100,y:0});s().applyCalibration(2);
 assert.equal(selected().widthM,.8);assert.equal(selected().approval.status,'draft');
 s().updatePlanOpening(o.id,{widthM:1.25,widthSource:'manual'});
 s().updatePlanOpening(o.id,{geometry:{endpointA:{x:10,y:20},endpointB:{x:110,y:20}}});assert.equal(selected().widthM,1.25);
 s().addCalibrationPoint({x:0,y:0});s().addCalibrationPoint({x:100,y:0});s().applyCalibration(4);assert.equal(selected().widthM,1.25);
});

test('replacing endpoints preserves identity, classification, room links and metadata; copies detach links without changing legacy rows',()=>{
 s().setProject(structuredClone(PLAN_A));const o=place();
 s().updatePlanOpening(o.id,{label:'Door A',notes:'Check jamb',roomIds:['r-master'],legacyRefs:[{roomId:'r-master',openingId:'o1'}]});
 const rooms=structuredClone(s().project!.rooms);
 s().beginOpeningEndpointEdit(o.id);s().placeOpeningPoint({x:4,y:5});s().placeOpeningPoint({x:64,y:5});
 assert.equal(selected().id,o.id);assert.equal(selected().kind,'door');assert.equal(selected().label,'Door A');assert.equal(selected().notes,'Check jamb');assert.deepEqual(selected().roomIds,['r-master']);
 s().approvePlanOpening(o.id);s().draftPlanOpening(o.id);assert.equal(selected().approval.reviewedAt,null);
 const id=s().duplicatePlanOpening(o.id)!;const copy=selected();assert.equal(copy.id,id);assert.notEqual(id,o.id);
 assert.deepEqual(copy.roomIds,[]);assert.deepEqual(copy.legacyRefs,[]);assert.equal(copy.geometry!.endpointA.x,34);
 assert.deepEqual(s().project!.rooms,rooms);s().undo();assert.equal(s().project!.openings!.length,1);
});

test('placement rejects coincident/non-finite endpoints and cancels on sheet/tool/plan switches',()=>{
 s().setProject(structuredClone(PLAN_A));s().beginOpeningPlacement('window');s().placeOpeningPoint({x:NaN,y:0});assert.equal(s().openingPlacement!.start,null);
 s().placeOpeningPoint({x:10,y:10});s().placeOpeningPoint({x:10,y:10});assert.equal(s().project!.openings,undefined);
 s().setCurrentPage(2);assert.equal(s().openingPlacement,null);s().beginOpeningPlacement('passage');s().setToolMode('pan');assert.equal(s().openingPlacement,null);
 s().beginOpeningPlacement('unknown');s().setProject(structuredClone(PLAN_A));assert.equal(s().openingPlacement,null);
 for(const preset of ['hinged','sliding','window','passage','unknown'] as const)assert.ok(openingClassification(preset).kind);
});

test('room suggestions require consistent boundary evidence and never mutate associations',()=>{
 s().setProject(structuredClone(PLAN_A));const o=place();const plan=structuredClone(s().project!);
 const template=plan.rooms[0];plan.rooms=[{...template,id:'left',points:[{x:0,y:0},{x:50,y:0},{x:50,y:100},{x:0,y:100}],closed:true},{...template,id:'right',points:[{x:50,y:0},{x:100,y:0},{x:100,y:100},{x:50,y:100}],closed:true}];
 const boundary={...o,geometry:{endpointA:{x:50,y:20},endpointB:{x:50,y:80}}};
 assert.deepEqual(suggestOpeningRooms(plan,boundary).sort(),['left','right']);assert.deepEqual(boundary.roomIds,[]);
 assert.deepEqual(suggestOpeningRooms(plan,{...boundary,geometry:{endpointA:{x:20,y:20},endpointB:{x:20,y:80}}}),[]);
 plan.rooms.push({...plan.rooms[1],id:'overlapping'});assert.deepEqual(suggestOpeningRooms(plan,boundary),[]);
});

test('manual opening controls have matching Hebrew and English translations',()=>{
 assert.deepEqual(Object.keys(en.openingTools).sort(),Object.keys(he.openingTools).sort());
 for(const key of Object.keys(he.openingTools))assert.ok(en.openingTools[key as keyof typeof en.openingTools].trim());
});
