import { parseOneClickResult } from '../../src/lib/ai/oneClick.ts';
import { AI_PREPARATION_VERSION } from '../../src/lib/ai/contracts.ts';
import type { OneClickManifest } from '../../src/lib/ai/oneClick.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiReviewProgress, roomHasPendingDetectionWarning, aiWarnings, pendingAiReviewCandidates } from '../../src/lib/localAiReview.ts';

test('review progress counts unique resolved IDs and pending IDs without double counting',()=>{
  assert.deepEqual(aiReviewProgress(['pending-1','pending-2'],['approved','rejected','approved']),{resolved:2,total:4});
  assert.deepEqual(aiReviewProgress([],['approved','rejected']),{resolved:2,total:2});
  assert.deepEqual(aiReviewProgress(['approved','pending'],['approved']),{resolved:1,total:2});
});
test('approved AI Rooms never show actionable confidence warnings, including older AI imports',()=>{
  assert.equal(roomHasPendingDetectionWarning({id:'local-ai:plan:space-001',detectionConfidence:'low'}),false);
  assert.equal(roomHasPendingDetectionWarning({id:'ordinary-id',detectionConfidence:'low',aiSource:{spaceId:'space-001',suggestedType:null,geometryClass:'AMBIGUOUS',reviewNotes:['Actual uncertainty'],reviewedWarningIds:[]}}),false);
  assert.equal(roomHasPendingDetectionWarning({id:'legacy-room',detectionConfidence:'low'}),true);
  assert.equal(roomHasPendingDetectionWarning({id:'manual-room'}),false);
});
test('acknowledgment removes active warning indicators but retains the original details',()=>{
  const meta={planId:'plan',sourceHash:'hash',pageNumber:1,width:100,height:100,spaceId:'space-001',geometryClass:'AMBIGUOUS',reviewNotes:['Boundary uncertain'],ambiguities:['Boundary uncertain'],requiresReview:true,reason:null};
  const original=structuredClone(meta),warnings=aiWarnings(meta),reviewed=warnings.map(w=>w.id);
  assert.equal(warnings.filter(w=>!reviewed.includes(w.id)).length,0);
  assert.equal(warnings.filter(w=>reviewed.includes(w.id)).length,warnings.length);
  assert.deepEqual(meta,original);
});


test('One-Click and full-page pending drafts share source filtering; resolved and approved drafts leave both interfaces',()=>{
  const manifest={preparationVersion:AI_PREPARATION_VERSION,renderer:'embedpdf-pdfium',planId:'plan',pageNumber:1,sourceHash:'current',nativeWidth:100,nativeHeight:100,rotation:0,userUnit:1,view:[0,0,100,100],pageDimensions:[100,100],renderScale:1,tiles:[],coordinateMapping:'native',targetPoint:{x:50,y:50},crop:{tileId:'TARGET_CROP',pageX:0,pageY:0,pageWidth:100,pageHeight:100,tileWidth:100,tileHeight:100}} as OneClickManifest;
  const [target]=parseOneClickResult({status:'FOUND',space:{polygon:[[.2,.2],[.8,.2],[.8,.8],[.2,.8]],type:'bedroom',geometryConfidence:'MEDIUM',ambiguities:[]}},manifest,'saved-job',[]);
  const full={...target,id:'full-page',localAi:{...target.localAi!,detectionMode:undefined}};
  const stale={...target,id:'old-pdf',localAi:{...target.localAi!,sourceHash:'old'}};
  const project={id:'plan',rooms:[]};
  const workflow={sourceHash:'current',resolvedIds:[],reviewScope:{planId:'plan',pageNumber:1}};
  assert.deepEqual(pendingAiReviewCandidates([target,full,stale],project,1,workflow).map(c=>c.id),[target.id,full.id]);
  assert.deepEqual(pendingAiReviewCandidates([target,full],project,1,{...workflow,resolvedIds:[target.id]}).map(c=>c.id),[full.id]);
  assert.deepEqual(pendingAiReviewCandidates([target,full],{...project,rooms:[{id:target.id}]},1,workflow).map(c=>c.id),[full.id]);
  // A fingerprint from a different page/plan must never hide this page's current suggestion.
  assert.equal(pendingAiReviewCandidates([target],project,1,{sourceHash:'other',resolvedIds:[target.id],reviewScope:{planId:'other-plan',pageNumber:2}}).length,1);
  assert.equal(pendingAiReviewCandidates([target],project,2,workflow).length,0);
});
