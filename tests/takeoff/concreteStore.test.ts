// The concrete workflow through the store: finishing a zone creates a real element (and only that),
// selection and the tool follow, history/undo/redo cover it and clear the selection, and rooms
// keep working. Browser globals are stubbed because the store loads pdf.js.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_A } from './fixtures.ts';
import { concreteOf } from '../../src/lib/structuralPlan.ts';
import { calculateConcrete } from '../../src/lib/concrete.ts';
import { buildConcreteSummary } from '../../src/lib/structuralQuantities.ts';

Object.assign(globalThis, { DOMMatrix: class {}, DOMPoint: class {}, DOMRect: class {}, Path2D: class {} });
const { useAppStore } = await import('../../src/store/appStore.ts');
after(() => useAppStore.getState().setProject(null)); // cancels the pending autosave (no IndexedDB here)

const store = () => useAppStore.getState();
const elements = () => concreteOf(store().project!);
const tri = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 100, y: 150 }];

function openConcrete(page = 1) {
  store().setProject(structuredClone(PLAN_A));
  store().setCurrentPage(page);
  store().setDrawTarget('concrete');
}

test('a polygon creates a concrete element of the chosen kind, with page, mark, selection and the select tool', () => {
  openConcrete(2);
  store().setConcreteKind('wall');
  useAppStore.setState({ drawingPoints: tri, toolMode: 'draw' });
  store().finishDrawing();
  const s = store();
  assert.equal(elements().length, 1);
  const e = elements()[0];
  assert.equal(e.kind, 'wall');
  assert.equal(e.pageNumber, 2);
  assert.equal(e.mark, 'W01');
  assert.deepEqual(e.points, tri);
  assert.equal(s.selectedConcreteId, e.id);
  assert.equal(s.selectedRoomId, null);
  assert.equal(s.toolMode, 'select');
  assert.deepEqual(s.drawingPoints, []);
  assert.equal(s.project!.rooms.length, PLAN_A.rooms.length); // no room
  assert.equal(s.history.length, 1);
});

test('a rectangle creates an element with the four corners; marks count per kind', () => {
  openConcrete();
  store().setConcreteKind('slab');
  store().finishRectangle({ x: 10, y: 10 }, { x: 110, y: 60 });
  store().setConcreteKind('column');
  store().finishRectangle({ x: 0, y: 0 }, { x: 20, y: 20 });
  store().setConcreteKind('slab');
  store().finishRectangle({ x: 300, y: 300 }, { x: 400, y: 400 });
  assert.deepEqual(elements().map((e) => e.mark), ['S01', 'C01', 'S02']);
  assert.deepEqual(elements()[0].points, [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 60 }, { x: 10, y: 60 }]);
});

test('no incomplete element: too few points, a zero-area rectangle, or no plan create nothing', () => {
  openConcrete();
  useAppStore.setState({ drawingPoints: tri.slice(0, 2) });
  store().finishDrawing();
  store().finishRectangle({ x: 5, y: 5 }, { x: 5, y: 80 }); // no width
  store().finishRectangle({ x: 5, y: 5 }, { x: 5, y: 5 });
  assert.equal(elements().length, 0);
  assert.equal(store().history.length, 0);
  assert.equal(store().selectedConcreteId, null);
  assert.deepEqual(store().drawingPoints, []);
});

test('update is debounced into history, delete clears the selection, both are undoable', () => {
  openConcrete();
  store().finishRectangle({ x: 0, y: 0 }, { x: 100, y: 100 });
  const id = elements()[0].id;
  store().updateConcreteElement(id, { depthM: 0.2 });
  store().updateConcreteElement(id, { depthM: 0.25 });
  store().updateConcreteElement(id, { grade: 'B30' });
  assert.equal(elements()[0].depthM, 0.25);
  assert.equal(elements()[0].grade, 'B30');

  store().deleteConcreteElement(id);
  assert.equal(elements().length, 0);
  assert.equal(store().selectedConcreteId, null);

  store().undo(); // the delete
  assert.equal(elements().length, 1);
  assert.equal(elements()[0].depthM, 0.25);
  assert.equal(store().selectedConcreteId, null);
  store().redo();
  assert.equal(elements().length, 0);
});

test('undo and redo clear the concrete selection and the room selection, and remove/restore the element', () => {
  openConcrete();
  store().finishRectangle({ x: 0, y: 0 }, { x: 100, y: 100 });
  assert.ok(store().selectedConcreteId);
  store().undo();
  assert.equal(elements().length, 0);
  assert.equal(store().selectedConcreteId, null);
  store().redo();
  assert.equal(elements().length, 1);
  assert.equal(store().selectedConcreteId, null);
});

test('changing page, or opening another plan, clears the selection', () => {
  openConcrete();
  store().finishRectangle({ x: 0, y: 0 }, { x: 100, y: 100 });
  store().setCurrentPage(2);
  assert.equal(store().selectedConcreteId, null);
  store().setSelectedConcreteId(elements()[0].id);
  store().setProject(structuredClone(PLAN_A));
  assert.equal(store().selectedConcreteId, null);
  assert.equal(store().drawTarget, 'room');
});

test('switching the target drops a shape in progress, but re-asserting the same target does not', () => {
  openConcrete();
  useAppStore.setState({ drawingPoints: tri });
  store().setDrawTarget('concrete');
  assert.equal(store().drawingPoints.length, 3);
  store().setDrawTarget('room');
  assert.deepEqual(store().drawingPoints, []);
});

test('rooms still draw as before when the target is room, with concrete data alongside', () => {
  openConcrete();
  store().finishRectangle({ x: 0, y: 0 }, { x: 100, y: 100 });
  store().setDrawTarget('room');
  const rooms = store().project!.rooms.length;
  store().finishRectangle({ x: 0, y: 0 }, { x: 50, y: 50 });
  assert.equal(store().project!.rooms.length, rooms + 1);
  assert.equal(elements().length, 1);
});

test('the calculation reads the element exactly as the form edits it: manual size works on an uncalibrated page', () => {
  openConcrete();
  store().setConcreteKind('column');
  store().finishRectangle({ x: 0, y: 0 }, { x: 40, y: 40 });
  const id = elements()[0].id;
  // page 1 of PLAN_A has a scale, page 3 does not; the element's own page decides
  store().updateConcreteElement(id, { depthM: 3, quantity: 4, sizeOverride: { lengthM: 0.4, widthM: 0.4 } });
  const e = elements()[0];
  const calc = calculateConcrete(e, null);
  assert.equal(calc.status, 'ok');
  assert.ok(Math.abs(calc.volumeM3! - 1.92) < 1e-9);
  store().updateConcreteElement(id, { sizeOverride: undefined });
  assert.equal(calculateConcrete(elements()[0], null).status, 'no-scale');
});

test('changing the kind is one undo step, updates the summary at once, and leaves the zone alone', () => {
  openConcrete();
  store().setProject(structuredClone(PLAN_A));
  store().setCurrentPage(1);
  store().setDrawTarget('concrete');
  store().setConcreteKind('slab');
  store().finishRectangle({ x: 0, y: 0 }, { x: 100, y: 100 });
  const id = elements()[0].id;
  store().updateConcreteElement(id, { depthM: 2 });
  store().changeConcreteElementKind(id, 'wall');
  assert.equal(elements()[0].kind, 'wall');
  assert.equal(elements()[0].mark, 'W01');
  assert.deepEqual(elements()[0].points, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]);
  const historyAfter = store().history.length; // includes the pending depth edit the change flushed
  assert.deepEqual(buildConcreteSummary(store().project!).rows.map((r) => r.kind), ['wall']);

  store().changeConcreteElementKind(id, 'wall'); // same kind: no history entry
  assert.equal(store().history.length, historyAfter);

  store().undo(); // exactly the kind change, not the depth edit before it
  assert.equal(elements()[0].kind, 'slab');
  assert.equal(elements()[0].mark, 'S01');
  assert.equal(elements()[0].depthM, 2);
  store().redo();
  assert.equal(elements()[0].kind, 'wall');
});
