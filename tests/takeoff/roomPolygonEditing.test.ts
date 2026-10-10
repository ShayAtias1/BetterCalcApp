import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { insertPolygonVertex, reshapeArea } from '../../src/lib/areaGeometryEditing.ts';
import { roomMetrics } from '../../src/lib/quantities.ts';
import { PLAN_A } from './fixtures.ts';
Object.assign(globalThis, { DOMMatrix: class {}, DOMPoint: class {}, DOMRect: class {}, Path2D: class {} });
const { useAppStore } = await import('../../src/store/appStore.ts');
after(() => useAppStore.getState().setProject(null));
const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

test('edge insertion projects the clicked position, including the closing edge, without changing area', () => {
  const inserted = insertPolygonVertex(square, 0, { x: 27, y: 2 })!;
  assert.deepEqual(inserted[1], { x: 27, y: 0 });
  assert.equal(inserted.length, 5);
  assert.deepEqual(square[1], { x: 100, y: 0 });
  const closing = insertPolygonVertex(square, 3, { x: -2, y: 62 })!;
  assert.deepEqual(closing.at(-1), { x: 0, y: 62 });
  assert.equal(insertPolygonVertex(square, 0, square[0]), null);
  assert.equal(insertPolygonVertex(square, 0, { x: 101, y: 0 }), null);
});

test('saved room insertion and vertex dragging preserve metadata, recalculate quantities, and undo/redo separately', () => {
  const plan = structuredClone(PLAN_A);
  plan.rooms[0].points = square;
  useAppStore.getState().setProject(plan);
  const original = structuredClone(useAppStore.getState().project!.rooms[0]);
  const calibration = plan.pages[1].calibration!;
  const baseline = roomMetrics(original, calibration);
  const inserted = insertPolygonVertex(square, 0, { x: 27, y: 2 })!;
  useAppStore.getState().editAreaGeometry('room', original.id, inserted);
  let room = useAppStore.getState().project!.rooms[0];
  assert.deepEqual(roomMetrics(room, calibration), baseline);
  assert.deepEqual(room.workItems, original.workItems);
  assert.equal(room.id, original.id);
  const dragged = reshapeArea(room.points, 1, { x: 27, y: -30 })!;
  useAppStore.getState().editAreaGeometry('room', room.id, dragged);
  room = useAppStore.getState().project!.rooms[0];
  assert.notEqual(roomMetrics(room, calibration).areaM2, baseline.areaM2);
  assert.notEqual(roomMetrics(room, calibration).perimeterM, baseline.perimeterM);
  assert.equal(useAppStore.getState().history.length, 2);
  useAppStore.getState().undo();
  assert.deepEqual(useAppStore.getState().project!.rooms[0].points, inserted);
  useAppStore.getState().undo();
  assert.deepEqual(useAppStore.getState().project!.rooms[0].points, square);
  useAppStore.getState().redo();
  useAppStore.getState().redo();
  assert.deepEqual(useAppStore.getState().project!.rooms[0].points, dragged);
});
