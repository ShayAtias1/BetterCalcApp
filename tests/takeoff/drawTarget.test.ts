// The draw target: rooms stay the default and keep being created exactly as before; a structural
// target (not reachable from the UI yet) creates nothing; opening or closing a plan resets it.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_A } from './fixtures.ts';

// The store pulls in pdf.js, which expects browser globals at load time; this test never renders a page.
Object.assign(globalThis, { DOMMatrix: class {}, DOMPoint: class {}, DOMRect: class {}, Path2D: class {} });
const { useAppStore } = await import('../../src/store/appStore.ts');

// Drawing schedules an autosave; closing the plan cancels it (there is no IndexedDB here to save to).
after(() => useAppStore.getState().setProject(null));

const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

function open() {
  useAppStore.getState().setProject(structuredClone(PLAN_A));
  return useAppStore.getState();
}
const roomCount = () => useAppStore.getState().project!.rooms.length;

test('the draw target defaults to room', () => {
  assert.equal(open().drawTarget, 'room');
});

test('room target: polygon and rectangle each create one room, select it, and return to the select tool', () => {
  open();
  const before = roomCount();
  useAppStore.setState({ drawingPoints: square.slice(0, 3), toolMode: 'draw' });
  useAppStore.getState().finishDrawing();
  let s = useAppStore.getState();
  assert.equal(roomCount(), before + 1);
  assert.equal(s.selectedRoomId, s.project!.rooms.at(-1)!.id);
  assert.equal(s.manuallyCreatedRoomId, s.selectedRoomId);
  assert.equal(s.toolMode, 'select');
  assert.deepEqual(s.drawingPoints, []);

  useAppStore.setState({ toolMode: 'draw-rect' });
  useAppStore.getState().finishRectangle({ x: 10, y: 10 }, { x: 60, y: 40 });
  s = useAppStore.getState();
  assert.equal(roomCount(), before + 2);
  assert.deepEqual(s.project!.rooms.at(-1)!.points, [{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 40 }, { x: 10, y: 40 }]);
  assert.equal(s.history.length, 2); // one undo step per room, as before
});

test('a polygon with fewer than three points still creates nothing and clears the points', () => {
  open();
  useAppStore.setState({ drawingPoints: square.slice(0, 2) });
  useAppStore.getState().finishDrawing();
  assert.equal(roomCount(), PLAN_A.rooms.length);
  assert.deepEqual(useAppStore.getState().drawingPoints, []);
});

test('the rebar target creates a mesh zone (and no room, no concrete); a degenerate shape creates nothing', () => {
  open();
  useAppStore.getState().setDrawTarget('rebar');
  useAppStore.setState({ drawingPoints: square, toolMode: 'draw' });
  useAppStore.getState().finishDrawing();
  let s = useAppStore.getState();
  assert.equal(roomCount(), PLAN_A.rooms.length);
  assert.equal(s.project!.concreteElements, undefined);
  assert.equal(s.project!.rebarItems!.length, 1);
  assert.equal(s.project!.rebarItems![0].kind, 'mesh');
  assert.equal(s.selectedRebarId, s.project!.rebarItems![0].id);
  assert.equal(s.toolMode, 'select');
  assert.deepEqual(s.drawingPoints, []);

  useAppStore.getState().finishRectangle({ x: 5, y: 5 }, { x: 5, y: 80 }); // no width
  s = useAppStore.getState();
  assert.equal(s.project!.rebarItems!.length, 1);
});

test('opening or closing a plan resets the target to room', () => {
  open();
  useAppStore.getState().setDrawTarget('rebar');
  useAppStore.getState().setProject(structuredClone(PLAN_A)); // what openPlan does
  assert.equal(useAppStore.getState().drawTarget, 'room');
  useAppStore.getState().setDrawTarget('concrete');
  useAppStore.getState().setProject(null); // what closePlan does
  assert.equal(useAppStore.getState().drawTarget, 'room');
});

test('undo and redo leave the draw target alone and keep their room behavior', () => {
  open();
  useAppStore.setState({ toolMode: 'draw-rect' });
  useAppStore.getState().finishRectangle({ x: 0, y: 0 }, { x: 10, y: 10 });
  const n = roomCount();
  useAppStore.getState().undo();
  assert.equal(roomCount(), n - 1);
  assert.equal(useAppStore.getState().selectedRoomId, null);
  useAppStore.getState().redo();
  assert.equal(roomCount(), n);
});
