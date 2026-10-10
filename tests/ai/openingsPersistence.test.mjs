import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {parseOpeningResult} from '../../src/lib/ai/openings.ts';
import {aiTiles,AI_PREPARATION_VERSION} from '../../src/lib/ai/contracts.ts';
const stores=new Map([['aiJobs',new Map([['room-id',{requestId:'room-id',status:'COMPLETED'}]])],['aiReviews',new Map([['room-review',{key:'room-review',candidates:['room']} ]])]]);
const transactions=[];let fail=false,openedVersion;
const getStore=(name)=>{if(!stores.has(name))stores.set(name,new Map());return stores.get(name);};
const adapter={
 put:async(name,value)=>getStore(name).set(value.requestId??value.key??value.id,structuredClone(value)),
 get:async(name,key)=>structuredClone(getStore(name).get(key)),getAll:async name=>structuredClone([...getStore(name).values()]),
 transaction(names,mode){
  transactions.push({names,mode});const staged=new Map(names.map(n=>[n,new Map(getStore(n))]));
  return {objectStore:name=>({get:async key=>structuredClone(staged.get(name).get(key)),put:async value=>{if(fail&&name==='openingsAiJobs')throw Error('write failed');staged.get(name).set(value.requestId??value.key??value.id,structuredClone(value));}}),
   get done(){for(const [name,values] of staged)stores.set(name,values);return Promise.resolve();}};
 }
};
await mock.module('idb',{namedExports:{openDB:async(_name,version,options)=>{openedVersion=version;options.upgrade({objectStoreNames:{contains:name=>stores.has(name)},createObjectStore:name=>getStore(name)});return adapter;}}});
const db=await import('../../src/db/database.ts');
const manifest={preparationVersion:AI_PREPARATION_VERSION,renderer:'embedpdf-pdfium',planId:'plan',pageNumber:1,sourceHash:'a'.repeat(64),nativeWidth:1417,nativeHeight:1276,rotation:0,userUnit:1,view:[0,0,1417,1276],pageDimensions:[5500,4953],renderScale:5500/1417,tiles:aiTiles(5500,4953),coordinateMapping:'native'};
import { result as result } from './fixtures/openings-synthetic.ts';
const review=parseOpeningResult(result,manifest,'job');
const job={task:'openings-v1',requestId:'openings-11111111-1111-1111-1111-111111111111',jobId:'job',planId:'plan',pageNumber:1,sourceHash:manifest.sourceHash,status:'COMPLETED',reviewKey:review.key,manifest,createdAt:1,updatedAt:1};
test('v6 adds isolated stores; completed drafts/provenance and job persist in one transaction',async()=>{
 const rooms=structuredClone([...stores.get('aiJobs')]),roomReviews=structuredClone([...stores.get('aiReviews')]);
 await db.saveCompletedOpeningsAiJob(job,review);assert.equal(openedVersion,6);
 assert.deepEqual(transactions.at(-1),{names:['openingsAiJobs','openingsAiReviews'],mode:'readwrite'});
 assert.deepEqual(await db.loadOpeningsAiReview(review.key),review);assert.deepEqual(await db.listOpeningsAiJobs(),[job]);
 assert.deepEqual([...stores.get('aiJobs')],rooms);assert.deepEqual([...stores.get('aiReviews')],roomReviews);
 const loaded=await db.loadOpeningsAiReview(review.key);loaded.candidates[0].geometry.endpointA.x=0;
 assert.deepEqual(await db.loadOpeningsAiReview(review.key),review);
});
test('duplicate completion preserves collected edits, and failed completion does not partially commit',async()=>{
 const edited=structuredClone(review);edited.candidates[0].geometry.endpointA.x=5;getStore('openingsAiReviews').set(review.key,edited);
 await db.saveCompletedOpeningsAiJob(job,review);assert.equal((await db.loadOpeningsAiReview(review.key)).candidates[0].geometry.endpointA.x,5);
 const other=parseOpeningResult(result,manifest,'other-job'),otherJob={...job,requestId:'openings-22222222-2222-2222-2222-222222222222',jobId:'other-job',reviewKey:other.key};
 fail=true;await assert.rejects(()=>db.saveCompletedOpeningsAiJob(otherJob,other));fail=false;
 assert.equal(await db.loadOpeningsAiReview(other.key),undefined);assert.equal((await db.listOpeningsAiJobs()).length,1);
 await assert.rejects(()=>db.saveCompletedOpeningsAiJob({...job,sourceHash:'wrong'},review));
 await assert.rejects(()=>db.saveOpeningsAiJob({...job,task:'rooms'}));
});

test('canonical imports and consumed review commit atomically; deletion/undo never resurrect suggestions',async()=>{
 const {PLAN_A}=await import('../takeoff/fixtures.ts');const plan={...structuredClone(PLAN_A),id:'plan'};
 const collected=await db.collectOpeningsAiReview(plan,review.key);assert.ok(collected);
 assert.deepEqual(transactions.at(-1),{names:['projects','openingsAiReviews'],mode:'readwrite'});
 assert.equal(getStore('projects').get('plan').openings.length,17);
 assert.equal(typeof (await db.loadOpeningsAiReview(review.key)).importedAt,'number');
 getStore('projects').set('plan',plan);assert.equal(await db.collectOpeningsAiReview(plan,review.key),undefined);
 assert.equal(getStore('projects').get('plan').openings,undefined);
});
