import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchQuantities, batchCost, reusableJob, type AiBatch } from '../../src/lib/ai/batchModel.ts';
import type { AiJobRecord } from '../../src/lib/ai/contracts.ts';
import { PLAN_A, PLAN_B } from '../takeoff/fixtures.ts';
import { buildProjectQuantities } from '../../src/lib/projectQuantities.ts';
function batch(pageNumber=1):AiBatch{return {id:'batch',projectId:'project-1',createdAt:0,updatedAt:0,state:'paused',calculations:['area','perimeter','flooring','cladding','skirting'],pages:[{planId:PLAN_A.id,planName:PLAN_A.name,pageNumber,sourceHash:'original',reviewKey:'review',status:'completed'}]};}
test('selected-page summary uses the existing engine and excludes other plans/pages',()=>{
  const result=batchQuantities(batch(),[PLAN_A,PLAN_B]);
  const expected=buildProjectQuantities([{...PLAN_A,rooms:PLAN_A.rooms.filter(r=>r.pageNumber===1).map(r=>({...r,workItems:r.workItems.filter(w=>w.type!=='cladding'||Number.isFinite(w.heightM)&&w.heightM!>0)}))}, {...PLAN_B,rooms:[]}]);
  assert.deepEqual(result.report.totals,expected.totals.filter(t=>['tiling_regular','tiling_as','cladding','panels'].includes(t.category)));
  assert.equal(result.pages[0].rooms.length,PLAN_A.rooms.filter(r=>r.pageNumber===1).length);
  assert.ok(result.pages[0].area!>0);
});
test('uncalibrated accepted Rooms have no physical area/perimeter',()=>{
  const result=batchQuantities(batch(2),[PLAN_A]);
  assert.equal(result.pages[0].calibrated,false);
  assert.equal(result.pages[0].area,null);assert.equal(result.pages[0].perimeter,null);
  for(const room of result.report.plans[0].summaries)assert.equal(room.tilingRegularAreaM2,null);
});
test('empty approval set and missing finish items stay pending, explicit cladding height required',()=>{
  const empty=batchQuantities(batch(),[{...PLAN_A,rooms:[]}]);
  assert.equal(empty.pages[0].area,null);assert.equal(empty.report.totals.length,0);
  const room=structuredClone(PLAN_A.rooms[0]);room.workItems=[];
  let q=batchQuantities(batch(),[{...PLAN_A,rooms:[room]}]);
  assert.deepEqual(q.pages[0].missing,['flooring','cladding','skirting']);
  room.workItems=[{id:'wall',type:'cladding'}];
  q=batchQuantities(batch(),[{...PLAN_A,rooms:[room]}]);
  assert.ok(q.pages[0].missing.includes('cladding'));assert.equal(q.report.totals.length,0);
  room.workItems[0].heightM=1.2;
  q=batchQuantities(batch(),[{...PLAN_A,rooms:[room]}]);
  assert.ok(!q.pages[0].missing.includes('cladding'));assert.ok(q.report.totals[0].quantityM2>0);
  room.workItems.push({id:'invalid-wall',type:'cladding',heightM:NaN});
  assert.ok(batchQuantities(batch(),[{...PLAN_A,rooms:[room]}]).pages[0].missing.includes('cladding'));
});
test('calculation choices control categories, cached jobs require exact source/page/plan',()=>{
  const b=batch();b.calculations=['perimeter'];assert.equal(batchQuantities(b,[PLAN_A]).report.totals.length,0);
  const job:AiJobRecord={requestId:'paid',planId:PLAN_A.id,pageNumber:1,sourceHash:'original',status:'COMPLETED',createdAt:0,updatedAt:0};
  assert.equal(reusableJob([job],b.pages[0])?.requestId,'paid');
  for(const override of [{sourceHash:'replacement'},{pageNumber:2},{planId:PLAN_B.id}])assert.equal(reusableJob([job],{...b.pages[0],...override}),undefined);
  assert.equal(reusableJob([{...job,status:'FAILED'}],b.pages[0]),undefined);
});
test('cost range uses historical metrics, no new requests estimate zero',()=>{
  assert.deepEqual(batchCost([],0),{low:0,high:0,samples:0});
  assert.deepEqual(batchCost([{metrics:{estimatedCostUsd:0.1}} as AiJobRecord],3),{low:0.15000000000000002,high:0.6000000000000001,samples:1});
});

test('One-Click completion never satisfies full-page reuse or changes full-page cost estimates',()=>{
  const page=batch().pages[0];
  const legacy:AiJobRecord={requestId:'full',planId:page.planId,pageNumber:page.pageNumber,sourceHash:page.sourceHash,status:'COMPLETED',createdAt:0,updatedAt:1,metrics:{estimatedCostUsd:.1}};
  const target:AiJobRecord={...legacy,requestId:'target',mode:'one-click-v1',updatedAt:2,metrics:{estimatedCostUsd:.01}};
  assert.equal(reusableJob([target],page),undefined);
  assert.equal(reusableJob([legacy,target],page)?.requestId,'full');
  assert.equal(reusableJob([{...legacy,mode:'full-page-v1'},target],page)?.requestId,'full');
  assert.deepEqual(batchCost([legacy,target],2),{low:.1,high:.4,samples:1});
});
