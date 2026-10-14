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
const { createEmptyComparison, useCompareStore } = await import('../../src/store/compareStore.ts');
const { wallFromLine } = await import('../../src/lib/revision/changeEdit.ts');
const { changeItems } = await import('../../src/lib/revision/changeItems.ts');
const { analysisInputKey } = await import('../../src/lib/revision/detect.ts');
const { revisionWorkKinds, elementWorkKind } = await import('../../src/lib/revision/workClassification.ts');
const { useRevisionUi } = await import('../../src/lib/revision/revisionWorkflow.ts');
const { default: Overlay } = await import('../../src/components/compare/RevisionChangeOverlay.tsx');
const { DEFAULT_AREA_KIND_COLORS } = await import('../../src/types/compare.ts');
const { loadComparison } = await import('../../src/db/database.ts');
globalThis.document ??= {createElement:()=>({getContext:()=>null})};
const GREEN=DEFAULT_AREA_KIND_COLORS.construction,YELLOW=DEFAULT_AREA_KIND_COLORS.demolition;
const store=()=>useCompareStore.getState();
function base(type) {
  return {id:'c1',pageNumber:1,userType:type,kind:'added',category:'wall',significance:'high',score:1,evidence:[],
    bbox:{x:0,y:0,width:300,height:50},walls:[],doors:[],addedSegments:[],removedSegments:[],addedLengthPx:0,removedLengthPx:0,status:'pending'};
}
function setup(change) {
  const c=createEmptyComparison('Click','','before.pdf',['after.pdf']);c.context='construction';
  c.pages[1]={originalPageNumber:1,originalCalibration:{pixelDistance:100,realDistanceMeters:1,metersPerPixel:.01,space:'original'},revisions:{}};
  c.revisions[0].analysis={pages:{1:{pageNumber:1,changes:[change],inputKey:analysisInputKey(c,c.activeRevisionId,1)}}};
  store().setComparison(c);useRevisionUi.setState({selectedChangeId:null,editingChangeId:null,markersVisible:true,selectedWallRegions:[],wallMergePreview:null,placingType:null,placingWall:null});
}
function render() {
  Object.assign(useCompareStore.getInitialState(),store());Object.assign(useRevisionUi.getInitialState(),useRevisionUi.getState());
  return renderToStaticMarkup(createElement(Overlay,{strokeW:1,zoom:1,interactive:true,editable:true,screenToNative:(x,y)=>({x,y}),noteBounds:{left:-300,top:-300,right:1000,bottom:1000}}));
}
const bboxRect=html=>html.match(/<rect[^>]*data-revision-hit="area"[^>]*>/)[0];

test('location box never covers exact geometry, so polygon clicks reach the polygon',()=>{
  setup({...base('wall-added'),walls:[wallFromLine('added',{x:0,y:0},{x:100,y:0},20)]});
  assert.match(bboxRect(render()),/pointer-events:none/);
});

test('location box stays clickable as the fallback when a change has no geometry',()=>{
  setup(base('wall-added'));
  assert.doesNotMatch(bboxRect(render()),/pointer-events:none/);
  assert.match(bboxRect(render()),/cursor:pointer/);
});

test('line geometry has a wide transparent hit target',()=>{
  setup({...base('wall-added'),addedSegments:[{x1:0,y1:0,x2:100,y2:0}],addedLengthPx:100});
  assert.match(render(),/<line[^>]*stroke="transparent"[^>]*stroke-width="12"/);
});

test('selectChange selects and opens the change; wall region click does the same',()=>{
  const change={...base('wall-added'),walls:[wallFromLine('added',{x:0,y:0},{x:100,y:0},20)]};
  setup(change);
  useRevisionUi.getState().selectChange('c1');
  assert.equal(useRevisionUi.getState().selectedChangeId,'c1');
  assert.equal(useRevisionUi.getState().editingChangeId,'c1');
  useRevisionUi.getState().selectChange(null);
  useRevisionUi.getState().selectWallRegion('c1',0);
  assert.equal(useRevisionUi.getState().selectedChangeId,'c1');
});

const { isRegionalNote, revisionCloudPath } = await import('../../src/components/compare/RevisionChangeOverlay.tsx');
function regionalFixture() {
  const region={...base('other'),id:'region',userType:undefined,category:'unknown',kind:'modified',bbox:{x:0,y:0,width:400,height:300},
    aiProposal:{changeType:'room-boundary-changed',before:null,after:null,verification:'verified',requiresReview:false,evidence:[]}};
  const wall={...base('wall-added'),id:'wall',walls:[wallFromLine('added',{x:50,y:50},{x:150,y:50},20)],bbox:{x:40,y:40,width:120,height:30}};
  const door={...base('door-added'),id:'door',category:'opening',bbox:{x:200,y:100,width:40,height:30},
    doors:[{side:'added',hinge:{x:200,y:100},jamb:{x:240,y:100},radiusPx:40,heightM:2.1,wallThicknessPx:20,opening:'door',
      footprint:[{x:200,y:100},{x:240,y:100},{x:240,y:120},{x:200,y:120}],geometryVerified:true,impactVerified:true}]};
  const c=createEmptyComparison('Regional','','before.pdf',['after.pdf']);c.context='construction';
  c.pages[1]={originalPageNumber:1,originalCalibration:{pixelDistance:100,realDistanceMeters:1,metersPerPixel:.01,space:'original'},revisions:{}};
  c.revisions[0].analysis={pages:{1:{pageNumber:1,changes:[region,wall,door],inputKey:analysisInputKey(c,c.activeRevisionId,1)}}};
  store().setComparison(c);useRevisionUi.setState({selectedChangeId:null,editingChangeId:null,markersVisible:true,selectedWallRegions:[],wallMergePreview:null,placingType:null,placingWall:null});
  return {region,wall,door};
}

test('regional note is an annotation: cloud outline only, no fill, no geometry',()=>{
  const {region,wall}=regionalFixture();
  assert.equal(isRegionalNote(region),true);assert.equal(isRegionalNote(wall),false);
  assert.match(revisionCloudPath(region.bbox,1),/^M0 0A/);
  const html=render();
  const cloud=html.match(/<g class="revision-cloud"[^>]*>.*?<\/g>/)[0];
  assert.match(cloud,/fill="none"/);
  assert.doesNotMatch(cloud,/<rect/);
  // interior never intercepts: the only interactive element is the stroke-only hit path
  assert.equal((cloud.match(/pointer-events:stroke/g)??[]).length,1);
  assert.equal(/data-revision-hit="area"/.test(html.split('data-revision-change-id="region"')[1].split('data-revision-change-id="wall"')[0]),false);
});

test('nested wall and opening stay clickable inside a regional cloud and render above it',()=>{
  regionalFixture();const html=render();
  const order=['region','wall','door'].map(id=>html.indexOf(`data-revision-change-id="${id}"`));
  assert.ok(order[0]>=0&&order[0]<order[1]&&order[1]<order[2],'regional note is drawn first (below physical changes)');
  const wallPart=html.split('data-revision-change-id="wall"')[1].split('data-revision-change-id="door"')[0];
  assert.match(wallPart,/<polygon[^>]*pointer-events:auto/);
  const doorPart=html.split('data-revision-change-id="door"')[1];
  assert.match(doorPart,/<polygon[^>]*pointer-events:auto/);
  // the regional group disables pointer events for everything except its outline hit path and bubble
  assert.match(html,/data-revision-change-id="region" pointer-events="none"/);
});

test('every overlapping change remains selectable through the store',()=>{
  regionalFixture();
  for(const id of ['wall','region','door']){useRevisionUi.getState().selectChange(id);assert.equal(useRevisionUi.getState().selectedChangeId,id);}
  useRevisionUi.getState().selectWallRegion('wall',0);assert.equal(useRevisionUi.getState().selectedChangeId,'wall');
});

const { notePopupPosition } = await import('../../src/components/compare/RevisionChangeOverlay.tsx');
test('description popup is clamped to the viewport without moving the bubble',()=>{
  const bounds={left:0,top:0,right:500,bottom:400},bubble={x:480,y:380,width:26,height:22};
  const p=notePopupPosition(bubble,150,60,bounds,1);
  assert.ok(p.x+150<=500&&p.x>=0);assert.ok(p.y+60<=400,'flips above when no room below');
  assert.deepEqual(bubble,{x:480,y:380,width:26,height:22});
  assert.deepEqual(notePopupPosition({x:10,y:10,width:26,height:22},150,60,bounds,1),{x:10,y:35});
});

test('collapsed overlay has no popup and bubbles keep the compact size',()=>{
  regionalFixture();const html=render();
  assert.doesNotMatch(html,/revision-change-popup/);
  assert.equal((html.match(/class="revision-change-balloon"/g)??[]).length,3);
});

test('expanded descriptions are portalled into the last child of the plan svg (topmost paint order)',()=>{
  const canvas=readFileSync(new URL('../../src/components/compare/CompareCanvas.tsx',import.meta.url),'utf8');
  assert.match(canvas,/<g ref=\{setPopupLayer\} className="revision-popup-layer" \/>\s*<\/svg>/);
  const overlay=readFileSync(new URL('../../src/components/compare/RevisionChangeOverlay.tsx',import.meta.url),'utf8');
  assert.match(overlay,/createPortal\(<>\{popups\}<\/>, popupLayer\)/);
  assert.match(overlay,/<rect x=\{x\} y=\{y\} width=\{popupWidth\}[^>]*fillOpacity=\{1\}/);
});

const { rotateOpening90 } = await import('../../src/lib/revision/changeEdit.ts');
test('rotateOpening90 turns the opening 90° clockwise about its centre, keeping dimensions; four turns restore it',()=>{
  const door={side:'added',hinge:{x:0,y:10},jamb:{x:100,y:10},radiusPx:100,heightM:2.1,wallThicknessPx:20,opening:'door',
    footprint:[{x:0,y:0},{x:100,y:0},{x:100,y:20},{x:0,y:20}],geometryVerified:true,impactVerified:true};
  const c={...base('door-added'),category:'opening',doors:[door]};
  const r=rotateOpening90(c,0).doors[0];
  assert.deepEqual(r.hinge,{x:50,y:-40});assert.deepEqual(r.jamb,{x:50,y:60});
  assert.deepEqual(r.footprint,[{x:60,y:-40},{x:60,y:60},{x:40,y:60},{x:40,y:-40}]);
  assert.equal(r.wallThicknessPx,20);assert.equal(r.radiusPx,100);assert.equal(r.heightM,2.1);
  let x=c;for(let i=0;i<4;i++)x=rotateOpening90(x,0);
  assert.deepEqual(x.doors[0].footprint,door.footprint);assert.deepEqual(x.doors[0].hinge,door.hinge);
});

test('entering manual change drawing mode renders the placing layer without throwing',()=>{
  setup(base('wall-added'));
  for(const type of ['wall-added','door-added','other']){
    useRevisionUi.setState({placingType:type,placingWall:null,selectedChangeId:null,editingChangeId:null});
    const html=render();
    assert.match(html,/revision-change-placing/);
  }
  useRevisionUi.setState({placingType:null});
});
