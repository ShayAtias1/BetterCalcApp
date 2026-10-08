import { create } from 'zustand';
import { loadPdfBlob, loadAiReview, updateAiReview, saveAiJob, listAiJobs } from '../../db/database';
import { useAppStore } from '../../store/appStore';
import { subscribePdfBlobChanges } from '../pdfBlobEvents';
import { parseLocalAiResult } from '../localAiImport';
import { pdfFingerprint, prepareAiPage } from './preparePage';
import { submitSpaceJob, getSpaceJob, findSpaceJob } from './jobClient';
import { aiReviewKey, aiImportManifest, type AiJobRecord, type AiJobResponse } from './contracts';

export const useAiWorkflow=create<{jobs:AiJobRecord[];ready:boolean;error:string|null;sourceHash:string|null;resolvedIds:string[];reviewScope:{planId:string;pageNumber:number}|null}>(()=>({jobs:[],ready:false,error:null,sourceHash:null,resolvedIds:[],reviewScope:null}));
let initialization:Promise<void>|null=null;
let starting=false, epoch=0;
let binding:{planId:string;pageNumber:number;sourceHash:string;key:string}|null=null;
let writes:Promise<void>=Promise.resolve();
let pendingWrites=0;
const polling=new Set<string>();
const busy=(job:AiJobRecord)=>job.status==='PREPARING'||job.status==='PROCESSING';
function errorText(error:unknown){return error instanceof Error?error.message:'AI workflow failed.';}
function storageError(error:unknown){useAiWorkflow.setState({error:`AI local persistence failed: ${errorText(error)}`});}
function track(job:AiJobRecord){useAiWorkflow.setState(s=>({jobs:[...s.jobs.filter(j=>j.requestId!==job.requestId),job]}));}
async function record(job:AiJobRecord){await saveAiJob(job);track(job);}

export function initializeAiWorkflow():Promise<void>{
  if(!initialization)initialization=initialize();
  return initialization;
}
async function initialize(){
  if(typeof window!=='undefined')window.addEventListener('beforeunload',event=>{
    if(pendingWrites>0){event.preventDefault();event.returnValue='';}
  });
  // Existing edit/type/warning/approval actions are persisted, without changing Room/history writes.
  useAppStore.subscribe((next,previous)=>{
    if(!binding || next.project?.id!==binding.planId || next.currentPage!==binding.pageNumber ||
      next.project?.id!==previous.project?.id || next.currentPage!==previous.currentPage || next.detectionCandidates===previous.detectionCandidates)return;
    const current=binding;
    const candidates=structuredClone(next.detectionCandidates.filter(c=>c.localAi?.sourceHash===current.sourceHash));
    const removed=previous.detectionCandidates.filter(c=>c.localAi?.sourceHash===current.sourceHash && !candidates.some(n=>n.id===c.id)).map(c=>c.id);
    // A cache of the existing persisted tombstones, not a second approval/warning state.
    if(removed.length)useAiWorkflow.setState(s=>({resolvedIds:[...new Set([...s.resolvedIds,...removed])]}));
    pendingWrites++;
    writes=writes.catch(()=>undefined).then(()=>updateAiReview(current.key,old=>{
      const resolvedIds=[...new Set([...(old?.resolvedIds??[]),...removed])];
      // Preserve proposals inserted by a completing job while this UI snapshot was being saved.
      const merged=new Map((old?.candidates??[]).map(c=>[c.id,c]));
      for(const id of removed)merged.delete(id);
      for(const candidate of candidates)if(!resolvedIds.includes(candidate.id))merged.set(candidate.id,candidate);
      return {...current,candidates:[...merged.values()],resolvedIds,updatedAt:Date.now()};
    })).finally(()=>{pendingWrites--;});
    void writes.catch(storageError);
  });
  subscribePdfBlobChanges(id=>{
    if(id===`plan:${useAppStore.getState().project?.id}`){
      binding=null;++epoch;useAiWorkflow.setState({ready:false,sourceHash:null,resolvedIds:[],reviewScope:null});
      // Clearing proposals never alters approved Rooms.
      useAppStore.setState({selectedDetectionCandidateId:null,detectionCandidates:[],detectionCandidatesPage:null});
      const state=useAppStore.getState();if(state.project)void activateAiPage(state.project.id,state.currentPage);
    }
  });
  try{
    const jobs=await listAiJobs();useAiWorkflow.setState({jobs});
    for(const job of jobs){
      if(job.status==='PREPARING')await record({...job,status:'FAILED',updatedAt:Date.now(),error:'Page preparation was interrupted by refresh. Retry explicitly; no request was resubmitted.'});
      if(job.status==='PROCESSING')void poll(job);
    }
  }catch(error){storageError(error);}
}

export async function activateAiPage(planId:string,pageNumber:number){
  const token=++epoch;binding=null;useAiWorkflow.setState({ready:false,sourceHash:null,resolvedIds:[],reviewScope:null});
  try{
    await writes;
    const blob=await loadPdfBlob(planId);if(!blob)throw new Error('The local PDF could not be found.');
    const sourceHash=await pdfFingerprint(blob),key=aiReviewKey(planId,pageNumber,sourceHash);
    const review=await loadAiReview(key);
    const state=useAppStore.getState();
    if(token!==epoch||state.project?.id!==planId||state.currentPage!==pageNumber)return;
    // Filter trusted IDs as well as persistent review tombstones, including after an undo.
    const candidates=(review?.candidates??[]).filter(c=>c.localAi?.planId===planId && c.localAi.sourceHash===sourceHash && c.pageNumber===pageNumber && !review?.resolvedIds.includes(c.id) && !state.project?.rooms.some(r=>r.id===c.id));
    useAppStore.setState({selectedDetectionCandidateId:null,detectionCandidates:candidates,detectionCandidatesPage:candidates.length?pageNumber:null});
    binding={planId,pageNumber,sourceHash,key};useAiWorkflow.setState({ready:true,sourceHash,resolvedIds:review?.resolvedIds??[],reviewScope:{planId,pageNumber}});
  }catch(error){if(token===epoch)storageError(error);}
}

async function completed(job:AiJobRecord,response:AiJobResponse){
  const m=job.manifest;if(!m)throw new Error('Missing preparation manifest for the completed job.');
  const blob=await loadPdfBlob(job.planId);
  if(!blob||await pdfFingerprint(blob)!==job.sourceHash)throw new Error('The source PDF changed. This result cannot be attached to the replacement PDF.');
  const candidates=parseLocalAiResult(response.result,aiImportManifest(m),{planId:job.planId,sourceHash:job.sourceHash,importId:response.id,pageNumber:job.pageNumber,
    width:m.nativeWidth,height:m.nativeHeight,rotation:m.rotation,userUnit:m.userUnit,view:m.view});
  const key=aiReviewKey(job.planId,job.pageNumber,job.sourceHash);
  await writes;
  await updateAiReview(key,old=>{
    const resolvedIds=old?.resolvedIds??[];
    const merged=new Map((old?.candidates??[]).map(c=>[c.id,c]));
    for(const candidate of candidates)if(!resolvedIds.includes(candidate.id)&&!merged.has(candidate.id))merged.set(candidate.id,candidate);
    return {key,planId:job.planId,pageNumber:job.pageNumber,sourceHash:job.sourceHash,candidates:[...merged.values()],resolvedIds,updatedAt:Date.now()};
  });
  const updated={...job,jobId:response.id,status:'COMPLETED' as const,updatedAt:Date.now(),metrics:response.metrics,error:undefined};
  await record(updated);
  const state=useAppStore.getState();
  if(state.project?.id===job.planId && state.currentPage===job.pageNumber)await activateAiPage(job.planId,job.pageNumber);
}
async function poll(initial:AiJobRecord){
  if(polling.has(initial.requestId))return;
  polling.add(initial.requestId);let job=initial;
  try{
    while(true){
      try{
        const response=job.jobId?await getSpaceJob(job.jobId):await findSpaceJob(job.requestId);
        if(response.requestId!==job.requestId)throw new Error('Job response identity mismatch.');
        if(response.status==='COMPLETED'){
          try{await completed(job,response);}catch(error){await record({...job,status:'FAILED',updatedAt:Date.now(),error:errorText(error)});}
          return;
        }
        if(response.status==='FAILED'||response.status==='CANCELLED'){
          await record({...job,jobId:response.id,status:response.status,updatedAt:Date.now(),error:response.error??'Inference did not complete.',metrics:response.metrics});return;
        }
        if(!job.jobId){job={...job,jobId:response.id};await record(job);}
        useAiWorkflow.setState({error:null});
      }catch(error){
        const status=(error as {status?:number}).status;
        if(status===404||status===410){await record({...job,status:'FAILED',updatedAt:Date.now(),error:errorText(error)});return;}
        // Only repeat free GETs. Never retry a paid POST or silently discard completed results.
        useAiWorkflow.setState({error:errorText(error)});
        if(Date.now()-job.createdAt>60*60*1000){await record({...job,status:'FAILED',updatedAt:Date.now(),error:'Job recovery expired. Check the local service before retrying.'});return;}
      }
      await new Promise(resolve=>setTimeout(resolve,2500));
    }
  }finally{polling.delete(initial.requestId);}
}

/** Explicit user action only. A persisted request identity precedes any paid POST. */
export async function startAiDetection(){
  if(starting||!binding||!useAiWorkflow.getState().ready||useAiWorkflow.getState().jobs.some(busy))return;
  const source={...binding},state=useAppStore.getState();
  if(state.project?.id!==source.planId||state.currentPage!==source.pageNumber||state.detectionCandidates.some(c=>c.localAi))return;
  starting=true;useAiWorkflow.setState({error:null});
  let job:AiJobRecord={requestId:crypto.randomUUID(),planId:source.planId,pageNumber:source.pageNumber,sourceHash:source.sourceHash,status:'PREPARING',createdAt:Date.now(),updatedAt:Date.now()};
  let posted=false;
  try{
    await record(job);
    const blob=await loadPdfBlob(source.planId);if(!blob||await pdfFingerprint(blob)!==source.sourceHash)throw new Error('The source PDF changed before preparation.');
    const prepared=await prepareAiPage(source.planId,source.pageNumber,blob,source.sourceHash);
    const current=await loadPdfBlob(source.planId);if(!current||await pdfFingerprint(current)!==source.sourceHash)throw new Error('The source PDF changed during preparation.');
    job={...job,manifest:prepared.manifest,status:'PROCESSING',updatedAt:Date.now()};await record(job);
    posted=true;
    try{
      const response=await submitSpaceJob(job.requestId,prepared.manifest,prepared.images);
      job={...job,jobId:response.id};await record(job);
    }catch(error){
      if((error as {status?:number}).status){posted=false;throw error;}
      // The admission response may have been lost. Recover by requestId; NEVER resubmit.
      useAiWorkflow.setState({error:errorText(error)});
    }
    void poll(job);
  }catch(error){
    if(posted){useAiWorkflow.setState({error:errorText(error)});void poll(job);}
    else{job={...job,status:'FAILED',updatedAt:Date.now(),error:errorText(error)};try{await record(job);}catch(e){storageError(e);}track(job);}
  }finally{starting=false;}
}
