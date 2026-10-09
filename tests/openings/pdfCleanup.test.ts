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
 const project={id:'project-1',name:'Test',createdAt:1,updatedAt:1};
 for(const language of ['en','he'] as const){
  const x=exportContext(language);
  for(const details of [false,true]){
   for(const scope of ['plan','project']){
    text.length=0;saved=null;
    if(scope==='plan')await exportQuantitiesToPdf(p,summaries,totals,{finishes:true,measurements:true,markups:true,concrete:false,rebar:false},undefined,content,language,details?{includeOpeningDetails:true}:undefined);
    else await exportProjectToPdf(project,[p],content,language,details?{includeOpeningDetails:true}:undefined);
    assert.ok(saved);const pdf=await PDFDocument.load(await (saved as Blob).arrayBuffer());assert.ok(pdf.getPageCount()>0);
    assert.equal(text.filter(value=>value===x.t('openingQuantities.schedule')).length,details?(scope==='plan'?2:1):0);
    assert.ok(!text.includes(x.t('openingQuantities.counts')));
    assert.ok(!text.includes(x.t('openingQuantities.exclusions')));
    assert.ok(!text.includes(x.t('exports.quantityPdf.openingsBlock')));
    assert.ok(!text.includes(x.t('exports.quantityPdf.deductionNote')));
   }
  }
 }
});
