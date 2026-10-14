import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
const saved = new Map();
await mock.module('idb', {namedExports:{openDB:async()=>({
  put:async(store,value)=>saved.set(store+':'+value.id,structuredClone(value)),
  get:async(store,id)=>structuredClone(saved.get(store+':'+id)),
})}});
const { parseRevisionPageResult, buildAiChanges, tileToNative } = await import('../../src/lib/revision/aiPageAnalysis.ts');
const { openingWallFootprints } = await import('../../src/lib/revision/openingGeometry.ts');
const { setOpeningFootprint, retypeChange, openingGeometryNeedsVerification } = await import('../../src/lib/revision/changeEdit.ts');
const { reshapeArea } = await import('../../src/lib/areaGeometryEditing.ts');
const { polygonAreaPx } = await import('../../src/lib/geometry.ts');
const { createEmptyComparison, useCompareStore } = await import('../../src/store/compareStore.ts');
const { loadComparison } = await import('../../src/db/database.ts');
const { parseRevisionPageModelResponse } = await import('../../server/revision-pipeline.mjs');

const manifest={pageNumber:1,renderScale:2,tiles:[{tileId:'TILE_B',pageX:200,pageY:100,pageWidth:400,pageHeight:200}]};
const rectangle=(end,kind='window')=>({corners:[{x:.1,y:.2},{x:end,y:.2},{x:end,y:.3},{x:.1,y:.3}],kind,heightM:null,sillHeightM:null});
const raw=(overrides={})=>({changeId:'fixture',changeType:'opening-modified',geometryTile:'TILE_B',
  before:{a:{x:.1,y:.25},b:{x:.6,y:.25}},after:{a:{x:.1,y:.25},b:{x:.4,y:.25}},
  beforeOpening:rectangle(.6),afterOpening:rectangle(.4),bbox:{x1:.1,y1:.2,x2:.6,y2:.3},
  confidence:.9,requiresReview:false,summary:'חלון הוצר',evidence:['jambs'],...overrides});
const drawings={W:1000,H:800,mpp:.01,tol:1,vector:false,baseV:{segments:[],arcs:[]},revV:{segments:[],arcs:[]}};
const build=(r=raw())=>buildAiChanges(parseRevisionPageResult({changes:[r]}).changes,manifest,drawings)[0];

test('provider schema accepts explicit before/after opening rectangles with unknown dimensions',()=>{
  const result={changes:[raw()],coverageNotes:[]};
  const answer={status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]};
  assert.deepEqual(parseRevisionPageModelResponse(answer),result);
});
test('both window rectangles map through the aligned tile frame without guessed dimensions',()=>{
  const c=build();
  assert.equal(c.doors.length,2);
  assert.deepEqual(c.doors[0].footprint,raw().beforeOpening.corners.map(p=>tileToNative(p,'TILE_B',manifest)));
  assert.equal(c.doors[0].wallThicknessPx,10);
  assert.equal(c.doors[0].heightM,undefined);
  assert.equal(c.doors[0].sillHeightM,undefined);
  assert.equal(c.doors[0].geometryVerified,false);
  assert.equal(c.aiProposal.requiresReview,true);
  assert.equal(openingGeometryNeedsVerification(c),true);
  const portions=openingWallFootprints(c);
  assert.equal(portions.length,1);
  assert.equal(portions[0].areaKind,'construction');
  assert.equal(polygonAreaPx(portions[0].points),400);
});
test('relocated observed openings draw both infill and removal before dimension confirmation',()=>{
  const after=rectangle(.4);
  after.corners=after.corners.map(p=>({x:p.x+.5,y:p.y}));
  const c=build(raw({afterOpening:after}));
  const portions=openingWallFootprints(c);
  assert.deepEqual(new Set(portions.map(p=>p.areaKind)),new Set(['construction','demolition']));
});
test('missing or invalid rectangles are flagged and are never replaced with fabricated lines',()=>{
  const missing=build(raw({beforeOpening:null}));
  assert.equal(missing.doors.length,1);
  assert.equal(missing.aiProposal.requiresReview,true);
  assert.deepEqual(openingWallFootprints(missing),[]);
  assert.equal(retypeChange(missing,'opening-modified',.01).doors.length,1);
  const invalid=rectangle(.6);
  invalid.corners[2]={x:.3,y:.6};
  const c=build(raw({beforeOpening:invalid,afterOpening:null}));
  assert.equal(c.doors.length,0);
  assert.equal(retypeChange(c,'opening-modified',.01).doors.length,0);
});
test('opening rectangles retain all four corners through editing, persistence and reload',async()=>{
  const c=build();
  const points=reshapeArea(c.doors[1].footprint,1,{x:200,y:70});
  const edited=setOpeningFootprint(c,1,points);
  assert.deepEqual(edited.doors[1].footprint,points);
  assert.equal(edited.doors[1].geometryVerified,true);
  assert.equal(edited.doors[1].impactVerified,false);
  const comparison=createEmptyComparison('fixture','','before.pdf',['after.pdf']);
  comparison.revisions[0].analysis={pages:{1:{pageNumber:1,manualOnly:true,changes:[edited]}}};
  const store=useCompareStore.getState();
  store.setComparison(comparison);
  await store.persist();
  const reloaded=await loadComparison(comparison.id);
  assert.deepEqual(reloaded.revisions[0].analysis.pages[1].changes[0].doors,edited.doors);
});

test('manual fallback creates persisted opening rectangles without individual lines or default dimensions',async()=>{
  const comparison=createEmptyComparison('manual opening','','before.pdf',['after.pdf']);
  const store=useCompareStore.getState();
  store.setComparison(comparison);
  const before=[{x:10,y:10},{x:110,y:10},{x:110,y:30},{x:10,y:30}];
  const after=[{x:10,y:10},{x:70,y:10},{x:70,y:30},{x:10,y:30}];
  assert.equal(store.addManualRevisionChange(1,'opening-modified',before[0]),null);
  const id=store.addManualRevisionChange(1,'opening-modified',before[0],[before,after]);
  assert.ok(id);
  const c=useCompareStore.getState().comparison.revisions[0].analysis.pages[1].changes.find(c=>c.id===id);
  assert.deepEqual(c.doors.map(d=>d.footprint),[before,after]);
  assert.deepEqual(c.doors.map(d=>d.side),['removed','added']);
  assert.equal(c.doors[0].heightM,undefined);
  assert.equal(c.doors[0].wallThicknessPx,20);
  await store.persist();
  const restored=await loadComparison(comparison.id);
  assert.deepEqual(restored.revisions[0].analysis.pages[1].changes.find(c=>c.id===id).doors,c.doors);
  store.undo();
  assert.equal(useCompareStore.getState().comparison.revisions[0].analysis,undefined);
});

const { rectanglePoints, isValidAreaPolygon, translateArea, closesPolygon } = await import('../../src/lib/areaGeometryEditing.ts');
const { openingFromFootprint, openingFootprint, setOpeningThickness } = await import('../../src/lib/revision/changeEdit.ts');

test('opposite corners complete a rectangle in either drawing direction',()=>{
  for (const [a,b] of [[{x:10,y:10},{x:100,y:30}],[{x:100,y:30},{x:10,y:10}]]) {
    const points=rectanglePoints(a,b);
    const d=openingFromFootprint('added',points,'door','rectangle');
    assert.ok(d);
    assert.equal(d.footprintShape,'rectangle');
    assert.deepEqual(d.footprint,points);
  }
  assert.equal(openingFromFootprint('added',rectanglePoints({x:0,y:0},{x:10,y:0}),'door','rectangle'),null);
});

test('triangles and concave polygons complete, remain editable and retain every vertex',()=>{
  const polygons=[
    [{x:0,y:0},{x:100,y:0},{x:50,y:20}],
    [{x:0,y:0},{x:100,y:0},{x:100,y:20},{x:60,y:20},{x:60,y:10},{x:40,y:10},{x:40,y:20},{x:0,y:20}],
  ];
  for(const points of polygons) {
    assert.equal(isValidAreaPolygon(points),true);
    assert.equal(closesPolygon(points,points[0],1),true);
    const d=openingFromFootprint('removed',points,'door','polygon');
    assert.ok(d);
    assert.deepEqual(openingFootprint(d),points);
    const c={id:'polygon',doors:[d]};
    const moved=translateArea(points,{x:25,y:40});
    const edited=setOpeningFootprint(c,0,moved);
    assert.deepEqual(edited.doors[0].footprint,moved);
    const resized=setOpeningThickness(edited,0,edited.doors[0].wallThicknessPx*1.5);
    assert.equal(resized.doors[0].footprint.length,points.length);
    assert.equal(isValidAreaPolygon(resized.doors[0].footprint),true);
  }
  assert.equal(isValidAreaPolygon([{x:0,y:0},{x:100,y:0},{x:0,y:80},{x:100,y:80},{x:20,y:30}]),false);
});

test('mixed BEFORE/AFTER drawing modes persist and support undo and redo',async()=>{
  const comparison=createEmptyComparison('mixed shapes','','before.pdf',['after.pdf']);
  const store=useCompareStore.getState();
  store.setComparison(comparison);
  const before=rectanglePoints({x:10,y:10},{x:110,y:30});
  const after=[{x:10,y:10},{x:70,y:10},{x:70,y:30},{x:40,y:25},{x:10,y:30}];
  const id=store.addManualRevisionChange(1,'opening-modified',before[0],[before,after],['rectangle','polygon']);
  assert.ok(id);
  const current=useCompareStore.getState().comparison;
  const doors=current.revisions[0].analysis.pages[1].changes[0].doors;
  assert.deepEqual(doors.map(d=>d.footprintShape),['rectangle','polygon']);
  assert.deepEqual(doors.map(d=>d.footprint),[before,after]);
  await store.persist();
  assert.deepEqual((await loadComparison(comparison.id)).revisions[0].analysis.pages[1].changes[0].doors,doors);
  store.undo();
  assert.equal(useCompareStore.getState().comparison.revisions[0].analysis,undefined);
  store.redo();
  assert.deepEqual(useCompareStore.getState().comparison.revisions,current.revisions);
});
