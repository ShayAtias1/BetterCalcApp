import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { aiTiles, AI_PREPARATION_VERSION, type AiManifest } from '../../src/lib/ai/contracts';
import { validateOpeningResult, parseOpeningResponse, parseOpeningResult, openingTileToNative, openingClassification } from '../../src/lib/ai/openings';
import type { OpeningDetectionType } from '../../src/types/aiOpenings';

import { metadata, result, response } from './fixtures/openings-synthetic.ts';
const fixtures: Record<string, unknown> = {'input-metadata.json':metadata,'parsed-local-openings.json':result,'raw-response.json':response};
// Deliberately mutable JSON inputs exercise rejection of malformed provider payloads.
const fixture = (name:string) => JSON.parse(JSON.stringify(fixtures[name]));
const saved=fixture('parsed-local-openings.json');
function manifest():AiManifest {
  const m=fixture('input-metadata.json');
  return {preparationVersion:AI_PREPARATION_VERSION,renderer:'embedpdf-pdfium',planId:'fixture-plan',pageNumber:m.page,
    sourceHash:m.sourceSha256,nativeWidth:m.pdfDimensionsPoints[0],nativeHeight:m.pdfDimensionsPoints[1],rotation:0,userUnit:1,
    view:[0,0,...m.pdfDimensionsPoints],pageDimensions:m.pageDimensions,renderScale:m.renderDpi/72,tiles:m.tiles,coordinateMapping:'tile to native'};
}
function syntheticManifest(rotation=0):AiManifest {
  return {...manifest(),nativeWidth:100,nativeHeight:80,rotation,view:[0,0,100,80],pageDimensions:[5500,4400],renderScale:55,tiles:aiTiles(5500,4400)};
}
test('synthetic provider response remains unchanged; every detection is a review draft',()=>{
  const result=parseOpeningResponse(fixture('raw-response.json'));
  assert.deepEqual(result,saved);
  const before=structuredClone(result),m=manifest(),review=parseOpeningResult(result,m,'saved-job');
  assert.equal(review.candidates.length,17);
  assert.equal(review.task,'openings-v1');assert.equal(review.deferred.length,0);
  for(const [i,c] of review.candidates.entries()){
    assert.deepEqual(c.approval,{status:'draft',reviewedAt:null});assert.equal(c.requiresReview,true);
    assert.deepEqual(c.provenance.original,result.openings[i]);assert.deepEqual(c.provenance.manifest,m);
    const o=result.openings[i],t=m.tiles.find(t=>t.tileId===o.geometryTile)!;
    for(const endpoint of ['endpointA','endpointB'] as const){
      assert.equal(c.geometry[endpoint].x,(t.pageX+o[endpoint].x*t.pageWidth)/m.renderScale);
      assert.equal(c.geometry[endpoint].y,(t.pageY+o[endpoint].y*t.pageHeight)/m.renderScale);
    }
    assert.equal(Object.hasOwn(c,'widthM'),false);assert.equal(Object.hasOwn(c,'quantity'),false);
  }
  assert.deepEqual(result,before);
  review.candidates[0].provenance.original.evidence.push('local edit');
  assert.deepEqual(result,before);
});
test('all tiles map overlap points to the same native location; rotation is not applied twice',()=>{
  for(const rotation of [0,90,180,270]){
    const m=syntheticManifest(rotation);
    for(const t of m.tiles){
      const p={x:(2750-t.pageX)/t.pageWidth,y:(2200-t.pageY)/t.pageHeight};
      assert.deepEqual(openingTileToNative(p,t.tileId as 'TILE_A',m),{x:50,y:40});
    }
    assert.deepEqual(openingTileToNative({x:1,y:1},'TILE_D',m),{x:100,y:80});
    assert.deepEqual(openingTileToNative({x:0,y:0},'TILE_A',m),{x:0,y:0});
  }
});
test('ceil-rounded raster padding is rejected, never clamped into the native page',()=>{
  const m=manifest();
  assert.throws(()=>openingTileToNative({x:1,y:1},'TILE_D',m),/outside native page/);
});
test('a span that collapses at native floating point precision is rejected',()=>{
  const data={openings:[{...saved.openings[0],geometryTile:'TILE_B',endpointA:{x:0,y:.2},endpointB:{x:Number.MIN_VALUE,y:.2},bbox:{x1:0,y1:.1,x2:.1,y2:.3}}],deferred:[],coverageNotes:[]};
  assert.throws(()=>parseOpeningResult(data,syntheticManifest(),'collapsed'),/Zero-length native/);
});
test('classification preserves separate kind, mechanism and access uncertainty',()=>{
  const expected={
    'hinged-door':['door','hinged','unknown'],'sliding-door':['door','sliding','unknown'],
    doorway:['door','open','unknown'],'open-passage':['open-passage','open','unknown'],
    window:['window','unknown','unsupported'],'unknown-opening':['unknown','unknown','unknown'],
  };
  for(const [type,values] of Object.entries(expected))assert.deepEqual(Object.values(openingClassification(type as OpeningDetectionType)),values);
  assert.throws(()=>openingClassification('room' as OpeningDetectionType));
});
test('uncertain spans and deferred observations remain distinct with original evidence',()=>{
  const data=structuredClone(saved);data.openings=[data.openings[0]];
  data.openings[0].type='unknown-opening';data.openings[0].requiresReview=false;
  data.deferred=[{geometryTile:'TILE_B',bbox:{x1:.1,y1:.1,x2:.2,y2:.2},evidence:['Only one jamb visible'],reason:'UNSUPPORTED_ENDPOINTS'},
    {geometryTile:'TILE_C',bbox:{x1:.1,y1:.1,x2:.2,y2:.2},evidence:[],reason:'CROSS_TILE_INCOMPLETE'}];
  const review=parseOpeningResult(data,manifest(),'uncertain-job');
  assert.equal(review.candidates[0].classification.kind,'unknown');assert.equal(review.candidates[0].requiresReview,true);
  assert.equal(review.deferred.length,2);
  for(const [i,d] of review.deferred.entries()){
    assert.equal(d.geometry,null);assert.deepEqual(d.original,data.deferred[i]);assert.equal(d.requiresReview,true);
    assert.equal(Object.hasOwn(d,'endpointA'),false);
  }
  const empty=parseOpeningResult({openings:[],deferred:[],coverageNotes:['No supported openings']},manifest(),'empty');
  assert.deepEqual(empty.candidates,[]);assert.deepEqual(empty.coverageNotes,['No supported openings']);
});
test('bad coordinates, spans, bboxes, IDs and malformed schema fail closed',()=>{
  const edits=[
    (d:typeof saved)=>{d.openings[0].endpointA.x=NaN;},
    (d:typeof saved)=>{d.openings[0].endpointA.x=Infinity;},
    (d:typeof saved)=>{d.openings[0].endpointA.x=-.01;},
    (d:typeof saved)=>{d.openings[0].endpointA.y=1.01;},
    (d:typeof saved)=>{d.openings[0].endpointB={...d.openings[0].endpointA};},
    (d:typeof saved)=>{d.openings[0].bbox.x2=d.openings[0].bbox.x1;},
    (d:typeof saved)=>{d.openings[0].bbox.y1=.5;},
    (d:typeof saved)=>{d.openings[1].openingId=d.openings[0].openingId;},
    (d:typeof saved)=>{d.openings[0].openingId=' ';},
    (d:typeof saved)=>{d.openings[0].geometryTile='PAGE';},
    (d:typeof saved)=>{d.openings[0].type='room';},
    (d:typeof saved)=>{d.openings[0].confidence=2;},
    (d:typeof saved)=>{d.openings[0].evidence=[7];},
    (d:typeof saved)=>{d.openings[0].widthM=1;},
    (d:typeof saved)=>{delete d.deferred;},
    (d:typeof saved)=>{d.deferred=[{geometryTile:'TILE_A',bbox:{x1:.1,y1:.1,x2:.2,y2:.2},evidence:[],reason:'invented'}];},
  ];
  for(const edit of edits){const data=structuredClone(saved);edit(data);assert.throws(()=>parseOpeningResult(data,manifest(),'bad'));}
  assert.throws(()=>validateOpeningResult(null));
});
test('manifest validation rejects wrong source/frame/scale/layout; stable identities are task and job scoped',()=>{
  const edits:((m:AiManifest)=>void)[]=[m=>{m.renderScale=0;},m=>{m.renderScale*=2;},m=>{m.sourceHash='wrong';},m=>{m.pageNumber=0;},
    m=>{m.rotation=45;},m=>{m.userUnit=2;},m=>{m.view[0]=10;},m=>{m.tiles[0].pageX=1;},m=>{m.tiles.reverse();},
    m=>{m.pageDimensions[1]+=1;},m=>{m.nativeWidth=Infinity;}];
  for(const edit of edits){const m=manifest();edit(m);assert.throws(()=>parseOpeningResult(saved,m,'bad'));}
  const a=parseOpeningResult(saved,manifest(),'job-a');
  assert.deepEqual(a,parseOpeningResult(saved,manifest(),'job-a'));
  assert.notEqual(a.candidates[0].id,parseOpeningResult(saved,manifest(),'job-b').candidates[0].id);
  const m=manifest();m.planId='another';assert.notEqual(a.key,parseOpeningResult(saved,m,'job-a').key);
  assert.throws(()=>parseOpeningResult(saved,manifest(),''));
});
test('incomplete, refused, invalid JSON and multiple provider outputs are rejected',()=>{
  const raw=fixture('raw-response.json');
  assert.throws(()=>parseOpeningResponse({...raw,status:'incomplete'}));
  assert.throws(()=>parseOpeningResponse({...raw,output:[]}));
  assert.throws(()=>parseOpeningResponse({...raw,output:[{type:'message',content:[{type:'refusal',refusal:'No'}]}]}));
  assert.throws(()=>parseOpeningResponse({...raw,output:[{type:'message',content:[{type:'output_text',text:'{'}]}]}));
  assert.throws(()=>parseOpeningResponse({...raw,output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(saved)},{type:'output_text',text:JSON.stringify(saved)}]}]}));
});
test('frozen asset hashes and exact Vision-002 settings are preserved',()=>{
  const asset=(name:string)=>readFileSync(new URL(`../../server/openings-ai-assets/${name}`,import.meta.url));
  const provenance=JSON.parse(asset('provenance.json').toString());
  for(const [name,hash] of Object.entries(provenance.copiedAssetsSha256))assert.equal(createHash('sha256').update(asset(name)).digest('hex'),hash);
  const config=JSON.parse(asset('config-used.json').toString());
  assert.equal(config.model,'gpt-6.1-sol');assert.equal(config.imageDetail,'original');assert.equal(config.reasoningEffort,'low');
  assert.equal(config.serviceTier,'default');assert.equal(config.maxOutputTokens,24000);assert.equal(config.maxRetries,0);
  assert.equal(config.maxImageDimension,5500);assert.equal(config.timeoutSeconds,420);
});
