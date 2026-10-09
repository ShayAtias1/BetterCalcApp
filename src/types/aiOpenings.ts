import type { Point } from './index';
import type { PlanOpening } from './openings';
import type { AiManifest } from '../lib/ai/contracts';

export const OPENINGS_AI_TASK = 'openings-v1';
export type OpeningDetectionType = 'hinged-door' | 'sliding-door' | 'doorway' | 'open-passage' | 'window' | 'unknown-opening';
export type OpeningTileId = 'TILE_A' | 'TILE_B' | 'TILE_C' | 'TILE_D';
export interface OpeningBox { x1:number; y1:number; x2:number; y2:number }
export interface RawOpeningDetection {
  openingId:string; type:OpeningDetectionType; geometryTile:OpeningTileId;
  endpointA:Point; endpointB:Point; bbox:OpeningBox; confidence:number;
  requiresReview:boolean; evidence:string[]; ambiguities:string[];
}
export interface RawDeferredOpening {
  geometryTile:OpeningTileId; bbox:OpeningBox; evidence:string[];
  reason:'CROSS_TILE_INCOMPLETE' | 'UNSUPPORTED_ENDPOINTS';
}
export interface OpeningDetectionResult {
  openings:RawOpeningDetection[]; deferred:RawDeferredOpening[]; coverageNotes:string[];
}
/** Immutable source evidence; model review flags never authorize approval. */
export interface AiOpeningProvenance {
  task:typeof OPENINGS_AI_TASK; baseline:'Vision-002 Original'; importId:string;
  candidateId:string; planId:string; pageNumber:number; sourceHash:string;
  manifest:AiManifest; original:RawOpeningDetection;
}
export interface AiOpeningCandidate {
  task:typeof OPENINGS_AI_TASK; id:string; pageNumber:number;
  geometry:NonNullable<PlanOpening['geometry']>; bbox:OpeningBox;
  classification:Pick<PlanOpening, 'kind' | 'mechanism' | 'walkableAccess'>;
  approval:{status:'draft'; reviewedAt:null}; requiresReview:true;
  provenance:AiOpeningProvenance;
}
export interface AiDeferredOpening {
  task:typeof OPENINGS_AI_TASK; id:string; pageNumber:number; geometry:null;
  bbox:OpeningBox; original:RawDeferredOpening; requiresReview:true;
}
/** Separate from room candidates/reviews. No store or UI integration in A4.1. */
export interface AiOpeningReview {
  importedAt?:number;
  task:typeof OPENINGS_AI_TASK; key:string; planId:string; pageNumber:number;
  sourceHash:string; importId:string; manifest:AiManifest;
  candidates:AiOpeningCandidate[]; deferred:AiDeferredOpening[];
  coverageNotes:string[];
}
