import type { AiImage, AiManifest, AiJobResponse } from './contracts';
/** Transport boundary: the localhost proxy can later be replaced with protected production routes. */
async function request(path:string,options:RequestInit={}):Promise<AiJobResponse>{
  let response:Response;
  try{response=await fetch(path,{...options,headers:{'X-BetterCalc-AI':'1',...options.headers},signal:AbortSignal.timeout(30_000)});}
  catch{throw new Error('Local AI service is unreachable. A submitted job may still be running; it is not automatically resubmitted.');}
  let body;try{body=await response.json();}catch{throw new Error('Local AI service returned an invalid response. Start the service and restart the frontend.');}
  if(!response.ok)throw Object.assign(new Error(body.error??'Local AI request failed.'),{status:response.status});
  return body;
}
export function submitSpaceJob(requestId:string,manifest:AiManifest,images:AiImage[]){
  return request('/ai/space-jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,manifest,images})});
}
export function getSpaceJob(jobId:string){return request(`/ai/space-jobs/${encodeURIComponent(jobId)}`);}
export function findSpaceJob(requestId:string){return request(`/ai/space-jobs?requestId=${encodeURIComponent(requestId)}`);}
