import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkOpeningsService,getOpeningsAdmission,submitOpeningsJob,previewOpeningsRequest} from '../../src/lib/ai/openingsClient.ts';
const realFetch=globalThis.fetch;
test('empty/HTML/error responses are graceful; an invalid paid response is never proof of safe rejection',async()=>{
 try{
  for(const response of [new Response('',{status:400}),new Response('<html>Proxy error</html>',{status:502}),new Response('null',{status:200})]){
   globalThis.fetch=async()=>response;
   await assert.rejects(()=>submitOpeningsJob({},{}),e=>{assert.ok(e.message.includes('empty or invalid'));assert.equal(e.status,undefined);return true;});
  }
  globalThis.fetch=async()=>Response.json({error:'Budget cap'},{status:429});
  await assert.rejects(()=>previewOpeningsRequest({}),e=>e.status===429&&e.message==='Budget cap');
 }finally{globalThis.fetch=realFetch;}
});
test('service capability preflight detects stale process; admission receipts are bound to the saved request',async()=>{
 try{
  let calls=0;globalThis.fetch=async(path,options)=>{calls++;assert.equal(path,'/ai/health');assert.equal(options.method,'GET');return Response.json({configured:true});};
  await assert.rejects(()=>checkOpeningsService(),/outdated/);assert.equal(calls,1);
  globalThis.fetch=async()=>Response.json({configured:true,supportedTasks:['openings-v1']});await checkOpeningsService();
  globalThis.fetch=async()=>Response.json({task:'openings-v1',requestId:'openings-known',admitted:true});assert.equal(await getOpeningsAdmission('openings-known'),true);
  await assert.rejects(()=>getOpeningsAdmission('openings-other'),/Invalid openings admission/);
  globalThis.fetch=async()=>{throw Error('proxy disconnect');};await assert.rejects(()=>checkOpeningsService(),/unreachable/);
 }finally{globalThis.fetch=realFetch;}
});
