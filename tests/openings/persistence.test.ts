import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_A } from '../takeoff/fixtures.ts';
import { addPlanOpening, openingsOf } from '../../src/lib/planOpenings.ts';

// Exercise actual database.ts save/load functions at the IndexedDB adapter boundary.
// No browser or fake application implementation; cloning models object-store semantics.
const rows=new Map<string,unknown>();
const adapter={
 async put(store:string,value:unknown){assert.equal(store,'projects');rows.set((value as {id:string}).id,structuredClone(value));},
 async get(store:string,id:string){assert.equal(store,'projects');return rows.has(id)?structuredClone(rows.get(id)):undefined;},
};
mock.module('idb',{namedExports:{openDB:async()=>adapter}});
const {savePlan,loadPlan}=await import('../../src/db/database.ts');

test('canonical openings persist atomically with legacy rows using existing plan record',async()=>{
 const plan=addPlanOpening(structuredClone(PLAN_A),{pageNumber:1,geometry:null,kind:'unknown',mechanism:'unknown',walkableAccess:'unknown',roomIds:[],widthM:null,heightM:null,sillHeightM:null,quantity:null,source:'manual',legacyRefs:[]},'canonical',1);
 await savePlan(plan);const loaded=(await loadPlan(plan.id))!;
 assert.deepEqual(loaded.openings,plan.openings);assert.deepEqual(loaded.rooms,plan.rooms);
 openingsOf(loaded)[0].widthM=7;assert.equal(openingsOf((await loadPlan(plan.id))!)[0].widthM,null);
});

test('old IndexedDB plan remains without canonical array; legacy openings are not rewritten',async()=>{
 await savePlan(PLAN_A);const loaded=(await loadPlan(PLAN_A.id))!;
 assert.equal(Object.hasOwn(loaded,'openings'),false);assert.deepEqual(loaded.rooms,PLAN_A.rooms);
 assert.equal(Object.hasOwn(rows.get(PLAN_A.id) as object,'openings'),false);
});

test('quantity consent, explicit zero base and legacy distinction persist without touching legacy rows',async()=>{
 const plan=addPlanOpening(structuredClone(PLAN_A),{pageNumber:1,geometry:{endpointA:{x:0,y:0},endpointB:{x:20,y:0}},kind:'door',mechanism:'hinged',walkableAccess:'supported',roomIds:['r-master'],widthM:1,heightM:2,sillHeightM:0,quantity:1,source:'manual',legacyRefs:[],quantityReview:{associationsConfirmed:true,distinctLegacyRoomIds:['r-master']}},'quantity-opening',1);
 await savePlan(plan);const loaded=(await loadPlan(plan.id))!;
 assert.deepEqual(loaded.openings,plan.openings);assert.deepEqual(loaded.rooms,PLAN_A.rooms);
});

test('quantity-only entry method persists without coordinates or conversion of legacy rows',async()=>{
 const {quantityOpeningInput}=await import('../../src/lib/manualOpenings.ts');
 const {validatePlanOpening}=await import('../../src/lib/planOpenings.ts');
 const p=addPlanOpening(structuredClone(PLAN_A),quantityOpeningInput(PLAN_A,'r-master','door',{widthM:1,heightM:2,sillHeightM:0,quantity:1}),'takeoff',1);
 await savePlan(p);const loaded=(await loadPlan(p.id))!;
 const opening=loaded.openings![0];
 assert.equal(opening.entryMethod,'takeoff');assert.equal(opening.geometry,null);assert.equal(opening.approval.status,'draft');assert.equal(opening.quantityReview?.associationsConfirmed,false);
 assert.equal(validatePlanOpening(loaded,opening).canApprove,true);assert.deepEqual(loaded.rooms,PLAN_A.rooms);
});
