import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
const saved = new Map();
await mock.module('idb', { namedExports: { openDB: async () => ({
  put: async (store, value) => saved.set(`${store}:${value.id}`, structuredClone(value)),
  get: async (store, id) => structuredClone(saved.get(`${store}:${id}`)),
}) } });
const { createEmptyComparison, useCompareStore } = await import('../../src/store/compareStore.ts');
const { loadComparison } = await import('../../src/db/database.ts');
const { editTypeOf, hasUnplacedLines, retypeChange, setElementLine, setWallFootprint, wallFromLine } = await import('../../src/lib/revision/changeEdit.ts');
const { useRevisionUi } = await import('../../src/lib/revision/revisionWorkflow.ts');
const { reshapeArea, translateArea, insertPolygonVertex, removePolygonVertex } = await import('../../src/lib/areaGeometryEditing.ts');
const { distancePx, polygonAreaPx } = await import('../../src/lib/geometry.ts');
const { changeItems } = await import('../../src/lib/revision/changeItems.ts');

function fixture() {
  const c = createEmptyComparison('Editing test', '', 'original.pdf', ['revision.pdf']);
  const r = c.revisions[0];
  c.context = 'construction';
  c.pages[1] = { originalPageNumber: 1, originalCalibration: { pixelDistance: 100, realDistanceMeters: 1, metersPerPixel: .01, space: 'original' }, revisions: {} };
  r.measurements = [{ id: 'manual', pageNumber: 1, tool: 'area', areaKind: 'demolition', calcMode: 'wall', wallHeightM: 2.5, points: [{x:0,y:0},{x:10,y:0},{x:10,y:100},{x:0,y:100}], wallLengthM: 1, areaM2: 2.5 }];
  const change = { id:'ai', pageNumber:1, kind:'added', category:'opening', significance:'high', score:1, evidence:[], bbox:{x:200,y:200,width:100,height:50}, addedSegments:[], removedSegments:[], walls:[], doors:[], status:'pending', aiProposal:{changeType:'window-added',before:null,after:[{x:200,y:220},{x:300,y:220}],verification:'unverified',requiresReview:true,evidence:[]} };
  r.analysis = { pages: { 1: { pageNumber:1, changes:[change] } } };
  useCompareStore.getState().setComparison(c);
  return {c,r,change};
}

test('sidebar selection leaves drawing mode and exposes an exclusive geometry selection', () => {
  fixture();
  const store = useCompareStore.getState();
  store.setMarkupTool('rectangle');
  store.setSelectedMarkupId('markup');
  assert.equal(useCompareStore.getState().toolMode, 'select');
  store.startChangeMeasurement('demolition');
  store.focusMeasurement('manual');
  assert.equal(useCompareStore.getState().toolMode, 'select');
  assert.equal(useCompareStore.getState().selectedMarkupId, null);
  assert.equal(useCompareStore.getState().selectedMeasurementId, 'manual');
});

test('manual geometry edits recalculate quantities and undo restores the entire drag', () => {
  const {r} = fixture();
  const store = useCompareStore.getState();
  const points = (length) => [{x:0,y:0},{x:10,y:0},{x:10,y:length},{x:0,y:length}];
  store.updateMeasurement('manual', {points:points(150)}, true);
  store.updateMeasurement('manual', {points:points(200)}, true);
  store.updateMeasurement('manual', {});
  assert.equal(useCompareStore.getState().comparison.revisions[0].measurements[0].areaM2, 5);
  store.undo();
  assert.deepEqual(useCompareStore.getState().comparison.revisions[0].measurements, r.measurements);
  store.redo();
  assert.equal(useCompareStore.getState().comparison.revisions[0].measurements[0].areaM2, 5);
});

test('selecting unverified AI geometry does not authorize quantities; manual correction does', () => {
  const {change} = fixture();
  useRevisionUi.getState().selectChange('ai');
  assert.equal(useCompareStore.getState().toolMode, 'select');
  assert.equal(useRevisionUi.getState().editingChangeId, 'ai');
  assert.equal(editTypeOf(change), 'window-added');
  assert.deepEqual(changeItems(change, 'construction', .01, 2.5), []);
  assert.equal(useCompareStore.getState().comparison.revisions[0].analysis.pages[1].changes[0].edited, undefined);
  useCompareStore.getState().editRevisionChange(1, 'ai', c => setElementLine(retypeChange(c, editTypeOf(c), .01), {list:'doors',index:0}, {x:200,y:220}, {x:320,y:220}));
  const corrected = useCompareStore.getState().comparison.revisions[0].analysis.pages[1].changes[0];
  assert.equal(corrected.edited, true);
  assert.equal(corrected.doors[0].opening, 'window');
  assert.equal(changeItems(corrected, 'construction', .01, 2.5)[0].wallLengthM, 1.2);
});

test('approved corrections rebuild quantities; applied geometry and generated measurements stay locked', () => {
  const {c,r,change} = fixture();
  r.analysis.pages[1].changes = [{...change, category:'wall', aiProposal:undefined, walls:[wallFromLine('added',{x:0,y:0},{x:0,y:100},10)]}];
  useCompareStore.getState().setComparison(c);
  const store = useCompareStore.getState();
  store.reviewRevisionChange(1,'ai','approved');
  store.editRevisionChange(1,'ai',c => setElementLine(c,{list:'walls',index:0},{x:0,y:0},{x:0,y:200}));
  let current = useCompareStore.getState().comparison;
  const generated = current.revisions[0].measurements.find(m=>m.revisionChangeId==='ai');
  assert.equal(generated.areaM2,5);
  store.updateMeasurement(generated.id,{areaM2:999});
  assert.equal(useCompareStore.getState().comparison,current);
  const locked = {...current,revisions:current.revisions.map(r=>({...r,analysis:{pages:{1:{...r.analysis.pages[1],changes:r.analysis.pages[1].changes.map(c=>({...c,status:'applied'}))}}}}))};
  store.setComparison(locked);
  current = useCompareStore.getState().comparison;
  store.editRevisionChange(1,'ai',c=>({...c,walls:[]}));
  assert.equal(useCompareStore.getState().comparison,current);
});

test('cancelling a geometry burst restores the document and does not leave a phantom undo step', () => {
  fixture();
  const store = useCompareStore.getState();
  store.updateMeasurement('manual',{wallHeightM:3,areaM2:3});
  const before = store.captureEditSnapshot();
  store.updateMeasurement('manual',{points:[{x:0,y:0},{x:20,y:0},{x:20,y:200},{x:0,y:200}]},true);
  store.cancelEditSnapshot(before);
  assert.equal(useCompareStore.getState().comparison,before.comparison);
  store.undo();
  assert.equal(useCompareStore.getState().comparison.revisions[0].measurements[0].areaM2,2.5);
});


test('wall footprint corners move independently and retain the other three corners and the other version', () => {
  const {change} = fixture();
  const before = wallFromLine('removed', {x:0,y:0}, {x:100,y:0}, 20);
  const after = wallFromLine('added', {x:0,y:40}, {x:100,y:40}, 20);
  const wallChange = {...change, userType:'wall-relocated', walls:[before,after], doors:[]};
  for (let index=0; index<4; index++) {
    const target = {x:after.footprint[index].x+12, y:after.footprint[index].y+3};
    const points = reshapeArea(after.footprint,index,target,{polygon:true});
    const result = setWallFootprint(wallChange,1,points);
    assert.equal(result.walls[0],before);
    assert.deepEqual(result.walls[1].footprint[index],target);
    for (let other=0; other<4; other++) if (other !== index) assert.deepEqual(result.walls[1].footprint[other],after.footprint[other]);
    assert.equal(result.walls[1].lengthPx,distancePx(...result.walls[1].centerline));
    assert.equal(result.walls[1].thicknessPx,polygonAreaPx(points)/result.walls[1].lengthPx);
  }
  const translated = setWallFootprint(wallChange,1,translateArea(after.footprint,{x:30,y:-10}));
  assert.deepEqual(translated.walls[1].footprint,after.footprint.map(p=>({x:p.x+30,y:p.y-10})));
  assert.equal(translated.walls[1].lengthPx,after.lengthPx);
  assert.equal(translated.walls[1].thicknessPx,after.thicknessPx);
});

test('corner correction updates approved quantities, persists the exact polygon, and undoes as one burst', async () => {
  const {c,r,change} = fixture();
  const before = wallFromLine('removed',{x:0,y:0},{x:100,y:0},20);
  const after = wallFromLine('added',{x:0,y:40},{x:100,y:40},20);
  r.analysis.pages[1].changes = [{...change,userType:'wall-relocated',aiProposal:undefined,walls:[before,after],doors:[]}];
  const store = useCompareStore.getState();
  store.setComparison(c);
  store.reviewRevisionChange(1,'ai','approved');
  const original = store.captureEditSnapshot().comparison;
  for (const dx of [20,40]) {
    const points = reshapeArea(after.footprint,1,{x:100+dx,y:50},{polygon:true});
    store.editRevisionChange(1,'ai',c=>setWallFootprint(c,1,points),true);
  }
  store.finishRevisionChangeEdit();
  const current = useCompareStore.getState().comparison;
  const edited = current.revisions[0].analysis.pages[1].changes[0];
  assert.deepEqual(edited.walls[0],before);
  assert.deepEqual(edited.walls[1].footprint,[{x:0,y:50},{x:140,y:50},{x:100,y:30},{x:0,y:30}]);
  assert.equal(edited.walls[1].lengthPx,120);
  assert.equal(edited.relocation.afterLengthPx,120);
  const items = current.revisions[0].measurements.filter(m=>m.revisionChangeId==='ai');
  assert.equal(items.find(m=>m.areaKind==='demolition').areaM2,2.5);
  assert.equal(items.find(m=>m.areaKind==='construction').areaM2,3);
  await store.persist();
  assert.deepEqual(saved.get(`comparisons:${c.id}`).revisions[0].analysis.pages[1].changes[0].walls[1].footprint,edited.walls[1].footprint);
  store.undo();
  assert.deepEqual(useCompareStore.getState().comparison.revisions,original.revisions);
  store.redo();
  assert.deepEqual(useCompareStore.getState().comparison.revisions,current.revisions);
});

for (const status of ['pending', 'approved', 'rejected']) {
  test(`deleting a ${status} AI change removes its geometry and items, persists, and supports undo`, async (t) => {
    const fetchSpy = t.mock.method(globalThis, 'fetch', () => { throw new Error('Deletion must not call AI'); });
    const {c,r,change} = fixture();
    const other = {...change,id:'other',bbox:{x:500,y:500,width:100,height:50}};
    r.analysis.pages[1].changes = [
      {...change,status,measurementIds:['linked'],walls:[wallFromLine('added',{x:0,y:0},{x:100,y:0},20)]},
      other,
    ];
    r.analysis.pages[2] = {pageNumber:2,changes:[{...other,id:'other-page',pageNumber:2}]};
    r.measurements.push(
      {...r.measurements[0],id:'linked',revisionChangeId:'ai'},
      {...r.measurements[0],id:'pending-linked',revisionChangeId:'ai'},
      {...r.measurements[0],id:'other-item',revisionChangeId:'other'},
    );
    const otherRevision = {...r,id:'other-revision'};
    c.revisions.push(otherRevision);
    const store = useCompareStore.getState();
    store.setComparison(c);
    const original = store.captureEditSnapshot().comparison;
    store.deleteRevisionChange(1,'ai');
    const deleted = useCompareStore.getState().comparison;
    assert.deepEqual(deleted.revisions[0].analysis.pages[1].changes,[other]);
    assert.deepEqual(deleted.revisions[0].measurements.map(m=>m.id),['manual','other-item']);
    assert.equal(deleted.revisions[0].analysis.pages[2],original.revisions[0].analysis.pages[2]);
    assert.equal(deleted.revisions[1],original.revisions[1]);
    await store.persist();
    store.undo();
    assert.deepEqual(useCompareStore.getState().comparison.revisions,original.revisions);
    store.redo();
    assert.deepEqual(useCompareStore.getState().comparison.revisions,deleted.revisions);
    await store.persist();
    store.setComparison(null);
    store.setComparison(await loadComparison(c.id));
    assert.deepEqual(useCompareStore.getState().comparison.revisions[0].analysis.pages[1].changes,[other]);
    assert.deepEqual(useCompareStore.getState().comparison.revisions[0].measurements.map(m=>m.id),['manual','other-item']);
    assert.equal(fetchSpy.mock.callCount(),0);
  });
}

test('manual deletion uses the same action; applied changes cannot be deleted before reverting', () => {
  fixture();
  const store = useCompareStore.getState();
  const id = store.addManualRevisionChange(1,'wall-added',{x:400,y:400}, [[{x:400,y:400},{x:500,y:400},{x:500,y:420},{x:400,y:420}]]);
  assert.ok(id);
  store.deleteRevisionChange(1,id);
  assert.deepEqual(useCompareStore.getState().comparison.revisions[0].analysis.pages[1].changes.map(c=>c.id),['ai']);
  store.setRevisionChangesStatus(useCompareStore.getState().comparison.activeRevisionId,['ai'],'applied');
  const before = store.captureEditSnapshot();
  store.deleteRevisionChange(1,'ai');
  store.deleteRevisionChange(1,'missing');
  assert.equal(useCompareStore.getState().comparison,before.comparison);
  assert.equal(useCompareStore.getState().history,before.history);
  store.setRevisionChangesStatus(before.comparison.activeRevisionId,['ai'],'approved');
  store.deleteRevisionChange(1,'ai');
  assert.deepEqual(useCompareStore.getState().comparison.revisions[0].analysis.pages[1].changes,[]);
});

for (const [type, side, areaKind] of [['wall-added','added','construction'], ['wall-removed','removed','demolition']]) {
  test(`${type} saves the drawn polygon, derives wall quantities and persists vertex removal`, async () => {
    const {c} = fixture();
    const store = useCompareStore.getState();
    const footprint = [{x:400,y:400},{x:420,y:400},{x:420,y:600},{x:400,y:600}];
    const id = store.addManualRevisionChange(1,type,footprint[0],[footprint]);
    const getChange = () => useCompareStore.getState().comparison.revisions[0].analysis.pages[1].changes.find(c=>c.id===id);
    assert.ok(id);
    assert.equal(getChange().walls[0].side,side);
    assert.equal(getChange().walls[0].lengthPx,200, 'vertical runs use the long axis');
    assert.equal(getChange().walls[0].thicknessPx,20);
    assert.equal(getChange().walls[0].placeholder,undefined);
    assert.deepEqual(new Set(getChange().walls[0].footprint.map(p=>JSON.stringify(p))),new Set(footprint.map(p=>JSON.stringify(p))));
    const items = changeItems(getChange(),'construction',.01,2.5);
    assert.equal(items[0].areaKind,areaKind);
    assert.equal(items[0].areaM2,5);
    store.reviewRevisionChange(1,id,'approved');
    const original = getChange().walls[0].footprint;
    const inserted = insertPolygonVertex(original,0,{x:420,y:500});
    store.editRevisionChange(1,id,c=>setWallFootprint(c,0,inserted));
    const removed = removePolygonVertex(inserted,1);
    assert.deepEqual(removed,original);
    store.editRevisionChange(1,id,c=>setWallFootprint(c,0,removed));
    assert.equal(getChange().status,'approved');
    store.undo();
    assert.deepEqual(getChange().walls[0].footprint,inserted);
    store.redo();
    assert.deepEqual(getChange().walls[0].footprint,original);
    await store.persist();
    const savedChange = (await loadComparison(c.id)).revisions[0].analysis.pages[1].changes.find(c=>c.id===id);
    assert.deepEqual(savedChange.walls[0].footprint,original);
    assert.equal(removePolygonVertex(original.slice(0,3),1),null);
  });
}

test('wall reclassification preserves edited vertices and requires a drawn missing relocation side', () => {
  const {change} = fixture();
  const wall = wallFromLine('added',{x:0,y:0},{x:100,y:0},20);
  const points = reshapeArea(wall.footprint,1,{x:120,y:15},{polygon:true});
  const edited = setWallFootprint({...change, walls:[wall], doors:[], userType:'wall-added'},0,points);
  const removed = retypeChange(edited,'wall-removed',.01);
  assert.deepEqual(removed.walls[0].footprint,points);
  const relocated = retypeChange(removed,'wall-relocated',.01);
  assert.equal(relocated.walls.length,1);
  assert.equal(hasUnplacedLines(relocated),true);
  assert.deepEqual(changeItems(relocated,'construction',.01,2.5),[]);
});

test('shared Takeoff rectangle and polygon edits recalculate Compare areas and persist one undo burst', async () => {
  const {c,r} = fixture();
  const store = useCompareStore.getState();
  const resized = reshapeArea(r.measurements[0].points,1,{x:20,y:-20});
  assert.deepEqual(resized,[{x:0,y:-20},{x:20,y:-20},{x:20,y:100},{x:0,y:100}]);
  store.updateMeasurement('manual',{points:resized},true);
  const inserted = insertPolygonVertex(resized,1,{x:20,y:40});
  const reshaped = reshapeArea(inserted,2,{x:40,y:40});
  assert.deepEqual(reshaped.filter((_,i)=>i!==2),inserted.filter((_,i)=>i!==2));
  store.updateMeasurement('manual',{points:reshaped},true);
  store.updateMeasurement('manual',{});
  await store.persist();
  assert.deepEqual((await loadComparison(c.id)).revisions[0].measurements[0].points,reshaped);
  assert.notEqual(useCompareStore.getState().comparison.revisions[0].measurements[0].areaM2,r.measurements[0].areaM2);
  store.undo();
  assert.deepEqual(useCompareStore.getState().comparison.revisions[0].measurements,r.measurements);
  store.redo();
  assert.deepEqual(useCompareStore.getState().comparison.revisions[0].measurements[0].points,reshaped);
});

test('shared edge insertion and movement preserve AI versions, approval, quantities and persistence', async () => {
  const {c,r,change} = fixture();
  const before = wallFromLine('removed',{x:0,y:0},{x:100,y:0},20);
  const after = wallFromLine('added',{x:0,y:40},{x:100,y:40},20);
  r.analysis.pages[1].changes = [{...change,userType:'wall-relocated',aiProposal:undefined,walls:[before,after],doors:[]}];
  const store = useCompareStore.getState();
  store.setComparison(c);
  store.reviewRevisionChange(1,'ai','approved');
  const original = store.captureEditSnapshot().comparison;
  const inserted = insertPolygonVertex(after.footprint,0,{x:50,y:50});
  assert.equal(inserted.length,5);
  assert.deepEqual(setWallFootprint(original.revisions[0].analysis.pages[1].changes[0],1,inserted).walls[1].centerline,after.centerline);
  store.editRevisionChange(1,'ai',c=>setWallFootprint(c,1,inserted));
  const reshaped = reshapeArea(inserted,1,{x:50,y:60},{polygon:true});
  const moved = translateArea(reshaped,{x:30,y:10});
  store.editRevisionChange(1,'ai',c=>setWallFootprint(c,1,moved),true);
  store.finishRevisionChangeEdit();
  const current = useCompareStore.getState().comparison;
  const edited = current.revisions[0].analysis.pages[1].changes[0];
  assert.deepEqual(edited.walls[0],before);
  assert.deepEqual(edited.walls[1].footprint,moved);
  assert.equal(edited.status,'approved');
  assert.equal(edited.userType,'wall-relocated');
  assert.equal(edited.relocation.afterLengthPx,edited.walls[1].lengthPx);
  assert.deepEqual(current.revisions[0].measurements.find(m=>m.revisionChangeId==='ai' && m.areaKind==='construction').points,moved);
  await store.persist();
  assert.deepEqual((await loadComparison(c.id)).revisions[0].analysis.pages[1].changes[0].walls[1].footprint,moved);
  store.undo();
  assert.deepEqual(useCompareStore.getState().comparison.revisions[0].analysis.pages[1].changes[0].walls[1].footprint,inserted);
  store.undo();
  assert.deepEqual(useCompareStore.getState().comparison.revisions,original.revisions);
});

for (const kind of ['demolition','construction']) {
  test(`Changes table deletion through a generated ${kind} row removes its change and supports undo`, async () => {
    const {c,r,change} = fixture();
    r.analysis.pages[1].changes = [{...change,userType:'wall-relocated',aiProposal:undefined,walls:[
      wallFromLine('removed',{x:0,y:0},{x:100,y:0},20),
      wallFromLine('added',{x:0,y:40},{x:100,y:40},20),
    ]}];
    const store = useCompareStore.getState();
    store.setComparison(c);
    store.reviewRevisionChange(1,'ai','approved');
    const row = useCompareStore.getState().comparison.revisions[0].measurements.find(m=>m.revisionChangeId==='ai' && m.areaKind===kind);
    assert.ok(row);
    store.setRevisionChangesStatus(c.activeRevisionId,['ai'],'applied');
    const locked = store.captureEditSnapshot();
    store.deleteMeasurement(row.id);
    assert.equal(useCompareStore.getState().comparison,locked.comparison);
    assert.equal(useCompareStore.getState().history,locked.history);
    store.setRevisionChangesStatus(c.activeRevisionId,['ai'],'approved');
    store.setSelectedMeasurementId(row.id);
    const before = store.captureEditSnapshot().comparison;
    store.deleteMeasurement(row.id);
    assert.deepEqual(useCompareStore.getState().comparison.revisions[0].analysis.pages[1].changes,[]);
    assert.deepEqual(useCompareStore.getState().comparison.revisions[0].measurements,r.measurements);
    assert.equal(useCompareStore.getState().selectedMeasurementId,null);
    await store.persist();
    assert.deepEqual((await loadComparison(c.id)).revisions[0].analysis.pages[1].changes,[]);
    store.undo();
    assert.deepEqual(useCompareStore.getState().comparison.revisions,before.revisions);
  });
}

for (const kind of ['demolition', 'construction']) {
  test(`classified ${kind} lines retain quantities, editing and deletion without changing AI review`, async () => {
    const {c, r} = fixture();
    const store = useCompareStore.getState();
    store.startChangeMeasurement(kind);
    store.setAreaShape('line');
    assert.equal(useCompareStore.getState().pendingAreaKind, kind);
    assert.equal(useCompareStore.getState().areaCalcMode, 'wall');
    store.finishMeasurement({
      id: 'drawn-line', tool: 'area', areaKind: kind, calcMode: 'wall',
      points: [{x:20,y:20},{x:120,y:20}], wallLengthM: 1, wallHeightM: 2.5, areaM2: 2.5,
    });
    store.focusMeasurement('drawn-line');
    store.updateMeasurement('drawn-line', {points:[{x:20,y:20},{x:220,y:20}]}, true);
    store.updateMeasurement('drawn-line', {});
    const current = useCompareStore.getState().comparison.revisions[0];
    assert.equal(current.measurements.at(-1).wallLengthM, 2);
    assert.equal(current.measurements.at(-1).areaM2, 5);
    assert.equal(current.measurements.at(-1).areaKind, kind);
    assert.deepEqual(current.measurements[0], r.measurements[0]);
    assert.deepEqual(current.analysis, r.analysis);
    await store.persist();
    assert.deepEqual((await loadComparison(c.id)).revisions[0].measurements, current.measurements);
    store.deleteMeasurement('drawn-line');
    assert.deepEqual(useCompareStore.getState().comparison.revisions[0].measurements, r.measurements);
    store.undo();
    assert.deepEqual(useCompareStore.getState().comparison.revisions[0].measurements, current.measurements);
  });
}

test('opening differences require verification, preserve distinct portion IDs and persist exact infill', async () => {
  const {c,r,change} = fixture();
  const door = (side,start,end) => ({side,hinge:{x:start,y:0},jamb:{x:end,y:0},radiusPx:end-start,heightM:2,wallThicknessPx:20,impactVerified:true});
  const opening = {...change,userType:'opening-modified',aiProposal:undefined,kind:'modified',doors:[door('removed',0,100),door('added',30,70)],walls:[]};
  r.analysis.pages[1].changes=[opening];
  const store = useCompareStore.getState();
  store.setComparison(c);
  store.reviewRevisionChange(1,'ai','approved');
  const current = useCompareStore.getState().comparison;
  const items = current.revisions[0].measurements.filter(m=>m.revisionChangeId==='ai');
  assert.equal(items.length,2);
  assert.equal(new Set(items.map(m=>m.id)).size,2);
  assert.deepEqual(items.map(m=>m.areaM2),[.6,.6]);
  assert.deepEqual(items.map(m=>m.revisionElement.part),[0,1]);
  assert.deepEqual(current.revisions[0].measurements[0],r.measurements[0]);
  await store.persist();
  assert.deepEqual((await loadComparison(c.id)).revisions[0].measurements, current.revisions[0].measurements);
  store.editRevisionChange(1,'ai',change=>({...change,doors:change.doors.map((d,i)=>i===0?{...d,heightM:2.2,impactVerified:false}:d)}));
  assert.equal(useCompareStore.getState().comparison.revisions[0].analysis.pages[1].changes[0].status,'pending');
  assert.deepEqual(useCompareStore.getState().comparison.revisions[0].measurements,r.measurements);
  store.reviewRevisionChange(1,'ai','approved');
  assert.equal(useCompareStore.getState().comparison.revisions[0].analysis.pages[1].changes[0].status,'pending');
  store.undo();
  assert.deepEqual(useCompareStore.getState().comparison.revisions,current.revisions);
});

test('legacy opening quantities are lazily withdrawn without changing approval or other measurements', () => {
  const {c,r,change} = fixture();
  r.analysis.pages[1].changes=[{...change,userType:'opening-modified',status:'approved',measurementIds:['legacy-opening'],
    doors:[{side:'removed',hinge:{x:0,y:0},jamb:{x:100,y:0},radiusPx:100},{side:'added',hinge:{x:0,y:0},jamb:{x:60,y:0},radiusPx:60}]}];
  r.measurements.push({...r.measurements[0],id:'legacy-opening',revisionChangeId:'ai'});
  const store = useCompareStore.getState();
  store.setComparison(c);
  const normalized = useCompareStore.getState().comparison;
  assert.deepEqual(normalized.revisions[0].measurements.map(m=>m.id),['manual']);
  assert.equal(normalized.revisions[0].analysis.pages[1].changes[0].status,'approved');
  store.setComparison(normalized);
  assert.equal(useCompareStore.getState().comparison,normalized);
});
