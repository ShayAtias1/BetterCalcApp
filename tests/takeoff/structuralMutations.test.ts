// The pure concrete-zone reducers and automatic marks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_A } from './fixtures.ts';
import {
  addConcreteElement,
  addConcreteFromRooms,
  changeConcreteKind,
  newConcreteElement,
  removeConcreteElement,
  updateConcreteElement,
} from '../../src/lib/structuralMutations.ts';
import { concreteOf } from '../../src/lib/structuralPlan.ts';
import { markLabel, markPatch, nextAutoNumber } from '../../src/lib/structuralMarks.ts';
import { translatorFor } from '../../src/i18n/index.ts';
import type { ConcreteElement } from '../../src/types/structural.ts';

const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
const el = (kind: ConcreteElement['kind'], mark: string): ConcreteElement => ({ id: mark, pageNumber: 1, kind, mark, points: sq });

// Old data holds letter marks; `concreteOf` reads them as automatic numbers.
const stored = (list: ConcreteElement[]) => concreteOf({ concreteElements: list });

test('automatic numbers are counted per kind, starting at 1', () => {
  assert.equal(nextAutoNumber([], 'slab'), 1);
  assert.equal(nextAutoNumber([], 'column'), 1);
  const some = stored([el('slab', 'S01'), el('slab', 'S02'), el('wall', 'W01')]);
  assert.equal(nextAutoNumber(some, 'slab'), 3);
  assert.equal(nextAutoNumber(some, 'wall'), 2);
  assert.equal(nextAutoNumber(some, 'beam'), 1);
});

test('numbers go above the highest one, ignore hand-typed marks, and widen past 99', () => {
  assert.equal(nextAutoNumber(stored([el('slab', 'S01'), el('slab', 'S05')]), 'slab'), 6); // a deleted 2-4 is not refilled
  assert.equal(nextAutoNumber(stored([el('slab', 'Roof'), el('slab', 'S1x')]), 'slab'), 1);
  assert.equal(nextAutoNumber(stored([el('slab', 'S99')]), 'slab'), 100);
  // a mark that looks like another kind's letter is user text for this kind, so it does not count
  assert.equal(nextAutoNumber(stored([el('wall', 'S07')]), 'slab'), 1);
});

test('the automatic name follows the language it is shown in; a typed mark never does', () => {
  const he = translatorFor('he');
  const en = translatorFor('en');
  const auto = { kind: 'slab' as const, mark: '', autoNumber: 1 };
  assert.equal(markLabel(auto, he), 'תקרה 01');
  assert.equal(markLabel(auto, en), 'Slab 01');
  assert.equal(markLabel({ kind: 'wall', mark: '', autoNumber: 12 }, en), 'Wall 12');
  assert.equal(markLabel({ kind: 'beam', mark: '', autoNumber: 3 }, he), 'קורה 03');
  assert.equal(markLabel({ kind: 'column', mark: '', autoNumber: 7 }, he), 'עמוד 07');
  assert.equal(markLabel({ kind: 'mesh', mark: '', autoNumber: 1 }, he), 'רשת 01');
  assert.equal(markLabel({ kind: 'mesh', mark: '', autoNumber: 1 }, en), 'Mesh 01');
  assert.equal(markLabel({ kind: 'bars', mark: '', autoNumber: 2 }, he), 'מוטות 02');
  assert.equal(markLabel({ kind: 'bars', mark: '', autoNumber: 2 }, en), 'Bars 02');
  assert.equal(markLabel({ kind: 'slab', mark: '', autoNumber: 100 }, en), 'Slab 100');
  // typed marks come out verbatim in both languages — including ones that look automatic
  for (const mark of ['Roof slab', 'S01', 'תקרה 01', '  spaced  ']) {
    const typed = { kind: 'slab' as const, mark, markManual: true };
    assert.equal(markLabel(typed, he), mark);
    assert.equal(markLabel(typed, en), mark);
  }
});

test('old letter marks are read as automatic; a typed mark of the same shape stays typed; reading never writes', () => {
  const plan = { concreteElements: [{ ...el('slab', 'S01'), id: 'old' }, { ...el('slab', 'S02'), id: 'typed', markManual: true }, { ...el('slab', 'Roof'), id: 'text' }] };
  const before = JSON.stringify(plan);
  const read = concreteOf(plan);
  assert.deepEqual([read[0].mark, read[0].autoNumber], ['', 1]);
  assert.deepEqual([read[1].mark, read[1].autoNumber, read[1].markManual], ['S02', undefined, true]);
  assert.deepEqual([read[2].mark, read[2].autoNumber], ['Roof', undefined]);
  assert.equal(JSON.stringify(plan), before); // the stored plan is untouched
  assert.equal(concreteOf(plan), read); // memoised: stable identity for readers
  assert.equal(markLabel(read[0], translatorFor('en')), 'Slab 01');
  // already-current data is returned as is
  const current = { concreteElements: [{ ...el('slab', ''), id: 'n', autoNumber: 4 }] };
  assert.equal(concreteOf(current), current.concreteElements);
});

test('typing a mark makes it manual; emptying the field returns to the next automatic number', () => {
  const list = stored([el('slab', 'S01'), { ...el('slab', 'S02'), id: 'two' }, { ...el('slab', 'S03'), id: 'three' }]);
  const typed = markPatch(list, { id: 'two', kind: 'slab' }, 'Roof');
  assert.deepEqual(typed, { mark: 'Roof', markManual: true, autoNumber: undefined });
  const back = markPatch(list, { id: 'two', kind: 'slab' }, '  ');
  assert.deepEqual(back, { mark: '', markManual: undefined, autoNumber: 4 }); // 4: above the highest of the others
});

test('a new element is minimal: geometry, page, kind, mark and zero waste — and its own copy of the points', () => {
  const plan = structuredClone(PLAN_A);
  const e = newConcreteElement(plan, 2, 'beam', sq);
  assert.equal(e.pageNumber, 2);
  assert.equal(e.kind, 'beam');
  assert.deepEqual([e.mark, e.autoNumber, e.markManual], ['', 1, undefined]);
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
  assert.equal(second.autoNumber, 2);
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
  assert.equal(a.autoNumber, 3); // next free wall number
  assert.equal(a.mark, '');
  assert.deepEqual(a.points, sq);
  assert.equal(a.depthM, 0.2);
  assert.equal(a.grade, 'B30');
  assert.equal(a.wastePercent, 5);
  assert.equal(changed.rooms, plan.rooms);
  assert.equal(concreteOf(plan).find((e) => e.id === 'a')!.kind, 'slab'); // input not mutated

  // the freed number is picked up by the old kind next time
  assert.equal(nextAutoNumber(concreteOf(changed), 'slab'), 1);
});

test('changing kind keeps a mark the user typed, and renumbers one that merely looks automatic', () => {
  let plan = structuredClone(PLAN_A);
  plan = addConcreteElement(plan, { ...el('slab', 'Roof slab'), id: 'typed' });
  plan = addConcreteElement(plan, { ...el('slab', 'S07'), id: 'auto' });
  plan = addConcreteElement(plan, { ...el('slab', 'W01'), id: 'foreign' }); // a slab marked with another kind's letter: user text
  const out = concreteOf(changeConcreteKind(changeConcreteKind(changeConcreteKind(plan, 'typed', 'beam'), 'auto', 'beam'), 'foreign', 'column'));
  assert.equal(out.find((e) => e.id === 'typed')!.mark, 'Roof slab');
  assert.equal(out.find((e) => e.id === 'auto')!.autoNumber, 1); // renumbered for beams
  assert.equal(out.find((e) => e.id === 'foreign')!.mark, 'W01');
});

test('a quantity belongs to columns only: it is dropped when the kind stops being a column, and not invented', () => {
  let plan = addConcreteElement(structuredClone(PLAN_A), { ...el('column', 'C01'), id: 'c', quantity: 4, depthM: 3 });
  const slab = concreteOf(changeConcreteKind(plan, 'c', 'slab'))[0];
  assert.equal('quantity' in slab, false);
  assert.equal(slab.depthM, 3);
  assert.equal(slab.autoNumber, 1);
  const back = concreteOf(changeConcreteKind(changeConcreteKind(plan, 'c', 'slab'), 'c', 'column'))[0];
  assert.equal('quantity' in back, false);
  assert.equal(back.autoNumber, 1);
});

test('changing to the same kind or an unknown id changes nothing', () => {
  const plan = addConcreteElement(structuredClone(PLAN_A), { ...el('slab', 'S01'), id: 'a' });
  assert.equal(changeConcreteKind(plan, 'a', 'slab'), plan);
  assert.equal(changeConcreteKind(plan, 'zzz', 'wall'), plan);
});

test('rooms → concrete: only the outline and page are copied, with new ids and marks; the rooms are untouched', () => {
  const plan = structuredClone(PLAN_A);
  const roomsBefore = JSON.stringify(plan.rooms);
  const apartment7 = plan.rooms.filter((r) => r.apartmentNumber === '7');
  assert.ok(apartment7.length >= 2);

  const { plan: out, created } = addConcreteFromRooms(plan, apartment7, 'slab');
  assert.equal(created.length, apartment7.length);
  assert.deepEqual(concreteOf(out), created);
  created.forEach((el, i) => {
    assert.deepEqual(el.points, apartment7[i].points); // identical native points
    assert.notEqual(el.points, apartment7[i].points); // a copy, not a shared array
    assert.notEqual(el.points[0], apartment7[i].points[0]);
    assert.equal(el.pageNumber, apartment7[i].pageNumber);
    assert.equal(el.kind, 'slab');
    assert.equal(el.autoNumber, i + 1);
    assert.notEqual(el.id, apartment7[i].id);
    // nothing of the room's finishes data came along
    assert.deepEqual(Object.keys(el).sort(), ['autoNumber', 'id', 'kind', 'mark', 'pageNumber', 'points', 'wastePercent']);
  });
  assert.equal(new Set(created.map((e) => e.id)).size, created.length);

  // the original plan and every room are exactly as they were; editing a copy never reaches a room
  assert.equal(JSON.stringify(plan.rooms), roomsBefore);
  assert.equal(out.rooms, plan.rooms);
  assert.equal(concreteOf(plan).length, 0);
  created[0].points[0].x = -999;
  assert.notEqual(apartment7[0].points[0].x, -999);
});

test('rooms → concrete continues the numbering, and skips rooms with no usable outline', () => {
  const plan = addConcreteElement(structuredClone(PLAN_A), { ...el('wall', 'W04'), id: 'w' });
  const flat = { ...PLAN_A.rooms[0], id: 'flat', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }] }; // zero area
  const tiny = { ...PLAN_A.rooms[0], id: 'tiny', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] };
  const { plan: out, created } = addConcreteFromRooms(plan, [flat, tiny, PLAN_A.rooms[0]], 'wall');
  assert.equal(created.length, 1);
  assert.equal(created[0].autoNumber, 5);
  assert.equal(concreteOf(out).length, 2);
  assert.equal(addConcreteFromRooms(plan, [], 'slab').created.length, 0);
});
