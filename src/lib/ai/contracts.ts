import type { DetectionCandidate } from '../../store/appStore';

export type AiJobStatus = 'IDLE' | 'PREPARING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export const AI_PREPARATION_VERSION = 'pdfium-five-images-5500-v1';
export const AI_IMAGE_NAMES = ['PAGE','TILE_A','TILE_B','TILE_C','TILE_D'] as const;
export interface AiTile {
  tileId:string; pageX:number; pageY:number; pageWidth:number; pageHeight:number; tileWidth:number; tileHeight:number;
}
export interface AiManifest {
  preparationVersion:string; renderer:'embedpdf-pdfium'; planId:string; pageNumber:number; sourceHash:string;
  nativeWidth:number; nativeHeight:number; rotation:number; userUnit:number; view:number[];
  pageDimensions:[number,number]; renderScale:number; tiles:AiTile[];
  coordinateMapping:string;
}
export interface AiImage { name:string; width:number; height:number; base64:string }
export interface AiJobRecord {
  requestId:string; jobId?:string; planId:string; pageNumber:number; sourceHash:string;
  status:AiJobStatus; createdAt:number; updatedAt:number; manifest?:AiManifest;
  /** Missing mode identifies checkpoint full-page jobs. */
  mode?:'full-page-v1'|'one-click-v1';
  resultSummary?:string;
  error?:string; metrics?:AiMetrics;
}
export interface AiMetrics {
  latencySeconds?:number|null; estimatedCostUsd?:number|null; usage?:unknown; model?:string; serviceTier?:string;
  requestId?:string; providerRequestId?:string; detectionType?:'rooms'|'openings';
  mode?:'full-page-v1'|'one-click-v1'|'openings-v1'; status?:AiJobStatus;
  startedAt?:number; finishedAt?:number|null; usageSource?:'provider'|null;
  inputTokens?:number|null; outputTokens?:number|null; cachedTokens?:number|null; reasoningTokens?:number|null;
  settings?:{reasoning?:{effort?:string};serviceTier?:string;maxOutputTokens?:number;store?:boolean;timeoutSeconds?:number;maxRetries?:number;
    imageDetails?:string[];outputFormat?:string;outputSchema?:string};
}
export interface AiJobResponse { id:string; requestId:string; status:AiJobStatus; error?:string; result?:unknown; metrics?:AiMetrics }
export interface AiReviewRecord {
  key:string; planId:string; pageNumber:number; sourceHash:string;
  candidates:DetectionCandidate[]; resolvedIds:string[]; updatedAt:number;
}
export function aiReviewKey(planId:string,pageNumber:number,hash:string){return `${planId}:${pageNumber}:${hash}`;}
export function aiTiles(width:number,height:number):AiTile[]{
  const tw=Math.ceil(width/1.82),th=Math.ceil(height/1.82);
  return [['TILE_A',0,0],['TILE_B',width-tw,0],['TILE_C',0,height-th],['TILE_D',width-tw,height-th]]
    .map(([tileId,x,y])=>({tileId:String(tileId),pageX:Number(x),pageY:Number(y),pageWidth:tw,pageHeight:th,tileWidth:tw,tileHeight:th}));
}
/** The Phase 1 parser uses the same recorded crop-origin/DPI mapping for both adapters. */
export function aiImportManifest(m:AiManifest){
  return {preparationVersion:m.preparationVersion,source:{sourceSha256:m.sourceHash,page:m.pageNumber,fullPage:true,renderEngine:m.renderer,
    pdfDimensionsPoints:[m.nativeWidth,m.nativeHeight],imageDimensions:m.pageDimensions,renderDpi:m.renderScale*72},
    pageDimensions:m.pageDimensions,tiles:m.tiles};
}
