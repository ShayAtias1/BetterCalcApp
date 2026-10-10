import type { Point } from '../../types';
import type { AiManifest } from './contracts';
import { aiTiles, AI_PREPARATION_VERSION } from './contracts.ts';
import { OPENINGS_AI_TASK, type OpeningDetectionResult, type OpeningDetectionType, type OpeningBox,
  type OpeningTileId, type AiOpeningCandidate, type AiOpeningReview } from '../../types/aiOpenings.ts';

const types:OpeningDetectionType[]=['hinged-door','sliding-door','doorway','open-passage','window','unknown-opening'];
const tileIds:OpeningTileId[]=['TILE_A','TILE_B','TILE_C','TILE_D'];
function requireValue(value:unknown,message:string):asserts value { if(!value)throw new Error(message); }
function object(value:unknown,keys:string[]):Record<string,unknown> {
  requireValue(value!==null&&typeof value==='object'&&!Array.isArray(value),'Expected openings object.');
  const data=value as Record<string,unknown>;
  requireValue(Object.keys(data).length===keys.length&&keys.every(k=>Object.hasOwn(data,k)),'Unexpected openings fields.');
  return data;
}
function normalized(value:unknown):asserts value is number {
  requireValue(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1,'Invalid normalized opening coordinate or confidence.');
}
function point(value:unknown) { const p=object(value,['x','y']);normalized(p.x);normalized(p.y); }
function box(value:unknown) {
  const b=object(value,['x1','y1','x2','y2']);
  normalized(b.x1);normalized(b.y1);normalized(b.x2);normalized(b.y2);
  requireValue(b.x1<b.x2&&b.y1<b.y2,'Invalid opening bbox extent.');
}
function strings(value:unknown) { requireValue(Array.isArray(value)&&value.every(v=>typeof v==='string'),'Invalid opening evidence/notes.'); }

/** Strict frozen output contract. Invalid responses fail as a whole, never as invented empty results. */
export function validateOpeningResult(value:unknown):OpeningDetectionResult {
  const data=object(value,['openings','deferred','coverageNotes']);strings(data.coverageNotes);
  requireValue(Array.isArray(data.openings)&&Array.isArray(data.deferred),'Expected opening arrays.');
  const ids=new Set<string>();
  for(const item of data.openings){
    const o=object(item,['openingId','type','geometryTile','endpointA','endpointB','bbox','confidence','requiresReview','evidence','ambiguities']);
    requireValue(typeof o.openingId==='string'&&o.openingId.trim().length>0&&!ids.has(o.openingId),'Missing or duplicate opening ID.');ids.add(o.openingId);
    requireValue(types.includes(o.type as OpeningDetectionType)&&tileIds.includes(o.geometryTile as OpeningTileId),'Invalid opening type/tile.');
    point(o.endpointA);point(o.endpointB);box(o.bbox);normalized(o.confidence);
    requireValue(typeof o.requiresReview==='boolean','Invalid model review flag.');strings(o.evidence);strings(o.ambiguities);
    const a=o.endpointA as Point,b=o.endpointB as Point,bbox=o.bbox as OpeningBox;
    requireValue(a.x!==b.x||a.y!==b.y,'Zero-length opening.');
    requireValue([a,b].every(p=>p.x>=bbox.x1&&p.x<=bbox.x2&&p.y>=bbox.y1&&p.y<=bbox.y2),'Opening endpoints outside bbox.');
  }
  for(const item of data.deferred){
    const d=object(item,['geometryTile','bbox','evidence','reason']);box(d.bbox);strings(d.evidence);
    requireValue(tileIds.includes(d.geometryTile as OpeningTileId)&&['CROSS_TILE_INCOMPLETE','UNSUPPORTED_ENDPOINTS'].includes(String(d.reason)),'Invalid deferred opening.');
  }
  return structuredClone(value) as OpeningDetectionResult;
}

/** Consume saved/provider Responses envelopes without any network activity. */
export function parseOpeningResponse(value:unknown):OpeningDetectionResult {
  const raw=value as {status?:string; output?:{type?:string; content?:{type?:string; text?:string}[]}[]};
  requireValue(raw?.status==='completed'&&Array.isArray(raw.output),'Opening response incomplete.');
  const content=raw.output.filter(o=>o.type==='message').flatMap(o=>o.content??[]);
  requireValue(!content.some(c=>c.type==='refusal'),'Opening response refused.');
  const texts=content.filter(c=>c.type==='output_text');
  requireValue(texts.length===1&&typeof texts[0].text==='string','Expected one openings structured output.');
  return validateOpeningResult(JSON.parse(texts[0].text));
}

export function validateOpeningManifest(m:AiManifest):void {
  requireValue(m?.preparationVersion===AI_PREPARATION_VERSION&&m.renderer==='embedpdf-pdfium','Unsupported openings preparation.');
  requireValue(typeof m.planId==='string'&&m.planId.length>0&&Number.isInteger(m.pageNumber)&&m.pageNumber>0&&/^[a-f0-9]{64}$/i.test(m.sourceHash),'Invalid openings source binding.');
  requireValue([m.nativeWidth,m.nativeHeight,m.renderScale].every(v=>Number.isFinite(v)&&v>0),'Invalid opening page dimensions/scale.');
  requireValue([0,90,180,270].includes(m.rotation)&&m.userUnit===1&&Array.isArray(m.view)&&m.view.length===4&&m.view.every(Number.isFinite)&&m.view[0]===0&&m.view[1]===0&&m.view[2]>0&&m.view[3]>0,'Unsupported PDF frame.');
  requireValue(Array.isArray(m.pageDimensions)&&m.pageDimensions.length===2&&m.pageDimensions.every(v=>Number.isInteger(v)&&v>0&&v<=5500)&&Math.max(...m.pageDimensions)===5500,'Invalid opening raster dimensions.');
  const [w,h]=m.pageDimensions;
  // DPI serialization can round the longest edge to 5500 + machine epsilon.
  // Tolerance only validates raster dimensions; endpoint coordinates are never adjusted.
  const expectedScale=5500/Math.max(m.nativeWidth,m.nativeHeight);
  requireValue(Math.abs(m.renderScale-expectedScale)<1e-8&&w===Math.ceil(m.nativeWidth*expectedScale-1e-8)&&h===Math.ceil(m.nativeHeight*expectedScale-1e-8),'Opening raster/native scale mismatch.');
  const expected=aiTiles(w,h);
  requireValue(Array.isArray(m.tiles)&&m.tiles.length===4&&expected.every((t,i)=>Object.entries(t).every(([k,v])=>m.tiles[i]?.[k as keyof typeof t]===v)),'Invalid opening tile layout.');
}
function mappedPoint(p:Point,tileId:OpeningTileId,m:AiManifest):Point {
  point(p);const tile=m.tiles.find(t=>t.tileId===tileId);requireValue(tile,'Unknown opening tile.');
  const mapped={x:(tile.pageX+p.x*tile.pageWidth)/m.renderScale,y:(tile.pageY+p.y*tile.pageHeight)/m.renderScale};
  requireValue(Number.isFinite(mapped.x)&&Number.isFinite(mapped.y)&&mapped.x>=0&&mapped.y>=0&&mapped.x<=m.nativeWidth&&mapped.y<=m.nativeHeight,'Opening coordinate outside native page.');
  return mapped;
}
export function openingTileToNative(p:Point,tileId:OpeningTileId,m:AiManifest):Point {
  validateOpeningManifest(m);return mappedPoint(p,tileId,m);
}
function mappedBox(b:OpeningBox,tileId:OpeningTileId,m:AiManifest):OpeningBox {
  const a=mappedPoint({x:b.x1,y:b.y1},tileId,m),z=mappedPoint({x:b.x2,y:b.y2},tileId,m);
  return {x1:a.x,y1:a.y,x2:z.x,y2:z.y};
}
/** Proposed classification only. Access for doors/windows is kept conservative. */
export function openingClassification(type:OpeningDetectionType):AiOpeningCandidate['classification'] {
  switch(type){
    case 'hinged-door':return {kind:'door',mechanism:'hinged',walkableAccess:'unknown'};
    case 'sliding-door':return {kind:'door',mechanism:'sliding',walkableAccess:'unknown'};
    case 'doorway':return {kind:'door',mechanism:'open',walkableAccess:'unknown'};
    case 'open-passage':return {kind:'open-passage',mechanism:'open',walkableAccess:'unknown'};
    case 'window':return {kind:'window',mechanism:'unknown',walkableAccess:'unsupported'};
    case 'unknown-opening':return {kind:'unknown',mechanism:'unknown',walkableAccess:'unknown'};
    default:throw new Error('Invalid opening classification.');
  }
}

export function parseOpeningResult(value:unknown,manifest:AiManifest,importId:string):AiOpeningReview {
  validateOpeningManifest(manifest);requireValue(typeof importId==='string'&&importId.trim().length>0,'Missing openings import identity.');
  const data=validateOpeningResult(value),m=structuredClone(manifest);
  const key=JSON.stringify([OPENINGS_AI_TASK,m.planId,m.pageNumber,m.sourceHash,importId]);
  return {task:OPENINGS_AI_TASK,key,planId:m.planId,pageNumber:m.pageNumber,sourceHash:m.sourceHash,importId,manifest:m,
    candidates:data.openings.map(o=>{
      const endpointA=mappedPoint(o.endpointA,o.geometryTile,m),endpointB=mappedPoint(o.endpointB,o.geometryTile,m);
      requireValue(endpointA.x!==endpointB.x||endpointA.y!==endpointB.y,'Zero-length native opening.');
      return {task:OPENINGS_AI_TASK,id:JSON.stringify([key,o.openingId]),pageNumber:m.pageNumber,
      geometry:{endpointA,endpointB},
      bbox:mappedBox(o.bbox,o.geometryTile,m),classification:openingClassification(o.type),approval:{status:'draft',reviewedAt:null},requiresReview:true,
      provenance:{task:OPENINGS_AI_TASK,baseline:'Vision-002 Original',importId,candidateId:o.openingId,planId:m.planId,pageNumber:m.pageNumber,sourceHash:m.sourceHash,manifest:structuredClone(m),original:structuredClone(o)}};}),
    deferred:data.deferred.map((o,i)=>({task:OPENINGS_AI_TASK,id:JSON.stringify([key,'deferred',i]),pageNumber:m.pageNumber,geometry:null,bbox:mappedBox(o.bbox,o.geometryTile,m),original:structuredClone(o),requiresReview:true})),
    coverageNotes:data.coverageNotes};
}
