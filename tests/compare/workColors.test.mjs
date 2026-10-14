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
const current=()=>store().comparison;
const currentChange=()=>current().revisions[0].analysis.pages[1].changes[0];
function base(type) {
  return {id:'selected',pageNumber:1,userType:type,kind:type.endsWith('-added')?'added':type.endsWith('-removed')?'removed':'modified',
    category:type.startsWith('wall')?'wall':'opening',significance:'high',score:1,evidence:[],bbox:{x:0,y:0,width:300,height:50},
    walls:[],doors:[],addedSegments:[],removedSegments:[],addedLengthPx:0,removedLengthPx:0,status:'pending'};
}
function opening(side,x,width) {
  return {side,hinge:{x,y:0},jamb:{x:x+width,y:0},radiusPx:width,heightM:2.1,wallThicknessPx:20,opening:'door',
    footprint:[{x,y:0},{x:x+width,y:0},{x:x+width,y:20},{x,y:20}],geometryVerified:true,impactVerified:true};
}
function fixture(change, colors=DEFAULT_AREA_KIND_COLORS) {
  const c=createEmptyComparison('Colors','','before.pdf',['after.pdf']);c.context='construction';c.areaKindColors=colors;
  c.pages[1]={originalPageNumber:1,originalCalibration:{pixelDistance:100,realDistanceMeters:1,metersPerPixel:.01,space:'original'},revisions:{}};
  c.revisions[0].analysis={pages:{1:{pageNumber:1,changes:[change],inputKey:analysisInputKey(c,c.activeRevisionId,1)}}};
  store().setComparison(c);useRevisionUi.setState({selectedChangeId:change.id,editingChangeId:change.id,editSide:'both',markersVisible:true,
    selectedWallRegions:[],wallMergePreview:null,placingType:null,placingWall:null});
  return c;
}
function render(editable=true) {
  Object.assign(useCompareStore.getInitialState(),store());Object.assign(useRevisionUi.getInitialState(),useRevisionUi.getState());
  return renderToStaticMarkup(createElement(Overlay,{strokeW:1,zoom:1,interactive:editable,editable,screenToNative:(x,y)=>({x,y}),noteBounds:{left:-300,top:-300,right:1000,bottom:1000}}));
}
const points=polygon=>polygon.map(p=>`${p.x},${p.y}`).join(' ');
function assertPolygon(html, polygon, color) {
  const tag=(html.match(/<polygon[^>]*>/g)??[]).find(tag=>tag.includes(`points="${points(polygon)}"`)&&tag.includes(`fill="${color}"`));
  assert.ok(tag,`Missing ${color} work polygon ${points(polygon)}`);assert.ok(tag.includes(`stroke="${color}"`));
}
function handleColors(html) {
  const edit=html.slice(html.indexOf('class="revision-change-edit"'));
  return (edit.match(/<circle[^>]*r="5"[^>]*>/g)??[]).map(tag=>tag.match(/stroke="([^"]+)"/)[1]);
}
for(const side of ['added','removed']) for(const ai of [false,true]) test(`${ai?'AI':'manual'} wall ${side} polygon and handles match its work token`,()=>{
  const change={...base(`wall-${side}`),walls:[wallFromLine(side,{x:0,y:0},{x:100,y:0},20)]};
  if(ai)change.aiProposal={changeType:`wall-${side}`,before:side==='removed'?change.walls[0].centerline:null,after:side==='added'?change.walls[0].centerline:null,verification:'verified',requiresReview:false,evidence:[]};
  fixture(change);const color=side==='added'?GREEN:YELLOW,html=render();
  assertPolygon(html,change.walls[0].footprint,color);assert.deepEqual(handleColors(html),Array(8).fill(color));
  assert.deepEqual(revisionWorkKinds(change),[side==='added'?'construction':'demolition']);
});
for(const side of ['added','removed'])test(`opening ${side} reverses wall work, consistently including handles`,()=>{
  const change={...base(`door-${side}`),doors:[opening(side,0,100)]};fixture(change);
  const color=side==='added'?YELLOW:GREEN,html=render();assertPolygon(html,change.doors[0].footprint,color);
  assert.deepEqual(handleColors(html),[color,color,color,color]);
});
for(const [name,before,after,color,kind] of [['narrowed',150,100,GREEN,'construction'],['widened',100,150,YELLOW,'demolition']])test(`opening ${name} colors only affected work and matches its editable corner handles`,()=>{
  const change={...base('opening-modified'),doors:[opening('removed',0,before),opening('added',0,after)]};fixture(change);
  const html=render(),items=changeItems(change,'construction',.01,3);
  assert.deepEqual(revisionWorkKinds(change),[kind]);assert.equal(items.length,1);
  assertPolygon(html,items[0].points,color);assert.deepEqual(handleColors(html),[color,color,color,color]);
  assert.ok(html.includes(`fill="#64748b"`),'source openings stay neutral guides');
});

test('relocated opening shows green infill and yellow removed wall with matching handles at both portions',()=>{
  const change={...base('opening-modified'),doors:[opening('removed',0,100),opening('added',200,100)]};fixture(change);
  const html=render(),items=changeItems(change,'construction',.01,3);assert.equal(items.length,2);
  for(const item of items)assertPolygon(html,item.points,DEFAULT_AREA_KIND_COLORS[item.areaKind]);
  assert.deepEqual(handleColors(html),[GREEN,GREEN,GREEN,GREEN,YELLOW,YELLOW,YELLOW,YELLOW]);
  assert.ok(html.includes('בנייה'));assert.ok(html.includes('הריסה'));
});

test('relocated walls reuse stored work tokens throughout both footprints and their handles',()=>{
  const change={...base('wall-relocated'),walls:[wallFromLine('removed',{x:0,y:0},{x:100,y:0},20),wallFromLine('added',{x:0,y:100},{x:100,y:100},20)],
    relocation:{beforeLengthPx:100,afterLengthPx:100,offsetPx:100}};
  fixture(change,{construction:'#128800',demolition:'#ccb100'});const html=render();
  assertPolygon(html,change.walls[0].footprint,'#ccb100');assertPolygon(html,change.walls[1].footprint,'#128800');
  assert.deepEqual(handleColors(html),[...Array(8).fill('#ccb100'),...Array(8).fill('#128800')]);
});

test('swapping narrowed/widened updates work, polygon color, corner colors and quantities with Undo/Redo and persistence',async()=>{
  const change={...base('opening-modified'),doors:[opening('removed',0,150),opening('added',0,100)]};fixture(change);
  store().reviewRevisionChange(1,change.id,'approved');const area=current().revisions[0].measurements[0].areaM2;
  assert.deepEqual(handleColors(render()),[GREEN,GREEN,GREEN,GREEN]);
  await store().swapRevisionChange(1,change.id,true);assert.deepEqual(revisionWorkKinds(currentChange()),['demolition']);
  assert.equal(current().revisions[0].measurements[0].areaKind,'demolition');assert.equal(current().revisions[0].measurements[0].areaM2,area);
  assert.deepEqual(handleColors(render()),[YELLOW,YELLOW,YELLOW,YELLOW]);
  store().undo();assert.deepEqual(handleColors(render()),[GREEN,GREEN,GREEN,GREEN]);store().redo();assert.deepEqual(handleColors(render()),[YELLOW,YELLOW,YELLOW,YELLOW]);
  await store().persist();const restored=await loadComparison(current().id);assert.deepEqual(revisionWorkKinds(restored.revisions[0].analysis.pages[1].changes[0]),['demolition']);
  assert.equal(elementWorkKind('doors','added'),'demolition');assert.equal(elementWorkKind('walls','added'),'construction');
});
