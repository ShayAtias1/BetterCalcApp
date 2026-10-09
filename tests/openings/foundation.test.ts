import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_A } from '../takeoff/fixtures.ts';
import type { NewPlanOpening } from '../../src/types/index.ts';
import { addPlanOpening, openingsOf, openingInventory, removePlanOpening, reviewPlanOpening, updatePlanOpening, validatePlanOpening, withOpeningRoomChanges } from '../../src/lib/planOpenings.ts';
import { clonePlanForDuplicate } from '../../src/lib/planDuplication.ts';
import { buildRoomSummaries } from '../../src/lib/quantities.ts';

export const INPUT: NewPlanOpening = {
  pageNumber: 1, geometry: { endpointA: { x: 10, y: 20 }, endpointB: { x: 50, y: 20 } },
  kind: 'door', mechanism: 'unknown', walkableAccess: 'unknown', roomIds: ['r-master'],
  widthM: null, heightM: null, sillHeightM: null, quantity: null, source: 'manual', legacyRefs: [],
};

test('legacy reads do not migrate, alter room rows or add canonical data', () => {
  const plan = structuredClone(PLAN_A), before = structuredClone(plan);
  assert.deepEqual(openingsOf(plan), []);
  assert.equal(openingInventory(plan).legacy.length, plan.rooms.reduce((n,r) => n+(r.openings?.length??0),0));
  assert.deepEqual(plan,before); assert.equal(Object.hasOwn(plan,'openings'),false);
});

test('canonical CRUD and approval never change legacy quantities or invent dimensions', () => {
  const plan=structuredClone(PLAN_A), expected=buildRoomSummaries(plan);
  let next=addPlanOpening(plan,INPUT,'canonical',1);
  assert.deepEqual(next.rooms,plan.rooms);
  assert.deepEqual(buildRoomSummaries(next),expected);
  next=reviewPlanOpening(next,'canonical','approved',2);
  assert.equal(openingsOf(next)[0].heightM,null);
  assert.equal(openingsOf(next)[0].quantity,null);
  assert.equal(openingsOf(next)[0].approval.status,'approved');
  next=updatePlanOpening(next,'canonical',{widthM:0.9},3);
  assert.equal(openingsOf(next)[0].approval.status,'draft');
  assert.deepEqual(buildRoomSummaries(next),expected);
  assert.deepEqual(buildRoomSummaries(removePlanOpening(next,'canonical',4)),expected);
  assert.deepEqual(plan,PLAN_A);
});

test('legacy links deduplicate inventory only; edits/deletion do not touch legacy quantities', () => {
  const plan=structuredClone(PLAN_A);
  const linked={...INPUT,source:'legacy' as const,legacyRefs:[{roomId:'r-master',openingId:'o1'}]};
  const next=addPlanOpening(plan,linked,'c',1);
  assert.equal(openingInventory(next).legacy.length,openingInventory(plan).legacy.length-1);
  assert.deepEqual(buildRoomSummaries(next),buildRoomSummaries(plan));
  assert.throws(()=>addPlanOpening(next,linked,'duplicate',2),/already linked/);
  assert.deepEqual(removePlanOpening(next,'c',2).rooms,plan.rooms);
  const approved=reviewPlanOpening(next,'c','approved',2);
  const rooms=approved.rooms.map(r=>r.id==='r-master'?{...r,openings:r.openings!.filter(o=>o.id!=='o1')}:r);
  const edited=withOpeningRoomChanges(approved,rooms,3);
  assert.deepEqual(openingsOf(edited)[0].legacyRefs,[]);
  assert.equal(openingsOf(edited)[0].approval.status,'draft');
  assert.equal(openingsOf(edited)[0].widthM,null);
});

test('validation rejects invalid geometry, references and dimensions before approval', () => {
  const p=structuredClone(PLAN_A);
  for(const patch of [{widthM:-1},{heightM:NaN},{quantity:1.5},{pageNumber:999},{roomIds:['missing']},{geometry:{endpointA:{x:1,y:1},endpointB:{x:1,y:1}}}]) {
    assert.throws(()=>addPlanOpening(p,{...INPUT,...patch},'bad',1));
  }
  let p2=addPlanOpening(p,{...INPUT,kind:'unknown',geometry:null},'unknown',1);
  assert.equal(validatePlanOpening(p2,openingsOf(p2)[0]).canApprove,false);
  assert.throws(()=>reviewPlanOpening(p2,'unknown','approved',2));
  p2=updatePlanOpening(p2,'unknown',{id:'replacement',approval:{status:'approved'}} as never,2);
  assert.equal(openingsOf(p2)[0].id,'unknown');assert.equal(openingsOf(p2)[0].approval.status,'draft');
});

test('plan duplication remaps canonical identity, rooms and legacy links without quantity changes', () => {
  const p=addPlanOpening(structuredClone(PLAN_A),{...INPUT,legacyRefs:[{roomId:'r-master',openingId:'o1'}]},'linked',1);
  const source=addPlanOpening(p,{...INPUT,roomIds:[],apartmentNumber:'7'},'standalone',1);
  const copy=clonePlanForDuplicate(source,'copy');
  assert.notEqual(copy.id,source.id);assert.equal(openingsOf(copy).length,2);
  const linked=openingsOf(copy).find(o=>o.legacyRefs.length)!;
  assert.equal(linked.planId,copy.id);assert.equal(linked.roomIds[0],copy.rooms[0].id);
  assert.equal(linked.legacyRefs[0].openingId,copy.rooms[0].openings![0].id);
  assert.notEqual(linked.id,'linked');
  assert.equal(linked.widthM,null);
  assert.deepEqual(buildRoomSummaries(copy).map(r=>({...r,roomId:''})),buildRoomSummaries(source).map(r=>({...r,roomId:''})));
  linked.geometry!.endpointA.x=999;assert.equal(openingsOf(source)[0].geometry!.endpointA.x,10);
  const oldCopy=clonePlanForDuplicate(PLAN_A,'legacy');assert.equal(Object.hasOwn(oldCopy,'openings'),false);
});
