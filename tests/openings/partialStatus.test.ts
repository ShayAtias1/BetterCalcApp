import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PLAN_A} from '../takeoff/fixtures.ts';
import type {Plan, PlanOpening} from '../../src/types/index.ts';
import {buildOpeningQuantityReport, openingReportTables} from '../../src/lib/openingQuantityReport.ts';
import {buildPlanQuantityReport, buildProjectQuantities, planStatusText} from '../../src/lib/projectQuantities.ts';
import {buildRoomSummaries} from '../../src/lib/quantities.ts';
import {exportContext} from '../../src/lib/exportLanguage.ts';

/** Reproduces the inspected plan: 12 approved openings, but vision-003 has no quantity.
 * Approval of drawing/classification is separate from completeness for quantity calculations.
 * Synthetic geometry and rooms keep this regression independent of the user's PDF/data. */
function fixture(): Plan {
 const plan=structuredClone(PLAN_A);
 plan.pages={1:{pageNumber:1,calibration:{metersPerPixel:1,pixelDistance:1,realDistanceMeters:1}}};
 plan.rooms=['living','bathroom'].map(id=>({...plan.rooms[0],id,name:id,closed:true,pageNumber:1,
  points:[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}],openings:[],
  workItems:[{id:`paint-${id}`,type:'painting',heightM:3,wastePercent:0}]}));
 plan.openings=Array.from({length:12},(_,index):PlanOpening=>{
  const number=index+1,window=[1,5,6,12].includes(number);
  return {id:`vision-${String(number).padStart(3,'0')}`,planId:plan.id,pageNumber:1,
   geometry:{endpointA:{x:0,y:number},endpointB:{x:1,y:number}},
   kind:window?'window':'door',mechanism:window?'sliding':'hinged',
   walkableAccess:window?'unsupported':[7,8].includes(number)?'unknown':'supported',
   roomIds:['living','bathroom'],quantityReview:{associationsConfirmed:true,distinctLegacyRoomIds:[]},
   widthM:window?1.2:.8,heightM:window?1.2:2.1,sillHeightM:window?1:0,
   quantity:number===3?null:1,legacyRefs:[],source:'import',
   approval:{status:'approved',reviewedAt:1},createdAt:1,updatedAt:1};
 });
 return plan;
}
function consistentStatus(plan:Plan,incomplete:boolean) {
 const openingReport=buildOpeningQuantityReport(plan);
 assert.equal(openingReport.incomplete,incomplete);
 const planReport=buildPlanQuantityReport(plan);
 assert.equal(planReport.status,incomplete?'partial':'ready');
 assert.equal(planReport.uncalibratedRoomCount,0);
 assert.equal(!!buildProjectQuantities([plan]).openingTotalsIncomplete,incomplete);
 for(const language of ['he','en'] as const){
  const x=exportContext(language);
  assert.equal(planStatusText(planReport,x.t),x.t(incomplete?'projectOverview.openingsIncompleteStatus':'planStatus.ready'));
  const tables=openingReportTables([plan],x);
  assert.equal(tables.find(table=>table.title===x.t('openingQuantities.counts'))!.rows[0][3],x.t(incomplete?'openingQuantities.partial':'openingQuantities.complete'));
 }
 return openingReport;
}
test('approved vision-003 with missing quantity remains partial in overview and reports; status reads never modify quantities',()=>{
 const plan=fixture(),before=structuredClone(plan),quantities=buildRoomSummaries(plan);
 const report=consistentStatus(plan,true);
 const incomplete=report.schedule.filter(row=>row.reasons.length);
 assert.deepEqual(incomplete.map(row=>({id:row.id,reasons:row.reasons})),[{id:'vision-003',reasons:['unknownQuantity']}]);
 assert.deepEqual(report.work.flatMap(item=>item.audit.filter(a=>a.incomplete)).map(a=>[a.openingId,a.reason]),
  [['vision-003','unknownQuantity'],['vision-003','unknownQuantity']]);
 assert.deepEqual(plan,before);assert.deepEqual(buildRoomSummaries(plan),quantities);
});
test('all approved openings with complete required data are ready; rejected incomplete openings stay resolved, drafts remain partial',()=>{
 const plan=fixture();plan.openings![2].quantity=1;
 consistentStatus(plan,false);
 plan.openings![2].quantity=null;plan.openings![2].approval={status:'rejected',reviewedAt:2};
 const before=buildRoomSummaries(plan);consistentStatus(plan,false);
 assert.deepEqual(buildRoomSummaries(plan),before);
 plan.openings![2].quantity=1;plan.openings![2].approval={status:'draft',reviewedAt:null};
 consistentStatus(plan,true);
});
