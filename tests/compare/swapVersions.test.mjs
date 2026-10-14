import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
const saved = new Map();
let failTransaction = false;
await mock.module('idb', { namedExports: { openDB: async () => ({
  put: async (store, value) => saved.set(`${store}:${value.id}`, structuredClone(value)),
  get: async (store, id) => structuredClone(saved.get(`${store}:${id}`)),
  transaction() {
    const staged = new Map(); let aborted = false;
    return {
      abort() { aborted = true; },
      objectStore: store => ({
        get: async id => structuredClone(saved.get(`${store}:${id}`)),
        put: async value => staged.set(`${store}:${value.id}`, structuredClone(value)),
      }),
      get done() {
        if (aborted || failTransaction) return Promise.reject(new Error('transaction failed'));
        for (const [key, value] of staged) saved.set(key, value);
        return Promise.resolve();
      },
    };
  },
}) } });
const { createEmptyComparison, useCompareStore } = await import('../../src/store/compareStore.ts');
const { wallFromLine, changeNoteKey } = await import('../../src/lib/revision/changeEdit.ts');
const { swapChangeVersions } = await import('../../src/lib/revision/swapVersions.ts');
const { swapAppliedQuantities } = await import('../../src/lib/revision/swapAppliedQuantities.ts');
const { changeItems } = await import('../../src/lib/revision/changeItems.ts');
const { loadComparison, loadPlan, saveComparisonWithLinkedPlan } = await import('../../src/db/database.ts');
const { swapSelectedChange, useRevisionUi } = await import('../../src/lib/revision/revisionWorkflow.ts');
const { settleDialog, useAppDialogs } = await import('../../src/lib/appDialogs.ts');
const { useAppStore } = await import('../../src/store/appStore.ts');
const { addPlanOpening, openingsOf } = await import('../../src/lib/planOpenings.ts');
const CAL = {pixelDistance:100,realDistanceMeters:1,metersPerPixel:.01,space:'original'};
const store = () => useCompareStore.getState();
const current = () => store().comparison;
const change = () => current().revisions[0].analysis.pages[1].changes[0];
function wall(id='wall', side='added', heightM=3) {
  return {id,pageNumber:1,kind:side,category:'wall',significance:'high',score:1,evidence:[],bbox:{x:0,y:0,width:100,height:10},
    userType:`wall-${side}`,walls:[{...wallFromLine(side,{x:0,y:0},{x:100,y:0},10),heightM}],doors:[],
    addedSegments:[{x1:0,y1:0,x2:100,y2:0}],removedSegments:[],addedLengthPx:100,removedLengthPx:0,status:'pending'};
}
function fixture(c0=wall(), context='construction') {
  const c=createEmptyComparison('Swap','','before.pdf',['after.pdf']);c.context=context;
  c.pages[1]={originalPageNumber:1,originalCalibration:CAL,revisions:{}};
  c.revisions[0].analysis={pages:{1:{pageNumber:1,changes:[c0,wall('other')]}}};
  store().setComparison(c); useRevisionUi.setState({applying:false,selectedChangeId:c0.id});
  useAppStore.setState({project:null,currentProject:null});
  return c;
}
function linkedPlan(c, c0=change()) {
  const appId='application';
  const items=changeItems(c0,c.context,.01,c.wallHeightDefaultM).map((i,n)=>({id:`linked-${n}`,pageNumber:1,tool:'area',points:i.points,
    centerline:i.centerline,areaKind:i.areaKind,areaM2:i.areaM2,calcMode:'wall',wallHeightM:i.wallHeightM,wallLengthM:i.wallLengthM,
    revisionSource:{comparisonId:c.id,revisionId:c.activeRevisionId,changeId:c0.id,applicationId:appId}}));
  return {id:'plan',updatedAt:100,pages:{1:{calibration:CAL}},rooms:[],openings:[],measurements:[{id:'unrelated',tool:'distance',points:[],pageNumber:1,lengthM:7},...items],
    revisionApplications:[{id:appId,status:'applied',comparisonId:c.id,revisionId:c.activeRevisionId,context:c.context,appliedAt:100,versionId:'version',
      changes:[{changeId:c0.id,pageNumber:1,kind:c0.kind,category:c0.category,bbox:c0.bbox}],measurementIds:items.map(m=>m.id),openingIds:[],roomIds:[],reviews:[]}]};
}
function appliedFixture() {
  fixture();store().reviewRevisionChange(1,'wall','approved');
  let c=current();const plan=linkedPlan(c);
  c={...c,linkedPlanId:plan.id,revisions:c.revisions.map(r=>({...r,analysis:{pages:{1:{...r.analysis.pages[1],changes:r.analysis.pages[1].changes.map(x=>x.id==='wall'?{...x,status:'applied'}:x)}}}}))};
  store().setComparison(c);saved.set('projects:plan',structuredClone(plan));
  return plan;
}

test('swap preserves full geometry/dimensions and flips segments, AI versions, candidates, text and classifications',()=>{
  const c0={...wall(),aiProposal:{changeType:'wall-added',before:null,after:[{x:0,y:0},{x:100,y:0}],verification:'verified',requiresReview:false,evidence:[]},
    textChanges:{before:['old'],after:['new']},wallCandidates:[{side:'added',pieces:[[{x:0,y:0},{x:30,y:0}]],lengthPx:30}]};
  const result=swapChangeVersions(c0);
  assert.equal(result.userType,'wall-removed');assert.equal(result.kind,'removed');
  assert.deepEqual(result.walls[0],{...c0.walls[0],side:'removed'});
  assert.deepEqual(result.removedSegments,c0.addedSegments);assert.equal(result.removedLengthPx,100);
  assert.deepEqual(result.aiProposal.before,c0.aiProposal.after);assert.equal(result.aiProposal.after,null);
  assert.equal(result.wallCandidates[0].side,'removed');assert.deepEqual(result.textChanges,{before:['new'],after:['old']});
  const roundTrip=swapChangeVersions(result);assert.deepEqual(roundTrip.walls,c0.walls);assert.equal(roundTrip.userType,c0.userType);
});

test('opening widened becomes narrowed with all verified dimensions moving intact',()=>{
  const door=(side,width,height)=>({side,hinge:{x:0,y:0},jamb:{x:width,y:0},radiusPx:width,opening:'window',heightM:height,sillHeightM:.8,
    geometryVerified:true,impactVerified:true,wallThicknessPx:20,footprint:[{x:0,y:0},{x:width,y:0},{x:width,y:20},{x:0,y:20}],footprintShape:'rectangle'});
  const c0={...wall(),kind:'modified',category:'opening',userType:'opening-modified',walls:[],doors:[door('removed',100,1),door('added',150,1.5)]};
  assert.equal(changeNoteKey(c0),'revisionAi.note.openingWidened');
  const swapped=swapChangeVersions(c0);assert.equal(changeNoteKey(swapped),'revisionAi.note.openingNarrowed');
  assert.deepEqual(swapped.doors,c0.doors.map(d=>({...d,side:d.side==='added'?'removed':'added'})));
  assert.ok(changeItems(c0,'construction',.01,3).every(i=>i.areaKind==='demolition'));
  assert.ok(changeItems(swapped,'construction',.01,3).every(i=>i.areaKind==='construction'));
  assert.equal(changeItems(swapped,'construction',.01,3).reduce((n,i)=>n+i.areaM2,0),changeItems(c0,'construction',.01,3).reduce((n,i)=>n+i.areaM2,0));
});

test('pending swap only changes the selected item, Undo/Redo and persisted reload work without AI',async()=>{
  fixture();const original=current(), other=original.revisions[0].analysis.pages[1].changes[1];
  const fetchSpy=mock.method(globalThis,'fetch',()=>{throw new Error('AI must not run');});
  try {
    assert.equal(await store().swapRevisionChange(1,'wall'),true);assert.equal(change().kind,'removed');
    assert.equal(current().revisions[0].analysis.pages[1].changes[1],other);assert.equal(current().pages,original.pages);
    store().undo();assert.equal(change().kind,'added');store().redo();assert.equal(change().kind,'removed');
    await store().persist();assert.equal((await loadComparison(current().id)).revisions[0].analysis.pages[1].changes[0].kind,'removed');
    assert.equal(fetchSpy.mock.callCount(),0);
  } finally {fetchSpy.mock.restore();}
});

test('approved swap requires confirmation, cancellation is inert, quantities and history synchronize',async()=>{
  fixture();store().reviewRevisionChange(1,'wall','approved');const before=current();
  assert.equal(await store().swapRevisionChange(1,'wall'),false);assert.equal(current(),before);
  let pending=swapSelectedChange(1,'wall');let dialog=useAppDialogs.getState().queue.at(-1);assert.ok(dialog);settleDialog(dialog.id,false);await pending;
  assert.equal(current(),before);
  pending=swapSelectedChange(1,'wall');dialog=useAppDialogs.getState().queue.at(-1);settleDialog(dialog.id,true);await pending;
  assert.equal(change().status,'approved');assert.equal(change().kind,'removed');
  assert.equal(current().revisions[0].measurements[0].areaKind,'demolition');assert.equal(current().revisions[0].measurements[0].areaM2,3);
  assert.equal(current().revisions[0].measurements.length,1);
  store().undo();assert.equal(current().revisions[0].measurements[0].areaKind,'construction');
});

test('design wall swap uses existing formulas and removes obsolete quantities without double counting',async()=>{
  fixture(wall(),'design');store().reviewRevisionChange(1,'wall','approved');assert.equal(current().revisions[0].measurements.length,1);
  await store().swapRevisionChange(1,'wall',true);assert.equal(current().revisions[0].measurements.length,0);
  await store().swapRevisionChange(1,'wall',true);assert.equal(current().revisions[0].measurements.length,1);
});

test('applied swap persists both documents, preserves unrelated data, supports consecutive swaps and atomic Undo/Redo',async()=>{
  const plan=appliedFixture();const other=change();const unrelated=current().revisions[0].analysis.pages[1].changes[1];
  assert.equal(await store().swapRevisionChange(1,'wall'),false);
  assert.equal(await store().swapRevisionChange(1,'wall',true),true);
  let stored=await loadPlan(plan.id);assert.equal(stored.measurements[1].areaKind,'demolition');assert.equal(stored.measurements[1].areaM2,3);
  assert.deepEqual(stored.measurements[0],plan.measurements[0]);assert.deepEqual(stored.rooms,plan.rooms);
  assert.equal(current().revisions[0].analysis.pages[1].changes[1],unrelated);assert.equal(change().status,'applied');
  assert.equal((await loadComparison(current().id)).revisions[0].analysis.pages[1].changes[0].kind,'removed');
  await store().swapRevisionChange(1,'wall',true);assert.equal(change().kind,'added');
  await store().undo();assert.equal(change().kind,'removed');assert.equal((await loadPlan(plan.id)).measurements[1].areaKind,'demolition');
  await store().undo();assert.equal(change().kind,other.kind);assert.equal((await loadPlan(plan.id)).measurements[1].areaKind,'construction');
  await store().redo();assert.equal(change().kind,'removed');await store().redo();assert.equal(change().kind,'added');
});

test('failed applied transaction leaves both documents and history unchanged',async()=>{
  const plan=appliedFixture();await store().persist();const before=current();const history=store().history;
  failTransaction=true;
  try {await assert.rejects(store().swapRevisionChange(1,'wall',true));}finally{failTransaction=false;}
  assert.equal(current(),before);assert.equal(store().history,history);assert.deepEqual(await loadPlan(plan.id),plan);
  assert.equal((await loadComparison(before.id)).revisions[0].analysis.pages[1].changes[0].kind,'added');
});

test('stale/independently edited linked measurements and older applications are refused',async()=>{
  let plan=appliedFixture();saved.set('projects:plan',{...plan,measurements:plan.measurements.map(m=>m.revisionSource?{...m,areaM2:99}:m)});
  await assert.rejects(store().swapRevisionChange(1,'wall',true));assert.equal(change().kind,'added');
  plan=appliedFixture();saved.set('projects:plan',{...plan,revisionApplications:[...plan.revisionApplications,{...plan.revisionApplications[0],id:'later',comparisonId:'other'}]});
  await assert.rejects(store().swapRevisionChange(1,'wall',true));assert.equal(change().kind,'added');
});

test('Undo refuses to overwrite later linked-plan edits',async()=>{
  const plan=appliedFixture();await store().swapRevisionChange(1,'wall',true);const before=current();const linked=await loadPlan(plan.id);
  saved.set('projects:plan',{...linked,updatedAt:linked.updatedAt+1,notes:'keep me'});
  await store().undo();assert.equal(current(),before);assert.equal((await loadPlan(plan.id)).notes,'keep me');
});

test('atomic save checks both documents before writing',async()=>{
  const plan=appliedFixture();await store().persist();
  await assert.rejects(saveComparisonWithLinkedPlan(current(),{...plan,notes:'new'},plan.updatedAt+1,current().updatedAt));
  assert.equal((await loadPlan(plan.id)).notes,undefined);
});

test('applied opening dimensions and status follow swapped versions through the canonical engine',()=>{
  const door=(side,width)=>({side,hinge:{x:0,y:0},jamb:{x:width,y:0},radiusPx:width,opening:'door',heightM:2.1,geometryVerified:true,impactVerified:true,wallThicknessPx:20,
    footprint:[{x:0,y:0},{x:width,y:0},{x:width,y:20},{x:0,y:20}]});
  const c0={...wall(),walls:[],doors:[door('added',100)],category:'opening',userType:'door-added',status:'applied'};
  const c=fixture(c0);let plan=linkedPlan(c,c0);
  plan=addPlanOpening(plan,{pageNumber:1,geometry:{endpointA:{x:0,y:0},endpointB:{x:100,y:0}},entryMethod:'plan',kind:'door',mechanism:'hinged',walkableAccess:'supported',roomIds:[],
    widthM:1,heightM:2.1,sillHeightM:null,quantity:1,source:'import',legacyRefs:[],notes:''},'opening',100);
  plan.revisionApplications[0].openingIds=['opening'];
  const swapped=swapAppliedQuantities(plan,c,c.activeRevisionId,c0,swapChangeVersions(c0));
  assert.equal(openingsOf(swapped)[0].approval.status,'rejected');
  assert.equal(swapped.measurements.filter(m=>m.revisionSource)[0].areaKind,'construction');
  const restored=swapAppliedQuantities(swapped,c,c.activeRevisionId,swapChangeVersions(c0),c0);
  assert.equal(openingsOf(restored)[0].approval.status,'draft');assert.equal(openingsOf(restored)[0].widthM,1);
});

test('applied editor asks for confirmation and synchronizes only after acceptance',async()=>{
  const plan=appliedFixture();const before=current();
  let action=swapSelectedChange(1,'wall');let dialog=useAppDialogs.getState().queue.at(-1);
  assert.ok(dialog);assert.match(dialog.message,/linked|מקושר/);
  settleDialog(dialog.id,false);await action;assert.equal(current(),before);assert.deepEqual(await loadPlan(plan.id),plan);
  action=swapSelectedChange(1,'wall');dialog=useAppDialogs.getState().queue.at(-1);settleDialog(dialog.id,true);await action;
  assert.equal(change().kind,'removed');assert.equal((await loadPlan(plan.id)).measurements[1].areaKind,'demolition');
});

test('in-flight state changes abort an atomic save before either document is committed',async()=>{
  const plan=appliedFixture();await store().persist();let checks=0;
  await assert.rejects(saveComparisonWithLinkedPlan({...current(),notes:'new'},{...plan,notes:'new'},plan.updatedAt,current().updatedAt,()=>++checks<2));
  assert.equal((await loadPlan(plan.id)).notes,undefined);assert.notEqual((await loadComparison(current().id)).notes,'new');
});

for (const status of ['pending', 'rejected']) for (const legacy of [false, true]) test(`${status} swap synchronizes ${legacy ? 'legacy ID-linked' : 'source-linked'} Changes table data and totals`, async () => {
  const original = wall();
  original.status = status;
  const c = fixture(original);
  const item = changeItems(original, 'construction', .01, 3)[0];
  const row = { id: 'saved-row', pageNumber: 1, tool: 'area', calcMode: 'wall', points: item.points, centerline: item.centerline,
    areaKind: item.areaKind, areaM2: item.areaM2, wallHeightM: item.wallHeightM, wallLengthM: item.wallLengthM,
    ...(legacy ? {} : { revisionChangeId: original.id, revisionElement: item.element }) };
  const unrelated = { ...row, id: 'unrelated-row', revisionChangeId: 'other' };
  if (legacy) original.measurementIds = [row.id];
  c.revisions[0].measurements = [row, unrelated];
  store().setComparison(c);
  const { changeMeasurements, changeTotals } = await import('../../src/lib/changeMeasurements.ts');
  const table = () => changeMeasurements(current().revisions[0].measurements);
  assert.equal(changeTotals(table(), 'construction').areaM2, 6);
  await store().swapRevisionChange(1, original.id);
  assert.equal(change().userType, 'wall-removed'); assert.equal(change().kind, 'removed'); assert.equal(change().status, status);
  assert.equal(table()[0].areaKind, 'demolition'); assert.equal(table()[0].id, row.id);
  assert.deepEqual(table()[0].points, row.points); assert.equal(table()[0].wallHeightM, row.wallHeightM);
  assert.equal(table()[0].areaM2, row.areaM2); assert.equal(table().length, 2);
  assert.deepEqual(table()[1], unrelated);
  assert.equal(changeTotals(table(), 'construction').areaM2, 3); assert.equal(changeTotals(table(), 'demolition').areaM2, 3);
  store().undo(); assert.equal(table()[0].areaKind, 'construction'); assert.equal(change().userType, 'wall-added');
  store().redo(); assert.equal(table()[0].areaKind, 'demolition');
  await store().persist(); store().setComparison(await loadComparison(current().id));
  assert.equal(table()[0].areaKind, 'demolition'); assert.equal(change().userType, 'wall-removed');
});

test('pending opening work reverses persisted table rows while retaining verified dimensions and untouched work', async () => {
  const door = { side: 'added', hinge: { x: 0, y: 0 }, jamb: { x: 100, y: 0 }, radiusPx: 100, opening: 'door',
    heightM: 2.1, wallThicknessPx: 20, footprint: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 }, { x: 0, y: 20 }], geometryVerified: true, impactVerified: true };
  const original = { ...wall(), userType: 'door-added', category: 'opening', walls: [], doors: [door] };
  const c = fixture(original);
  const item = changeItems(original, 'construction', .01, 3)[0];
  c.revisions[0].measurements = [{ id: 'opening-row', revisionChangeId: original.id, revisionElement: item.element,
    pageNumber: 1, tool: 'area', calcMode: 'wall', points: item.points, centerline: item.centerline,
    areaKind: item.areaKind, areaM2: item.areaM2, wallHeightM: item.wallHeightM, wallLengthM: item.wallLengthM }];
  store().setComparison(c);
  assert.equal(current().revisions[0].measurements[0].areaKind, 'demolition');
  await store().swapRevisionChange(1, original.id);
  assert.equal(change().userType, 'door-removed'); assert.deepEqual(change().doors[0], { ...door, side: 'removed' });
  assert.equal(current().revisions[0].measurements[0].areaKind, 'construction');
  assert.equal(current().revisions[0].measurements[0].areaM2, item.areaM2);
});
