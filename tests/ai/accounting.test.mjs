import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createAiService} from '../../server/ai-server.mjs';
import {reportedAccounting,requestAccounting} from '../../server/ai-accounting.mjs';
import {modelRequest,estimateCost,COST_RESERVATION_USD} from '../../server/ai-pipeline.mjs';
import {aiTiles,AI_PREPARATION_VERSION} from '../../src/lib/ai/contracts.ts';
import {targetCrop} from '../../src/lib/ai/oneClick.ts';
const spaces=JSON.parse(readFileSync(new URL('./frozen-spaces.json',import.meta.url)));
import { response as openings } from './fixtures/openings-synthetic.ts';
const headers={Origin:'http://127.0.0.1:5173','X-BetterCalc-AI':'1','Content-Type':'application/json'};
const usage={input_tokens:1000,output_tokens:2000,input_tokens_details:{cached_tokens:200,cache_write_tokens:100},output_tokens_details:{reasoning_tokens:1200}};
function submission(mode){
  const manifest={preparationVersion:AI_PREPARATION_VERSION,renderer:'embedpdf-pdfium',planId:'plan',pageNumber:1,sourceHash:'a'.repeat(64),nativeWidth:100,nativeHeight:80,renderScale:55,rotation:0,userUnit:1,view:[0,0,100,80],pageDimensions:[5500,4400],tiles:aiTiles(5500,4400),coordinateMapping:'native = crop / scale'};
  if(mode==='one-click-v1')Object.assign(manifest,{preparationVersion:mode,targetPoint:{x:50,y:40},crop:targetCrop(5500,4400,{x:50,y:40},55),tiles:[]});
  const frames=mode==='one-click-v1'?[['PAGE',5500,4400],['TARGET_CROP',manifest.crop.tileWidth,manifest.crop.tileHeight]]:
    [['PAGE',5500,4400],...manifest.tiles.map(t=>[t.tileId,t.tileWidth,t.tileHeight])];
  const images=frames.map(([name,width,height])=>{
    const png=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(width,16);png.writeUInt32BE(height,20);
    return {name,width,height,base64:png.toString('base64')};
  });
  return {requestId:(mode==='openings-v1'?'openings-':'')+randomUUID(),manifest,images,...(mode==='openings-v1'?{task:mode}:{})};
}
async function harness(t,provider){
  const dir=mkdtempSync(join(tmpdir(),'bc-accounting-')),ledgerPath=join(dir,'ledger.json');
  const servers=[];
  async function start(fetchProvider){
    const server=createAiService({env:{OPENAI_API_KEY:'mock'},fetchProvider,ledgerPath});servers.push(server);
    await new Promise(r=>server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${server.address().port}`;
  }
  let base=await start(provider);
  t.after(async()=>{for(const s of servers)if(s.listening)await new Promise(r=>s.close(r));rmSync(dir,{recursive:true,force:true});});
  return {ledger:()=>JSON.parse(readFileSync(ledgerPath)),post:(path,b)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(b)}),
    get:path=>fetch(base+path,{headers}),restart:async()=>{await new Promise(r=>servers[0].close(r));base=await start(async()=>{throw Error('Recovery must not infer');});}};
}
async function finish(s,path,id){
  for(let i=0;i<100;i++){const j=await(await s.get(path+'/'+id)).json();if(j.status!=='PROCESSING')return j;await new Promise(r=>setTimeout(r,5));}
  throw Error('Mock job did not finish');
}
test('unknown token counts stay unknown; provider subsets never add a second reasoning charge',()=>{
  const m=requestAccounting(modelRequest([]),{requestId:'id',detectionType:'rooms',mode:'full-page-v1',startedAt:1});
  assert.equal(m.inputTokens,null);assert.equal(m.estimatedCostUsd,null);
  const raw={usage,service_tier:'default'},cost=estimateCost(raw);
  assert.equal(cost,(700*2+200*.1+100*2.5+2000*10)/1e6);
  assert.equal(reportedAccounting(raw,cost).reasoningTokens,1200);
  assert.equal(reportedAccounting({},null).cachedTokens,null);
  assert.equal(reportedAccounting({usage:{input_tokens:-1,output_tokens:NaN}},null).inputTokens,null);
  assert.equal(estimateCost({usage:{...usage,input_tokens_details:{cached_tokens:1001}}}),null);
});
for(const mode of ['full-page-v1','one-click-v1','openings-v1'])test(`${mode}: persists settings, provider usage, cost and duration once across refresh/restart`,async t=>{
  let calls=0,release;const gate=new Promise(r=>release=r);
  const result=mode==='openings-v1'?openings:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(mode==='one-click-v1'?{status:'UNCERTAIN',reason:'Mock uncertainty',space:null}:spaces)}]}]};
  const raw={...result,id:'resp-mock',model:'gpt-6.1-sol',service_tier:'default',usage};
  const s=await harness(t,async()=>{calls++;await gate;return Response.json(raw);});
  const body=submission(mode),path=mode==='openings-v1'?'/ai/opening-jobs':'/ai/space-jobs';
  if(mode==='openings-v1'){
    const p=await(await s.post('/ai/opening-previews',body)).json();body.consent={approved:true,approvedAt:Date.now(),previewId:p.previewId,requestDigest:p.requestDigest};
  }
  const admitted=await s.post(path,body);assert.equal(admitted.status,202);const job=await admitted.json();
  const reserved=s.ledger()[0];assert.equal(reserved.status,'PROCESSING');assert.equal(reserved.metrics.mode,mode);assert.equal(reserved.metrics.estimatedCostUsd,null);
  assert.equal(reserved.metrics.settings.reasoning.effort,'low');assert.equal(reserved.metrics.settings.maxOutputTokens,24000);
  assert.equal(reserved.metrics.settings.timeoutSeconds,420);assert.equal(reserved.metrics.settings.maxRetries,0);
  assert.deepEqual(reserved.metrics.settings.imageDetails,[mode==='openings-v1'?'original':'high']);
  assert.equal((await s.post(path,body)).status,200);release();const done=await finish(s,path,job.id);
  assert.equal(done.status,'COMPLETED');const entries=s.ledger();assert.equal(entries.length,1);const entry=entries[0],m=entry.metrics;
  assert.equal(m.requestId,body.requestId);assert.equal(m.detectionType,mode==='openings-v1'?'openings':'rooms');assert.equal(m.providerRequestId,'resp-mock');
  assert.equal(m.inputTokens,1000);assert.equal(m.outputTokens,2000);assert.equal(m.cachedTokens,200);assert.equal(m.reasoningTokens,1200);assert.equal(m.usageSource,'provider');
  assert.equal(m.status,'COMPLETED');assert.ok(m.latencySeconds>=0);assert.ok(m.finishedAt>=m.startedAt);assert.equal(entry.charge,m.estimatedCostUsd);assert.deepEqual(done.metrics,m);
  for(let i=0;i<3;i++)await s.get(path+'?requestId='+body.requestId);
  await s.restart();const recovered=await s.get(path+'?requestId='+body.requestId);assert.equal(recovered.status,410);assert.deepEqual((await recovered.json()).metrics,m);
  assert.equal((await s.post(path,body)).status,410);assert.equal(calls,1);assert.deepEqual(s.ledger(),entries);
});
for(const failure of ['network','http','invalid','missing-usage','unknown-tier'])test(`accounting survives ${failure} without retries or invented usage`,async t=>{
  let calls=0;const s=await harness(t,async()=>{
    calls++;if(failure==='network')throw Error('offline');
    return Response.json({status:'incomplete',model:'gpt-6.1-sol',service_tier:failure==='unknown-tier'?'flex':'default',...(failure==='missing-usage'?{}:{usage})},{status:failure==='http'?429:200});
  });
  const body=submission('full-page-v1'),path='/ai/space-jobs',j=await(await s.post(path,body)).json(),done=await finish(s,path,j.id);
  assert.equal(done.status,'FAILED');const entry=s.ledger()[0],m=entry.metrics;assert.equal(m.status,'FAILED');assert.ok(m.latencySeconds>=0);assert.ok(m.finishedAt>=m.startedAt);
  if(['network','missing-usage'].includes(failure)){assert.equal(m.inputTokens,null);assert.equal(m.usageSource,null);}else assert.equal(m.inputTokens,1000);
  if(['network','missing-usage','unknown-tier'].includes(failure)){assert.equal(m.estimatedCostUsd,null);assert.equal(entry.charge,COST_RESERVATION_USD);}else assert.equal(entry.charge,estimateCost({usage}));
  await s.post(path,body);await s.get(path+'/'+j.id);assert.equal(calls,1);assert.equal(s.ledger().length,1);
});
