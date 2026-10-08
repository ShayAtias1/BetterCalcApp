import { scheduleBatchPages } from './batchQueue';
import { create } from 'zustand';
import { listAiBatches, saveAiBatch, loadPdfBlob, loadAiReview } from '../../db/database';
import { ViewerPdfDocument } from '../pdfViewerSource';
import { pdfFingerprint } from './preparePage';
import { aiReviewKey } from './contracts';
import { initializeAiWorkflow, startAiPageDetection, useAiWorkflow } from './workflow';
import { reusableJob, type AiBatch, type BatchPage, type Calculation } from './batchModel';
import type { Plan } from '../../types';

export const useAiBatches=create<{batches:AiBatch[];error:string|null;ready:boolean}>(()=>({batches:[],error:null,ready:false}));
let initialization:Promise<void>|undefined;
let running=false;
const stopped=new Set<string>();
function message(e:unknown){return e instanceof Error?e.message:String(e);}
async function write(batch:AiBatch){
  await saveAiBatch(batch);
  useAiBatches.setState(s=>({batches:[...s.batches.filter(b=>b.id!==batch.id),batch]}));
}
export function initializeBatches(){
  return initialization??= (async()=>{
    await initializeAiWorkflow();
    const batches=await listAiBatches();
    for(const batch of batches)await write({...batch,state:batch.state==='running'?'paused':batch.state});
    await reconcileJobs();
    useAiWorkflow.subscribe((next,previous)=>{if(next.jobs!==previous.jobs&&!running)void reconcileJobs().catch(e=>useAiBatches.setState({error:message(e)}));});
    useAiBatches.setState({ready:true});
  })().catch(e=>{useAiBatches.setState({error:message(e)});throw e;});
}
/** Polling may finish recovered jobs while the scheduler remains paused. */
async function reconcileJobs(){
  if(!navigator.locks)return;
  await navigator.locks.request('bettercalc-ai-batch',{ifAvailable:true},async lock=>{
    if(!lock||running)return;
    await reconcileStoredJobs();
  });
}
async function reconcileStoredJobs(){
  for(const stored of await listAiBatches()){
    if(running)return;
    let changed=false;
    const pages=stored.pages.map(page=>{
      const job=useAiWorkflow.getState().jobs.find(j=>j.requestId===page.requestId);
      if(page.status==='processing'&&job&&['COMPLETED','FAILED','CANCELLED'].includes(job.status)){
        changed=true;return {...page,status:job.status==='COMPLETED'?'completed' as const:'failed' as const,error:job.error};
      }
      return page;
    });
    if(changed&&!running)await write({...stored,pages,state:pages.every(p=>p.status==='completed'||p.status==='failed')?'completed':stored.state,updatedAt:Date.now()});
  }
}
export async function inspectBatchPlans(plans:Plan[]){
  const result:{plan:Plan;count:number;sourceHash:string}[]=[];
  for(const plan of plans){
    const blob=await loadPdfBlob(plan.id);if(!blob)continue;
    const doc=await ViewerPdfDocument.open(()=>Promise.resolve(blob),new AbortController().signal);
    try{result.push({plan,count:doc.numPages,sourceHash:await pdfFingerprint(blob)});}finally{doc.dispose();}
  }
  return result;
}
export async function prepareBatch(projectId:string,selection:{plan:Plan;pageNumber:number;sourceHash:string}[],calculations:Calculation[]):Promise<AiBatch>{
  await initializeBatches();
  const pages:BatchPage[]=[];
  const seen=new Set<string>();
  for(const s of selection){
    const reviewKey=aiReviewKey(s.plan.id,s.pageNumber,s.sourceHash);
    if(seen.has(reviewKey))continue;seen.add(reviewKey);
    const page:BatchPage={planId:s.plan.id,planName:s.plan.name,pageNumber:s.pageNumber,sourceHash:s.sourceHash,reviewKey,status:'queued'};
    const job=reusableJob(useAiWorkflow.getState().jobs,page),review=await loadAiReview(reviewKey);
    if(review&&(job||review.candidates.length||review.resolvedIds.length)){page.status='completed';page.requestId=job?.requestId;}
    pages.push(page);
  }
  if(!pages.length||!calculations.length)throw new Error('Select pages and calculations.');
  return {id:crypto.randomUUID(),projectId,calculations,pages,state:'paused',createdAt:Date.now(),updatedAt:Date.now()};
}
export function stopBatch(id:string){stopped.add(id);}
function terminal(requestId:string):Promise<void>{
  return new Promise(resolve=>{
    const done=()=>{const j=useAiWorkflow.getState().jobs.find(j=>j.requestId===requestId);return j&&['COMPLETED','FAILED','CANCELLED'].includes(j.status);};
    if(done()){resolve();return;}
    const unsubscribe=useAiWorkflow.subscribe(()=>{if(done()){unsubscribe();resolve();}});
  });
}
/** Explicit confirmation/resume only. Refresh restores polling, never calls this scheduler. */
export async function runBatch(input:AiBatch){
  if(running)return;
  running=true;stopped.delete(input.id);useAiBatches.setState({error:null});
  let batch=structuredClone(input);
  let acquired=false;
  const execute=async()=>{
    batch.state='running';await write(batch);
    await scheduleBatchPages(batch,async page=>{
      const blob=await loadPdfBlob(page.planId);
      if(!blob||await pdfFingerprint(blob)!==page.sourceHash){page.status='failed';page.error='Source PDF changed or was removed.';return;}
      if(page.requestId){
        const known=useAiWorkflow.getState().jobs.find(j=>j.requestId===page.requestId);
        if(!known){page.status='failed';page.error='Interrupted submission; no paid request was resubmitted.';return;}
      }else{
        // Recheck cache immediately before admission; another single-page run may have completed.
        const reuse=reusableJob(useAiWorkflow.getState().jobs,page);
        const review=await loadAiReview(page.reviewKey);
        if(review&&(reuse||review.candidates.length||review.resolvedIds.length)){page.requestId=reuse?.requestId;page.status='completed';return;}
        if(useAiWorkflow.getState().jobs.some(j=>j.status==='PROCESSING'||j.status==='PREPARING'))throw new Error('An AI job is active. Resume when it finishes.');
        page.requestId=crypto.randomUUID();page.status='processing';
        await write({...batch,updatedAt:Date.now()}); // durable identity before any paid POST
        // Existing service POST atomically checks active job, request cap and spending ledger
        // before EVERY paid inference. No new admission path or limit override.
        await startAiPageDetection(page,page.requestId);
      }
      await terminal(page.requestId);
      const job=useAiWorkflow.getState().jobs.find(j=>j.requestId===page.requestId)!;
      page.status=job.status==='COMPLETED'?'completed':'failed';page.error=job.error;
    },()=>stopped.has(batch.id),()=>write({...batch,updatedAt:Date.now()}));
  };
  try{
    // Prevent two tabs from scheduling the same persisted batch at once.
    if(!navigator.locks)throw new Error('Batch scheduling requires browser Web Locks support.');
    await navigator.locks.request('bettercalc-ai-batch',{ifAvailable:true},async lock=>{
      if(!lock)throw new Error('Another tab is scheduling an AI batch.');
      acquired=true;
      batch=structuredClone((await listAiBatches()).find(b=>b.id===input.id)??input);
      await execute();
    });
  }catch(e){
    useAiBatches.setState({error:message(e)});batch.state='paused';
    try{if(acquired)await write({...batch,updatedAt:Date.now()});}catch(storage){useAiBatches.setState({error:message(storage)});}
  }finally{running=false;}
}
