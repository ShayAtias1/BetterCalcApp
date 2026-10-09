import { validateOneClickSubmission, oneClickModelRequest, parseOneClickResponse } from './one-click-pipeline.mjs';
import { validateOpeningsSubmission, openingsModelRequest, parseOpeningsModelResponse, openingsRequestDigest, openingsCostPreview, OPENINGS_RESERVATION_USD, estimateOpeningsCost } from './openings-pipeline.mjs';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, validateSubmission, modelRequest, parseModelResponse, estimateCost, COST_RESERVATION_USD, MAX_BODY_BYTES } from './ai-pipeline.mjs';
import { requestAccounting, reportedAccounting } from './ai-accounting.mjs';

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
  const jobs=new Map(),previews=new Map();let active=false;
  function status(job){return {id:job.id,requestId:job.requestId,status:job.status,error:job.error,result:job.result,metrics:job.metrics,...(job.task==='openings-v1'?{task:job.task,requestDigest:job.requestDigest}: {})};}
  async function run(job,body){
    const start=Date.now();let measured=null;
    try{
      const pending=fetchProvider('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(config.timeoutSeconds*1000)});
      body=null;
      const response=await pending;
      const reader=response.body?.getReader();let total=0;const chunks=[];
      while(reader){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>8_000_000){await reader.cancel();throw new Error('Provider response exceeded the size limit.');}chunks.push(value);}
      let raw;
      try{raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{if(response.ok)throw new Error('Provider returned invalid JSON.');}
      if(raw && typeof raw==='object'){
        const knownModel=!raw.model||raw.model===config.model||typeof raw.model==='string'&&raw.model.startsWith(config.model+'-');
        measured=knownModel?(job.task==='openings-v1'?estimateOpeningsCost(raw):estimateCost(raw)):null;
        Object.assign(job.metrics,reportedAccounting(raw,measured));
      }
      if(!response.ok){
        const messages={401:'OpenAI rejected the API key.',403:'OpenAI denied access to the configured model.',404:'The configured model is unavailable for this account.',429:'OpenAI rate or quota limit reached.'};
        throw new Error(messages[response.status]??`OpenAI request failed (HTTP ${response.status}).`);
      }
      if(raw.service_tier && !['default','standard'].includes(raw.service_tier))throw new Error('Provider returned an unexpected service tier.');
      if(raw.model && raw.model!==config.model && !raw.model.startsWith(config.model+'-'))throw new Error('Provider returned an unexpected model.');
      job.result=job.task==='openings-v1'?parseOpeningsModelResponse(raw):job.oneClick?parseOneClickResponse(raw):parseModelResponse(raw);job.status='COMPLETED';
    }catch(error){
      job.status='FAILED';
      // Only our own fixed errors are sent to the client. Never provider bodies/headers/secrets.
      const message=error?.message??'';
      job.error=/^(OpenAI |Provider |Expected one |Missing or duplicate |The configured )/.test(message)?message:
        error?.name==='TimeoutError'?'OpenAI request timed out; it may still incur a charge. No automatic retry.':'Inference failed or returned invalid output. No automatic retry.';
    }finally{
      body=null;active=false;job.updatedAt=Date.now();
      Object.assign(job.metrics,{finishedAt:job.updatedAt,latencySeconds:(job.updatedAt-start)/1000,status:job.status});
      const expiry=setTimeout(()=>jobs.delete(job.id),3600_000);expiry.unref();
      const entry=ledger.find(e=>e.requestId===job.requestId);
      if(entry){entry.status=job.status;entry.metrics=job.metrics;if(measured!==null)entry.charge=measured;try{saveLedger();}catch{job.status='FAILED';job.metrics.status='FAILED';job.result=undefined;job.error='Spending ledger could not be saved. Restart and inspect the local service.';}}
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
      if(req.method==='GET'&&url.pathname==='/ai/health')return reply(200,{configured:!!env.OPENAI_API_KEY,active,model:config.model,requestCap,spendCap,reservationUsd:COST_RESERVATION_USD,supportedTasks:['spaces','openings-v1']});
      if(req.method==='GET'&&url.pathname==='/ai/opening-admissions'){
        const requestId=url.searchParams.get('requestId');
        if(!requestId?.startsWith('openings-'))return reply(400,{error:'Invalid openings request identity.'});
        const entry=ledger.find(e=>e.task==='openings-v1'&&e.requestId===requestId);
        return reply(200,{task:'openings-v1',requestId,admitted:!!entry,...(entry?{jobId:entry.jobId,status:entry.status,chargeUsd:entry.charge,metrics:entry.metrics}:{})});
      }
      const openingsRoute=url.pathname==='/ai/opening-jobs'||url.pathname.startsWith('/ai/opening-jobs/');
      if(req.method==='GET'&&(url.pathname.startsWith('/ai/space-jobs')||openingsRoute)){
        const requestId=url.searchParams.get('requestId');
        const id=url.pathname.split('/')[3];
        const job=requestId?[...jobs.values()].find(j=>j.requestId===requestId):jobs.get(id);
        if(job && (job.task==='openings-v1')===openingsRoute)return reply(200,status(job));
        const entry=ledger.find(e=>(e.task==='openings-v1')===openingsRoute&&(requestId?e.requestId===requestId:e.jobId===id));
        if(entry)return reply(410,{error:'Job unavailable after a server restart or expiry. No inference was resubmitted.',metrics:entry.metrics});
        return reply(404,{error:'Job not found. No inference was resubmitted.'});
      }
      const openingPreview=url.pathname==='/ai/opening-previews';
      if(req.method!=='POST'||(!openingsRoute&&!openingPreview&&url.pathname!=='/ai/space-jobs')|| (openingsRoute&&url.pathname!=='/ai/opening-jobs'))return reply(404,{error:'Unknown endpoint.'});
      if(req.headers['content-type']!=='application/json')return reply(415,{error:'Expected application/json.'});
      if(Number(req.headers['content-length'])>MAX_BODY_BYTES)return reply(413,{error:'Image payload exceeds the input limit.'});
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY_BYTES){reply(413,{error:'Image payload exceeds the input limit.'});req.resume();return;}chunks.push(chunk);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,{error:'Invalid JSON request.'});}
      const openingTask=openingsRoute||openingPreview;
      const allowed=openingTask?['task','requestId','manifest','images',...(openingPreview?[]:['consent'])]:['requestId','manifest','images'];
      if(Object.keys(body??{}).some(k=>!allowed.includes(k)))return reply(400,{error:'Unknown request fields; model and upstream are fixed.'});
      const oneClick=body.manifest?.preparationVersion==='one-click-v1';
      if(openingTask)validateOpeningsSubmission(body);else if(oneClick)validateOneClickSubmission(body);else validateSubmission(body);
      if(!openingTask&&body.requestId.startsWith('openings-'))return reply(400,{error:'Openings request identities cannot be used for room jobs.'});
      const digest=openingTask?openingsRequestDigest(body):undefined;
      for(const [id,p] of previews)if(p.expiresAt<Date.now())previews.delete(id);
      if(openingPreview){
        if(ledger.some(e=>e.requestId===body.requestId))return reply(410,{error:'Request already admitted; recover its job instead.'});
        if(previews.size>=100)return reply(429,{error:'Too many prepared previews.'});
        const preview={task:'openings-v1',previewId:randomUUID(),requestId:body.requestId,requestDigest:digest,expiresAt:Date.now()+600_000,...openingsCostPreview(body)};
        previews.set(preview.previewId,preview);return reply(200,preview);
      }
      const previous=ledger.find(e=>e.requestId===body.requestId);
      if(previous){
        if((previous.task==='openings-v1')!==openingsRoute||(openingsRoute&&previous.requestDigest!==digest))return reply(409,{error:'Request identity belongs to a different task or prepared payload.'});
        const job=jobs.get(previous.jobId);return job?reply(200,status(job)):reply(410,{error:'This paid submission was already admitted. It will not be rerun.'});
      }
      let consentPreview;
      if(openingsRoute){
        const consent=body.consent;consentPreview=previews.get(consent?.previewId);
        if(!consentPreview||consent?.approved!==true||consent.requestDigest!==digest||consentPreview.requestDigest!==digest||consentPreview.requestId!==body.requestId||!Number.isFinite(consent.approvedAt)||consent.approvedAt> Date.now()+1000||consent.approvedAt<consentPreview.expiresAt-600_000)return reply(400,{error:'Explicit consent to the current prepared openings request and cost preview is required.'});
      }
      if(!env.OPENAI_API_KEY || env.OPENAI_API_KEY==='YOUR_OPENAI_API_KEY')return reply(503,{error:'Set OPENAI_API_KEY in the local service environment.'});
      if(active)return reply(409,{error:'One AI inference is already running. Wait for it to finish.'});
      if(ledger.length>=requestCap)return reply(429,{error:'Local request cap reached.'});
      const reservation=openingsRoute?OPENINGS_RESERVATION_USD:COST_RESERVATION_USD;
      if(ledger.reduce((sum,e)=>sum+e.charge,0)+reservation>spendCap)return reply(429,{error:'Local spending cap cannot reserve this request. Increase it explicitly if desired.'});
      const job={id:randomUUID(),requestId:body.requestId,oneClick,...(openingsRoute?{task:'openings-v1',requestDigest:digest}:{}),status:'PROCESSING',createdAt:Date.now(),updatedAt:Date.now()};
      const payload=openingsRoute?openingsModelRequest(body.images):oneClick?oneClickModelRequest(body.images,body.manifest):modelRequest(body.images);
      job.metrics={...requestAccounting(payload,{requestId:job.requestId,detectionType:openingsRoute?'openings':'rooms',mode:openingsRoute?'openings-v1':oneClick?'one-click-v1':'full-page-v1',startedAt:job.createdAt,timeoutSeconds:config.timeoutSeconds,maxRetries:config.maxRetries}),status:job.status};
      ledger.push({requestId:job.requestId,jobId:job.id,status:'PROCESSING',charge:reservation,reservationUsd:reservation,metrics:job.metrics,...(openingsRoute?{task:'openings-v1',requestDigest:digest,consent:{previewId:consentPreview.previewId,approvedAt:body.consent.approvedAt,estimatedCostUsd:consentPreview.estimatedCostUsd,reservationUsd:reservation}}:{})});
      try{saveLedger();}catch{ledger.pop();return reply(503,{error:'Cannot write spending ledger; no inference submitted.'});}
      jobs.set(job.id,job);active=true;
      reply(202,status(job));
      // Safe only in this long-lived Node process. Never copy detached work into a short-lived function.
      void run(job,JSON.stringify(payload));
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
