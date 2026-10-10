import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createAiService } from '../../server/ai-server.mjs';
import { modelRequest, parseModelResponse, validateSubmission, estimateCost, COST_RESERVATION_USD } from '../../server/ai-pipeline.mjs';
import { aiTiles, aiImportManifest, AI_PREPARATION_VERSION } from '../../src/lib/ai/contracts.ts';
import { parseLocalAiResult } from '../../src/lib/localAiImport.ts';
const frozen=JSON.parse(readFileSync(new URL('./frozen-spaces.json',import.meta.url)));
function submission(){
  const manifest={preparationVersion:AI_PREPARATION_VERSION,renderer:'embedpdf-pdfium',planId:'plan',pageNumber:1,sourceHash:'a'.repeat(64),nativeWidth:100,nativeHeight:80,renderScale:55,rotation:0,userUnit:1,view:[0,0,100,80],pageDimensions:[5500,4400],tiles:aiTiles(5500,4400)};
  // Header fixture only: provider calls are mocked; no real image/inference is submitted.
  const images=['PAGE',...manifest.tiles.map(t=>t.tileId)].map((name,i)=>{
    const [width,height]=i?[manifest.tiles[i-1].tileWidth,manifest.tiles[i-1].tileHeight]:manifest.pageDimensions;
    const png=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(width,16);png.writeUInt32BE(height,20);
    return {name,width,height,base64:png.toString('base64')};
  });
  return {requestId:randomUUID(),manifest,images};
}
const raw=()=>({status:'completed',model:'gpt-6.1-sol',service_tier:'default',usage:{input_tokens:1000,output_tokens:2000},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(frozen)}]}]});
const headers={'Origin':'http://127.0.0.1:5173','X-BetterCalc-AI':'1','Content-Type':'application/json'};
async function service(context,fetchProvider,env={}){
  const dir=mkdtempSync(join(tmpdir(),'bettercalc-ai-test-')),ledgerPath=join(dir,'spending.json');
  const server=createAiService({env:{OPENAI_API_KEY:'mock-test-key',...env},fetchProvider,ledgerPath});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  context.after(async()=>{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=body=>fetch(base+'/ai/space-jobs',{method:'POST',headers,body:JSON.stringify(body)});
  const get=id=>fetch(base+'/ai/space-jobs/'+id,{headers});
  return {server,post,get,base,ledgerPath};
}
async function done(get,id){for(let i=0;i<100;i++){const job=await (await get(id)).json();if(job.status!=='PROCESSING')return job;await new Promise(r=>setTimeout(r,5));}throw new Error('Mock job did not finish.');}

test('assets are byte-identical frozen copies; request stays five HIGH images, fixed model/limits/store:false',()=>{
  const provenance=JSON.parse(readFileSync(new URL('../../server/ai-assets/provenance.json',import.meta.url)));
  for(const [name,digest] of Object.entries(provenance.copiedAssetsSha256))assert.equal(createHash('sha256').update(readFileSync(new URL('../../server/ai-assets/'+name,import.meta.url))).digest('hex'),digest);
  const request=modelRequest(submission().images);
  assert.equal(request.model,'gpt-6.1-sol');assert.equal(request.reasoning.effort,'low');assert.equal(request.store,false);assert.equal(request.max_output_tokens,24000);
  assert.equal(request.input[0].content.filter(c=>c.type==='input_image'&&c.detail==='high').length,5);
  const m=submission().manifest;
  const candidates=parseLocalAiResult(parseModelResponse(raw()),aiImportManifest(m),{planId:m.planId,sourceHash:m.sourceHash,importId:'job',pageNumber:1,width:100,height:80,rotation:0,userUnit:1,view:m.view});
  assert.equal(candidates.length,frozen.spaces.length);
  candidates.forEach((c,i)=>{const tile=m.tiles.find(t=>t.tileId===frozen.spaces[i].geometryTile);assert.equal(c.points[0].x,(tile.pageX+frozen.spaces[i].polygon[0][0]*tile.pageWidth)/55);assert.equal(c.localAi.suggestedType,frozen.spaces[i].type);});
});
test('rejects incomplete/malformed outputs and altered crop policy; computes frozen token pricing',()=>{
  assert.throws(()=>parseModelResponse({...raw(),status:'incomplete'}));
  const malformed=raw();malformed.output[0].content[0].text=JSON.stringify({spaces:[{...frozen.spaces[0],extra:true}]});assert.throws(()=>parseModelResponse(malformed));
  const bad=submission();bad.manifest.tiles[0].pageWidth++;assert.throws(()=>validateSubmission(bad));
  assert.equal(estimateCost(raw()),.022);assert.ok(COST_RESERVATION_USD>.076);
});
test('local jobs return immediately, enforce origins/concurrency/idempotency and recover status without a second provider call',async context=>{
  let release,calls=0;
  const gate=new Promise(resolve=>{release=resolve;});
  const s=await service(context,async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(JSON.parse(options.body).store,false);await gate;return Response.json(raw());});
  const forbidden=await fetch(s.base+'/ai/space-jobs',{method:'POST',headers:{...headers,Origin:'https://untrusted.example'},body:'{}'});assert.equal(forbidden.status,403);
  const request=submission(),admission=await s.post(request);assert.equal(admission.status,202);const job=await admission.json();
  assert.equal((await s.post(request)).status,200);assert.equal((await s.post(submission())).status,409);assert.equal(calls,1);
  const recovered=await (await fetch(s.base+'/ai/space-jobs?requestId='+request.requestId,{headers})).json();assert.equal(recovered.id,job.id);
  release();const result=await done(s.get,job.id);assert.equal(result.status,'COMPLETED');assert.deepEqual(result.result,frozen);assert.equal(result.metrics.estimatedCostUsd,.022);assert.equal(calls,1);
  assert.equal((await s.post({...submission(),model:'other-model'})).status,400);
});
test('missing key and cap failures make no provider calls; ambiguous failures retain conservative charges',async context=>{
  let calls=0;
  const missing=await service(context,async()=>{calls++;throw new Error('must not call');},{OPENAI_API_KEY:''});assert.equal((await missing.post(submission())).status,503);assert.equal(calls,0);
  const s=await service(context,async()=>{calls++;throw new Error('simulated network interruption');},{AI_SPEND_LIMIT_USD:7});
  const admitted=await (await s.post(submission())).json();assert.equal((await done(s.get,admitted.id)).status,'FAILED');
  assert.equal((await s.post(submission())).status,429);assert.equal(calls,1);
  assert.equal(JSON.parse(readFileSync(s.ledgerPath))[0].charge,COST_RESERVATION_USD);
});
test('server restart never reruns a paid admission identity',async context=>{
  const s=await service(context,async()=>Response.json(raw()));const request=submission(),admitted=await(await s.post(request)).json();await done(s.get,admitted.id);
  await new Promise(resolve=>s.server.close(resolve));
  let calls=0;const restarted=createAiService({env:{OPENAI_API_KEY:'mock'},fetchProvider:async()=>{calls++;throw new Error('must not call');},ledgerPath:s.ledgerPath});
  await new Promise(resolve=>restarted.listen(0,'127.0.0.1',resolve));context.after(()=>new Promise(resolve=>restarted.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${restarted.address().port}/ai/space-jobs`,{method:'POST',headers,body:JSON.stringify(request)});assert.equal(response.status,410);assert.equal(calls,0);
});
