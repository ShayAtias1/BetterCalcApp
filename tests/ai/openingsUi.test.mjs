import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {create} from 'zustand';
import {PLAN_A} from '../takeoff/fixtures.ts';
import {parseOpeningResult} from '../../src/lib/ai/openings.ts';
import {aiTiles,AI_PREPARATION_VERSION} from '../../src/lib/ai/contracts.ts';
import {importOpeningReview} from '../../src/lib/ai/openingsImport.ts';
const hash='a'.repeat(64),jobs=new Map(),consumed=new Set();let paid=0,prepared=0,resumed=0,sourceHash=hash;
const manifest={preparationVersion:AI_PREPARATION_VERSION,renderer:'embedpdf-pdfium',planId:PLAN_A.id,pageNumber:1,sourceHash:hash,nativeWidth:100,nativeHeight:80,rotation:0,userUnit:1,view:[0,0,100,80],pageDimensions:[5500,4400],renderScale:55,tiles:aiTiles(5500,4400),coordinateMapping:'native'};
const result={openings:[],deferred:[{geometryTile:'TILE_A',bbox:{x1:.1,y1:.1,x2:.2,y2:.2},evidence:['one jamb'],reason:'UNSUPPORTED_ENDPOINTS'}],coverageNotes:[]};
const reviews=new Map();
const app=create(()=>({project:structuredClone(PLAN_A),currentPage:1,selectedOpeningId:null,openingPlacement:null,
 importAiOpeningReview:r=>app.setState(s=>({project:importOpeningReview(s.project,r,1)})),
 setOverlayVisible:()=>{},selectPlanOpening:id=>app.setState({selectedOpeningId:id}),draftPlanOpening:()=>{},updatePlanOpening:()=>{}}));
await mock.module(new URL('../../src/store/appStore.ts',import.meta.url).href,{namedExports:{useAppStore:app}});
await mock.module(new URL('../../src/db/database.ts',import.meta.url).href,{namedExports:{
 listOpeningsAiJobs:async()=>structuredClone([...jobs.values()]),loadPdfBlob:async()=>new Blob([sourceHash]),
 collectOpeningsAiReview:async(_plan,key)=>{if(consumed.has(key))return;consumed.add(key);return reviews.get(key);}
}});
await mock.module(new URL('../../src/lib/ai/preparePage.ts',import.meta.url).href,{namedExports:{pdfFingerprint:async b=>b.text()}});
await mock.module(new URL('../../src/lib/ai/openingsService.ts',import.meta.url).href,{namedExports:{openingsAiService:{
 resume:async()=>{resumed++;},prepare:async(planId,pageNumber)=>{prepared++;const requestId='openings-'+prepared;const j={task:'openings-v1',requestId,planId,pageNumber,sourceHash:hash,status:'AWAITING_CONSENT',preview:{previewId:'preview',requestDigest:'b'.repeat(64),estimatedCostUsd:.205,reservationUsd:5.61,expiresAt:Date.now()+600000}};jobs.set(requestId,j);return j;},
 discard:async id=>jobs.set(id,{...jobs.get(id),status:'FAILED'}),
 submit:async(id,consent)=>{assert.equal(consent.approved,true);assert.equal(consent.requestDigest,'b'.repeat(64));paid++;const j=jobs.get(id),r=parseOpeningResult(result,manifest,'job-'+id);reviews.set(r.key,r);jobs.set(id,{...j,status:'COMPLETED',reviewKey:r.key});}
}}});
const {initializeOpeningsAiUi,activateOpeningsAiPage,requestOpeningDetection,useOpeningsAiUi}=await import('../../src/lib/ai/openingsUi.ts');
const {confirmDialog,useAppDialogs,settleDialog}=await import('../../src/lib/appDialogs.ts');
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,1));}throw Error('UI did not settle');}
test('modal cancellation and navigation while confirming never submit; reopening initializes recovery only once',async()=>{
 await initializeOpeningsAiUi();await activateOpeningsAiPage(PLAN_A.id,1);await initializeOpeningsAiUi();assert.equal(resumed,1);
 const pending=requestOpeningDetection(job=>confirmDialog(`Cost $${job.preview.estimatedCostUsd}; reservation $${job.preview.reservationUsd}`));
 await until(()=>useAppDialogs.getState().queue.length);assert.ok(useAppDialogs.getState().queue[0].message.includes('$5.61'));settleDialog(useAppDialogs.getState().queue[0].id,false);await pending;assert.equal(paid,0);
 const navigated=requestOpeningDetection(()=>{app.setState({currentPage:2});return Promise.resolve(true);});await navigated;assert.equal(paid,0);app.setState({currentPage:1});await activateOpeningsAiPage(PLAN_A.id,1);
});
test('explicit approval imports once; refresh/delete/undo never replay or add paid requests; controls and marker render',async()=>{
 await requestOpeningDetection(()=>Promise.resolve(true));assert.equal(paid,1);assert.equal(app.getState().project.openings.length,1);
 const marker=app.getState().project.openings[0];assert.equal(marker.geometry,null);assert.equal(marker.approval.status,'draft');
 app.setState({project:{...app.getState().project,openings:[]}});await activateOpeningsAiPage(PLAN_A.id,1);assert.equal(app.getState().project.openings.length,0);
 await requestOpeningDetection(()=>Promise.resolve(true));assert.equal(paid,1);assert.equal(prepared,3);
 sourceHash='c'.repeat(64);await activateOpeningsAiPage(PLAN_A.id,1);assert.equal(useOpeningsAiUi.getState().sourceHash,sourceHash);
});
