import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {targetCrop,parseOneClickResult,candidateGeometryProblems,overlapNotes} from '../../src/lib/ai/oneClick.ts';
import {validateOneClickSubmission,oneClickModelRequest,parseOneClickResponse} from '../../server/one-click-pipeline.mjs';
import {createAiService} from '../../server/ai-server.mjs';
function submission(rotation=0){
 const targetPoint={x:50,y:40},manifest={preparationVersion:'one-click-v1',renderer:'embedpdf-pdfium',planId:'plan',pageNumber:1,sourceHash:'a'.repeat(64),nativeWidth:100,nativeHeight:80,rotation,userUnit:1,view:[0,0,100,80],pageDimensions:[5500,4400],renderScale:55,tiles:[],targetPoint,crop:targetCrop(5500,4400,targetPoint,55)};
 const images=['PAGE','TARGET_CROP'].map((name,i)=>{const [width,height]=i?[manifest.crop.tileWidth,manifest.crop.tileHeight]:manifest.pageDimensions;const png=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(width,16);png.writeUInt32BE(height,20);return {name,width,height,base64:png.toString('base64')};});
 return {requestId:randomUUID(),manifest,images};
}
const found={status:'FOUND',reason:'Visible wall boundary.',space:{polygon:[[.2,.2],[.8,.2],[.8,.8],[.2,.8]],type:'bedroom',geometryConfidence:'MEDIUM',ambiguities:['Review door closure.']}};
const raw=result=>({status:'completed',model:'gpt-6.1-sol',service_tier:'default',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]});
test('targeted two-image request binds exact point and supports geometry beyond the crop',()=>{
 const body=submission();validateOneClickSubmission(body);
 const req=oneClickModelRequest(body.images,body.manifest);
 assert.equal(req.model,'gpt-6.1-sol');assert.equal(req.store,false);assert.equal(req.input[0].content.filter(c=>c.type==='input_image').length,2);
 const context=JSON.parse(req.input[0].content[1].text.split('TARGET_POINT AND FRAMES: ')[1]);assert.deepEqual(context.targetPageNormalized,[.5,.5]);assert.deepEqual(context.targetCropPixels,[1500,1500]);
 for(const rotation of [0,90,180,270]){const m=submission(rotation).manifest,c=parseOneClickResult(parseOneClickResponse(raw(found)),m,'job',[])[0];assert.deepEqual(c.points,[{x:20,y:16},{x:80,y:16},{x:80,y:64},{x:20,y:64}]);assert.deepEqual(c.validationProblems,[]);assert.equal(c.localAi.targetPoint.x,50);}
 const edge=targetCrop(5500,4400,{x:1,y:79},55);assert.equal(edge.pageX,0);assert.equal(edge.pageY,1400);
});
test('uncertainty produces no draft; malformed output and tampered input fail closed',()=>{
 const body=submission();const uncertain={status:'UNCERTAIN',reason:'Walls obscured.',space:null};assert.deepEqual(parseOneClickResult(parseOneClickResponse(raw(uncertain)),body.manifest,'job',[]),[]);
 assert.throws(()=>parseOneClickResponse(raw({...found,space:null})));
 assert.throws(()=>parseOneClickResponse(raw({...found,spaces:[found.space]})));
 const bad=structuredClone(body);bad.manifest.crop.pageX++;assert.throws(()=>validateOneClickSubmission(bad));
 bad.manifest=structuredClone(body.manifest);bad.manifest.targetPoint.x=Infinity;assert.throws(()=>validateOneClickSubmission(bad));
 bad.manifest=structuredClone(body.manifest);bad.images.reverse();assert.throws(()=>validateOneClickSubmission(bad));
});
test('geometry checks block missed target, page overflow and self-crossing without repairs; overlaps warn',()=>{
 const m=submission().manifest,c=parseOneClickResult(found,m,'job',[])[0];
 assert.ok(candidateGeometryProblems([{x:1,y:1},{x:2,y:1},{x:2,y:2}],c.localAi).some(p=>p.includes('target point')));
 assert.ok(candidateGeometryProblems([{x:-1,y:1},{x:2,y:1},{x:2,y:2}],c.localAi).some(p=>p.includes('outside')));
 assert.ok(candidateGeometryProblems([{x:20,y:16},{x:80,y:64},{x:80,y:16},{x:20,y:64}],c.localAi).some(p=>p.includes('intersecting')));
 const room={id:'existing',name:'Bedroom',pageNumber:1,points:c.points};assert.equal(overlapNotes(c.points,[room],1).length,1);
 const adjacent={...room,points:[{x:80,y:16},{x:90,y:16},{x:90,y:64},{x:80,y:64}]};assert.deepEqual(overlapNotes(c.points,[adjacent],1),[]);
 assert.equal(parseOneClickResult(found,m,'job',[room])[0].localAi.overlapWarnings.length,1);
});
test('One-Click uses shared localhost admission, limits, recovery and idempotency with a mocked provider',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'one-click-test-'));let calls=0,release;const gate=new Promise(resolve=>{release=resolve;});
 const server=createAiService({env:{OPENAI_API_KEY:'mock',AI_MAX_REQUESTS:'1'},ledgerPath:join(dir,'ledger.json'),fetchProvider:async(_url,options)=>{calls++;const req=JSON.parse(options.body);assert.equal(req.text.format.name,'one_click_target_space_v1');assert.equal(req.input[0].content.filter(c=>c.type==='input_image').length,2);await gate;return Response.json(raw(found));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{release();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}/ai/space-jobs`,headers={Origin:'http://127.0.0.1:5173','X-BetterCalc-AI':'1','Content-Type':'application/json'},body=submission();
 const post=b=>fetch(base,{method:'POST',headers,body:JSON.stringify(b)});
 const response=await post(body);assert.equal(response.status,202);const job=await response.json();assert.equal((await post(body)).status,200);assert.equal(calls,1);
 release();let result;
 for(let i=0;i<100;i++){result=await(await fetch(base+'?requestId='+body.requestId,{headers})).json();if(result.status!=='PROCESSING')break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(result.status,'COMPLETED');assert.deepEqual(result.result,found);assert.equal(result.id,job.id);assert.equal((await post(submission())).status,429);assert.equal(calls,1);
});
