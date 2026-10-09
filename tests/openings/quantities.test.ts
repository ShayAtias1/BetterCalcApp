import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Plan, PlanOpening, WorkType } from '../../src/types/index.ts';
import { PLAN_A } from '../takeoff/fixtures.ts';
import { buildRoomSummaries, calculateWorkItem } from '../../src/lib/quantities.ts';
import { buildOpeningQuantityReport, openingReportTables } from '../../src/lib/openingQuantityReport.ts';
import { buildPlanQuantityReport, buildProjectQuantities } from '../../src/lib/projectQuantities.ts';
import { exportContext } from '../../src/lib/exportLanguage.ts';
import { buildQuantitiesWorkbook } from '../../src/lib/exportExcel.ts';
import { buildProjectWorkbook } from '../../src/lib/exportProjectExcel.ts';
import { en } from '../../src/i18n/en.ts';
import { he } from '../../src/i18n/he.ts';
function plan():Plan {
 const p=structuredClone(PLAN_A);p.pages={1:{pageNumber:1,calibration:{metersPerPixel:1,pixelDistance:1,realDistanceMeters:1}}};
 p.rooms=['left','right'].map(id=>({...p.rooms[0],id,name:id,points:[{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:0,y:4}],closed:true,openings:[],workItems:[{id:id+'-paint',type:'painting',heightM:3,wastePercent:10}]}));
 return p;
}
function opening(p:Plan,patch:Partial<PlanOpening>={}):PlanOpening {
 return {id:'door',planId:p.id,pageNumber:1,geometry:{endpointA:{x:0,y:1},endpointB:{x:1,y:1}},kind:'door',mechanism:'hinged',walkableAccess:'supported',roomIds:['left','right'],quantityReview:{associationsConfirmed:true,distinctLegacyRoomIds:[]},widthM:1,heightM:2,sillHeightM:0,quantity:1,source:'manual',legacyRefs:[],approval:{status:'approved',reviewedAt:1},createdAt:1,updatedAt:1,...patch};
}
const calc=(p:Plan,type:WorkType='painting',height=3,deductOpenings=true,room=0)=>calculateWorkItem({id:'item',type,heightM:height,deductOpenings},p.rooms[room],16,16,p);

test('one shared physical door is counted once and deducts both confirmed room faces, waste unchanged',()=>{
 const p=plan();p.openings=[opening(p)];
 assert.equal(calc(p).grossM2,48);assert.equal(calc(p).deductedM2,2);assert.equal(calc(p).netM2,46);assert.equal(calc(p,'painting',3,true,1).netM2,46);
 const r=buildOpeningQuantityReport(p);assert.equal(r.doors,1);assert.equal(r.schedule.length,1);assert.equal(r.incomplete,false);
 const summaries=buildRoomSummaries(p);assert.equal(summaries[0].extra.painting.orderM2,50.6);
 const project=buildProjectQuantities([p]);assert.equal(project.totals.find(t=>t.category==='painting')!.quantityM2,92);assert.equal(project.totals.find(t=>t.category==='painting')!.orderM2,101.2);
});

test('windows deduct only the vertical overlap with cladding/painting/plaster',()=>{
 const p=plan();p.openings=[opening(p,{kind:'window',mechanism:'fixed',walkableAccess:'unsupported',widthM:2,heightM:1,sillHeightM:1.2})];
 for(const type of ['cladding','painting','plaster'] as const)assert.ok(Math.abs(calc(p,type,1.5).deductedM2-.6)<1e-10);
 assert.equal(calc(p,'cladding',1).deductedM2,0);assert.equal(calc(p,'painting',3).deductedM2,2);
 assert.equal(calc(p,'panels',.1).deductedLengthM,0);
 assert.equal(buildOpeningQuantityReport(p).windows,1);
});

test('floor access doors/passages reduce skirting; raised base and disabled items do not',()=>{
 const p=plan();p.openings=[opening(p)];assert.equal(calc(p,'panels',.1).lengthM,15);assert.equal(calc(p,'panels',.1).netM2,1.5);
 p.openings=[opening(p,{kind:'open-passage',mechanism:'open'})];assert.equal(calc(p,'panels',.1).lengthM,15);
 p.openings=[opening(p,{sillHeightM:.05})];assert.equal(calc(p,'panels',.1).lengthM,16);
 assert.equal(calc(p,'painting',3,false).netM2,48);assert.equal(calc(p,'painting',3,false).openingAudit![0].reason,'disabled');
});

test('approval, association confirmation and every required dimension/count guard deductions',()=>{
 for(const patch of [{approval:{status:'draft',reviewedAt:null}},{quantityReview:{associationsConfirmed:false,distinctLegacyRoomIds:[]}},{widthM:null},{heightM:null},{sillHeightM:null},{quantity:null},{kind:'unknown'}] as Partial<PlanOpening>[]){
  const p=plan();p.openings=[opening(p,patch)];assert.equal(calc(p).deductedM2,0);assert.ok(buildOpeningQuantityReport(p).incomplete);assert.equal(buildPlanQuantityReport(p).status,'partial');
 }
 const p=plan();p.openings=[opening(p,{roomIds:[]})];assert.equal(calc(p).deductedM2,0);assert.equal(buildOpeningQuantityReport(p).doors,1);assert.ok(buildOpeningQuantityReport(p).incomplete);
});

test('legacy remains authoritative, links combine shared counts without changing historical finish quantities',()=>{
 const p=plan();for(const room of p.rooms)room.openings=[{id:room.id+'-old',type:'door',widthM:1,heightM:2,quantity:1}];
 const before=buildRoomSummaries(p);p.openings=[opening(p,{legacyRefs:p.rooms.map(r=>({roomId:r.id,openingId:r.openings![0].id}))})];
 assert.deepEqual(buildRoomSummaries(p),before);assert.equal(buildOpeningQuantityReport(p).doors,1);assert.equal(buildOpeningQuantityReport(p).schedule.length,1);
 p.openings[0].widthM=2;p.openings[0].sillHeightM=1;assert.deepEqual(buildRoomSummaries(p),before);assert.ok(buildOpeningQuantityReport(p).incomplete);
 assert.equal(calc(p).openingAudit![0].reason,'legacyConflict');
});

test('ambiguous legacy overlap blocks canonical additions until explicit link or distinct confirmation',()=>{
 const p=plan();p.rooms[0].openings=[{id:'old',type:'door',widthM:1,heightM:2,quantity:1}];p.openings=[opening(p,{roomIds:['left']})];
 assert.equal(calc(p).deductedM2,2);assert.equal(calc(p).openingAudit![0].reason,'legacyUnresolved');assert.equal(buildOpeningQuantityReport(p).doors,1);
 p.openings[0].quantityReview!.distinctLegacyRoomIds=['left'];assert.equal(calc(p).deductedM2,4);assert.equal(buildOpeningQuantityReport(p).doors,2);
 p.openings[0].legacyRefs=[{roomId:'left',openingId:'old'}];p.openings[0].quantityReview!.distinctLegacyRoomIds=[];assert.equal(calc(p).deductedM2,2);assert.equal(buildOpeningQuantityReport(p).doors,1);
});

test('coincident canonical spans, repeated ids, excess deductions and missing scale are explicitly flagged',()=>{
 const p=plan(),first=opening(p);p.openings=[first,opening(p,{id:'duplicate',geometry:{endpointA:first.geometry!.endpointB,endpointB:first.geometry!.endpointA},createdAt:2})];
 assert.equal(calc(p).deductedM2,2);assert.equal(buildOpeningQuantityReport(p).doors,1);assert.ok(buildOpeningQuantityReport(p).incomplete);
 p.openings=[first,opening(p,{geometry:{endpointA:{x:2,y:1},endpointB:{x:3,y:1}}})];assert.equal(calc(p).deductedM2,0);
 p.openings=[opening(p,{widthM:100})];assert.equal(calc(p).netM2,0);assert.ok(calc(p).openingAudit!.some(a=>a.reason==='capped'));
 p.pages[1].calibration=null;assert.equal(calc(p).openingAudit![0].reason,'uncalibrated');assert.equal(buildRoomSummaries(p)[0].extra.painting.areaM2,null);
});

test('plan/project Excel and PDF table data share counts, schedules, dimensions, scopes and RTL/LTR text',async()=>{
 const p=plan();p.openings=[opening(p)];const p2=structuredClone(p);p2.id='second';p2.name='Second';p2.openings![0].planId=p2.id;
 for(const language of ['he','en'] as const){
  const x=exportContext(language),tables=openingReportTables([p,p2],x);assert.equal(tables[0].rows.at(-1)![1],'2');assert.equal(tables[1].rows.length,2);
  const workbook=buildQuantitiesWorkbook(buildRoomSummaries(p),[],language,undefined,p,new Set([1]));
  const schedule=workbook.getWorksheet(x.t('openingQuantities.schedule'))!;assert.equal(schedule.getRow(2).getCell(3).value,1);assert.equal(schedule.getRow(2).getCell(6).value,1);assert.equal(schedule.views[0].rightToLeft,language==='he');
  const bytes=await workbook.xlsx.writeBuffer();const loaded=new (await import('exceljs')).default.Workbook();await loaded.xlsx.load(bytes);assert.equal(loaded.getWorksheet(schedule.name)!.getRow(2).getCell(7).value,1);
  const project=buildProjectWorkbook({id:'project-1',name:'Project',createdAt:1,updatedAt:1},[p,p2],language);
  assert.equal(project.getWorksheet(x.t('openingQuantities.counts'))!.getRow(4).getCell(2).value,2);
  assert.deepEqual(openingReportTables([p],x,undefined,new Set([2])),[]);
 }
 assert.deepEqual(Object.keys(he.openingQuantities).sort(),Object.keys(en.openingQuantities).sort());
});

test('opening PDF tables serialize with existing writer and local Hebrew/Latin fonts, without browser or network',async()=>{
 const {PDFDocument}=await import('pdf-lib');const {default:fontkit}=await import('@pdf-lib/fontkit');const {readFile}=await import('node:fs/promises');
 Object.assign(globalThis,{DOMParser:class {parseFromString(){return {documentElement:{getAttribute:()=> '0 0 1 1'},querySelectorAll:()=>[]};}}});
 const {ReportWriter}=await import('../../src/lib/exportProjectPdf.ts');
 for(const language of ['he','en'] as const){
  const p=plan();p.openings=[opening(p)];const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
  const font=async(subset:string,weight:number)=>pdf.embedFont(await readFile(new URL(`../../node_modules/@fontsource/noto-sans-hebrew/files/noto-sans-hebrew-${subset}-${weight}-normal.woff`,import.meta.url)),{subset:true});
  const fonts={regular:{hebrew:await font('hebrew',400),latin:await font('latin',400)},bold:{hebrew:await font('hebrew',700),latin:await font('latin',700)}};
  const x=exportContext(language),writer=new ReportWriter(pdf,fonts,'Openings','Phase 3',x);
  for(const table of openingReportTables([p],x)){writer.section(table.title);writer.table(table.headers,table.widths,table.rows.map(cells=>({cells})));}
  const bytes=await pdf.save();const loaded=await PDFDocument.load(bytes);assert.ok(loaded.getPageCount()>0);assert.ok(bytes.length>1000);
 }
});

test('a transom above a door sharing jambs remains a separate physical window',()=>{
 const p=plan();p.openings=[opening(p),opening(p,{id:'transom',kind:'window',mechanism:'fixed',walkableAccess:'unsupported',heightM:.4,sillHeightM:2,createdAt:2})];
 const report=buildOpeningQuantityReport(p);assert.equal(report.doors,1);assert.equal(report.windows,1);assert.equal(report.incomplete,false);
 assert.ok(Math.abs(calc(p).deductedM2-2.4)<1e-10);
});

test('legacy ambiguity is not dismissed merely because its type differs from the canonical opening',()=>{
 const p=plan();p.rooms[0].openings=[{id:'old-window',type:'window',widthM:1,heightM:2,quantity:1}];p.openings=[opening(p,{roomIds:['left']})];
 assert.equal(calc(p).deductedM2,2);assert.equal(calc(p).openingAudit![0].reason,'legacyUnresolved');
 const report=buildOpeningQuantityReport(p);assert.equal(report.doors,0);assert.equal(report.windows,1);assert.ok(report.incomplete);
});

test('mixed legacy/canonical faces count one physical opening and require consistent shared dimensions',()=>{
 const p=plan();p.rooms[0].openings=[{id:'old',type:'door',widthM:1,heightM:2,quantity:1}];
 p.openings=[opening(p,{legacyRefs:[{roomId:'left',openingId:'old'}]})];
 assert.equal(calc(p).deductedM2,2);assert.equal(calc(p,'painting',3,true,1).deductedM2,2);assert.equal(buildOpeningQuantityReport(p).doors,1);
 p.openings[0].heightM=2.5;assert.equal(calc(p).deductedM2,2);assert.equal(calc(p,'painting',3,true,1).deductedM2,0);assert.equal(calc(p,'painting',3,true,1).openingAudit![0].reason,'legacyConflict');
 p.openings[0]=opening(p,{roomIds:[]});assert.equal(buildOpeningQuantityReport(p).doors,1);assert.ok(buildOpeningQuantityReport(p).incomplete);
});
