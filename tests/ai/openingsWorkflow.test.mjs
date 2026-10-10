import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createOpeningsWorkflow} from '../../src/lib/ai/openingsWorkflow.ts';
import {aiTiles,AI_PREPARATION_VERSION} from '../../src/lib/ai/contracts.ts';
import { result as saved } from './fixtures/openings-synthetic.ts';
const hash='a'.repeat(64);
function harness(){
 const jobs=new Map(),reviews=new Map();let calls=0,gets=0,previewCalls=0,sourceHash=hash,postError=null,getError=null,result=structuredClone(saved),saveFailure=false;
 const deps={pollDelay:()=>new Promise(()=>{}),loadPdf:async()=>new Blob([sourceHash]),fingerprint:async b=>b.text(),
 prepare:async(planId,pageNumber,_blob,sourceHash)=>({manifest:{preparationVersion:AI_PREPARATION_VERSION,renderer:'embedpdf-pdfium',planId,pageNumber,sourceHash,nativeWidth:1417,nativeHeight:1276,rotation:0,userUnit:1,view:[0,0,1417,1276],pageDimensions:[5500,4953],renderScale:5500/1417,tiles:aiTiles(5500,4953),coordinateMapping:'native'},images:[]}),
 saveJob:async j=>{if(saveFailure&&j.status==='PROCESSING')throw Error('disk failed');jobs.set(j.requestId,structuredClone(j));},listJobs:async()=>structuredClone([...jobs.values()]),
 saveCompleted:async(j,r)=>{if(saveFailure)throw Error('disk failed');jobs.set(j.requestId,structuredClone(j));if(!reviews.has(r.key))reviews.set(r.key,structuredClone(r));},
 preview:async b=>{previewCalls++;return {task:'openings-v1',requestId:b.requestId,previewId:randomUUID(),requestDigest:'b'.repeat(64),estimatedCostUsd:.2044,reservationUsd:5.61,currency:'USD',expiresAt:Date.now()+600000,basis:'historical',pricingVerifiedDate:'2026-10-07'};},
 submit:async()=>{calls++;assert.equal([...jobs.values()].at(-1).status,'PROCESSING');if(postError)throw postError;return response([...jobs.values()].at(-1));},
 find:async id=>{gets++;if(getError)throw getError;return response(jobs.get(id));},requestId:()=>`openings-${randomUUID()}`};
 function response(j){return {task:'openings-v1',id:'job-'+j.requestId,requestId:j.requestId,requestDigest:j.preview.requestDigest,status:'COMPLETED',result};}
 const workflow=createOpeningsWorkflow(deps);
 return {workflow,deps,jobs,reviews,get calls(){return calls;},get gets(){return gets;},get previewCalls(){return previewCalls;},set sourceHash(v){sourceHash=v;},set postError(v){postError=v;},set getError(v){getError=v;},set result(v){result=v;},set saveFailure(v){saveFailure=v;}};
}
const consent=j=>({approved:true,approvedAt:Date.now(),previewId:j.preview.previewId,requestDigest:j.preview.requestDigest});
test('preparation only previews; explicit bound consent submits once and persists drafts/deferred/provenance',async()=>{
 const h=harness();const result=structuredClone(saved);result.deferred=[{geometryTile:'TILE_A',bbox:{x1:.1,y1:.1,x2:.2,y2:.2},reason:'UNSUPPORTED_ENDPOINTS',evidence:['One jamb']}];h.result=result;
 const j=await h.workflow.prepare('plan',1);assert.equal(j.status,'AWAITING_CONSENT');assert.equal(h.calls,0);assert.equal(h.previewCalls,1);
 await assert.rejects(()=>h.workflow.submit(j.requestId,{...consent(j),approved:false}));
 await assert.rejects(()=>h.workflow.submit(j.requestId,{...consent(j),requestDigest:'wrong'}));assert.equal(h.calls,0);
 const done=await h.workflow.submit(j.requestId,consent(j));assert.equal(done.status,'COMPLETED');assert.equal(h.calls,1);
 const review=h.reviews.get(done.reviewKey);assert.equal(review.candidates.length,17);assert.equal(review.deferred[0].geometry,null);
 for(const c of review.candidates){assert.equal(c.approval.status,'draft');assert.equal(c.requiresReview,true);assert.equal(c.provenance.sourceHash,hash);}
 await assert.rejects(()=>h.workflow.submit(j.requestId,consent(j)));await h.workflow.recover(j.requestId);assert.equal(h.calls,1);
});
test('ambiguous admission and refresh recover with GET only; status outages retain recoverability',async()=>{
 const h=harness(),j=await h.workflow.prepare('plan',1);h.postError=Error('Lost POST response');h.getError=Error('Status offline');
 await h.workflow.submit(j.requestId,consent(j));assert.equal(h.calls,1);assert.equal(h.jobs.get(j.requestId).status,'PROCESSING');
 const restored=createOpeningsWorkflow(h.deps);await assert.rejects(()=>restored.submit(j.requestId,consent(j)));assert.equal(h.calls,1);
 h.getError=null;await restored.resume();assert.equal(h.jobs.get(j.requestId).status,'COMPLETED');assert.equal(h.calls,1);assert.equal(h.reviews.size,1);
});
test('source replacement, preparation refresh, and failed durable admission never produce paid calls',async()=>{
 const h=harness(),j=await h.workflow.prepare('plan',1);h.sourceHash='c'.repeat(64);await assert.rejects(()=>h.workflow.submit(j.requestId,consent(j)));assert.equal(h.calls,0);
 const fresh=harness(),prepared=await fresh.workflow.prepare('plan',1);await createOpeningsWorkflow(fresh.deps).resume();assert.equal(fresh.jobs.get(prepared.requestId).status,'FAILED');assert.equal(fresh.calls,0);
 const disk=harness(),ready=await disk.workflow.prepare('plan',1);disk.saveFailure=true;await assert.rejects(()=>disk.workflow.submit(ready.requestId,consent(ready)));assert.equal(disk.calls,0);
});
test('unavailable server, wrong task and invalid result fail without submission retries',async()=>{
 for(const mode of ['restart','invalid','wrong-task','source']){
  const h=harness(),j=await h.workflow.prepare('plan',1);h.postError=Error('Lost response');h.getError=Error('offline');await h.workflow.submit(j.requestId,consent(j));
  h.getError=null;
  if(mode==='restart')h.getError=Object.assign(Error('Gone'),{status:410});
  if(mode==='invalid')h.result={openings:[],deferred:[]};
  if(mode==='wrong-task')h.deps.find=async()=>({task:'rooms',id:'wrong',requestId:j.requestId,status:'COMPLETED',requestDigest:j.preview.requestDigest,result:saved});
  if(mode==='source')h.sourceHash='c'.repeat(64);
  await createOpeningsWorkflow(h.deps).resume();assert.equal(h.jobs.get(j.requestId).status,'FAILED');assert.equal(h.calls,1);assert.equal(h.reviews.size,0);
 }
});
test('double submission submits once; result collection retries cannot overwrite collected edits',async()=>{
 const h=harness(),j=await h.workflow.prepare('plan',1);
 const settled=await Promise.allSettled([h.workflow.submit(j.requestId,consent(j)),h.workflow.submit(j.requestId,consent(j))]);assert.equal(settled.filter(s=>s.status==='fulfilled').length,1);assert.equal(h.calls,1);
 const job=h.jobs.get(j.requestId),review=h.reviews.get(job.reviewKey);review.candidates[0].geometry.endpointA.x=12;
 h.jobs.set(j.requestId,{...job,status:'PROCESSING'});await h.workflow.recover(j.requestId);assert.equal(h.reviews.get(job.reviewKey).candidates[0].geometry.endpointA.x,12);assert.equal(h.calls,1);
});
test('processing jobs are collected by background free polling without another POST',async()=>{
 const h=harness();let gets=0;
 h.deps.pollDelay=()=>new Promise(r=>setTimeout(r,1));
 h.deps.find=async requestId=>{gets++;const j=h.jobs.get(requestId);return {task:'openings-v1',id:'job-'+requestId,requestId,requestDigest:j.preview.requestDigest,status:gets===1?'PROCESSING':'COMPLETED',result:saved};};
 const workflow=createOpeningsWorkflow(h.deps),j=await workflow.prepare('plan',1);
 assert.equal((await workflow.submit(j.requestId,consent(j))).status,'PROCESSING');
 for(let i=0;i<100&&h.jobs.get(j.requestId).status==='PROCESSING';i++)await new Promise(r=>setTimeout(r,2));
 assert.equal(h.jobs.get(j.requestId).status,'COMPLETED');assert.equal(h.calls,1);assert.equal(gets,2);assert.equal(h.reviews.size,1);
});
test('stale service is rejected before preparation/upload or paid admission',async()=>{
 const h=harness();h.deps.checkService=async()=>{throw Error('outdated service');};
 const workflow=createOpeningsWorkflow(h.deps);await assert.rejects(()=>workflow.prepare('plan',1),/outdated/);assert.equal(h.previewCalls,0);assert.equal(h.calls,0);assert.equal(h.jobs.size,0);
});
test('failed admitted request is recovered before retry; unresolved receipts block new preparation',async()=>{
 const h=harness(),j=await h.workflow.prepare('plan',1);h.jobs.set(j.requestId,{...j,status:'FAILED',consent:consent(j),updatedAt:1});h.deps.admission=async()=>true;
 const next=createOpeningsWorkflow(h.deps);await assert.rejects(()=>next.prepare('plan',1),/existing openings request was recovered/);assert.equal(h.jobs.get(j.requestId).status,'COMPLETED');assert.equal(h.calls,0);assert.equal(h.previewCalls,1);
 const blocked=harness(),old=await blocked.workflow.prepare('plan',1);blocked.jobs.set(old.requestId,{...old,status:'FAILED',consent:consent(old),updatedAt:1});blocked.deps.admission=async()=>{throw Error('receipt unreachable');};
 await assert.rejects(()=>createOpeningsWorkflow(blocked.deps).prepare('plan',1),/receipt unreachable/);assert.equal(blocked.previewCalls,1);assert.equal(blocked.calls,0);
});
test('admitted failed request warns of another charge; fresh unadmitted in-flight requests block retry',async()=>{
 const h=harness(),j=await h.workflow.prepare('plan',1);h.jobs.set(j.requestId,{...j,status:'FAILED',consent:consent(j),updatedAt:1});h.deps.admission=async()=>true;
 h.deps.find=async id=>({task:'openings-v1',id:'job-'+id,requestId:id,requestDigest:j.preview.requestDigest,status:'FAILED',error:'provider failed'});
 const retry=await createOpeningsWorkflow(h.deps).prepare('plan',1);assert.equal(retry.previousPaidAttempt,true);assert.equal(h.calls,0);
 const transit=harness(),old=await transit.workflow.prepare('plan',1);transit.jobs.set(old.requestId,{...old,status:'FAILED',consent:consent(old),submittedAt:Date.now()});transit.deps.admission=async()=>false;
 await assert.rejects(()=>createOpeningsWorkflow(transit.deps).prepare('plan',1),/still be in transit/);assert.equal(transit.calls,0);
});
