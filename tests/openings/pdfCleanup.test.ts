import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import {PDFDocument} from 'pdf-lib';
import {PLAN_A} from '../takeoff/fixtures.ts';
import {buildRoomSummaries,buildReportCategoryTotals} from '../../src/lib/quantities.ts';
import {exportContext} from '../../src/lib/exportLanguage.ts';
Object.assign(globalThis,{DOMMatrix:class{},DOMPoint:class{},DOMRect:class{},Path2D:class{},DOMParser:class{parseFromString(){return {documentElement:{getAttribute:()=> '0 0 1 1'},querySelectorAll:()=>[]};}}});
const text:string[]=[];
let saved:Blob|null=null;
mock.module('file-saver',{namedExports:{saveAs:(blob:Blob)=>{saved=blob;}}});
const original=await import('../../src/lib/pdfText.ts');
mock.module('../../src/lib/pdfText.ts',{namedExports:{...original,
 PdfPainter:class extends original.PdfPainter {
  fillText(...args:Parameters<InstanceType<typeof original.PdfPainter>['fillText']>){text.push(args[0]);super.fillText(...args);}
 },
 embedReportFonts:async(pdf:PDFDocument)=>{
  pdf.registerFontkit(fontkit);
  const font=async(subset:string,weight:number)=>pdf.embedFont(await readFile(new URL(`../../node_modules/@fontsource/noto-sans-hebrew/files/noto-sans-hebrew-${subset}-${weight}-normal.woff`,import.meta.url)),{subset:true});
  return {regular:{hebrew:await font('hebrew',400),latin:await font('latin',400)},bold:{hebrew:await font('hebrew',700),latin:await font('latin',700)}};
 }
}});
const {exportQuantitiesToPdf}=await import('../../src/lib/exportQuantitiesPdf.ts');
const {exportProjectToPdf}=await import('../../src/lib/exportProjectPdf.ts');

test('actual plan/project PDF exporters default to no opening schedule; opt-in adds it once in Hebrew and English',async()=>{
 const p=structuredClone(PLAN_A);p.rooms=p.rooms.filter(r=>r.id==='r-master');
 const summaries=buildRoomSummaries(p),totals=buildReportCategoryTotals(p,summaries);
 const content={plan:false,finishes:true,concrete:false,rebar:false};
 const project={id:'project-1',name:'Test',createdAt:1,updatedAt:1,planIds:[p.id]};
 for(const language of ['en','he'] as const){
  const x=exportContext(language);
  for(const details of [false,true]){
   for(const scope of ['plan','project']){
    text.length=0;saved=null;
    if(scope==='plan')await exportQuantitiesToPdf(p,summaries,totals,{finishes:true,measurements:true,markups:true,concrete:false,rebar:false},undefined,content,language,details?{includeOpeningDetails:true}:undefined);
    else await exportProjectToPdf(project,[p],content,language,details?{includeOpeningDetails:true}:undefined);
    assert.ok(saved);const pdf=await PDFDocument.load(await (saved as Blob).arrayBuffer());assert.ok(pdf.getPageCount()>0);
    // One continuous report: the schedule's title appears once, as its section heading, in both scopes.
    assert.equal(text.filter(value=>value===x.t('openingQuantities.schedule')).length,details?1:0);
    assert.ok(!text.includes(x.t('openingQuantities.counts')));
    assert.ok(!text.includes(x.t('openingQuantities.exclusions')));
    assert.ok(!text.includes(x.t('exports.quantityPdf.openingsBlock')));
    assert.ok(!text.includes(x.t('exports.quantityPdf.deductionNote')));
   }
  }
 }
});

test('PDF room matrix prints rooms once and a single integrated summary; project summary appears only for multiple plans',async()=>{
 const p=structuredClone(PLAN_A);p.measurements=[];
 const second=structuredClone(p);second.id='plan-second';second.name='Second plan';second.rooms=second.rooms.slice(0,1).map(r=>({...r,id:'second-room',name:'Second room'}));
 const content={plan:false,finishes:true,concrete:false,rebar:false};
 for(const language of ['he','en'] as const){
  const x=exportContext(language),summaries=buildRoomSummaries(p),totals=buildReportCategoryTotals(p,summaries);
  text.length=0;
  await exportQuantitiesToPdf(p,summaries,totals,{finishes:true,measurements:true,markups:true,concrete:false,rebar:false},undefined,content,language);
  for(const room of p.rooms)assert.equal(text.filter(v=>v===room.name).length,1);
  assert.equal(text.filter(v=>v===x.t('exports.common.total')).length,1);
  assert.ok(!text.includes(x.t('workCatalog.unassigned')));
  assert.ok(!text.includes(x.t('exports.projectPdf.summary')));
  assert.ok(!text.includes(x.t('exports.quantityPdf.schedule.byType')));
  assert.equal(text.filter(v=>v===x.t('exports.quantityPdf.columns.details')).length,1);
  assert.equal(text.filter(v=>v===x.t('exports.quantityPdf.columns.openings')).length,1);
  assert.equal(text.filter(v=>v===x.t('exports.common.notes')).length,1);
  assert.ok(text.join(' ').includes(`1 ${x.t('openingQuantities.doors')} / 2 ${x.t('openingQuantities.windows')}`));
  text.length=0;
  await exportProjectToPdf({id:'project-1',name:'Test',createdAt:1,updatedAt:1,planIds:[p.id,second.id]},[p,second],content,language);
  assert.equal(text.filter(v=>v===x.t('exports.projectPdf.summary')).length,1);
  assert.equal(text.filter(v=>v===x.t('exports.common.total')).length,2);
  assert.ok(saved);assert.equal((await PDFDocument.load(await (saved as Blob).arrayBuffer())).getPageCount(),1);
 }
});

test('long PDF matrices repeat paired headers after page breaks without repeating room rows or the total',async()=>{
 const p=structuredClone(PLAN_A);p.measurements=[];p.rooms=Array.from({length:65},(_,i)=>({...structuredClone(p.rooms[0]),id:`room-${i}`,name:`Room ${i+1}`}));
 const x=exportContext('en'),summaries=buildRoomSummaries(p);
 text.length=0;
 await exportQuantitiesToPdf(p,summaries,buildReportCategoryTotals(p,summaries),{finishes:true,measurements:true,markups:true,concrete:false,rebar:false},undefined,{plan:false,finishes:true,concrete:false,rebar:false},'en');
 assert.ok(saved);const pages=(await PDFDocument.load(await (saved as Blob).arrayBuffer())).getPageCount();
 assert.ok(pages>=3);
 assert.equal(text.filter(v=>v===x.t('exports.common.apartment')).length,pages);
 assert.equal(text.filter(v=>v===x.t('exports.common.total')).length,1);
 for(const room of p.rooms)assert.equal(text.filter(v=>v===room.name).length,1);
});

test('PDF material breakdown preserves partial-allocation and over-allocation warnings without duplicate room details',async()=>{
 const {withCatalogEntries}=await import('../../src/lib/workCatalog.ts');
 const base=structuredClone(PLAN_A);base.rooms=base.rooms.slice(0,1);base.measurements=[];
 base.rooms[0].workItems=base.rooms[0].workItems.filter(w=>w.type==='painting');
 const p=withCatalogEntries(base,{specs:[{id:'white',categoryId:'builtin:painting',name:'White paint',createdAt:1,updatedAt:1}]});
 const content={plan:false,finishes:true,concrete:false,rebar:false};
 for(const quantity of [10,1000]){
  p.rooms[0].workItems[0].allocations=[{id:'a',specId:'white',quantity}];
  text.length=0;
  const x=exportContext('en'),summaries=buildRoomSummaries(p);
  await exportQuantitiesToPdf(p,summaries,buildReportCategoryTotals(p,summaries),{finishes:true,measurements:true,markups:true,concrete:false,rebar:false},undefined,content,'en');
  assert.equal(text.filter(v=>v==='White paint').length,1);
  assert.equal(text.filter(v=>v===p.rooms[0].name).length,1);
  if(quantity===10)assert.ok(text.includes(x.t('workCatalog.sources.unassigned')));
  else assert.ok(text.some(v=>v.includes('Allocations exceed the calculated quantity')));
 }
});
