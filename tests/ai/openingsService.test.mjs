import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createAiService} from '../../server/ai-server.mjs';
import {aiTiles,AI_PREPARATION_VERSION} from '../../src/lib/ai/contracts.ts';
import {openingsModelRequest,OPENINGS_RESERVATION_USD} from '../../server/openings-pipeline.mjs';
import { response as raw, metadata as meta } from './fixtures/openings-synthetic.ts';
function submission(){
 const manifest={preparationVersion:AI_PREPARATION_VERSION,renderer:'embedpdf-pdfium',planId:'plan',pageNumber:1,sourceHash:meta.sourceSha256,nativeWidth:meta.pdfDimensionsPoints[0],nativeHeight:meta.pdfDimensionsPoints[1],renderScale:meta.renderDpi/72,rotation:0,userUnit:1,view:[0,0,...meta.pdfDimensionsPoints],pageDimensions:meta.pageDimensions,tiles:aiTiles(...meta.pageDimensions),coordinateMapping:'native = crop / scale'};
 const images=['PAGE',...manifest.tiles.map(t=>t.tileId)].map((name,i)=>{
  const [width,height]=i?[manifest.tiles[i-1].tileWidth,manifest.tiles[i-1].tileHeight]:manifest.pageDimensions;
  const png=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(width,16);png.writeUInt32BE(height,20);
  return {name,width,height,base64:png.toString('base64')};
 });
 return {task:'openings-v1',requestId:`openings-${randomUUID()}`,manifest,images};
}
const headers={Origin:'http://127.0.0.1:5173','X-BetterCalc-AI':'1','Content-Type':'application/json'};
async function service(t,provider,env={}){
 const dir=mkdtempSync(join(tmpdir(),'bc-openings-')),ledgerPath=join(dir,'ledger.json');
 const server=createAiService({env:{OPENAI_API_KEY:'mock',...env},fetchProvider:provider,ledgerPath});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 const post=(path,body)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});
 const get=path=>fetch(base+path,{headers});
 return {server,post,get,ledgerPath};
}
async function preview(s,body){const r=await s.post('/ai/opening-previews',body);assert.equal(r.status,200);return r.json();}
const consent=p=>({approved:true,approvedAt:Date.now(),previewId:p.previewId,requestDigest:p.requestDigest});
async function done(s,id){for(let i=0;i<100;i++){const r=await s.get('/ai/opening-jobs/'+id),j=await r.json();if(j.status!=='PROCESSING')return j;await new Promise(r=>setTimeout(r,5));}throw new Error('Mock job did not finish');}
test('free preview binds images and source; no consent, wrong consent or tampering makes zero provider calls',async t=>{
 let calls=0;const s=await service(t,async()=>{calls++;return Response.json(raw);});
 const body=submission(),p=await preview(s,body);
 assert.equal(p.estimatedCostUsd,.184275);assert.equal(p.reservationUsd,5.61);assert.ok(p.basis.includes('Historical'));assert.equal(calls,0);
 assert.equal(existsSync(s.ledgerPath),false);
 assert.equal((await s.post('/ai/opening-jobs',body)).status,400);
 assert.equal((await s.post('/ai/opening-jobs',{...body,consent:{...consent(p),approved:false}})).status,400);
 for(const mutate of [b=>{b.manifest.planId='other';},b=>{b.manifest.pageNumber=2;},b=>{const bytes=Buffer.from(b.images[0].base64,'base64');bytes[32]=1;b.images[0].base64=bytes.toString('base64');},b=>{b.requestId=`openings-${randomUUID()}`;}]){
  const bad=structuredClone(body);mutate(bad);assert.equal((await s.post('/ai/opening-jobs',{...bad,consent:consent(p)})).status,400);
 }
 assert.equal((await s.post('/ai/opening-jobs',{...body,consent:{...consent(p),approvedAt:1}})).status,400);
 assert.equal(calls,0);
});
test('one frozen ORIGINAL request, reserved before execution, separated status routes and idempotent recovery',async t=>{
 let calls=0,release;const gate=new Promise(r=>release=r);
 const s=await service(t,async(_url,options)=>{
  calls++;const ledger=JSON.parse(readFileSync(s.ledgerPath));assert.equal(ledger[0].charge,OPENINGS_RESERVATION_USD);assert.equal(ledger[0].task,'openings-v1');
  const payload=JSON.parse(options.body);assert.deepEqual(payload,openingsModelRequest(body.images));
  assert.equal(payload.input[0].content.filter(c=>c.type==='input_image'&&c.detail==='original').length,5);
  await gate;return Response.json(raw);
 });
 const body=submission(),p=await preview(s,body),paid={...body,consent:consent(p)};
 const admitted=await s.post('/ai/opening-jobs',paid);assert.equal(admitted.status,202);const job=await admitted.json();
 assert.equal((await s.post('/ai/opening-jobs',paid)).status,200);assert.equal(calls,1);
 assert.equal((await s.get('/ai/space-jobs/'+job.id)).status,404);
 assert.equal((await s.get('/ai/space-jobs?requestId='+body.requestId)).status,404);
 assert.equal((await s.post('/ai/space-jobs',{requestId:body.requestId,manifest:body.manifest,images:body.images})).status,400);
 assert.equal((await(await s.get('/ai/opening-jobs?requestId='+body.requestId)).json()).id,job.id);
 release();const result=await done(s,job.id);assert.equal(result.status,'COMPLETED');assert.equal(result.result.openings.length,17);assert.equal(result.metrics.estimatedCostUsd,.022);assert.equal(calls,1);
 assert.equal(JSON.parse(readFileSync(s.ledgerPath))[0].consent.reservationUsd,5.61);
 assert.equal((await(await s.get('/ai/opening-admissions?requestId='+body.requestId)).json()).admitted,true);
 await new Promise(r=>s.server.close(r));
 const restarted=createAiService({env:{OPENAI_API_KEY:'mock'},fetchProvider:async()=>{calls++;throw Error('must not run');},ledgerPath:s.ledgerPath});
 await new Promise(r=>restarted.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>restarted.close(r)));
 const base=`http://127.0.0.1:${restarted.address().port}`;
 assert.equal((await fetch(base+'/ai/opening-jobs?requestId='+body.requestId,{headers})).status,410);
 assert.equal((await(await fetch(base+'/ai/opening-admissions?requestId='+body.requestId,{headers})).json()).admitted,true);
 assert.equal((await fetch(base+'/ai/opening-jobs',{method:'POST',headers,body:JSON.stringify(paid)})).status,410);assert.equal(calls,1);
});
test('caps, missing credentials, malformed output and ambiguous failure never retry',async t=>{
 for(const scenario of ['missing','cap','network','malformed']){
  let calls=0;const s=await service(t,async()=>{calls++;if(scenario==='network')throw Error('network lost');return Response.json({...raw,status:'incomplete'});},scenario==='missing'?{OPENAI_API_KEY:''}:scenario==='cap'?{AI_SPEND_LIMIT_USD:1}:{});
  const b=submission(),p=await preview(s,b),r=await s.post('/ai/opening-jobs',{...b,consent:consent(p)});
  if(scenario==='missing'||scenario==='cap'){assert.equal(r.status,scenario==='missing'?503:429);assert.equal(calls,0);}
  else {const j=await r.json();assert.equal((await done(s,j.id)).status,'FAILED');await done(s,j.id);assert.equal(calls,1);if(scenario==='network')assert.equal(JSON.parse(readFileSync(s.ledgerPath))[0].charge,5.61);}
 }
});
test('expired cost previews require fresh consent and never reserve or infer',async t=>{
 let calls=0;const s=await service(t,async()=>{calls++;return Response.json(raw);}),body=submission(),p=await preview(s,body);
 const now=Date.now();t.mock.method(Date,'now',()=>now+600001);
 try{assert.equal((await s.post('/ai/opening-jobs',{...body,consent:consent(p)})).status,400);assert.equal(calls,0);assert.equal(existsSync(s.ledgerPath),false);}
 finally{t.mock.restoreAll();}
});
