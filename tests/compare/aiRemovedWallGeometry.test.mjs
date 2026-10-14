import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const saved = new Map();
await mock.module('idb', { namedExports: { openDB: async () => ({
  put: async (store, value) => saved.set(`${store}:${value.id}`, structuredClone(value)),
  get: async (store, id) => structuredClone(saved.get(`${store}:${id}`)),
}) } });
registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if ((specifier.startsWith('.') || specifier.startsWith('/')) && !specifier.endsWith('.tsx')) return nextResolve(`${specifier}.tsx`, context);
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx')) return nextLoad(url, context);
    return { format:'module', shortCircuit:true, source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{
      compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
    }).outputText };
  },
});
const { buildAiChanges } = await import('../../src/lib/revision/aiPageAnalysis.ts');
const { normalizeRevisionWallGeometry, withComparisonWallGeometry } = await import('../../src/lib/revision/wallGeometry.ts');
const { wallFromLine, wallFromFootprint, setWallFootprint, wallGeometryNeedsVerification, hasUnplacedLines } = await import('../../src/lib/revision/changeEdit.ts');
const { createEmptyComparison, useCompareStore } = await import('../../src/store/compareStore.ts');
const { loadComparison } = await import('../../src/db/database.ts');
const { changeItems } = await import('../../src/lib/revision/changeItems.ts');
const { useRevisionUi } = await import('../../src/lib/revision/revisionWorkflow.ts');
const { analysisInputKey } = await import('../../src/lib/revision/detect.ts');
const { reshapeArea, translateArea } = await import('../../src/lib/areaGeometryEditing.ts');
const { polygonAreaPx } = await import('../../src/lib/geometry.ts');
const { default: Overlay } = await import('../../src/components/compare/RevisionChangeOverlay.tsx');

const W=600,H=250,mpp=.01,tol=1;
const manifest={pageNumber:1,renderScale:2,tiles:[{tileId:'TILE_A',pageX:100,pageY:40,pageWidth:800,pageHeight:400}]};
const page = segments => ({width:W,height:H,segments:new Float32Array(segments),curve:new Uint8Array(segments.length/4),arcs:[],texts:[]});
const geometry = [150,80,450,80,150,90,450,90];
const normalize = p => ({x:(p.x*2-100)/800,y:(p.y*2-40)/400});
function build(type='wall-removed', vector=true, own=geometry) {
  const line={a:normalize({x:150,y:85}),b:normalize({x:450,y:85})};
  return buildAiChanges([{changeId:'raw',changeType:type,geometryTile:'TILE_A',
    before:type==='wall-removed'?line:null,after:type==='wall-added'?line:null,
    bbox:{x1:.25,y1:.3,x2:1,y2:.35},confidence:.9,requiresReview:false,summary:'wall',evidence:[]}],manifest,
    {W,H,mpp,tol,vector,baseV:page(type==='wall-removed'?own:[]),revV:page(type==='wall-added'?own:[])})[0];
}
function fixture(change) {
  const c=createEmptyComparison('Removed wall','','original.pdf',['revised.pdf']);
  c.context='construction'; c.wallHeightDefaultM=2.5;
  c.areaKindColors={demolition:'#a11234',construction:'#126789'};
  c.pages[1]={originalPageNumber:1,originalCalibration:{pixelDistance:100,realDistanceMeters:1,metersPerPixel:mpp,space:'original'},revisions:{}};
  c.revisions[0].analysis={pages:{1:{pageNumber:1,inputKey:analysisInputKey(c,c.activeRevisionId,1),changes:[change]}}};
  useCompareStore.getState().setComparison(c);
  useRevisionUi.getState().selectChange(null);
  return c;
}
function render() {
  Object.assign(useCompareStore.getInitialState(),useCompareStore.getState());
  Object.assign(useRevisionUi.getInitialState(),useRevisionUi.getState());
  return renderToStaticMarkup(createElement(Overlay,{strokeW:1,zoom:1,interactive:true,editable:true,
    screenToNative:(x,y)=>({x,y}),noteBounds:{left:0,top:0,right:W,bottom:H}}));
}
const polygonString = points => points.map(p=>`${p.x},${p.y}`).join(' ');

test('relocation annotations show one compact label, two work-colored leaders and a distinct movement arrow', () => {
  const change = build();
  const original = change.walls[0];
  const revised = wallFromFootprint('added', translateArea(original.footprint,{x:0,y:60}));
  const relocated = {...change,kind:'modified',userType:'wall-relocated',walls:[original,revised],
    aiProposal:{...change.aiProposal,changeType:'wall-relocated'}};
  fixture(relocated);
  const markup = render();
  assert.match(markup,new RegExp(`points="${polygonString(original.footprint)}" fill="#a11234"`));
  assert.match(markup,new RegExp(`points="${polygonString(revised.footprint)}" fill="#126789"`));
  assert.equal((markup.match(/class="revision-relocation-arrow"/g)??[]).length,1);
  assert.equal((markup.match(/class="revision-change-balloon"/g)??[]).length,1);
  assert.equal((markup.match(/class="revision-annotation-leader demolition"/g)??[]).length,1);
  assert.equal((markup.match(/class="revision-annotation-leader construction"/g)??[]).length,1);
  assert.match(markup,/aria-expanded="false"/);
  assert.match(markup,/>#1<\/text>/);
  assert.match(markup,/stroke-dasharray="4 3"/);
  fixture({...relocated,walls:[original,{...revised,placeholder:true}]});
  assert.doesNotMatch(render(),/class="revision-relocation-arrow"/);
});

for (const type of ['wall-removed','wall-added']) test(`${type} maps verified thickness to native polygons, matching overlay styling and quantity geometry`, () => {
  const change=build(type);
  assert.equal(change.aiProposal.verification,'verified');
  assert.equal(change.walls.length,1);
  assert.equal(change.walls[0].thicknessPx,10);
  assert.equal(change.walls[0].lengthPx,300);
  assert.equal(polygonAreaPx(change.walls[0].footprint),3000);
  assert.equal(wallGeometryNeedsVerification(change),false);
  const items=changeItems(change,'construction',mpp,2.5);
  assert.equal(items.length,1);
  assert.equal(items[0].areaKind,type==='wall-removed'?'demolition':'construction');
  assert.deepEqual(items[0].points,change.walls[0].footprint);
  assert.equal(items[0].areaM2,7.5);
  fixture(change);
  const html=render(), color=useCompareStore.getState().comparison.areaKindColors[type==='wall-removed'?'demolition':'construction'];
  assert.ok(html.includes(`<polygon points="${polygonString(change.walls[0].footprint)}" fill="${color}"`));
  assert.ok(!html.includes('<line x1="150" y1="85" x2="450" y2="85"'));
  assert.equal((html.match(/class="revision-change-balloon"/g)??[]).length,1);
  assert.equal((html.match(/class="revision-annotation-leader /g)??[]).length,1);
  useRevisionUi.getState().selectChange(change.id);
  assert.ok(render().includes('area-geometry-handles'));
});

test('saved removed-wall centerline and verified thickness repair the polygon and linked quantities idempotently', async () => {
  const change=build();
  const wall=change.walls[0];
  change.walls=[{...wall,footprint:[]}]; change.status='approved'; change.measurementIds=['legacy'];
  const c=fixture(change);
  c.revisions[0].measurements=[{id:'legacy',pageNumber:1,tool:'area',calcMode:'wall',areaKind:'demolition',
    points:wall.centerline,centerline:wall.centerline,areaM2:7.5,wallLengthM:3,wallHeightM:2.5,
    revisionChangeId:change.id,revisionElement:{list:'walls',index:0}}];
  const store=useCompareStore.getState(); store.setComparison(c);
  const current=useCompareStore.getState().comparison;
  const repaired=current.revisions[0].analysis.pages[1].changes[0];
  assert.equal(repaired.status,'approved'); assert.equal(repaired.aiProposal,change.aiProposal);
  assert.equal(polygonAreaPx(repaired.walls[0].footprint),3000);
  assert.equal(current.revisions[0].measurements.length,1);
  assert.equal(current.revisions[0].measurements[0].id,'legacy');
  assert.deepEqual(current.revisions[0].measurements[0].points,repaired.walls[0].footprint);
  assert.equal(current.revisions[0].measurements[0].areaM2,7.5);
  assert.equal(withComparisonWallGeometry(current),current);
  await store.persist();
  const loaded=await loadComparison(c.id); store.setComparison(loaded);
  assert.equal(useCompareStore.getState().comparison,loaded);
});

test('verified saved footprint or linked demolition polygon restores missing geometry without bbox guessing', () => {
  const change=build(), expected=change.walls[0];
  const {thicknessPx,...withoutThickness}=expected;
  const repaired=normalizeRevisionWallGeometry({...change,walls:[withoutThickness]});
  assert.equal(repaired.walls[0].thicknessPx,thicknessPx);
  const item={id:'saved',pageNumber:1,tool:'area',calcMode:'wall',areaKind:'demolition',points:expected.footprint,
    centerline:expected.centerline,wallHeightM:2.5,revisionChangeId:change.id,revisionElement:{list:'walls',index:0}};
  const restored=normalizeRevisionWallGeometry({...change,walls:[]},[item]);
  assert.equal(restored.walls.length,1);
  assert.equal(polygonAreaPx(restored.walls[0].footprint),3000);
  assert.equal(restored.walls[0].thicknessPx,10);
  assert.equal(normalizeRevisionWallGeometry(restored,[item]),restored);
  assert.equal(normalizeRevisionWallGeometry({...change,edited:true,walls:[]},[item]).walls.length,0);
});

test('legacy display strip uses recorded verified thickness, while user-edited footprints remain exact', () => {
  const change=build(), verified=change.walls[0];
  const strip=wallFromLine('removed',verified.centerline[0],verified.centerline[1],0).footprint;
  const legacy={...change,walls:[{...verified,footprint:strip}]};
  const restored=normalizeRevisionWallGeometry(legacy);
  assert.equal(polygonAreaPx(restored.walls[0].footprint),3000);
  assert.equal(restored.walls[0].thicknessPx,10);
  const edited={...legacy,edited:true};
  assert.equal(normalizeRevisionWallGeometry(edited),edited);
  assert.deepEqual(edited.walls[0].footprint,strip);
});

test('unknown thickness, raster-only geometry and single-face evidence require verification and create no quantities', () => {
  const unknown=build(); unknown.walls=[wallFromLine('removed',{x:150,y:85},{x:450,y:85},0)];
  const missing=build(); missing.walls=[{side:'removed',thicknessPx:0,lengthPx:300}];
  for(const change of [unknown,missing,build('wall-removed',false),build('wall-removed',true,[150,80,450,80])]) {
    assert.equal(wallGeometryNeedsVerification(change),true);
    assert.equal(hasUnplacedLines(change),true);
    assert.deepEqual(changeItems(change,'construction',mpp,2.5),[]);
    fixture(change);
    const store=useCompareStore.getState(), before=store.captureEditSnapshot();
    store.reviewRevisionChange(1,change.id,'approved');
    assert.equal(useCompareStore.getState().comparison,before.comparison);
    assert.equal(useCompareStore.getState().history,before.history);
    assert.ok(!render().includes('NaN'));
    if(change===unknown) assert.ok(!render().includes(`<polygon points="${polygonString(change.walls[0].footprint)}"`));
  }
});

test('legacy approved unknown-thickness wall items are withdrawn without changing approval or unrelated measurements', () => {
  const change=build(); change.walls=[wallFromLine('removed',{x:150,y:85},{x:450,y:85},0)];
  change.status='approved'; change.measurementIds=['thin'];
  const c=fixture(change);
  const unrelated={id:'manual',pageNumber:1,tool:'area',calcMode:'wall',areaKind:'demolition',points:[],areaM2:4};
  c.revisions[0].measurements=[unrelated,{id:'thin',pageNumber:1,tool:'area',calcMode:'wall',areaKind:'demolition',
    points:change.walls[0].footprint,centerline:change.walls[0].centerline,areaM2:7.5,revisionChangeId:change.id}];
  useCompareStore.getState().setComparison(c);
  const current=useCompareStore.getState().comparison;
  assert.deepEqual(current.revisions[0].measurements,[unrelated]);
  assert.equal(current.revisions[0].analysis.pages[1].changes[0].status,'approved');
  assert.equal(wallGeometryNeedsVerification(current.revisions[0].analysis.pages[1].changes[0]),true);
});

test('user-verified removed footprint supports polygon resizing, dragging, undo/redo, approval and persistence', async t => {
  const fetchSpy=t.mock.method(globalThis,'fetch',()=>{throw Error('No paid calls');});
  const change=build('wall-removed',false), c=fixture(change);
  const store=useCompareStore.getState();
  const footprint=wallFromLine('removed',{x:150,y:85},{x:450,y:85},10).footprint;
  store.editRevisionChange(1,change.id,c=>({...c,walls:[wallFromFootprint('removed',footprint)]}));
  store.reviewRevisionChange(1,change.id,'approved');
  const original=store.captureEditSnapshot().comparison;
  const resized=reshapeArea(footprint,1,{x:480,y:90},{polygon:true});
  const moved=translateArea(resized,{x:5,y:10});
  store.editRevisionChange(1,change.id,c=>setWallFootprint(c,0,resized),true);
  store.editRevisionChange(1,change.id,c=>setWallFootprint(c,0,moved),true);
  store.finishRevisionChangeEdit();
  const edited=useCompareStore.getState().comparison;
  assert.deepEqual(edited.revisions[0].analysis.pages[1].changes[0].walls[0].footprint,moved);
  assert.deepEqual(edited.revisions[0].measurements[0].points,moved);
  assert.equal(edited.revisions[0].measurements[0].areaM2,7.88);
  await store.persist(); assert.deepEqual((await loadComparison(c.id)).revisions,edited.revisions);
  store.undo(); assert.deepEqual(useCompareStore.getState().comparison.revisions,original.revisions);
  store.redo(); assert.deepEqual(useCompareStore.getState().comparison.revisions,edited.revisions);
  assert.equal(fetchSpy.mock.callCount(),0);
});
