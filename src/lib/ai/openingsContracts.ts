import type { AiImage, AiManifest, AiMetrics } from './contracts';
import type { AiOpeningReview } from '../../types/aiOpenings';
export interface OpeningsPreview {
  task:'openings-v1'; previewId:string; requestId:string; requestDigest:string; expiresAt:number;
  estimatedCostUsd:number; reservationUsd:number; currency:'USD'; pricingVerifiedDate:string; basis:string;
}
/** Supplied only following explicit owner consent; preparation/recovery never creates consent. */
export interface OpeningsConsent { approved:true; approvedAt:number; previewId:string; requestDigest:string }
export interface OpeningsJob {
  task:'openings-v1'; requestId:string; jobId?:string; planId:string; pageNumber:number; sourceHash:string;
  status:'PREPARING'|'AWAITING_CONSENT'|'PROCESSING'|'COMPLETED'|'FAILED';
  createdAt:number; updatedAt:number; manifest?:AiManifest; preview?:OpeningsPreview;
  consent?:OpeningsConsent; error?:string; metrics?:AiMetrics; reviewKey?:string;
  admission?:'admitted'|'not-admitted'|'unknown';
  previousPaidAttempt?:boolean;
  submittedAt?:number;
}
export interface OpeningsJobResponse {
  task:'openings-v1'; id:string; requestId:string; requestDigest:string;
  status:'PROCESSING'|'COMPLETED'|'FAILED'; result?:unknown; error?:string; metrics?:AiMetrics;
}
export interface OpeningsSubmission { task:'openings-v1'; requestId:string; manifest:AiManifest; images:AiImage[] }
export interface OpeningsWorkflowDependencies {
  loadPdf:(planId:string)=>Promise<Blob|undefined>;
  fingerprint:(blob:Blob)=>Promise<string>;
  prepare:(planId:string,pageNumber:number,blob:Blob,sourceHash:string)=>Promise<{manifest:AiManifest;images:AiImage[]}>;
  saveJob:(job:OpeningsJob)=>Promise<void>; listJobs:()=>Promise<OpeningsJob[]>;
  saveCompleted:(job:OpeningsJob,review:AiOpeningReview)=>Promise<void>;
  preview:(body:OpeningsSubmission)=>Promise<OpeningsPreview>;
  submit:(body:OpeningsSubmission,consent:OpeningsConsent)=>Promise<OpeningsJobResponse>;
  find:(requestId:string)=>Promise<OpeningsJobResponse>;
  requestId:()=>string;
  /** Injectable free-status polling delay for focused offline tests. */
  pollDelay?:()=>Promise<void>;
  checkService?:()=>Promise<void>;
  admission?:(requestId:string)=>Promise<boolean>;
}
