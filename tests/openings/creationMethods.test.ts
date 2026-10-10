import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {PLAN_A} from '../takeoff/fixtures.ts';
import {quantityOpeningInput} from '../../src/lib/manualOpenings.ts';
import {validatePlanOpening,addPlanOpening,reviewPlanOpening} from '../../src/lib/planOpenings.ts';
import {buildOpeningQuantityReport,openingQuantityFeedback,openingPdfSchedule,openingPdfDeductions} from '../../src/lib/openingQuantityReport.ts';
import {buildRoomSummaries} from '../../src/lib/quantities.ts';
import {exportContext} from '../../src/lib/exportLanguage.ts';
Object.assign(globalThis,{DOMMatrix:class{},DOMPoint:class{},DOMRect:class{},Path2D:class{}});
const {useAppStore}=await import('../../src/store/appStore.ts');
const state=()=>useAppStore.getState();
after(()=>state().setProject(null));
function plan(){const p=structuredClone(PLAN_A);p.rooms=p.rooms.filter(r=>r.id==='r-master');p.rooms[0].openings=[];return p;}

test('quantity-only creation stays draft, needs explicit consent, and uses the same room-side calculator without coordinates',()=>{
 const p=plan(),before=buildRoomSummaries(p);state().setProject(p);
 const input=quantityOpeningInput(p,'r-master','door',{widthM:1,heightM:2,sillHeightM:0,quantity:1});
 const id=state().addPlanOpening(input)!;
 const opening=()=>state().project!.openings!.find(o=>o.id===id)!;
 assert.equal(opening().geometry,null);assert.equal(opening().approval.status,'draft');assert.equal(opening().entryMethod,'takeoff');
 assert.deepEqual(buildRoomSummaries(state().project!),before);
 assert.equal(validatePlanOpening(state().project!,opening()).canApprove,true);
 state().approvePlanOpening(id);assert.equal(openingQuantityFeedback(state().project!,opening()).affects,false);
 state().updatePlanOpening(id,{walkableAccess:'supported',quantityReview:{associationsConfirmed:true,distinctLegacyRoomIds:[]}});
 state().approvePlanOpening(id);
 const report=buildOpeningQuantityReport(state().project!);
 assert.equal(report.doors,1);assert.equal(report.work.find(w=>w.type==='painting')!.deducted,2);assert.equal(report.work.find(w=>w.type==='panels')!.deducted,1);
 state().undo();assert.equal(opening().approval.status,'draft');state().redo();assert.equal(opening().approval.status,'approved');
 const physical={...opening(),entryMethod:'plan' as const,geometry:{endpointA:{x:1,y:2},endpointB:{x:65,y:2}}};
 const withDrawing={...state().project!,openings:[physical]};
 assert.deepEqual(buildRoomSummaries(withDrawing),buildRoomSummaries(state().project!));
});

test('coordinate-free approval is explicit; existing geometry-less records and legacy rows are not converted',()=>{
 const p=plan(),input=quantityOpeningInput(p,'r-master','window',{widthM:1,heightM:1,sillHeightM:1,quantity:1});
 const {entryMethod:_,...old}=input;
 const legacy=addPlanOpening(p,old,'old',1);
 assert.equal(validatePlanOpening(legacy,legacy.openings![0]).canApprove,false);
 assert.throws(()=>reviewPlanOpening(legacy,'old','approved',2));
 const next=addPlanOpening(p,input,'new',1);
 assert.equal(validatePlanOpening(next,next.openings![0]).canApprove,true);
 assert.deepEqual(next.rooms,p.rooms);
 const unknown=addPlanOpening(p,{...input,heightM:null},'missing',1);
 const approved=reviewPlanOpening(unknown,'missing','approved',2);
 assert.equal(openingQuantityFeedback(approved,approved.openings![0]).affects,false);
 assert.ok(openingQuantityFeedback(approved,approved.openings![0]).missing.includes('height'));
});

test('placement cancellation clears only the temporary gesture, from either endpoint phase',()=>{
 state().setProject(plan());state().setCurrentPage(1);
 const id=state().addPlanOpening(quantityOpeningInput(state().project!,'r-master','custom',{widthM:1,heightM:1,sillHeightM:0,quantity:1}))!;
 const saved=state().project;
 state().beginOpeningPlacement('hinged');state().cancelOpeningPlacement();assert.equal(state().openingPlacement,null);assert.equal(state().project,saved);
 state().beginOpeningPlacement('window');state().placeOpeningPoint({x:10,y:20});state().cancelOpeningPlacement();
 assert.equal(state().openingPlacement,null);assert.equal(state().project,saved);assert.equal(state().project!.openings![0].id,id);
});

test('PDF details default off, one shared physical schedule row, and deduction summaries omit zero rows without changing quantities',()=>{
 const p=plan();p.rooms.push({...structuredClone(p.rooms[0]),id:'second',name:'Second',workItems:[{id:'paint-second',type:'painting'}]});
 let next=addPlanOpening(p,{...quantityOpeningInput(p,'r-master','door',{widthM:1,heightM:2,sillHeightM:0,quantity:1}),roomIds:['r-master','second'],roomSides:[{roomId:'r-master'},{roomId:'second'}],quantityReview:{associationsConfirmed:true,distinctLegacyRoomIds:[]}},'shared',1);
 next=reviewPlanOpening(next,'shared','approved',2);
 const before=buildRoomSummaries(next);
 for(const language of ['he','en'] as const){
  const x=exportContext(language);
  assert.equal(openingPdfSchedule([next],x),null);
  const schedule=openingPdfSchedule([next],x,{includeOpeningDetails:true})!;
  assert.equal(schedule.rows.length,1);assert.equal(schedule.rows[0][5],'1');
  assert.ok(schedule.rows[0][6].includes('Second'));
  assert.equal(openingPdfSchedule([next],x,{includeOpeningDetails:true},new Set([2])),null);
  const deductions=openingPdfDeductions([next],x)!;
  assert.equal(deductions.rows.filter(r=>r[2]===x.t('workTypes.painting')).length,2);
  assert.ok(deductions.rows.every(row=>Number(row[4])>0));
 }
 assert.deepEqual(buildRoomSummaries(next),before);assert.equal(buildOpeningQuantityReport(next).doors,1);
});
