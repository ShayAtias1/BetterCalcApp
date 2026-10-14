import { test } from 'node:test';
import assert from 'node:assert/strict';
const { openingImpact, openingImpactReady } = await import('../../src/lib/revision/openingImpact.ts');
const { changeItems } = await import('../../src/lib/revision/changeItems.ts');
const { setElementLine, setOpeningHeight } = await import('../../src/lib/revision/changeEdit.ts');

const opening = (side, start, end, extras = {}) => ({
  side, hinge: {x:start,y:0}, jamb: {x:end,y:0}, radiusPx:end-start,
  heightM:2, wallThicknessPx:20, impactVerified:true, ...extras,
});
const change = (doors) => ({
  id:'opening', pageNumber:1, kind:'modified', category:'opening', userType:'opening-modified',
  walls:[], doors, addedSegments:[], removedSegments:[], bbox:{x:0,y:0,width:300,height:20},
  evidence:[], significance:'high', score:1, status:'pending', edited:true,
});
const totals = (c) => {
  const items = changeItems(c, 'construction', .01, 3);
  return ['construction','demolition'].map(kind => items.filter(i=>i.areaKind===kind).reduce((sum,i)=>sum+i.areaM2,0));
};

test('narrowing counts only infill and uses measured thickness', () => {
  const c = change([opening('removed',0,100),opening('added',0,60)]);
  assert.deepEqual(totals(c),[.8,0]);
  const [p] = openingImpact(c,.01).portions;
  assert.deepEqual(p.centerline,[{x:60,y:0},{x:100,y:0}]);
  assert.equal(Math.max(...p.points.map(p=>p.y))-Math.min(...p.points.map(p=>p.y)),20);
});
test('widening measures only removed wall, including reversed endpoints', () => {
  assert.deepEqual(totals(change([opening('removed',60,0),opening('added',100,0)])),[0,.8]);
});
test('partially overlapping relocation subtracts the shared opening area', () => {
  assert.deepEqual(totals(change([opening('removed',0,100),opening('added',60,160)])),[1.2,1.2]);
});
test('nonoverlapping relocation produces old infill and new removal exactly once', () => {
  assert.deepEqual(totals(change([opening('removed',0,100),opening('added',200,300)])),[2,2]);
});
test('height and sill changes subtract elevation overlap', () => {
  const c = change([
    opening('removed',0,100,{opening:'window',sillHeightM:1,heightM:1}),
    opening('added',0,100,{opening:'window',sillHeightM:.5,heightM:1.5}),
  ]);
  assert.deepEqual(totals(c),[0,.5]);
});
test('duplicate same-side opening evidence cannot double the affected area', () => {
  assert.deepEqual(totals(change([opening('removed',0,100),opening('removed',0,100),opening('added',0,60)])),[.8,0]);
});
test('uncertain dimensions block quantities; edits invalidate verification', () => {
  const c = change([opening('removed',0,100),opening('added',0,60)]);
  for (const patch of [{heightM:undefined},{wallThicknessPx:undefined},{impactVerified:false},{placeholder:true},{heightM:NaN}]) {
    const uncertain = {...c,doors:[{...c.doors[0],...patch},c.doors[1]]};
    assert.equal(openingImpactReady(uncertain),false);
    assert.deepEqual(totals(uncertain),[0,0]);
  }
  assert.equal(openingImpactReady(setElementLine(c,{list:'doors',index:0},{x:0,y:0},{x:120,y:0})),false);
  assert.equal(openingImpactReady(setOpeningHeight(c,0,2.5)),false);
});
test('design revision reports signed wall delta without demolition measurements', () => {
  const narrowed = change([opening('removed',0,100),opening('added',0,60)]);
  assert.equal(openingImpact(narrowed,.01).designDeltaM2,.8);
  assert.deepEqual(changeItems(narrowed,'design',.01,3),[]);
  assert.equal(openingImpact(change([opening('removed',0,60),opening('added',0,100)]),.01).designDeltaM2,-.8);
});

const { editOpeningImpactFootprint } = await import('../../src/lib/revision/openingImpactEditing.ts');
const { reshapeArea, translateArea } = await import('../../src/lib/areaGeometryEditing.ts');

test('infill corner editing reuses the rectangle editor and changes only its source boundaries', () => {
  const c = change([opening('removed',0,100),opening('added',0,60)]);
  const [portion] = openingImpact(c,.01).portions;
  const points = reshapeArea(portion.points,1,{x:120,y:10});
  const edited = editOpeningImpactFootprint(c,portion,points);
  assert.deepEqual(edited.doors[0].jamb,{x:120,y:0});
  assert.deepEqual(edited.doors[1].jamb,c.doors[1].jamb);
  assert.deepEqual(openingImpact(edited,.01).portions[0].points,points);
  assert.equal(edited.doors[0].heightM,c.doors[0].heightM);
  assert.deepEqual(totals(edited),[1.2,0]);
});
test('moving a difference footprint moves its defining opening geometry together', () => {
  const c = change([opening('removed',0,100),opening('added',0,60)]);
  const [portion] = openingImpact(c,.01).portions;
  const points = translateArea(portion.points,{x:20,y:10});
  const edited = editOpeningImpactFootprint(c,portion,points,true);
  assert.deepEqual(openingImpact(edited,.01).portions[0].points,points);
  assert.deepEqual(totals(edited),totals(c));
});
test('thickness editing updates the footprint without changing the surface quantity formula', () => {
  const c = change([opening('removed',0,100),opening('added',0,60)]);
  const [portion] = openingImpact(c,.01).portions;
  const points = reshapeArea(portion.points,1,{x:100,y:20});
  const edited = editOpeningImpactFootprint(c,portion,points);
  assert.equal(edited.doors[0].wallThicknessPx,30);
  assert.deepEqual(openingImpact(edited,.01).portions[0].points,points);
  assert.deepEqual(totals(edited),totals(c));
});
