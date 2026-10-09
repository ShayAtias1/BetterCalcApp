import { loadPdfBlob, saveOpeningsAiJob, listOpeningsAiJobs, saveCompletedOpeningsAiJob } from '../../db/database';
import { pdfFingerprint, prepareAiPage } from './preparePage';
import { previewOpeningsRequest, submitOpeningsJob, findOpeningsJob, checkOpeningsService, getOpeningsAdmission } from './openingsClient';
import { createOpeningsWorkflow } from './openingsWorkflow';

// No UI entry or automatic startup. Preparation and submission are separate explicit calls.
export const openingsAiService=createOpeningsWorkflow({loadPdf:loadPdfBlob,fingerprint:pdfFingerprint,prepare:prepareAiPage,
  saveJob:saveOpeningsAiJob,listJobs:listOpeningsAiJobs,saveCompleted:saveCompletedOpeningsAiJob,
  preview:previewOpeningsRequest,submit:submitOpeningsJob,find:findOpeningsJob,checkService:checkOpeningsService,admission:getOpeningsAdmission,requestId:()=>`openings-${crypto.randomUUID()}`});
