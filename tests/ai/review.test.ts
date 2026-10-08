import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiReviewProgress, roomHasPendingDetectionWarning, aiWarnings } from '../../src/lib/localAiReview.ts';

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
