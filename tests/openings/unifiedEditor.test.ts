import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {PLAN_A} from '../takeoff/fixtures.ts';
import {buildOpeningQuantityReport} from '../../src/lib/openingQuantityReport.ts';
Object.assign(globalThis,{DOMMatrix:class{},DOMPoint:class{},DOMRect:class{},Path2D:class{}});
const {useAppStore}=await import('../../src/store/appStore.ts');
const s=()=>useAppStore.getState();
after(()=>s().setProject(null));

// Execute the actual shared editor button handler, with real canonical store actions.
const source=ts.createSourceFile('OpeningsPanel.tsx',readFileSync(new URL('../../src/components/OpeningsPanel.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let approval='';
function visit(node:ts.Node){if(ts.isJsxAttribute(node)&&node.name.getText(source)==='onClick'&&node.initializer&&ts.isJsxExpression(node.initializer)&&node.initializer.expression?.getText(source).includes('state.approvePlanOpening'))approval=node.initializer.expression.getText(source);ts.forEachChild(node,visit);}
visit(source);assert.ok(approval);
const code=ts.transpileModule(`(${approval})`,{compilerOptions:{target:ts.ScriptTarget.ES2023}}).outputText;

test('both entry methods open the same canonical draft and finish through the same editor approval, with identical quantities',()=>{
 const results=[];
 for(const drawn of [true,false]){
  const p=structuredClone(PLAN_A);p.rooms=p.rooms.filter(r=>r.id==='r-master');p.rooms[0].openings=[];
  s().setProject(p);s().setCurrentPage(1);
  if(drawn){s().beginOpeningPlacement('hinged');s().placeOpeningPoint({x:0,y:0});s().placeOpeningPoint({x:64,y:0});}
  else s().beginQuantityOpening('hinged');
  const id=s().selectedOpeningId!;
  assert.ok(id);assert.equal(s().openingPlacement,null);assert.equal(s().project!.openings!.length,1);
  let o=s().project!.openings![0];assert.equal(o.approval.status,'draft');assert.equal(o.mechanism,'hinged');assert.equal(o.walkableAccess,'supported');assert.equal(o.quantity,1);
  assert.equal(o.geometry===null,!drawn);assert.equal(o.heightM,null);assert.equal(o.sillHeightM,null);
  s().updatePlanOpening(id,{widthM:1,heightM:2,sillHeightM:0,roomIds:['r-master'],roomSides:[{roomId:'r-master'},'exterior']});
  s().updatePlanOpening(id,{quantityReview:{associationsConfirmed:true,distinctLegacyRoomIds:[]}});
  const state=s(),plan=state.project!;o=plan.openings![0];
  let error='';runInNewContext(code,{state,plan,o,useAppStore,setError:(value:string)=>{error=value;},text:(key:string)=>key})();
  assert.equal(error,'');assert.equal(s().selectedOpeningId,null);assert.equal(s().openingPlacement,null);assert.equal(s().project!.openings![0].approval.status,'approved');
  const report=buildOpeningQuantityReport(s().project!);
  assert.equal(report.doors,1);assert.equal(report.work.find(w=>w.type==='painting')!.deducted,2);assert.equal(report.work.find(w=>w.type==='panels')!.deducted,1);
  results.push(report.work.map(w=>[w.type,w.deducted,w.net]));
 }
 assert.deepEqual(results[0],results[1]);
});

test('closing the common editor or cancelling placement preserves saved openings and their review state',()=>{
 s().setProject(structuredClone(PLAN_A));s().setCurrentPage(1);
 const id=s().beginQuantityOpening('window')!;const before=s().project;
 s().cancelOpeningPlacement();s().selectPlanOpening(null);
 assert.equal(s().project,before);assert.equal(s().project!.openings![0].id,id);assert.equal(s().project!.openings![0].approval.status,'draft');
 s().selectPlanOpening(id);assert.equal(s().selectedOpeningId,id);assert.equal(s().project!.openings![0].geometry,null);
});
