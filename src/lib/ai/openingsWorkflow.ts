import { parseOpeningResult, validateOpeningManifest } from './openings.ts';
import type { OpeningsJob, OpeningsConsent, OpeningsSubmission, OpeningsWorkflowDependencies } from './openingsContracts';

const message=(e:unknown)=>e instanceof Error?e.message:'Openings workflow failed.';
/** Independent openings lifecycle. Images are ephemeral; jobs and imagery-free reviews persist. */
export function createOpeningsWorkflow(d:OpeningsWorkflowDependencies){
  const prepared=new Map<string,OpeningsSubmission>();
  const submitting=new Set<string>();
  const polling=new Set<string>();
  const delay=d.pollDelay??(()=>new Promise<void>(resolve=>{
    const timer=setTimeout(resolve,2500);
    // Node tests/services may exit; browser timers have no unref method.
    (timer as unknown as {unref?:()=>void}).unref?.();
  }));
  function track(requestId:string){
    if(polling.has(requestId))return;
    polling.add(requestId);
    void (async()=>{
      try{
        while(true){
          await delay();
          const job=await recover(requestId);
          if(job.status!=='PROCESSING')return;
        }
      }finally{polling.delete(requestId);}
    })().catch(()=>undefined); // Durable PROCESSING identity remains available for explicit recovery after storage failure.
  }
  async function source(job:{planId:string;sourceHash:string}){
    const blob=await d.loadPdf(job.planId);
    if(!blob||await d.fingerprint(blob)!==job.sourceHash)throw new Error('The source PDF changed. Openings cannot attach to the replacement PDF.');
    return blob;
  }
  async function prepare(planId:string,pageNumber:number){
    await d.checkService?.(); // Detect a stale service before uploading five large images.
    const blob=await d.loadPdf(planId);if(!blob)throw new Error('The local PDF could not be found.');
    const sourceHash=await d.fingerprint(blob),now=Date.now();
    let previousPaidAttempt=false;
    if(d.admission){
      for(const previous of (await d.listJobs()).filter(j=>j.planId===planId&&j.pageNumber===pageNumber&&j.sourceHash===sourceHash&&j.consent&&j.status==='FAILED')){
        const admitted=await d.admission(previous.requestId); // Failure to inspect admission blocks a new attempt.
        if(admitted){
          await d.saveJob({...previous,status:'PROCESSING',admission:'admitted'});
          const recovered=await recover(previous.requestId);
          if(recovered.status!=='FAILED')throw new Error('An existing openings request was recovered. Review it before starting another paid request.');
          previousPaidAttempt=true;
        }else{
          if(previous.admission!=='not-admitted'&&Date.now()-(previous.submittedAt??previous.updatedAt)<90_000)throw new Error('The previous submission may still be in transit. Recover its status before starting another paid request.');
          await d.saveJob({...previous,admission:'not-admitted'});
        }
      }
    }
    let job:OpeningsJob={task:'openings-v1',requestId:d.requestId(),planId,pageNumber,sourceHash,status:'PREPARING',createdAt:now,updatedAt:now,previousPaidAttempt};
    if(!/^openings-[a-f0-9-]{36}$/.test(job.requestId))throw new Error('Invalid openings request namespace.');
    if((await d.listJobs()).some(j=>j.requestId===job.requestId))throw new Error('Openings request identity already exists.');
    await d.saveJob(job);
    try{
      const page=await d.prepare(planId,pageNumber,blob,sourceHash);validateOpeningManifest(page.manifest);
      if(page.manifest.planId!==planId||page.manifest.pageNumber!==pageNumber||page.manifest.sourceHash!==sourceHash)throw new Error('Openings preparation identity mismatch.');
      await source(job);
      const body:OpeningsSubmission={task:'openings-v1',requestId:job.requestId,...structuredClone(page)};
      const preview=await d.preview(body);
      if(preview.task!==job.task||preview.requestId!==job.requestId||!preview.previewId||!/^[a-f0-9]{64}$/.test(preview.requestDigest)||
        !Number.isFinite(preview.estimatedCostUsd)||preview.estimatedCostUsd<0||!Number.isFinite(preview.reservationUsd)||preview.reservationUsd<=0||preview.expiresAt<=Date.now())throw new Error('Invalid openings cost preview.');
      job={...job,status:'AWAITING_CONSENT',manifest:page.manifest,preview,updatedAt:Date.now()};
      await d.saveJob(job);prepared.set(job.requestId,body);
      return structuredClone(job); // Caller presents the cost and requests explicit consent later.
    }catch(e){await d.saveJob({...job,status:'FAILED',error:message(e),updatedAt:Date.now()});throw e;}
  }
  async function submit(requestId:string,consent:OpeningsConsent){
    if(submitting.has(requestId))throw new Error('Openings request submission already started.');
    submitting.add(requestId);
    try{
      let job=(await d.listJobs()).find(j=>j.requestId===requestId&&j.task==='openings-v1');
      const body=prepared.get(requestId),p=job?.preview;
      if(!job||job.status!=='AWAITING_CONSENT'||!body||!p)throw new Error('Prepared openings request unavailable; no paid resubmission.');
      if(consent?.approved!==true||consent.previewId!==p.previewId||consent.requestDigest!==p.requestDigest||p.expiresAt<=Date.now()||
        !Number.isFinite(consent.approvedAt)||consent.approvedAt<p.expiresAt-600_000||consent.approvedAt>Date.now()+1000)throw new Error('Explicit consent to the prepared openings request is required.');
      await source(job);
      job={...job,consent:structuredClone(consent),status:'PROCESSING',admission:'unknown',submittedAt:Date.now(),updatedAt:Date.now()};
      await d.saveJob(job); // Durable identity BEFORE paid admission. Never reset to consent state.
      prepared.delete(requestId);
      try{
        const response=await d.submit(body,consent);
        if(response.task!=='openings-v1'||response.requestId!==requestId||response.requestDigest!==p.requestDigest)throw new Error('Openings admission identity mismatch.');
        await d.saveJob({...job,jobId:response.id,admission:'admitted',updatedAt:Date.now()});
      }catch(e){
        // A lost/ambiguous POST response is recovered only with GET, including after refresh.
        const status=(e as {status?:number}).status;
        if(status&&[400,403,409,413,415,429,503].includes(status))await d.saveJob({...job,status:'FAILED',admission:'not-admitted',error:message(e),updatedAt:Date.now()});
        else await d.saveJob({...job,error:`Admission response unavailable: ${message(e)}. Recover by status; never resubmit.`,updatedAt:Date.now()});
      }
      const current=await recover(requestId);
      if(current.status==='PROCESSING')track(requestId);
      return current;
    }finally{submitting.delete(requestId);}
  }
  async function recover(requestId:string):Promise<OpeningsJob>{
    const job=(await d.listJobs()).find(j=>j.task==='openings-v1'&&j.requestId===requestId);
    if(!job)throw new Error('Unknown openings job.');
    if(job.status!=='PROCESSING')return job;
    try{
      const response=await d.find(requestId);
      if(response.task!=='openings-v1'||response.requestId!==requestId||response.requestDigest!==job.preview?.requestDigest||!response.id||(job.jobId&&job.jobId!==response.id))throw new Error('Openings status identity mismatch.');
      if(response.status==='COMPLETED'){
        await source(job);if(!job.manifest)throw new Error('Missing openings manifest.');
        if(job.manifest.planId!==job.planId||job.manifest.pageNumber!==job.pageNumber||job.manifest.sourceHash!==job.sourceHash)throw new Error('Openings manifest identity mismatch.');
        let review;
        try{review=parseOpeningResult(response.result,job.manifest,response.id);}catch(e){throw Object.assign(new Error(`Invalid openings result: ${message(e)}`),{terminal:true});}
        const updated:OpeningsJob={...job,jobId:response.id,admission:'admitted',status:'COMPLETED',reviewKey:review.key,metrics:response.metrics,error:undefined,updatedAt:Date.now()};
        await d.saveCompleted(updated,review);return updated;
      }
      if(response.status!=='PROCESSING'&&response.status!=='FAILED')throw new Error('Invalid openings job status.');
      const updated:OpeningsJob={...job,jobId:response.id,admission:'admitted',status:response.status,metrics:response.metrics,error:response.error,updatedAt:Date.now()};
      await d.saveJob(updated);return updated;
    }catch(e){
      const status=(e as {status?:number}).status;
      // Transient status/network/storage errors remain recoverable with another free GET.
      const inTransit=status===404&&d.admission&&Date.now()-(job.submittedAt??job.updatedAt)<90_000;
      const terminal=!inTransit&&((e as {terminal?:boolean}).terminal||status===404||status===410||message(e).includes('identity mismatch')||message(e).includes('source PDF changed')||Date.now()-job.createdAt>3600_000);
      const updated:OpeningsJob={...job,status:terminal?'FAILED':'PROCESSING',error:message(e),updatedAt:Date.now()};
      await d.saveJob(updated);return updated;
    }
  }
  async function resume(){
    for(const job of await d.listJobs()){
      if(job.task!=='openings-v1')continue;
      if(job.status==='PREPARING'||job.status==='AWAITING_CONSENT'){
        if(!prepared.has(job.requestId))await d.saveJob({...job,status:'FAILED',error:'Preparation/consent was interrupted. Prepare a new request explicitly; nothing was submitted.',updatedAt:Date.now()});
      }else if(job.status==='PROCESSING'){
        const current=await recover(job.requestId);
        if(current.status==='PROCESSING')track(job.requestId);
      }
    }
  }
  async function discard(requestId:string){
    const job=(await d.listJobs()).find(j=>j.requestId===requestId);
    if(!job||job.status!=='AWAITING_CONSENT')return;
    prepared.delete(requestId);
    await d.saveJob({...job,status:'FAILED',error:undefined,updatedAt:Date.now()});
  }
  return {prepare,submit,recover,resume,discard};
}
