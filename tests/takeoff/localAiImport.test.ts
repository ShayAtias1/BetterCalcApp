import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalAiResult, polygonProblems } from '../../src/lib/localAiImport.ts';
import { reshapeArea } from '../../src/lib/areaGeometryEditing.ts';
import { roomMetrics } from '../../src/lib/quantities.ts';
import { aiWarnings, aiProfileKey, aiCandidateLabel } from '../../src/lib/localAiReview.ts';
import { translate } from '../../src/i18n/index.ts';
import { PLAN_A } from './fixtures.ts';

const target={planId:PLAN_A.id,sourceHash:'verified-hash',importId:'result-hash',pageNumber:1,width:100,height:100,rotation:0,userUnit:1,view:[0,0,100,100]};
const manifest={source:{sourceSha256:target.sourceHash,page:1,fullPage:true,renderEngine:'pypdfium2',pdfDimensionsPoints:[100,100],imageDimensions:[200,200],renderDpi:144},pageDimensions:[200,200],tiles:['A','B','C','D'].map((letter,i)=>({tileId:`TILE_${letter}`,pageX:i%2*90,pageY:Math.floor(i/2)*90,pageWidth:110,pageHeight:110,tileWidth:110,tileHeight:110}))};
const space={spaceId:'space-001',geometryTile:'TILE_D',geometryClass:'OPEN_CONNECTED',polygon:[[0.1,0.1],[0.5,0.1],[0.5,0.5],[0.1,0.5]],vertexCount:4,type:'bath',requiresReview:true,ambiguities:['Doorway boundary needs review.'],reason:null};
const parsed=()=>parseLocalAiResult({spaces:[space]},manifest,target);

test('maps offset tile-local geometry through the recorded DPI without viewport transforms',()=>{
  const [candidate]=parsed();
  assert.deepEqual(candidate.points,[{x:50.5,y:50.5},{x:72.5,y:50.5},{x:72.5,y:72.5},{x:50.5,y:72.5}]);
  assert.deepEqual(candidate.validationProblems,[]);
  assert.deepEqual(parseLocalAiResult({spaces:[space]},manifest,{...target,rotation:270})[0].points,candidate.points);
  assert.equal(candidate.roomTypeKey,null);
  assert.equal(candidate.localAi.geometryClass,'OPEN_CONNECTED');
  assert.equal(parsed()[0].id,candidate.id);
});

test('rejects source/page/orientation mismatches and unsupported remapped files',()=>{
  for (const patch of [{sourceHash:'wrong'},{pageNumber:2},{width:101},{rotation:45},{userUnit:2},{view:[5,0,105,100]}]) assert.throws(()=>parseLocalAiResult({spaces:[space]},manifest,{...target,...patch}));
  assert.throws(()=>parseLocalAiResult({spaces:[space],transform:'pageNormalized'},manifest,target));
  assert.throws(()=>parseLocalAiResult({spaces:[space,space]},manifest,target));
});

test('blocks invalid topology, bounds, degeneracy and inconsistent vertex counts',()=>{
  const polygons=[[{x:0,y:0},{x:20,y:20},{x:0,y:20},{x:20,y:0}], [{x:0,y:0},{x:20,y:0},{x:10,y:0}], [{x:0,y:0},{x:110,y:0},{x:0,y:20}], [{x:0,y:0},{x:NaN,y:0},{x:0,y:20}], [{x:0,y:0},{x:20,y:0},{x:10,y:0},{x:10,y:20},{x:0,y:20}]];
  for (const polygon of polygons) assert.ok(polygonProblems(polygon,100,100).length);
  const [candidate]=parseLocalAiResult({spaces:[{...space,vertexCount:5}]},manifest,target);
  assert.ok(candidate.validationProblems.length);
});

Object.assign(globalThis,{DOMMatrix:class {},DOMPoint:class {},DOMRect:class {},Path2D:class {}});
const {useAppStore}=await import('../../src/store/appStore.ts');
after(()=>useAppStore.getState().setProject(null));
const store=()=>useAppStore.getState();
function open() {
  store().setProject(structuredClone(PLAN_A));
  useAppStore.setState({detectionCandidates:parsed(),detectionCandidatesPage:1});
}

test('approval creates an unclassified editable room, preserves manual rooms and uses existing metrics/history',()=>{
  open();
  const candidate=store().detectionCandidates[0];
  candidate.roomTypeKey = 'bath'; // Even a supplied AI semantic guess must not seed finishes.
  const original=structuredClone(store().project!.rooms);
  assert.equal(store().acceptDetectionCandidate(candidate.id),candidate.id);
  const room=store().project!.rooms.at(-1)!;
  assert.deepEqual(store().project!.rooms.slice(0,-1),original);
  assert.deepEqual(room.workItems,[]);
  assert.equal(room.roomType,undefined);
  assert.equal(room.detectedType,undefined);
  assert.equal(room.closed,true);
  assert.deepEqual(roomMetrics(room,{pixelDistance:1,realDistanceMeters:0.1,metersPerPixel:0.1}),{areaM2:4.840000000000001,perimeterM:8.8});
  assert.equal(store().history.length,1);
  store().undo(); assert.deepEqual(store().project!.rooms,original);
  store().redo(); assert.equal(store().project!.rooms.at(-1)!.id,room.id);
  store().editAreaGeometry('room',room.id,[{x:10,y:10},{x:30,y:10},{x:30,y:30},{x:10,y:30}]);
  assert.equal(store().project!.rooms.at(-1)!.points[0].x,10);
});

test('bulk acceptance keeps invalid proposals; wrong-plan/page and duplicate imports cannot commit',()=>{
  open();
  const valid=parsed()[0], invalid={...valid,id:'invalid',validationProblems:['bad geometry']};
  useAppStore.setState({detectionCandidates:[valid,invalid]});
  assert.equal(store().acceptAllDetectionCandidates(),1);
  assert.deepEqual(store().detectionCandidates,[invalid]);
  assert.equal(store().acceptDetectionCandidate(invalid.id),null);
  useAppStore.setState({detectionCandidates:[valid]});
  assert.equal(store().acceptAllDetectionCandidates(),0);
  open();
  useAppStore.setState({detectionCandidates:[{...valid,localAi:{...valid.localAi,planId:'other'}}]});
  assert.equal(store().acceptAllDetectionCandidates(),0);
  useAppStore.setState({currentPage:2,detectionCandidates:[valid]});
  assert.equal(store().acceptAllDetectionCandidates(),0);
});

test('reject and clear only change proposals',()=>{
  open();
  const before=store().project;
  store().rejectDetectionCandidate(store().detectionCandidates[0].id);
  assert.equal(store().project,before);
  assert.equal(store().history.length,0);
  useAppStore.setState({detectionCandidates:parsed()});
  store().clearDetectionCandidates();
  assert.equal(store().project,before);
  assert.equal(store().detectionCandidates.length,0);
});

test('draft vertex edits preserve originals, source identity, manual rooms, history and quantities',()=>{
  open();
  const candidate=store().detectionCandidates[0], before=store().project, original=structuredClone(candidate.points);
  store().selectDetectionCandidate(candidate.id);
  const moved=candidate.points.map((p,i)=>i===0 ? {x:48,y:49} : {...p});
  store().editDetectionCandidate(candidate.id,moved);
  const edited=store().detectionCandidates[0];
  assert.deepEqual(edited.originalPoints,original);
  assert.deepEqual(edited.points,moved);
  assert.equal(edited.id,candidate.id);
  assert.equal(edited.pageNumber,1);
  assert.equal(store().project,before);
  assert.equal(store().history.length,0);
  assert.equal(store().dirty,false);
  store().restoreDetectionCandidate(candidate.id);
  assert.deepEqual(store().detectionCandidates[0].points,original);
  assert.equal(store().selectedDetectionCandidateId,candidate.id);
});

test('temporarily invalid edits block approval, then correction imports latest geometry',()=>{
  open();
  const candidate=store().detectionCandidates[0];
  store().editDetectionCandidate(candidate.id,[{x:0,y:0},{x:20,y:20},{x:0,y:20},{x:20,y:0}]);
  assert.ok(store().detectionCandidates[0].validationProblems!.length);
  assert.equal(store().acceptDetectionCandidate(candidate.id),null);
  assert.equal(store().acceptAllDetectionCandidates(),0);
  const recess=[{x:10,y:10},{x:30,y:10},{x:30,y:20},{x:20,y:20},{x:20,y:30},{x:10,y:30}];
  store().editDetectionCandidate(candidate.id,recess);
  assert.deepEqual(store().detectionCandidates[0].validationProblems,[]);
  assert.equal(store().acceptDetectionCandidate(candidate.id),candidate.id);
  assert.deepEqual(store().project!.rooms.at(-1)!.points,recess);
  assert.equal(store().selectedDetectionCandidateId,null);
});

test('bulk approval uses edited drafts and resets selection; wrong-source edits are ignored',()=>{
  open();
  const candidate=store().detectionCandidates[0], second={...parsed()[0],id:'second-draft'};
  useAppStore.setState({detectionCandidates:[candidate,second]});
  const next=[{x:1,y:1},{x:5,y:1},{x:1,y:5}];
  store().editDetectionCandidate(candidate.id,next);
  store().selectDetectionCandidate(candidate.id);
  assert.equal(store().acceptAllDetectionCandidates(),2);
  assert.deepEqual(store().project!.rooms.at(-2)!.points,next);
  assert.equal(store().selectedDetectionCandidateId,null);
  open();
  useAppStore.setState({currentPage:2});
  store().editDetectionCandidate(candidate.id,next);
  assert.deepEqual(store().detectionCandidates[0].points,candidate.points);
  store().selectDetectionCandidate(candidate.id);
  assert.equal(store().selectedDetectionCandidateId,null);
});


test('shared reshape helper moves draft corners independently without changing normal rectangle editing',()=>{
  const rect=[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}];
  const draft=reshapeArea(rect,0,{x:5,y:5},{polygon:true,allowInvalid:true})!;
  assert.deepEqual(draft,[{x:5,y:5},...rect.slice(1)]);
  assert.notDeepEqual(reshapeArea(rect,0,{x:5,y:5}),draft);
  const collapsed=reshapeArea(rect,0,rect[2],{polygon:true,allowInvalid:true})!;
  assert.ok(polygonProblems(collapsed,100,100).length);
});


test('AI warnings retain exact evidence, can be reviewed individually or per page, and never bypass invalid geometry', () => {
  open();
  const candidate = store().detectionCandidates[0];
  const metadata = structuredClone(candidate.localAi!);
  const warnings = aiWarnings(metadata);
  assert.ok(warnings.some(w => w.id === 'geometryClass'));
  assert.equal(warnings.find(w => w.id === 'ambiguity:0')!.text, space.ambiguities[0]);
  assert.ok(!warnings.some(w => w.id === 'reason')); // No fabricated cross-tile reason.
  const otherPage = {...candidate, id:'other-page', pageNumber:2};
  useAppStore.setState({detectionCandidates:[candidate, otherPage]});
  store().setDetectionWarningReviewed(candidate.id, 'ambiguity:0', true);
  assert.deepEqual(store().detectionCandidates[0].reviewedWarningIds, ['ambiguity:0']);
  assert.deepEqual(store().detectionCandidates[0].localAi, metadata);
  store().editDetectionCandidate(candidate.id, [{x:0,y:0},{x:20,y:20},{x:0,y:20},{x:20,y:0}]);
  store().setAllDetectionWarningsReviewed(true);
  assert.equal(store().detectionCandidates[0].reviewedWarningIds!.length, warnings.length);
  assert.equal(store().detectionCandidates[1].reviewedWarningIds, undefined);
  assert.equal(store().acceptDetectionCandidate(candidate.id), null);
  assert.ok(store().detectionCandidates[0].validationProblems!.length);
  store().setAllDetectionWarningsReviewed(false);
  assert.deepEqual(store().detectionCandidates[0].reviewedWarningIds, []);
  store().setDetectionWarningReviewed(candidate.id, 'ambiguity:0', true);
  store().setDetectionWarningReviewed(candidate.id, 'ambiguity:0', false);
  assert.deepEqual(store().detectionCandidates[0].reviewedWarningIds, []);
  assert.deepEqual(store().detectionCandidates[0].localAi, metadata);
  assert.deepEqual(store().detectionCandidates[0].points, [{x:0,y:0},{x:20,y:20},{x:0,y:20},{x:20,y:0}]);
});

test('semantic labels reuse exact profiles; confirmation is separate and never creates finish items', context => {
  context.after(() => store().setProject(null));
  assert.equal(aiProfileKey('Bedroom'), 'bedroom');
  assert.equal(aiProfileKey('Utility room'), 'service');
  assert.equal(aiProfileKey('Living kitchen and circulation'), null);
  assert.equal(aiProfileKey('Protected bedroom'), null);
  assert.equal(aiCandidateLabel({...parsed()[0], localAi:{...parsed()[0].localAi,suggestedType:'Bedroom'}}, (key, ...args) => translate('he', key, ...args)), 'חדר שינה');
  open();
  const candidate = store().detectionCandidates[0];
  store().setDetectionCandidateType(candidate.id, 'unsupported');
  assert.equal(store().detectionCandidates[0].semanticTypeEdited, undefined);
  store().setDetectionCandidateType(candidate.id, 'bedroom');
  assert.equal(store().detectionCandidates[0].semanticTypeConfirmed, false);
  store().confirmDetectionCandidateType(candidate.id);
  assert.equal(store().detectionCandidates[0].semanticTypeConfirmed, true);
  store().setDetectionCandidateType(candidate.id, 'balcony');
  assert.equal(store().detectionCandidates[0].semanticTypeConfirmed, false);
  store().confirmDetectionCandidateType(candidate.id);
  store().setAllDetectionWarningsReviewed(true);
  store().acceptDetectionCandidate(candidate.id);
  const room = store().project!.rooms.at(-1)!;
  assert.equal(room.roomType, 'balcony');
  assert.equal(room.detectedType, undefined);
  assert.deepEqual(room.workItems, []);
  assert.equal(room.aiSource!.spaceId, space.spaceId);
  assert.equal(room.aiSource!.suggestedType, 'bath');
  assert.deepEqual(room.aiSource!.reviewNotes, candidate.localAi!.reviewNotes);
  assert.ok(room.aiSource!.reviewedWarningIds.length);
});

test('One-Click target containment remains an approval gate after edits and normal Room approval preserves point provenance',context=>{
  context.after(()=>store().setProject(null));
  open();const candidate=store().detectionCandidates[0];
  candidate.localAi.targetPoint={x:60,y:60};candidate.localAi.detectionMode='one-click-v1';
  const original=candidate.points.map(p=>({...p}));
  store().editDetectionCandidate(candidate.id,[{x:10,y:10},{x:20,y:10},{x:20,y:20},{x:10,y:20}]);
  assert.ok(store().detectionCandidates[0].validationProblems?.some(p=>p.includes('target point')));
  assert.equal(store().acceptDetectionCandidate(candidate.id),null);
  store().editDetectionCandidate(candidate.id,original);
  assert.equal(store().acceptDetectionCandidate(candidate.id),candidate.id);
  const room=store().project!.rooms.at(-1)!;assert.deepEqual(room.aiSource?.targetPoint,{x:60,y:60});
  assert.equal(room.aiSource?.detectionMode,'one-click-v1');assert.deepEqual(room.workItems,[]);
});
