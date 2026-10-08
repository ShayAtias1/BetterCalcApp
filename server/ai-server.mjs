import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, validateSubmission, modelRequest, parseModelResponse, estimateCost, COST_RESERVATION_USD, MAX_BODY_BYTES } from './ai-pipeline.mjs';

function positive(value,fallback,max){const n=Number(value??fallback);if(!Number.isFinite(n)||n<=0||n>max)throw new Error('Invalid local AI limit configuration.');return n;}
export function createAiService({env=process.env,fetchProvider=fetch,ledgerPath=resolve('.ai-local/spending.json')}={}){
  if(env.OPENAI_MODEL && env.OPENAI_MODEL!==config.model)throw new Error('Only the frozen gpt-6.1-sol model is supported.');
  const requestCap=positive(env.AI_MAX_REQUESTS,20,1000),spendCap=positive(env.AI_SPEND_LIMIT_USD,20,1000);
  if(!Number.isInteger(requestCap))throw new Error('AI_MAX_REQUESTS must be an integer.');
  const origins=new Set((env.AI_ALLOWED_ORIGINS??'http://127.0.0.1:5173,http://localhost:5173').split(','));
  for(const origin of origins){const u=new URL(origin);if(!['localhost','127.0.0.1'].includes(u.hostname)||u.protocol!=='http:'||u.origin!==origin)throw new Error('AI_ALLOWED_ORIGINS must contain exact local HTTP origins.');}
  mkdirSync(dirname(ledgerPath),{recursive:true,mode:0o700});
  let ledger=existsSync(ledgerPath)?JSON.parse(readFileSync(ledgerPath,'utf8')):[];
  if(!Array.isArray(ledger)||ledger.some(e=>!e.requestId||!Number.isFinite(e.charge)||e.charge<0))throw new Error('Invalid spending ledger; refusing paid requests.');
  function saveLedger(){writeFileSync(ledgerPath+'.tmp',JSON.stringify(ledger),{mode:0o600});renameSync(ledgerPath+'.tmp',ledgerPath);}
  const jobs=new Map();let active=false;
  function status(job){return {id:job.id,requestId:job.requestId,status:job.status,error:job.error,result:job.result,metrics:job.metrics};}
  async function run(job,images){
    const start=Date.now();let measured=null;
    try{
      let body=JSON.stringify(modelRequest(images));images=null;
      const pending=fetchProvider('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(config.timeoutSeconds*1000)});
      body=null;
      const response=await pending;
      if(!response.ok){
        const messages={401:'OpenAI rejected the API key.',403:'OpenAI denied access to the configured model.',404:'The configured model is unavailable for this account.',429:'OpenAI rate or quota limit reached.'};
        throw new Error(messages[response.status]??`OpenAI request failed (HTTP ${response.status}).`);
      }
      const reader=response.body.getReader();let total=0;const chunks=[];
      while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>8_000_000){await reader.cancel();throw new Error('Provider response exceeded the size limit.');}chunks.push(value);}
      const raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      measured=estimateCost(raw);
      job.metrics={latencySeconds:(Date.now()-start)/1000,usage:raw.usage,estimatedCostUsd:measured,model:raw.model,serviceTier:raw.service_tier};
      if(raw.service_tier && !['default','standard'].includes(raw.service_tier))throw new Error('Provider returned an unexpected service tier.');
      job.result=parseModelResponse(raw);job.status='COMPLETED';
    }catch(error){
      job.status='FAILED';
      // Only our own fixed errors are sent to the client. Never provider bodies/headers/secrets.
      const message=error?.message??'';
      job.error=/^(OpenAI |Provider |Expected one |Missing or duplicate |The configured )/.test(message)?message:
        error?.name==='TimeoutError'?'OpenAI request timed out; it may still incur a charge. No automatic retry.':'Inference failed or returned invalid output. No automatic retry.';
    }finally{
      images=null;active=false;job.updatedAt=Date.now();
      const expiry=setTimeout(()=>jobs.delete(job.id),3600_000);expiry.unref();
      const entry=ledger.find(e=>e.requestId===job.requestId);
      if(entry){entry.status=job.status;if(measured!==null)entry.charge=measured;try{saveLedger();}catch{job.status='FAILED';job.result=undefined;job.error='Spending ledger could not be saved. Restart and inspect the local service.';}}
    }
  }
  const server=http.createServer(async(req,res)=>{
    const reply=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try{
      const host=new URL(`http://${req.headers.host}`).hostname;
      if(!['127.0.0.1','localhost'].includes(host))return reply(403,{error:'Invalid local host.'});
      let origin=req.headers.origin;
      if(!origin && req.headers.referer){try{origin=new URL(req.headers.referer).origin;}catch{}}
      if(!origins.has(origin))return reply(403,{error:'Request origin is not allowed.'});
      res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
      if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST');res.setHeader('Access-Control-Allow-Headers','Content-Type, X-BetterCalc-AI');res.writeHead(204);return res.end();}
      if(req.headers['x-bettercalc-ai']!=='1')return reply(403,{error:'Missing local AI request header.'});
      const url=new URL(req.url,'http://localhost');
      // Expire only terminal job imagery-free outputs. Paid admission identities stay in the ledger.
      for(const [id,job] of jobs)if(job.status!=='PROCESSING'&&Date.now()-job.updatedAt>3600_000)jobs.delete(id);
      if(req.method==='GET'&&url.pathname==='/ai/health')return reply(200,{configured:!!env.OPENAI_API_KEY,active,model:config.model,requestCap,spendCap,reservationUsd:COST_RESERVATION_USD});
      if(req.method==='GET'&&url.pathname.startsWith('/ai/space-jobs')){
        const requestId=url.searchParams.get('requestId');
        const id=url.pathname.split('/')[3];
        const job=requestId?[...jobs.values()].find(j=>j.requestId===requestId):jobs.get(id);
        if(job)return reply(200,status(job));
        if(ledger.some(e=>requestId?e.requestId===requestId:e.jobId===id))return reply(410,{error:'Job unavailable after a server restart or expiry. No inference was resubmitted.'});
        return reply(404,{error:'Job not found. No inference was resubmitted.'});
      }
      if(req.method!=='POST'||url.pathname!=='/ai/space-jobs')return reply(404,{error:'Unknown endpoint.'});
      if(req.headers['content-type']!=='application/json')return reply(415,{error:'Expected application/json.'});
      if(Number(req.headers['content-length'])>MAX_BODY_BYTES)return reply(413,{error:'Image payload exceeds the input limit.'});
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY_BYTES){reply(413,{error:'Image payload exceeds the input limit.'});req.resume();return;}chunks.push(chunk);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,{error:'Invalid JSON request.'});}
      if(Object.keys(body??{}).some(k=>!['requestId','manifest','images'].includes(k)))return reply(400,{error:'Unknown request fields; model and upstream are fixed.'});
      validateSubmission(body);
      const previous=ledger.find(e=>e.requestId===body.requestId);
      if(previous){const job=jobs.get(previous.jobId);return job?reply(200,status(job)):reply(410,{error:'This paid submission was already admitted. It will not be rerun.'});}
      if(!env.OPENAI_API_KEY || env.OPENAI_API_KEY==='YOUR_OPENAI_API_KEY')return reply(503,{error:'Set OPENAI_API_KEY in the local service environment.'});
      if(active)return reply(409,{error:'One AI inference is already running. Wait for it to finish.'});
      if(ledger.length>=requestCap)return reply(429,{error:'Local request cap reached.'});
      if(ledger.reduce((sum,e)=>sum+e.charge,0)+COST_RESERVATION_USD>spendCap)return reply(429,{error:'Local spending cap cannot reserve this request. Increase it explicitly if desired.'});
      const job={id:randomUUID(),requestId:body.requestId,status:'PROCESSING',createdAt:Date.now(),updatedAt:Date.now()};
      ledger.push({requestId:job.requestId,jobId:job.id,status:'PROCESSING',charge:COST_RESERVATION_USD});
      try{saveLedger();}catch{ledger.pop();return reply(503,{error:'Cannot write spending ledger; no inference submitted.'});}
      jobs.set(job.id,job);active=true;
      reply(202,status(job));
      // Safe only in this long-lived Node process. Never copy detached work into a short-lived function.
      void run(job,body.images);
    }catch(error){reply(error.statusCode??500,{error:error.statusCode===400?error.message:'Local AI service failed; no automatic retry.'});}
  });
  server.requestTimeout=30_000;server.headersTimeout=10_000;
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const port=positive(process.env.AI_PORT,4781,65535);
  if(!Number.isInteger(port))throw new Error('AI_PORT must be an integer.');
  createAiService().listen(port,'127.0.0.1',()=>console.info(`BetterCalc local AI service listening on 127.0.0.1:${port}. No inference runs until requested.`));
}
