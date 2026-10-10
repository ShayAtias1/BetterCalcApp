import type { OpeningsPreview, OpeningsSubmission, OpeningsConsent, OpeningsJobResponse } from './openingsContracts';
async function request<T>(path:string,body?:unknown):Promise<T>{
  let response:Response;
  try{response=await fetch(path,{method:body?'POST':'GET',headers:{'X-BetterCalc-AI':'1',...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30_000)});}
  catch{throw new Error('Local AI service is unreachable. Recover an existing submission before starting another paid request.');}
  let value:Record<string,unknown>;
  try{
    const text=await response.text();
    if(!text.trim())throw new Error('Empty response');
    const parsed:unknown=JSON.parse(text);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Invalid response');
    value=parsed as Record<string,unknown>;
  }catch{
    // An empty proxy error is not proof of rejection. Omit definitive HTTP status so
    // a lost paid admission stays recoverable, rather than being marked safe to retry.
    throw new Error(`Local AI service returned an empty or invalid response (HTTP ${response.status}). Restart the local AI service; recover any existing submission before retrying.`);
  }
  if(!response.ok)throw Object.assign(new Error(typeof value.error==='string'?value.error:'Openings AI service failed.'),{status:response.status});
  return value as T;
}
export async function checkOpeningsService(){
  const health=await request<{supportedTasks?:string[];configured?:boolean}>('/ai/health');
  if(!health.supportedTasks?.includes('openings-v1'))throw new Error('The running local AI service is outdated. Restart npm run dev:ai before preparing openings detection. No paid request was submitted.');
  if(!health.configured)throw new Error('Configure the local AI service API key before preparing detection.');
}
export async function getOpeningsAdmission(requestId:string){
  const result=await request<{task:string;requestId:string;admitted:boolean}>(`/ai/opening-admissions?requestId=${encodeURIComponent(requestId)}`);
  if(result.task!=='openings-v1'||result.requestId!==requestId||typeof result.admitted!=='boolean')throw new Error('Invalid openings admission receipt. Recover before retrying.');
  return result.admitted;
}
export const previewOpeningsRequest=(body:OpeningsSubmission)=>request<OpeningsPreview>('/ai/opening-previews',body);
export const submitOpeningsJob=(body:OpeningsSubmission,consent:OpeningsConsent)=>request<OpeningsJobResponse>('/ai/opening-jobs',{...body,consent});
export const findOpeningsJob=(requestId:string)=>request<OpeningsJobResponse>(`/ai/opening-jobs?requestId=${encodeURIComponent(requestId)}`);
