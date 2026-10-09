import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {PLAN_A} from '../takeoff/fixtures.ts';
import {parseOpeningResult} from '../../src/lib/ai/openings.ts';
import {aiTiles,AI_PREPARATION_VERSION} from '../../src/lib/ai/contracts.ts';
import {importOpeningReview} from '../../src/lib/ai/openingsImport.ts';
import {validatePlanOpening} from '../../src/lib/planOpenings.ts';
import {canonicalOpeningDeduction} from '../../src/lib/openingQuantities.ts';
import {translate} from '../../src/i18n/index.ts';
const manifest={preparationVersion:AI_PREPARATION_VERSION,renderer:'embedpdf-pdfium' as const,planId:PLAN_A.id,pageNumber:1,sourceHash:'a'.repeat(64),nativeWidth:100,nativeHeight:80,rotation:0,userUnit:1,view:[0,0,100,80],pageDimensions:[5500,4400] as [number,number],renderScale:55,tiles:aiTiles(5500,4400),coordinateMapping:'native'};
const result={openings:[{openingId:'door',type:'hinged-door',geometryTile:'TILE_A',endpointA:{x:.1,y:.2},endpointB:{x:.2,y:.2},bbox:{x1:.05,y1:.1,x2:.3,y2:.3},confidence:.9,requiresReview:false,evidence:['swing arc'],ambiguities:['jamb uncertain']}],deferred:[{geometryTile:'TILE_B',bbox:{x1:.1,y1:.1,x2:.2,y2:.2},evidence:['one jamb'],reason:'UNSUPPORTED_ENDPOINTS'}],coverageNotes:['Review kitchen doorway']};
const review=parseOpeningResult(result,manifest,'fixture');
Object.assign(globalThis,{DOMMatrix:class{},DOMPoint:class{},DOMRect:class{},Path2D:class{}});
const {useAppStore}=await import('../../src/store/appStore.ts');const s=()=>useAppStore.getState();
after(()=>s().setProject(null));
test('AI imports deterministic drafts and deferred markers without defaults, associations or legacy changes',()=>{
 const p=importOpeningReview(PLAN_A,review,1);assert.equal(p.openings!.length,2);assert.deepEqual(p.rooms,PLAN_A.rooms);
 for(const o of p.openings!){assert.equal(o.approval.status,'draft');assert.equal(o.source,'import');assert.equal(o.widthM,null);assert.equal(o.quantity,null);assert.deepEqual(o.roomIds,[]);assert.equal(o.aiDetection!.sourceHash,manifest.sourceHash);}
 assert.deepEqual(p.openings![0].aiDetection!.provenance!.original,result.openings[0]);assert.equal(p.openings![1].geometry,null);assert.equal(validatePlanOpening(p,p.openings![1]).canApprove,false);
 assert.equal(importOpeningReview(p,review,2),p);
 const deleted={...p,openings:[]};assert.equal(importOpeningReview(deleted,review,3),deleted);
 assert.throws(()=>importOpeningReview({...PLAN_A,id:'other'},review,1));
});
test('existing editor places deferred endpoints, edits preserve provenance, duplication detaches AI identity, undo/redo works',()=>{
 s().setProject(structuredClone(PLAN_A));s().importAiOpeningReview(review);const count=s().project!.openings!.length;
 s().importAiOpeningReview(review);assert.equal(s().project!.openings!.length,count);
 const marker=s().project!.openings![1];s().beginOpeningEndpointEdit(marker.id);s().placeOpeningPoint({x:10,y:20});s().placeOpeningPoint({x:50,y:20});
 const placed=s().project!.openings!.find(o=>o.id===marker.id)!;assert.deepEqual(placed.geometry,{endpointA:{x:10,y:20},endpointB:{x:50,y:20}});assert.equal(placed.widthM,null);assert.equal(placed.quantity,null);
 assert.throws(()=>s().approvePlanOpening(marker.id));s().updatePlanOpening(marker.id,{kind:'door',mechanism:'hinged'});s().approvePlanOpening(marker.id);assert.equal(s().project!.openings![1].approval.status,'approved');
 s().updatePlanOpening(marker.id,{heightM:2});assert.equal(s().project!.openings![1].approval.status,'draft');assert.deepEqual(s().project!.openings![1].aiDetection,marker.aiDetection);
 const id=s().duplicatePlanOpening(marker.id);assert.equal(s().project!.openings!.find(o=>o.id===id)!.aiDetection,undefined);s().undo();assert.equal(s().project!.openings!.length,2);s().redo();assert.equal(s().project!.openings!.length,3);
});
test('only approved quantity-eligible AI openings deduct; real edits invalidate eligibility',()=>{
 const base=structuredClone(PLAN_A);base.rooms[0].openings=[];s().setProject(base);s().importAiOpeningReview(review);
 const id=s().project!.openings![0].id,room=base.rooms[0],item=room.workItems.find(w=>w.type==='painting')!;
 const audit=()=>canonicalOpeningDeduction(s().project!,room,item,3,s().project!.openings!.find(o=>o.id===id)!);
 assert.equal(audit().areaM2,0);
 s().updatePlanOpening(id,{roomIds:[room.id],quantityReview:{associationsConfirmed:true,distinctLegacyRoomIds:[]}});s().approvePlanOpening(id);assert.equal(audit().areaM2,0);
 s().updatePlanOpening(id,{widthM:1,heightM:2,sillHeightM:0,quantity:1});assert.equal(audit().areaM2,0);s().approvePlanOpening(id);assert.equal(audit().areaM2,2);
 s().updatePlanOpening(id,{geometry:{endpointA:{x:10,y:20},endpointB:{x:50,y:20}}});assert.equal(audit().areaM2,0);assert.equal(s().project!.openings![0].quantityReview!.associationsConfirmed,false);
});
test('modal translations retain paid-call consent and exact Hebrew action without stale cost placeholders',()=>{
 assert.equal(translate('he','openingAi.title'),'זיהוי דלתות וחלונות באמצעות AI');
 for(const language of ['he','en'] as const){const copy=translate(language,'openingAi.consent');assert.ok(copy.includes('OpenAI'));assert.ok(copy.includes(language==='he'?'בתשלום':'paid'));assert.ok(!/\{(?:estimate|reservation)\}/.test(copy));}
});
