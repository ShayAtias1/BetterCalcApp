import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkSpaceService,submitSpaceJob,getSpaceJob} from '../../src/lib/ai/jobClient.ts';
test('space transport handles proxy failures without declaring paid admission safe to retry',async()=>{
  const original=globalThis.fetch;
  try{
    for(const response of [new Response('',{status:502}),new Response('<html>error</html>',{status:500}),Response.json(null),Response.json([])]){
      globalThis.fetch=async()=>response;
      await assert.rejects(()=>submitSpaceJob('id',{},[]),error=>{assert.match(error.message,/empty or invalid/);assert.equal(error.status,undefined);return true;});
    }
    globalThis.fetch=async()=>Response.json({});
    await assert.rejects(()=>getSpaceJob('id'),/Invalid local AI job response/);
    globalThis.fetch=async()=>Response.json({error:'Already admitted'},{status:410});
    await assert.rejects(()=>getSpaceJob('id'),error=>error.status===410);
    globalThis.fetch=async(path,options)=>{assert.equal(path,'/ai/health');assert.equal(options.headers['X-BetterCalc-AI'],'1');return Response.json({configured:true,supportedTasks:['spaces']});};
    await checkSpaceService();
    globalThis.fetch=async()=>Response.json({configured:false,supportedTasks:['spaces']});
    await assert.rejects(()=>checkSpaceService(),/No paid request was submitted/);
  }finally{globalThis.fetch=original;}
});
