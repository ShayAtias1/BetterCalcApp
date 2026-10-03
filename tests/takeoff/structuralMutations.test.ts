// The pure concrete-zone reducers and automatic marks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_A } from './fixtures.ts';
import {
  addConcreteElement,
  changeConcreteKind,
  newConcreteElement,
  nextConcreteMark,
  removeConcreteElement,
  updateConcreteElement,
} from '../../src/lib/structuralMutations.ts';
import { concreteOf } from '../../src/lib/structuralPlan.ts';
import type { ConcreteElement } from '../../src/types/structural.ts';

const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
const el = (kind: ConcreteElement['kind'], mark: string): ConcreteElement => ({ id: mark, pageNumber: 1, kind, mark, points: sq });

test('automatic marks: S01, W01, B01, C01, counted per kind', () => {
  assert.equal(nextConcreteMark([], 'slab'), 'S01');
  assert.equal(nextConcreteMark([], 'wall'), 'W01');
  assert.equal(nextConcreteMark([], 'beam'), 'B01');
  assert.equal(nextConcreteMark([], 'column'), 'C01');
  const some = [el('slab', 'S01'), el('slab', 'S02'), el('wall', 'W01')];
  assert.equal(nextConcreteMark(some, 'slab'), 'S03');
  assert.equal(nextConcreteMark(some, 'wall'), 'W02');
  assert.equal(nextConcreteMark(some, 'beam'), 'B01');
});

test('marks go above the highest number, ignore hand-typed marks, and widen past 99', () => {
  assert.equal(nextConcreteMark([el('slab', 'S01'), el('slab', 'S05')], 'slab'), 'S06'); // a deleted S02-S04 is not refilled
  assert.equal(nextConcreteMark([el('slab', 'Roof'), el('slab', 'S1x')], 'slab'), 'S01');
  assert.equal(nextConcreteMark([el('slab', 'S99')], 'slab'), 'S100');
  // a mark that looks like another kind's prefix does not count for this kind
  assert.equal(nextConcreteMark([el('wall', 'S07')], 'slab'), 'S01');
});

test('a new element is minimal: geometry, page, kind, mark and zero waste — and its own copy of the points', () => {
  const plan = structuredClone(PLAN_A);
  const e = newConcreteElement(plan, 2, 'beam', sq);
  assert.equal(e.pageNumber, 2);
  assert.equal(e.kind, 'beam');
  assert.equal(e.mark, 'B01');
  assert.equal(e.wastePercent, 0);
  assert.equal(e.depthM, undefined);
  assert.deepEqual(e.points, sq);
  assert.notEqual(e.points[0], sq[0]);
  assert.ok(e.id.length > 8);
});

test('add / update / remove leave rooms and every other part of the plan alone', () => {
  const plan = structuredClone(PLAN_A);
  const e = newConcreteElement(plan, 1, 'slab', sq);
  const added = addConcreteElement(plan, e);
  assert.equal(concreteOf(added).length, 1);
  assert.equal(added.rooms, plan.rooms);
  assert.equal(concreteOf(plan).length, 0); // the input is not mutated

  const second = newConcreteElement(added, 1, 'slab', sq);
  assert.equal(second.mark, 'S02');
  const two = addConcreteElement(added, second);

  const updated = updateConcreteElement(two, e.id, { depthM: 0.25, grade: 'B30' });
  assert.equal(concreteOf(updated)[0].depthM, 0.25);
  assert.equal(concreteOf(updated)[0].id, e.id);
  assert.equal(concreteOf(updated)[1], concreteOf(two)[1]);

  // a field patched to undefined disappears instead of leaving a key behind
  const cleared = updateConcreteElement(updated, e.id, { depthM: undefined });
  assert.equal('depthM' in concreteOf(cleared)[0], false);
  const manual = updateConcreteElement(cleared, e.id, { sizeOverride: { lengthM: 1, widthM: 2 } });
  assert.equal('sizeOverride' in concreteOf(updateConcreteElement(manual, e.id, { sizeOverride: undefined }))[0], false);

  // the id can not be changed through a patch
  assert.equal(concreteOf(updateConcreteElement(two, e.id, { id: 'other' } as never))[0].id, e.id);

  const removed = removeConcreteElement(two, e.id);
  assert.deepEqual(concreteOf(removed).map((x) => x.id), [second.id]);
});

test('an unknown id changes nothing', () => {
  const plan = addConcreteElement(structuredClone(PLAN_A), newConcreteElement(PLAN_A, 1, 'slab', sq));
  assert.equal(updateConcreteElement(plan, 'nope', { depthM: 1 }), plan);
  assert.equal(removeConcreteElement(plan, 'nope'), plan);
});

test('changing kind: auto mark is renumbered for the new kind, geometry and dimension are untouched', () => {
  let plan = structuredClone(PLAN_A);
  plan = addConcreteElement(plan, { ...el('slab', 'S01'), id: 'a', depthM: 0.2, grade: 'B30', wastePercent: 5 });
  plan = addConcreteElement(plan, { ...el('wall', 'W01'), id: 'w1' });
  plan = addConcreteElement(plan, { ...el('wall', 'W02'), id: 'w2' });

  const changed = changeConcreteKind(plan, 'a', 'wall');
  const a = concreteOf(changed).find((e) => e.id === 'a')!;
  assert.equal(a.kind, 'wall');
  assert.equal(a.mark, 'W03'); // next free wall number
  assert.deepEqual(a.points, sq);
  assert.equal(a.depthM, 0.2);
  assert.equal(a.grade, 'B30');
  assert.equal(a.wastePercent, 5);
  assert.equal(changed.rooms, plan.rooms);
  assert.equal(concreteOf(plan).find((e) => e.id === 'a')!.kind, 'slab'); // input not mutated

  // the freed number is picked up by the old kind next time
  assert.equal(nextConcreteMark(concreteOf(changed), 'slab'), 'S01');
});

test('changing kind keeps a mark the user typed, and renumbers one that merely looks automatic', () => {
  let plan = structuredClone(PLAN_A);
  plan = addConcreteElement(plan, { ...el('slab', 'Roof slab'), id: 'typed' });
  plan = addConcreteElement(plan, { ...el('slab', 'S07'), id: 'auto' });
  plan = addConcreteElement(plan, { ...el('slab', 'W01'), id: 'foreign' }); // a slab marked with another kind's letter: user text
  const out = concreteOf(changeConcreteKind(changeConcreteKind(changeConcreteKind(plan, 'typed', 'beam'), 'auto', 'beam'), 'foreign', 'column'));
  assert.equal(out.find((e) => e.id === 'typed')!.mark, 'Roof slab');
  assert.equal(out.find((e) => e.id === 'auto')!.mark, 'B01');
  assert.equal(out.find((e) => e.id === 'foreign')!.mark, 'W01');
});

test('a quantity belongs to columns only: it is dropped when the kind stops being a column, and not invented', () => {
  let plan = addConcreteElement(structuredClone(PLAN_A), { ...el('column', 'C01'), id: 'c', quantity: 4, depthM: 3 });
  const slab = concreteOf(changeConcreteKind(plan, 'c', 'slab'))[0];
  assert.equal('quantity' in slab, false);
  assert.equal(slab.depthM, 3);
  assert.equal(slab.mark, 'S01');
  const back = concreteOf(changeConcreteKind(changeConcreteKind(plan, 'c', 'slab'), 'c', 'column'))[0];
  assert.equal('quantity' in back, false);
  assert.equal(back.mark, 'C01');
});

test('changing to the same kind or an unknown id changes nothing', () => {
  const plan = addConcreteElement(structuredClone(PLAN_A), { ...el('slab', 'S01'), id: 'a' });
  assert.equal(changeConcreteKind(plan, 'a', 'slab'), plan);
  assert.equal(changeConcreteKind(plan, 'zzz', 'wall'), plan);
});
