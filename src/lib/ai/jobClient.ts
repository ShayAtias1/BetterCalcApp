import type { AiImage, AiManifest, AiJobResponse } from './contracts';
/** Transport boundary: the localhost proxy can later be replaced with protected production routes. */
async function request(path:string,options:RequestInit={}):Promise<Record<string,unknown>>{
  let response:Response;
  try{response=await fetch(path,{...options,headers:{'X-BetterCalc-AI':'1',...options.headers},signal:AbortSignal.timeout(30_000)});}
  catch{throw new Error('Local AI service is unreachable. A submitted job may still be running; it is not automatically resubmitted.');}
  let body:Record<string,unknown>;
  try{
    const parsed:unknown=await response.json();
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Invalid response');
    body=parsed as Record<string,unknown>;
  }catch{throw new Error(`Local AI service returned an empty or invalid response (HTTP ${response.status}). Run npm run dev:ai from BetterCalc/app. Recover existing submissions before retrying.`);}
  if(!response.ok)throw Object.assign(new Error(typeof body.error==='string'?body.error:'Local AI request failed.'),{status:response.status});
  return body;
}
export async function checkSpaceService(){
  const health=await request('/ai/health');
  if(!Array.isArray(health.supportedTasks)||!health.supportedTasks.includes('spaces'))throw new Error('Restart npm run dev:ai: the local AI service does not support space detection. No paid request was submitted.');
  if(!health.configured)throw new Error('Configure the local AI service API key before detection. No paid request was submitted.');
}
async function jobRequest(path:string,options:RequestInit={}):Promise<AiJobResponse>{
  const body=await request(path,options);
  if(typeof body.id!=='string'||typeof body.requestId!=='string'||!['PROCESSING','COMPLETED','FAILED','CANCELLED'].includes(String(body.status)))throw new Error('Invalid local AI job response. Recover existing submissions before retrying.');
  return body as unknown as AiJobResponse;
}
export function submitSpaceJob(requestId:string,manifest:AiManifest,images:AiImage[]){
  return jobRequest('/ai/space-jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,manifest,images})});
}
export function getSpaceJob(jobId:string){return jobRequest(`/ai/space-jobs/${encodeURIComponent(jobId)}`);}
export function findSpaceJob(requestId:string){return jobRequest(`/ai/space-jobs?requestId=${encodeURIComponent(requestId)}`);}
