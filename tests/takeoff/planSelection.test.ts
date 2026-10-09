import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { selectionBox, polygonInSelection, segmentInSelection } from '../../src/lib/planSelection.ts';
import { PLAN_A } from './fixtures.ts';
Object.assign(globalThis, { DOMMatrix: class {}, DOMPoint: class {}, DOMRect: class {}, Path2D: class {} });
const { useAppStore } = await import('../../src/store/appStore.ts');
const state = () => useAppStore.getState();
after(() => state().setProject(null));
const input = { pageNumber: 1, geometry: { endpointA: { x: 10, y: 20 }, endpointB: { x: 70, y: 20 } },
  kind: 'window' as const, mechanism: 'fixed' as const, walkableAccess: 'unsupported' as const,
  roomIds: ['r-master'], widthM: 1, heightM: 1, sillHeightM: 1, quantity: 1, source: 'manual' as const, legacyRefs: [] };

test('rectangle selection handles reversed drags, crossing spans, enclosed rooms and nonintersections', () => {
  const box = selectionBox({ x: 20, y: 20 }, { x: 10, y: 10 });
  assert.deepEqual(box, { x: 10, y: 10, width: 10, height: 10 });
  assert.ok(segmentInSelection({ x: 0, y: 15 }, { x: 30, y: 15 }, box));
  assert.ok(!segmentInSelection({ x: 0, y: 5 }, { x: 30, y: 5 }, box));
  assert.ok(!segmentInSelection({ x: 0, y: 19 }, { x: 19, y: 0 }, box));
  assert.ok(polygonInSelection([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }], box));
  assert.ok(!polygonInSelection([], box));
});

test('mixed selection deletes rooms and openings in one undo step and restores associations', () => {
  state().setProject(structuredClone(PLAN_A));
  const a = state().addPlanOpening(input)!, b = state().addPlanOpening(input)!;
  state().setPlanSelection(['r-master', 'r-master', 'missing'], [a, a, 'missing']);
  assert.deepEqual(state().selectedRoomIds, ['r-master']);
  assert.deepEqual(state().selectedOpeningIds, [a]);
  const before = structuredClone(state().project), history = state().history.length;
  state().deletePlanSelection();
  assert.equal(state().history.length, history + 1);
  assert.ok(!state().project!.rooms.some(r => r.id === 'r-master'));
  assert.ok(!state().project!.openings!.some(o => o.id === a));
  assert.deepEqual(state().project!.openings!.find(o => o.id === b)!.roomIds, []);
  assert.deepEqual(state().selectedOpeningIds, []);
  state().undo(); assert.deepEqual(state().project, before);
  state().setPlanSelection(['r-master'], [a]); state().setCurrentPage(2);
  assert.deepEqual(state().selectedOpeningIds, []); assert.deepEqual(state().selectedRoomIds, []);
});

test('reject remaining preserves previous decisions and is one undo step', () => {
  state().setProject(structuredClone(PLAN_A));
  const a = state().addPlanOpening(input)!, b = state().addPlanOpening(input)!, c = state().addPlanOpening(input)!;
  state().approvePlanOpening(a);
  const before = structuredClone(state().project), history = state().history.length;
  state().rejectPlanOpenings([a, b, c, b, 'missing']);
  assert.equal(state().history.length, history + 1);
  assert.equal(state().project!.openings!.find(o => o.id === a)!.approval.status, 'approved');
  assert.ok(state().project!.openings!.filter(o => o.id === b || o.id === c).every(o => o.approval.status === 'rejected'));
  state().undo(); assert.deepEqual(state().project, before);
});
