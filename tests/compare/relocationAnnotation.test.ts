import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RevisionChange } from '../../src/types/revisionAnalysis';
import { wallFromFootprint, openingFromFootprint, setWallFootprint, setOpeningFootprint } from '../../src/lib/revision/changeEdit';
import { relocationAnnotation } from '../../src/lib/revision/relocationAnnotation';
import { translateArea } from '../../src/lib/areaGeometryEditing';
import { polygonCentroid } from '../../src/lib/geometry';

const before = [{x:100,y:100},{x:200,y:100},{x:200,y:120},{x:100,y:120}];
const after = translateArea(before,{x:30,y:50});
function fixture(family: 'wall' | 'opening', ai = false): RevisionChange {
  return { id:'relocated', pageNumber:1, kind:'modified', category:family, significance:'high', score:1, evidence:[],
    bbox:{x:0,y:0,width:500,height:500}, addedSegments:[], removedSegments:[], addedLengthPx:0, removedLengthPx:0, status:'pending',
    userType:family==='wall'?'wall-relocated':'opening-modified', manual:!ai, edited:!ai,
    ...(ai ? { aiProposal:{ changeType:family==='wall'?'wall-relocated':'opening-modified',before:null,after:null,verification:'verified',requiresReview:false,evidence:[] } } : {}),
    walls:family==='wall'?[wallFromFootprint('removed',before)!,wallFromFootprint('added',after)!]:[],
    doors:family==='opening'?[openingFromFootprint('removed',before,'door')!,openingFromFootprint('added',after,'door')!]:[] };
}

for (const family of ['wall','opening'] as const) for (const ai of [false,true]) {
  test(`${ai?'AI':'manual'} ${family} movement runs from the original centroid to the revised centroid and follows edits`, () => {
    const change = fixture(family,ai);
    const annotation = relocationAnnotation(change)!;
    assert.deepEqual(annotation.from,polygonCentroid(before));
    assert.deepEqual(annotation.to,polygonCentroid(after));
    const moved = translateArea(after,{x:-60,y:15});
    const edited = family==='wall'?setWallFootprint(change,1,moved):setOpeningFootprint(change,1,moved);
    assert.deepEqual(relocationAnnotation(edited)!.from,annotation.from);
    assert.deepEqual(relocationAnnotation(edited)!.to,polygonCentroid(moved));
    assert.deepEqual(change[family==='wall'?'walls':'doors'][1].footprint,after);
  });
}

test('missing, placeholder and unverified locations never supply a movement arrow', () => {
  const wall = fixture('wall',true);
  assert.equal(relocationAnnotation({...wall,walls:wall.walls.slice(0,1)}),null);
  assert.equal(relocationAnnotation({...wall,walls:wall.walls.map((w,i)=>i?{...w,placeholder:true}:w)}),null);
  assert.equal(relocationAnnotation({...wall,aiProposal:{...wall.aiProposal!,verification:'unverified'}}),null);
  const opening = fixture('opening',true);
  assert.equal(relocationAnnotation({...opening,doors:opening.doors.map((d,i)=>i?{...d,geometryVerified:false}:d)}),null);
  assert.equal(relocationAnnotation({...opening,doors:opening.doors.map((d,i)=>i?{...d,footprint:undefined}:d)}),null);
});

test('opening resizing around a fixed jamb does not create a relocation arrow', () => {
  const change = fixture('opening');
  change.doors[1] = openingFromFootprint('added',[before[0],{x:250,y:100},{x:250,y:120},before[3]],'door')!;
  assert.equal(relocationAnnotation(change),null);
});
