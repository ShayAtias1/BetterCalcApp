import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_A } from '../takeoff/fixtures.ts';
import type { NewPlanOpening } from '../../src/types/index.ts';
import { addPlanOpening, cloneOpeningsForRooms, reviewPlanOpening, updatePlanOpening, withOpeningRoomChanges } from '../../src/lib/planOpenings.ts';

const input: NewPlanOpening = {
  pageNumber: 1, geometry: { endpointA: { x: 10, y: 20 }, endpointB: { x: 50, y: 20 } },
  kind: 'door', mechanism: 'hinged', walkableAccess: 'supported',
  roomIds: ['r-master'], roomSides: [{ roomId: 'r-master' }, 'exterior'],
  widthM: 1, heightM: 2, sillHeightM: null, quantity: 1, source: 'manual', legacyRefs: [],
};

test('explicit exterior and unassigned sides persist without changing room quantity rows', () => {
  const plan = addPlanOpening(structuredClone(PLAN_A), input, 'opening', 1);
  const reviewed = reviewPlanOpening(plan, 'opening', 'approved', 2);
  const edited = updatePlanOpening(reviewed, 'opening', { roomSides: [null, { roomId: 'r-master' }], roomIds: ['r-master'] }, 3);
  assert.deepEqual(edited.openings![0].roomSides, [null, { roomId: 'r-master' }]);
  assert.equal(edited.openings![0].approval.status, 'draft');
  assert.equal(edited.openings![0].quantityReview?.associationsConfirmed, false);
  assert.deepEqual(edited.rooms, PLAN_A.rooms);
  assert.deepEqual(plan.openings![0].roomSides, [{ roomId: 'r-master' }, 'exterior']);
});

test('duplicate rooms and inconsistent side metadata are rejected', () => {
  assert.throws(() => addPlanOpening(PLAN_A, { ...input, roomSides: [{ roomId: 'r-master' }, { roomId: 'r-master' }] }, 'bad', 1));
  assert.throws(() => addPlanOpening(PLAN_A, { ...input, roomSides: [null, 'exterior'] }, 'bad', 1));
  const plan = addPlanOpening(PLAN_A, input, 'opening', 1);
  const edited = updatePlanOpening(plan, 'opening', { roomIds: [], legacyRefs: [] }, 2);
  assert.equal(edited.openings![0].roomSides, undefined);
});

test('room copies remap side IDs and room removal retains the exterior side', () => {
  const plan = addPlanOpening(PLAN_A, input, 'opening', 1);
  const source = plan.rooms.find(room => room.id === 'r-master')!;
  const copy = { ...structuredClone(source), id: 'room-copy', openings: [] };
  const copies = cloneOpeningsForRooms(plan, [{ source, copy }], plan.id, () => 'opening-copy', 2);
  assert.deepEqual(copies[0].roomSides, [{ roomId: 'room-copy' }, 'exterior']);
  assert.deepEqual(copies[0].roomIds, ['room-copy']);
  const removed = withOpeningRoomChanges(plan, plan.rooms.filter(room => room.id !== source.id), 3);
  assert.deepEqual(removed.openings![0].roomSides, [null, 'exterior']);
  assert.deepEqual(removed.openings![0].roomIds, []);
});

test('old records with more than two associations remain intact during unrelated edits', () => {
  const roomIds = PLAN_A.rooms.filter(room => room.pageNumber === 1).slice(0, 3).map(room => room.id);
  assert.equal(roomIds.length, 3);
  const { roomSides: _sides, ...legacyInput } = input;
  const plan = addPlanOpening(PLAN_A, { ...legacyInput, roomIds }, 'old-opening', 1);
  const edited = updatePlanOpening(plan, 'old-opening', { label: 'Updated label' }, 2);
  assert.deepEqual(edited.openings![0].roomIds, roomIds);
  assert.equal(edited.openings![0].roomSides, undefined);
});
