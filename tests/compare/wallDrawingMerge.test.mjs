import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
const saved = new Map();
await mock.module('idb', { namedExports: { openDB: async () => ({
  put: async (store, value) => saved.set(`${store}:${value.id}`, structuredClone(value)),
  get: async (store, id) => structuredClone(saved.get(`${store}:${id}`)),
}) } });
const { createEmptyComparison, useCompareStore } = await import('../../src/store/compareStore.ts');
const { loadComparison } = await import('../../src/db/database.ts');
const { wallFromFootprint, finalizeEditedChange, setWallFootprint } = await import('../../src/lib/revision/changeEdit.ts');
const { prepareWallRegionMerge } = await import('../../src/lib/revision/wallRegionMerge.ts');
const { useRevisionUi } = await import('../../src/lib/revision/revisionWorkflow.ts');
const { rectanglePoints, reshapeArea, translateArea } = await import('../../src/lib/areaGeometryEditing.ts');
const { polygonAreaPx } = await import('../../src/lib/geometry.ts');
const rect = (x, y, width, height) => rectanglePoints({x,y},{x:x+width,y:y+height});

function change(id, side, points, extra = {}) {
  return finalizeEditedChange({ id, pageNumber:1, kind:side==='added'?'added':'removed',
    category:'wall', userType:side==='added'?'wall-added':'wall-removed', status:'pending',
    score:1, significance:'high', evidence:[], bbox:{x:0,y:0,width:1,height:1},
    addedSegments:[], removedSegments:[], addedLengthPx:0, removedLengthPx:0,
    walls:[wallFromFootprint(side,points)], doors:[], ...extra });
}
function fixture(changes = []) {
  const c = createEmptyComparison('Wall regions','','original.pdf',['revised.pdf']);
  c.context = 'construction'; c.wallHeightDefaultM = 2.5;
  c.pages[1] = {originalPageNumber:1,originalCalibration:{pixelDistance:100,realDistanceMeters:1,metersPerPixel:.01,space:'original'},revisions:{}};
  c.revisions[0].analysis = {pages:{1:{pageNumber:1,changes}}};
  useCompareStore.getState().setComparison(c);
  useRevisionUi.getState().selectChange(null);
  return c;
}

for (const type of ['wall-added','wall-removed','wall-relocated']) {
  for (const shape of ['rectangle','polygon']) {
    test(`${type} accepts complete ${shape} footprints for each version and persists editable vertices`, async () => {
      const c = fixture();
      const points = shape === 'rectangle' ? rect(0,0,100,20)
        : [{x:0,y:0},{x:100,y:0},{x:100,y:10},{x:50,y:10},{x:50,y:20},{x:0,y:20}];
      const footprints = type === 'wall-relocated' ? [points,translateArea(points,{x:0,y:40})] : [points];
      const store = useCompareStore.getState();
      const id = store.addManualRevisionChange(1,type,points[0],footprints);
      assert.ok(id);
      let current = useCompareStore.getState().comparison.revisions[0].analysis.pages[1].changes[0];
      assert.equal(current.walls.length,footprints.length);
      current.walls.forEach((w,i)=>assert.equal(polygonAreaPx(w.footprint),polygonAreaPx(footprints[i])));
      const edited = reshapeArea(current.walls[0].footprint,0,{x:-5,y:-5},{polygon:true});
      store.editRevisionChange(1,id,c=>setWallFootprint(c,0,edited));
      await store.persist();
      current = (await loadComparison(c.id)).revisions[0].analysis.pages[1].changes[0];
      assert.deepEqual(current.walls[0].footprint,edited);
      store.undo(); store.undo();
      assert.deepEqual(useCompareStore.getState().comparison.revisions[0].analysis.pages[1].changes,[]);
      store.redo(); store.redo();
      assert.deepEqual(useCompareStore.getState().comparison.revisions[0].analysis.pages[1].changes[0].walls[0].footprint,edited);
    });
  }
}

test('union keeps a concave external outline and removes shared internal boundaries', () => {
  const changes = [change('a','added',rect(0,0,100,20)),change('b','added',rect(0,20,20,80)),change('c','added',rect(20,0,80,20))];
  const result = prepareWallRegionMerge(changes,changes.map(c=>({changeId:c.id,index:0})));
  assert.equal(result.ok,true);
  assert.equal(result.change.walls.length,1);
  assert.equal(result.change.walls[0].footprint.length,6);
  assert.equal(polygonAreaPx(result.change.walls[0].footprint),3600);
  assert.deepEqual(new Set(result.change.walls[0].footprint.map(p=>`${p.x},${p.y}`)),new Set(['0,0','100,0','100,20','20,20','20,100','0,100']));
});

for (const side of ['removed','added']) test(`${side} AI fragments merge without double-counting, persist, undo and redo`, async t => {
  const fetchSpy = t.mock.method(globalThis,'fetch',()=>{throw Error('No AI requests');});
  const a = change('a',side,rect(0,0,150,20),{manual:false});
  const b = change('b',side,rect(100,0,150,20),{manual:false});
  const unrelated = change('other','added',rect(500,500,100,20));
  const c = fixture([a,b,unrelated]);
  const store = useCompareStore.getState();
  store.reviewRevisionChange(1,'a','approved'); store.reviewRevisionChange(1,'b','approved');
  const original = store.captureEditSnapshot().comparison;
  const result = store.mergeWallRegions(1,[{changeId:'a',index:0},{changeId:'b',index:0}]);
  assert.deepEqual(result,{changeId:'a'});
  const merged = useCompareStore.getState().comparison;
  assert.equal(merged.revisions[0].analysis.pages[1].changes.length,2);
  assert.equal(merged.revisions[0].analysis.pages[1].changes[1],original.revisions[0].analysis.pages[1].changes[2]);
  const items = merged.revisions[0].measurements.filter(m=>m.revisionChangeId==='a'||m.revisionChangeId==='b');
  assert.equal(items.length,1);
  assert.equal(items[0].wallLengthM,2.5);
  assert.equal(items[0].areaM2,6.25);
  assert.equal(polygonAreaPx(items[0].points),5000);
  await store.persist();
  assert.deepEqual((await loadComparison(c.id)).revisions,merged.revisions);
  store.undo(); assert.deepEqual(useCompareStore.getState().comparison.revisions,original.revisions);
  store.redo(); assert.deepEqual(useCompareStore.getState().comparison.revisions,merged.revisions);
  assert.equal(fetchSpy.mock.callCount(),0);
});

test('merging one version preserves every opposite footprint and relocation quantity difference', () => {
  const a = change('a','removed',rect(0,0,100,20),{userType:'wall-relocated',walls:[wallFromFootprint('removed',rect(0,0,100,20)),wallFromFootprint('added',rect(0,40,100,20))]});
  const b = change('b','removed',rect(100,0,100,20),{userType:'wall-relocated',walls:[wallFromFootprint('removed',rect(100,0,100,20)),wallFromFootprint('added',rect(100,40,100,20))]});
  const result = prepareWallRegionMerge([a,b],[{changeId:'a',index:0},{changeId:'b',index:0}]);
  assert.equal(result.ok,true);
  assert.deepEqual(result.change.walls.filter(w=>w.side==='added'),[a.walls[1],b.walls[1]]);
  assert.equal(result.change.relocation.beforeLengthPx,200);
  assert.equal(result.change.relocation.afterLengthPx,200);
});

test('gaps, holes, mixed versions, applied walls and duplicate selections cannot mutate the document', () => {
  const cases = [
    [[change('a','added',rect(0,0,100,20)),change('b','added',rect(106,5,100,20))],'separated'],
    [[change('a','removed',rect(0,0,100,20)),change('b','added',rect(50,0,100,20))],'incompatible'],
    [[change('a','added',rect(0,0,100,20),{status:'applied'}),change('b','added',rect(50,0,100,20),{status:'applied'})],'incompatible'],
    [[change('a','added',rect(0,0,100,20)),change('b','added',rect(0,80,100,20)),change('c','added',rect(0,20,20,60)),change('d','added',rect(80,20,20,60))],'holes'],
  ];
  for (const [changes,error] of cases) {
    fixture(changes);
    const store = useCompareStore.getState(), before = store.captureEditSnapshot();
    assert.deepEqual(store.mergeWallRegions(1,changes.map(c=>({changeId:c.id,index:0}))),{error});
    assert.equal(useCompareStore.getState().comparison,before.comparison);
    assert.equal(useCompareStore.getState().history,before.history);
  }
  assert.deepEqual(prepareWallRegionMerge(cases[0][0],[{changeId:'a',index:0},{changeId:'a',index:0}]),{ok:false,error:'incompatible'});
});

test('wall regions can be multi-selected within and across changes; normal selection clears the merge set', () => {
  fixture([change('a','added',rect(0,0,100,20),{walls:[wallFromFootprint('added',rect(0,0,100,20)),wallFromFootprint('added',rect(100,0,100,20))]}),change('b','added',rect(200,0,100,20))]);
  const ui = useRevisionUi.getState();
  ui.selectWallRegion('a',0);
  ui.selectWallRegion('a',1,true);
  ui.selectWallRegion('b',0,true);
  assert.equal(useRevisionUi.getState().selectedWallRegions.length,3);
  ui.selectWallRegion('a',1,true);
  assert.deepEqual(useRevisionUi.getState().selectedWallRegions,[{changeId:'a',index:0},{changeId:'b',index:0}]);
  ui.selectChange('b');
  assert.deepEqual(useRevisionUi.getState().selectedWallRegions,[]);
});

for (const side of ['removed','added']) for (const gapPx of [2,100,2000]) test(`${side} ${gapPx*.01}m gap merge previews without mutation and requires confirmation before quantities, persistence and undo`, async t => {
  const fetchSpy = t.mock.method(globalThis,'fetch',()=>{throw Error('No API requests');});
  const c = fixture([change('a',side,rect(0,0,100,20)),change('b',side,rect(100+gapPx,0,100,20))]);
  const store = useCompareStore.getState();
  store.reviewRevisionChange(1,'a','approved'); store.reviewRevisionChange(1,'b','approved');
  const original = store.captureEditSnapshot();
  const selection = [{changeId:'a',index:0},{changeId:'b',index:0}];
  const result = store.mergeWallRegions(1,selection);
  assert.equal(result.error,'confirmation');
  assert.equal(result.preview.connectors.length,1);
  assert.equal(result.preview.gapLengthsM[0],gapPx*.01);
  assert.equal(polygonAreaPx(result.preview.connectors[0]),gapPx*20);
  assert.equal(polygonAreaPx(result.preview.footprint),(200+gapPx)*20);
  assert.equal(useCompareStore.getState().comparison,original.comparison);
  assert.equal(useCompareStore.getState().history,original.history);
  assert.equal(store.mergeWallRegions(1,selection,'unconfirmed').error,'confirmation');
  assert.equal(useCompareStore.getState().comparison,original.comparison);
  assert.deepEqual(store.mergeWallRegions(1,selection,result.preview.confirmationKey),{changeId:'a'});
  const merged = useCompareStore.getState().comparison;
  const items = merged.revisions[0].measurements;
  assert.equal(items.length,1);
  assert.equal(items[0].wallLengthM,2+gapPx*.01);
  assert.equal(items[0].areaM2,Math.round((2+gapPx*.01)*2.5*100)/100);
  assert.deepEqual(items[0].points,merged.revisions[0].analysis.pages[1].changes[0].walls[0].footprint);
  await store.persist();
  assert.deepEqual((await loadComparison(c.id)).revisions,merged.revisions);
  store.undo(); assert.deepEqual(useCompareStore.getState().comparison.revisions,original.comparison.revisions);
  store.redo(); assert.deepEqual(useCompareStore.getState().comparison.revisions,merged.revisions);
  const points = items[0].points;
  const edited = reshapeArea(points,0,{x:points[0].x-5,y:points[0].y-2},{polygon:true});
  store.editRevisionChange(1,'a',c=>setWallFootprint(c,0,edited));
  await store.persist();
  const reloaded = (await loadComparison(c.id)).revisions[0];
  assert.deepEqual(reloaded.analysis.pages[1].changes[0].walls[0].footprint,edited);
  assert.deepEqual(reloaded.measurements[0].points,edited);
  store.undo(); assert.deepEqual(useCompareStore.getState().comparison.revisions,merged.revisions);
  assert.equal(fetchSpy.mock.callCount(),0);
});

test('gap previews use calibration rather than pixels, and reversed/vertical wall directions are supported', () => {
  const refs = [{changeId:'a',index:0},{changeId:'b',index:0}];
  for (const factor of [.5,1,4]) {
    const changes = [change('a','added',rect(0,0,100*factor,20*factor)),change('b','added',rect(102*factor,0,100*factor,20*factor))];
    const result = prepareWallRegionMerge(changes,refs,{metersPerPixel:.01/factor});
    assert.equal(result.error,'confirmation');
    assert.equal(result.preview.gapLengthsM[0],.02);
    const largerPhysicalGap = prepareWallRegionMerge(changes,refs,{metersPerPixel:.1/factor});
    assert.equal(largerPhysicalGap.error,'confirmation');
    assert.equal(largerPhysicalGap.preview.gapLengthsM[0],.2);
    assert.equal(prepareWallRegionMerge(changes,refs,{metersPerPixel:0}).error,'uncalibrated');
  }
  const vertical = [change('a','removed',rect(0,0,20,100)),change('b','removed',rect(0,102,20,100))];
  vertical[1].walls[0].centerline.reverse();
  const result = prepareWallRegionMerge(vertical,refs,{metersPerPixel:.01});
  assert.equal(result.error,'confirmation');
  assert.equal(polygonAreaPx(result.preview.footprint),4040);
});

test('misaligned walls and real openings cannot be filled even with a confirmation token', () => {
  const refs = [{changeId:'a',index:0},{changeId:'b',index:0}];
  for (const after of [rect(102,5,100,20),rect(102,0,20,100)]) {
    const result = prepareWallRegionMerge([change('a','added',rect(0,0,100,20)),change('b','added',after)],refs,{metersPerPixel:.01,confirmedPreview:'yes'});
    assert.equal(result.ok,false);
    assert.equal(result.error,'separated');
  }
  const walls = [change('a','added',rect(0,0,100,20)),change('b','added',rect(102,0,100,20))];
  const opening = change('door','added',rect(100,0,2,20),{walls:[],category:'opening',userType:'door-added',doors:[{
    side:'added',hinge:{x:100,y:10},jamb:{x:102,y:10},radiusPx:2,opening:'door',footprint:rect(100,0,2,20),
  }]});
  assert.equal(prepareWallRegionMerge([...walls,opening],refs,{metersPerPixel:.01,confirmedPreview:'yes'}).error,'opening');
  opening.doors[0].footprint = undefined;
  assert.equal(prepareWallRegionMerge([...walls,opening],refs,{metersPerPixel:.01}).error,'opening');
});

test('changed geometry or calibration invalidates confirmation; a three-region merge previews every required gap', () => {
  const changes = [change('a','added',rect(0,0,100,20)),change('b','added',rect(102,0,100,20)),change('c','added',rect(205,0,100,20))];
  const refs = changes.map(c=>({changeId:c.id,index:0}));
  const result = prepareWallRegionMerge(changes,refs,{metersPerPixel:.01});
  assert.equal(result.error,'confirmation');
  assert.deepEqual(result.preview.gapLengthsM,[.02,.03]);
  assert.equal(polygonAreaPx(result.preview.footprint),6100);
  const changedScale = prepareWallRegionMerge(changes,refs,{metersPerPixel:.005,confirmedPreview:result.preview.confirmationKey});
  assert.equal(changedScale.error,'confirmation');
  changes[1].walls[0] = wallFromFootprint('added',rect(103,0,99,20));
  const changed = prepareWallRegionMerge(changes,refs,{metersPerPixel:.01,confirmedPreview:result.preview.confirmationKey});
  assert.equal(changed.error,'confirmation');
  assert.equal(prepareWallRegionMerge(changes,refs,{metersPerPixel:.01,confirmedPreview:changed.preview.confirmationKey}).ok,true);
});

test('touching and overlapping merges still work without calibration or confirmation', () => {
  for (const x of [90,100]) {
    const changes = [change('a','added',rect(0,0,100,20)),change('b','added',rect(x,0,100,20))];
    const result = prepareWallRegionMerge(changes,[{changeId:'a',index:0},{changeId:'b',index:0}],{metersPerPixel:0});
    assert.equal(result.ok,true);
    assert.equal(result.change.walls.length,1);
  }
});
