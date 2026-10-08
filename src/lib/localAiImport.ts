import { AI_PREPARATION_VERSION } from './ai/contracts';
import type { Point } from '../types';
import { polygonAreaPx } from './geometry';

export interface LocalAiMetadata {
  planId: string;
  sourceHash: string;
  pageNumber: number;
  width: number;
  height: number;
  spaceId: string;
  geometryClass: string;
  reviewNotes: string[];
  suggestedType?: string | null;
  typeConfidence?: string;
  geometryConfidence?: string;
  requiresReview?: boolean;
  ambiguities?: string[];
  reason?: string | null;
}

/** Focused import gate; measurements continue to use the existing geometry engine. */
export function polygonProblems(points: Point[], width: number, height: number): string[] {
  if (points.length < 3 || new Set(points.map(p => `${p.x},${p.y}`)).size < 3) return ['At least three distinct vertices are required.'];
  if (!points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return ['Coordinates must be finite.'];
  const issues: string[] = [];
  if (points.some(p => p.x < 0 || p.y < 0 || p.x > width || p.y > height)) issues.push('Polygon extends outside the page.');
  const cross = (a: Point, b: Point, c: Point) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const on = (a: Point, b: Point, p: Point) => Math.abs(cross(a,b,p)) <= 1e-9 && p.x >= Math.min(a.x,b.x)-1e-9 && p.x <= Math.max(a.x,b.x)+1e-9 && p.y >= Math.min(a.y,b.y)-1e-9 && p.y <= Math.max(a.y,b.y)+1e-9;
  for (let i=0; i<points.length; i++) {
    const a=points[i], b=points[(i+1)%points.length];
    if (a.x === b.x && a.y === b.y) issues.push('Repeated adjacent vertex.');
    const c=points[(i+2)%points.length];
    if (Math.abs(cross(a,b,c)) <= 1e-9 && (b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y) < 0) issues.push('An edge doubles back on itself.');
    for (let j=i+1; j<points.length; j++) {
      if (j === i+1 || (i === 0 && j === points.length-1)) continue;
      const c=points[j], d=points[(j+1)%points.length];
      if ((cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0) || on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b)) issues.push('Polygon has intersecting or touching nonadjacent edges.');
    }
  }
  if (polygonAreaPx(points) <= 1e-9) issues.push('Polygon has no positive area.');
  return [...new Set(issues)];
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.');
  return value as Record<string, unknown>;
}
function pair(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(v => typeof v === 'number' && Number.isFinite(v))) throw new Error('Invalid coordinate/dimension pair.');
  return value as [number, number];
}
function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('Missing or invalid render metadata.');
  return value;
}

export interface ImportedSpace {
  id: string;
  pageNumber: number;
  points: Point[];
  suggestedName: string;
  roomTypeKey: null;
  confidence: 'low';
  localAi: LocalAiMetadata;
  validationProblems: string[];
  originalPoints: Point[];
  originalValidationProblems: string[];
}

/** Frozen PDFium crop/DPI convention, shared by research imports and versioned live preparation. */
export function parseLocalAiResult(result: unknown, manifest: unknown, target: {
  planId: string; sourceHash: string; importId: string; pageNumber: number; width: number; height: number;
  rotation: number; userUnit: number; view: number[];
}): ImportedSpace[] {
  const m=record(manifest), source=record(m.source);
  if (source.sourceSha256 !== target.sourceHash || source.page !== target.pageNumber) throw new Error('This result belongs to a different PDF or page.');
  if (source.fullPage !== true || !(source.renderEngine === 'pypdfium2' || (source.renderEngine === 'embedpdf-pdfium' && m.preparationVersion === AI_PREPARATION_VERSION))) throw new Error('Unsupported or missing full-page preparation metadata.');
  if (![0,90,180,270].includes(target.rotation) || target.userUnit !== 1 || target.view[0] !== 0 || target.view[1] !== 0) throw new Error('Phase 1 requires standard intrinsic rotation, unit scale and a zero-origin page box; other mappings need more preparation metadata.');
  // The frozen renderer calls pypdfium2 get_size()/render() with no added rotation.
  // Both these dimensions and PDF.js's default viewport include intrinsic page rotation.
  const [pw,ph]=pair(source.pdfDimensionsPoints), [rw,rh]=pair(m.pageDimensions);
  const imageSize=pair(source.imageDimensions);
  const scale=positive(source.renderDpi)/72;
  if (Math.abs(pw-target.width)>0.01 || Math.abs(ph-target.height)>0.01 || rw <= 0 || rh <= 0 || imageSize[0] !== rw || imageSize[1] !== rh || Math.abs(rw-pw*scale)>1.01 || Math.abs(rh-ph*scale)>1.01) throw new Error('Page dimensions or recorded raster scale do not match.');
  if (!Array.isArray(m.tiles) || m.tiles.length !== 4) throw new Error('Four recorded tile crops are required.');
  const tiles=new Map<string, {x:number;y:number;w:number;h:number}>();
  for (const raw of m.tiles) {
    const t=record(raw);
    if (typeof t.tileId !== 'string' || !['TILE_A','TILE_B','TILE_C','TILE_D'].includes(t.tileId) || tiles.has(t.tileId)) throw new Error('Invalid or duplicate tile ID.');
    const w=positive(t.pageWidth), h=positive(t.pageHeight);
    if (typeof t.pageX !== 'number' || typeof t.pageY !== 'number' || !Number.isFinite(t.pageX) || !Number.isFinite(t.pageY) || t.pageX<0 || t.pageY<0 || t.pageX+w>rw || t.pageY+h>rh || t.tileWidth !== w || t.tileHeight !== h) throw new Error('Invalid tile crop metadata.');
    tiles.set(t.tileId,{x:t.pageX,y:t.pageY,w,h});
  }
  const data=record(result);
  if (Object.keys(data).some(key => key !== 'spaces')) throw new Error('Use the original parsed-spaces.json, not a remapped result.');
  if (!Array.isArray(data.spaces) || data.spaces.length > 2000) throw new Error('Expected parsed-spaces.json with a bounded spaces array.');
  const ids=new Set<string>();
  return data.spaces.map(raw => {
    const s=record(raw);
    if (typeof s.spaceId !== 'string' || !s.spaceId || ids.has(s.spaceId)) throw new Error('Missing or duplicate Space identifier.');
    ids.add(s.spaceId);
    const tile=tiles.get(String(s.geometryTile));
    if (!tile || !Array.isArray(s.polygon) || s.polygon.length > 2000) throw new Error(`Invalid tile or polygon for ${s.spaceId}. Use parsed-spaces.json, not remapped-spaces.json.`);
    const problems: string[]=[];
    const points=s.polygon.map(rawPoint => {
      const [u,v]=pair(rawPoint);
      if (u<0 || u>1 || v<0 || v>1) problems.push('Tile-local coordinates must be in [0,1].');
      // pypdfium2 rounds the raster bounds; the recorded DPI is the actual rendering scale.
      return {x:(tile.x+u*tile.w)/scale,y:(tile.y+v*tile.h)/scale};
    });
    if (s.vertexCount !== points.length) problems.push('vertexCount does not match the polygon.');
    if (!['CLOSED','OPEN_CONNECTED','AMBIGUOUS'].includes(String(s.geometryClass)) || typeof s.requiresReview !== 'boolean' || !Array.isArray(s.ambiguities) || !s.ambiguities.every(a => typeof a === 'string')) throw new Error(`Missing review metadata for ${s.spaceId}.`);
    if (s.type != null && typeof s.type !== 'string') throw new Error(`Invalid Space type for ${s.spaceId}.`);
    const reviewNotes=[...(s.ambiguities as string[])];
    if (s.requiresReview) reviewNotes.unshift('AI marked this Space for review.');
    if (s.reason != null) reviewNotes.push(String(s.reason));
    const validationProblems=[...new Set([...problems,...polygonProblems(points,target.width,target.height)])];
    return {id:`local-ai:${target.planId}:${target.sourceHash}:${target.pageNumber}:${target.importId}:${s.spaceId}`,pageNumber:target.pageNumber,points,suggestedName:`AI · ${s.spaceId}`,roomTypeKey:null,confidence:'low',
      localAi:{planId:target.planId,sourceHash:target.sourceHash,pageNumber:target.pageNumber,width:target.width,height:target.height,spaceId:s.spaceId,geometryClass:String(s.geometryClass),reviewNotes,
        suggestedType:typeof s.type === 'string' ? s.type : null,
        typeConfidence:typeof s.typeConfidence === 'string' ? s.typeConfidence : undefined,
        geometryConfidence:typeof s.geometryConfidence === 'string' ? s.geometryConfidence : undefined,
        requiresReview:s.requiresReview,ambiguities:[...(s.ambiguities as string[])],reason:s.reason == null ? null : String(s.reason)},
      originalPoints:points.map(p => ({...p})), originalValidationProblems:[...validationProblems], validationProblems};
  });
}
