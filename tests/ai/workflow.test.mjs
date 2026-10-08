import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from 'zustand/vanilla';
import { aiTiles, AI_PREPARATION_VERSION, aiReviewKey } from '../../src/lib/ai/contracts.ts';
const hash='a'.repeat(64),newHash='b'.repeat(64);
const reviews=new Map(),pdfs=new Map([['restore',new Blob([hash])]]),jobs=new Map();
const result=JSON.parse(readFileSync(new URL('./frozen-spaces.json',import.meta.url)));
function manifest(planId,pageNumber=1){return {preparationVersion:AI_PREPARATION_VERSION,renderer:'embedpdf-pdfium',planId,pageNumber,sourceHash:hash,nativeWidth:100,nativeHeight:80,rotation:0,userUnit:1,view:[0,0,100,80],pageDimensions:[5500,4400],renderScale:55,tiles:aiTiles(5500,4400)};}
const app=createStore(()=>({project:{id:'restore',rooms:[]},currentPage:1,detectionCandidates:[],selectedDetectionCandidateId:null,detectionCandidatesPage:null}));
const restored={requestId:'restored-request',jobId:'restored-job',planId:'restore',pageNumber:1,sourceHash:hash,status:'PROCESSING',createdAt:Date.now(),updatedAt:Date.now(),manifest:manifest('restore')};jobs.set(restored.requestId,restored);
await mock.module(new URL('../../src/db/database.ts',import.meta.url).href,{namedExports:{
  loadPlan:async id=>({id,rooms:[]}),
  loadPdfBlob:async id=>pdfs.get(id),loadAiReview:async key=>structuredClone(reviews.get(key)),
  updateAiReview:async(key,update)=>{reviews.set(key,structuredClone(update(reviews.get(key))));},
  saveAiJob:async job=>{jobs.set(job.requestId,structuredClone(job));},listAiJobs:async()=>[...jobs.values()]
}});
await mock.module(new URL('../../src/store/appStore.ts',import.meta.url).href,{namedExports:{useAppStore:app}});
let prepareGate=null,postCalls=0,rejectPost=false;
const oneClickRequests=new Set();
const oneClickResult={status:'FOUND',reason:'',space:{polygon:[[.2,.2],[.8,.2],[.8,.8],[.2,.8]],type:'bedroom',geometryConfidence:'MEDIUM',ambiguities:[]}};
await mock.module(new URL('../../src/lib/ai/preparePage.ts',import.meta.url).href,{namedExports:{
  prepareOneClickPage:async(planId,pageNumber,_blob,_hash,targetPoint)=>{if(prepareGate)await prepareGate;return {manifest:{...manifest(planId,pageNumber),preparationVersion:'one-click-v1',targetPoint,tiles:[],crop:{}},images:[]};},
  pdfFingerprint:async blob=>blob.text(),prepareAiPage:async(planId,pageNumber)=>{if(prepareGate)await prepareGate;return {manifest:manifest(planId,pageNumber),images:[]};}
}});
const response=requestId=>({id:requestId==='restored-request'?'restored-job':requestId,requestId,status:'COMPLETED',result:oneClickRequests.has(requestId)?oneClickResult:result});
await mock.module(new URL('../../src/lib/ai/jobClient.ts',import.meta.url).href,{namedExports:{
  submitSpaceJob:async(requestId,m)=>{if(m.preparationVersion==='one-click-v1')oneClickRequests.add(requestId);postCalls++;if(rejectPost)throw Object.assign(new Error('Cap reached.'),{status:429});return {id:requestId,requestId,status:'PROCESSING'};},
  getSpaceJob:async id=>response(id==='restored-job'?'restored-request':id),findSpaceJob:async id=>response(id)
}});
const {initializeAiWorkflow,activateAiPage,startAiDetection,useAiWorkflow}=await import('../../src/lib/ai/workflow.ts');
const {notifyPdfBlobChanged}=await import('../../src/lib/pdfBlobEvents.ts');
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw new Error('Workflow state did not settle.');}
function navigate(page){app.setState({currentPage:page,detectionCandidates:[],detectionCandidatesPage:null,selectedDetectionCandidateId:null});}

test('refresh recovery polls the saved job without any paid resubmission',async()=>{
  await initializeAiWorkflow();await until(()=>useAiWorkflow.getState().jobs.some(j=>j.status==='COMPLETED'));
  assert.equal(postCalls,0);await activateAiPage('restore',1);assert.equal(app.getState().detectionCandidates.length,result.spaces.length);
});
test('page-scoped drafts retain edited/original points, warning acknowledgments and type choices through navigation',async()=>{
  const original=app.getState().detectionCandidates[0];
  const edited={...original,points:original.points.map((p,i)=>i? p:{...p,x:p.x+1}),reviewedWarningIds:['requiresReview'],roomTypeKey:'bedroom',semanticTypeEdited:true,semanticTypeConfirmed:true};
  app.setState({detectionCandidates:[edited,...app.getState().detectionCandidates.slice(1)],selectedDetectionCandidateId:edited.id});
  assert.deepEqual(useAiWorkflow.getState().resolvedIds,[]); // Neither selection nor warning review resolves a Space.
  navigate(2);await activateAiPage('restore',2);assert.equal(app.getState().detectionCandidates.length,0);
  navigate(1);await activateAiPage('restore',1);assert.deepEqual(app.getState().detectionCandidates[0],edited);
  assert.deepEqual(reviews.get(aiReviewKey('restore',1,hash)).candidates[0].originalPoints,original.originalPoints);
});
test('approved/rejected identities stay resolved even after Room undo; replaced PDF cannot inherit old drafts',async()=>{
  const candidate=app.getState().detectionCandidates[0];
  app.setState({project:{id:'restore',rooms:[{id:candidate.id}]},detectionCandidates:app.getState().detectionCandidates.slice(1)});
  navigate(2);await activateAiPage('restore',2);app.setState({project:{id:'restore',rooms:[]}});
  navigate(1);await activateAiPage('restore',1);assert.ok(!app.getState().detectionCandidates.some(c=>c.id===candidate.id));
  assert.ok(useAiWorkflow.getState().resolvedIds.includes(candidate.id));
  assert.deepEqual(useAiWorkflow.getState().reviewScope,{planId:'restore',pageNumber:1});
  pdfs.set('restore',new Blob([newHash]));notifyPdfBlobChanged('plan:restore');await until(()=>useAiWorkflow.getState().sourceHash===newHash);
  assert.equal(app.getState().detectionCandidates.length,0);
});
test('detection follows its source page while the user navigates; a double start submits once',async()=>{
  pdfs.set('background',new Blob([hash]));app.setState({project:{id:'background',rooms:[]},currentPage:1,detectionCandidates:[]});await activateAiPage('background',1);
  let release;prepareGate=new Promise(resolve=>{release=resolve;});
  const first=startAiDetection();await until(()=>useAiWorkflow.getState().jobs.some(j=>j.planId==='background'&&j.status==='PREPARING'));
  await startAiDetection();navigate(2);await activateAiPage('background',2);release();await first;prepareGate=null;
  await until(()=>useAiWorkflow.getState().jobs.some(j=>j.planId==='background'&&j.status==='COMPLETED'));
  assert.equal(postCalls,1);assert.equal(app.getState().currentPage,2);assert.equal(app.getState().detectionCandidates.length,0);
  navigate(1);await activateAiPage('background',1);assert.equal(app.getState().detectionCandidates.length,result.spaces.length);
});
test('failed paid admission remains failed until the user explicitly retries',async()=>{
  pdfs.set('failed',new Blob([hash]));app.setState({project:{id:'failed',rooms:[]},currentPage:1,detectionCandidates:[]});await activateAiPage('failed',1);
  rejectPost=true;await startAiDetection();assert.equal(postCalls,2);
  assert.equal(useAiWorkflow.getState().jobs.find(j=>j.planId==='failed').status,'FAILED');
  navigate(2);await activateAiPage('failed',2);navigate(1);await activateAiPage('failed',1);assert.equal(postCalls,2);
});

test('One-Click appends one editable persisted draft alongside existing suggestions and ignores repeated submission',async()=>{
  rejectPost=false;pdfs.set('oneclick',new Blob([hash]));
  app.setState({project:{id:'oneclick',rooms:[]},currentPage:1,detectionCandidates:[],selectDetectionCandidate:id=>app.setState({selectedDetectionCandidateId:id})});
  await activateAiPage('oneclick',1);
  const candidate={id:'existing-draft',pageNumber:1,points:[],localAi:{planId:'oneclick',sourceHash:hash}};
  app.setState({detectionCandidates:[candidate]});
  let release;prepareGate=new Promise(resolve=>{release=resolve;});const before=postCalls;
  const first=startAiDetection({x:50,y:40});await until(()=>useAiWorkflow.getState().jobs.some(j=>j.planId==='oneclick'&&j.status==='PREPARING'));
  await startAiDetection({x:60,y:40});release();await first;prepareGate=null;
  await until(()=>useAiWorkflow.getState().jobs.some(j=>j.planId==='oneclick'&&j.status==='COMPLETED')&&app.getState().detectionCandidates.length===2);
  assert.equal(postCalls,before+1);assert.equal(app.getState().project.rooms.length,0);
  const target=app.getState().detectionCandidates.find(c=>c.id!==candidate.id);assert.equal(target.localAi.detectionMode,'one-click-v1');
  assert.deepEqual(target.localAi.targetPoint,{x:50,y:40});assert.deepEqual(target.validationProblems,[]);
  navigate(2);await activateAiPage('oneclick',2);navigate(1);await activateAiPage('oneclick',1);
  assert.equal(app.getState().detectionCandidates.length,2);assert.equal(postCalls,before+1);
});
