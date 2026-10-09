import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_A } from './fixtures.ts';
Object.assign(globalThis, { DOMMatrix: class {}, DOMPoint: class {}, DOMRect: class {}, Path2D: class {} });
const { useAppStore } = await import('../../src/store/appStore.ts');
const state = () => useAppStore.getState();
after(() => state().setProject(null));

test('bulk deletion is one history entry and Undo/Redo restore rooms and opening associations together', () => {
  state().setProject(structuredClone(PLAN_A));
  const id = state().addPlanOpening({ pageNumber: 1, geometry: { endpointA: { x: 10, y: 20 }, endpointB: { x: 70, y: 20 } },
    kind: 'door', mechanism: 'hinged', walkableAccess: 'supported', roomIds: ['r-master','r-bed1'],
    widthM: 1, heightM: 2, sillHeightM: 0, quantity: 1, source: 'manual', legacyRefs: [],
    quantityReview: { associationsConfirmed: true, distinctLegacyRoomIds: [] } })!;
  state().approvePlanOpening(id);
  state().setSelectedRoomId('r-master');
  const before = structuredClone(state().project), history = state().history.length;
  state().deleteRooms(['r-master', 'r-bed1', 'r-master', 'not-a-room']);
  assert.equal(state().history.length, history + 1);
  assert.equal(state().selectedRoomId, null);
  assert.deepEqual(state().project!.rooms.map(r => r.id), before!.rooms.filter(r => !['r-master','r-bed1'].includes(r.id)).map(r => r.id));
  const opening = state().project!.openings!.find(o => o.id === id)!;
  assert.deepEqual(opening.roomIds, []);
  assert.equal(opening.approval.status, 'draft');
  const deleted = structuredClone(state().project);
  state().undo();
  assert.deepEqual(state().project!.rooms, before!.rooms);
  assert.deepEqual(state().project!.openings, before!.openings);
  state().redo();
  assert.deepEqual(state().project!.rooms, deleted!.rooms);
  assert.deepEqual(state().project!.openings, deleted!.openings);
});

test('empty/stale ids do not add history and individual deletion remains available', () => {
  state().setProject(structuredClone(PLAN_A));
  state().setSelectedRoomId('r-living');
  const plan = state().project, history = state().history.length;
  state().deleteRooms([]); state().deleteRooms(['absent']);
  assert.equal(state().project, plan); assert.equal(state().history.length, history);
  state().deleteRooms(['r-master']);
  assert.equal(state().selectedRoomId, 'r-living');
  state().deleteRoom('r-bed1');
  assert.ok(!state().project!.rooms.some(r => r.id === 'r-bed1'));
  state().undo();
  assert.ok(state().project!.rooms.some(r => r.id === 'r-bed1'));
  assert.ok(!state().project!.rooms.some(r => r.id === 'r-master'));
});

test('bulk opening deletion restores all records in one Undo and preserves legacy rows and import guards', () => {
  const plan = structuredClone(PLAN_A);
  plan.aiOpeningImportKeys = ['consumed-review'];
  state().setProject(plan);
  const input = { pageNumber: 1, geometry: { endpointA: { x: 10, y: 20 }, endpointB: { x: 70, y: 20 } },
    kind: 'window' as const, mechanism: 'fixed' as const, walkableAccess: 'unsupported' as const,
    roomIds: [], widthM: null, heightM: null, sillHeightM: null, quantity: null, source: 'manual' as const, legacyRefs: [] };
  const a = state().addPlanOpening(input)!, b = state().addPlanOpening(input)!;
  state().selectPlanOpening(a); state().beginOpeningEndpointEdit(a);
  const before = structuredClone(state().project), history = state().history.length;
  state().removePlanOpenings([a,b,a,'absent']);
  assert.equal(state().history.length,history + 1);
  assert.equal(state().selectedOpeningId,null); assert.equal(state().openingPlacement,null);
  assert.deepEqual(state().project!.rooms,before!.rooms);
  assert.deepEqual(state().project!.aiOpeningImportKeys,['consumed-review']);
  assert.deepEqual(state().project!.openings,[]);
  state().undo(); assert.deepEqual(state().project!.openings,before!.openings);
  state().redo(); assert.deepEqual(state().project!.openings,[]);
  const after = state().project, afterHistory = state().history.length;
  state().removePlanOpenings([]); state().removePlanOpenings(['absent']);
  assert.equal(state().project,after); assert.equal(state().history.length,afterHistory);
});
