import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleBatchPages } from '../../src/lib/ai/batchQueue.ts';
import type { AiBatch } from '../../src/lib/ai/batchModel.ts';
function batch():AiBatch{return {id:'test',projectId:'project',createdAt:0,updatedAt:0,state:'running',calculations:['area'],pages:[1,2,3].map(pageNumber=>({planId:'plan',planName:'Plan',pageNumber,sourceHash:'sha',reviewKey:String(pageNumber),status:'queued'}))};}
test('mocked page jobs never overlap; cached pages are skipped',async()=>{
  const b=batch();b.pages[0].status='completed';
  let active=0;const calls:number[]=[];let writes=0;
  await scheduleBatchPages(b,async page=>{assert.equal(active++,0);calls.push(page.pageNumber);await new Promise(resolve=>setImmediate(resolve));active--;page.status='completed';},()=>false,async()=>{writes++;});
  assert.deepEqual(calls,[2,3]);assert.equal(b.state,'completed');assert.equal(writes,3);
});
test('stopping scheduling lets the current mocked request finish and preserves queued pages',async()=>{
  const b=batch();let stopped=false;const calls:number[]=[];
  await scheduleBatchPages(b,async page=>{calls.push(page.pageNumber);stopped=true;await Promise.resolve();page.status='completed';},()=>stopped,async()=>{});
  assert.deepEqual(calls,[1]);assert.deepEqual(b.pages.map(p=>p.status),['completed','queued','queued']);assert.equal(b.state,'paused');
});
test('failed or ambiguous requests are not retried; a deliberate resume can continue other queued pages',async()=>{
  const b=batch();const calls:number[]=[];
  await scheduleBatchPages(b,async page=>{calls.push(page.pageNumber);page.status='failed';},()=>false,async()=>{});
  assert.deepEqual(calls,[1]);assert.equal(b.state,'paused');
  await scheduleBatchPages(b,async page=>{calls.push(page.pageNumber);page.status='completed';},()=>false,async()=>{});
  assert.deepEqual(calls,[1,2,3]);assert.equal(b.pages[0].status,'failed');assert.equal(b.state,'completed');
});
test('a persistence failure stops before another page admission',async()=>{
  const b=batch();const calls:number[]=[];
  await assert.rejects(scheduleBatchPages(b,async page=>{calls.push(page.pageNumber);page.status='completed';},()=>false,async()=>{throw new Error('disk');}),/disk/);
  assert.deepEqual(calls,[1]);assert.equal(b.pages[1].status,'queued');
});
