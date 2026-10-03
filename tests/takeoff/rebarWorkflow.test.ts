// The rebar workflow without the UI: pure mutations (marks, mesh, manual bars, layers, two directions,
// copy from rooms) and the same through the store (history, selection, persistence-shaped data,
// duplication). Calculation goes through the M5 engine.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_A } from './fixtures.ts';
import {
  addRebarItem,
  addRebarLayer,
  addRebarMeshFromRooms,
  newRebarBars,
  newRebarMesh,
  oppositeDirection,
  removeRebarItem,
  removeRebarLayer,
  updateRebarItem,
  updateRebarLayer,
} from '../../src/lib/structuralMutations.ts';
import { rebarOf } from '../../src/lib/structuralPlan.ts';
import { nextAutoNumber } from '../../src/lib/structuralMarks.ts';
import { calculateRebar, rebarNotation } from '../../src/lib/rebar.ts';
import { clonePlanForDuplicate } from '../../src/lib/planDuplication.ts';
import type { Plan, Point } from '../../src/types/index.ts';
import type { RebarItem } from '../../src/types/structural.ts';

Object.assign(globalThis, { DOMMatrix: class {}, DOMPoint: class {}, DOMRect: class {}, Path2D: class {} });
const { useAppStore } = await import('../../src/store/appStore.ts');
after(() => useAppStore.getState().setProject(null));

const CAL = { pixelDistance: 100, realDistanceMeters: 1, metersPerPixel: 0.01 };
const rect = (w: number, h: number): Point[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const L_SHAPE: Point[] = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 600 }, { x: 0, y: 600 }];
const near = (a: number | null, b: number, eps = 1e-9) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} vs ${b}`);
const fresh = (): Plan => structuredClone(PLAN_A);

test('automatic numbers: counted separately for mesh zones and manual bars', () => {
  let plan = fresh();
  assert.equal(nextAutoNumber(rebarOf(plan), 'mesh'), 1);
  assert.equal(nextAutoNumber(rebarOf(plan), 'bars'), 1);
  plan = addRebarItem(plan, newRebarMesh(plan, 1, rect(100, 100)));
  plan = addRebarItem(plan, newRebarBars(plan, 1));
  plan = addRebarItem(plan, newRebarMesh(plan, 1, rect(100, 100)));
  assert.deepEqual(rebarOf(plan).map((i) => [i.kind, i.mark, i.autoNumber]), [['mesh', '', 1], ['bars', '', 1], ['mesh', '', 2]]);
  assert.equal(nextAutoNumber(rebarOf(plan), 'bars'), 2);
  // old letter marks are read as the same numbers
  const old = { rebarItems: [{ ...rebarOf(plan)[0], mark: 'M07', autoNumber: undefined }, { ...rebarOf(plan)[1], mark: 'R03', autoNumber: undefined }] } as unknown as Plan;
  assert.deepEqual(rebarOf(old).map((i) => [i.mark, i.autoNumber]), [['', 7], ['', 3]]);
});

test('a new mesh zone is minimal: points, page, mark, one empty layer, zero waste — not calculable until filled in', () => {
  const plan = fresh();
  const m = newRebarMesh(plan, 2, rect(1000, 800));
  assert.equal(m.kind, 'mesh');
  assert.equal(m.pageNumber, 2);
  assert.equal(m.layers.length, 1);
  assert.equal(m.layers[0].diameterMm, 0);
  assert.equal(calculateRebar(m, CAL).status, 'invalid-input');
  assert.equal(calculateRebar(m, CAL).totalLengthM, null);
  assert.equal(calculateRebar({ ...m, layers: [] }, CAL).status, 'no-layers');
  const bars = newRebarBars(plan, 3);
  assert.equal(bars.pageNumber, 3);
  assert.equal(calculateRebar(bars, null).status, 'invalid-input');
});

test('update / remove: id and kind are fixed, undefined removes a key, an unknown id changes nothing', () => {
  let plan = addRebarItem(fresh(), newRebarMesh(fresh(), 1, rect(100, 100)));
  const id = rebarOf(plan)[0].id;
  plan = updateRebarItem(plan, id, { mark: 'Slab bottom', wastePercent: 5, sizeOverride: { lengthM: 3, widthM: 2 } });
  assert.equal(rebarOf(plan)[0].mark, 'Slab bottom');
  plan = updateRebarItem(plan, id, { sizeOverride: undefined });
  assert.equal('sizeOverride' in rebarOf(plan)[0], false);
  const hijack = updateRebarItem(plan, id, { id: 'x', kind: 'bars' } as never);
  assert.equal(rebarOf(hijack)[0].id, id);
  assert.equal(rebarOf(hijack)[0].kind, 'mesh');
  assert.equal(updateRebarItem(plan, 'nope', { mark: 'x' }), plan);
  assert.equal(removeRebarItem(plan, 'nope'), plan);
  assert.equal(rebarOf(removeRebarItem(plan, id)).length, 0);
});

test('layers: add, edit and remove; layer edits on a bars row or an unknown mesh do nothing', () => {
  let plan = addRebarItem(fresh(), newRebarMesh(fresh(), 1, rect(1000, 800)));
  const id = rebarOf(plan)[0].id;
  const layerId = (rebarOf(plan)[0] as { layers: { id: string }[] }).layers[0].id;

  plan = updateRebarLayer(plan, id, layerId, { diameterMm: 12, spacingM: 0.2, direction: 'long' });
  plan = addRebarLayer(plan, id, { diameterMm: 10, spacingM: 0.25, direction: 'short' });
  const mesh = rebarOf(plan)[0];
  assert.ok(mesh.kind === 'mesh');
  assert.equal(mesh.layers.length, 2);
  assert.notEqual(mesh.layers[0].id, mesh.layers[1].id);
  assert.equal(rebarNotation(mesh.layers), 'Ø12 @ 200 / Ø10 @ 250');

  // the engine reads exactly what the form wrote: 41 × 10 m + 41 × 8 m
  const c = calculateRebar(mesh, CAL);
  assert.equal(c.status, 'ok');
  near(c.totalLengthM, 41 * 10 + 41 * 8);

  plan = removeRebarLayer(plan, id, layerId);
  assert.equal((rebarOf(plan)[0] as { layers: unknown[] }).layers.length, 1);
  plan = removeRebarLayer(plan, id, (rebarOf(plan)[0] as { layers: { id: string }[] }).layers[0].id);
  assert.equal(calculateRebar(rebarOf(plan)[0], CAL).status, 'no-layers'); // removing every layer is allowed and not calculable

  const bars = addRebarItem(fresh(), newRebarBars(fresh(), 1));
  const barsId = rebarOf(bars)[0].id;
  assert.equal(addRebarLayer(bars, barsId), bars);
  assert.equal(addRebarLayer(bars, 'nope'), bars);
});

test('"two directions": a second layer with the first one\'s bars running the other way', () => {
  let plan = addRebarItem(fresh(), newRebarMesh(fresh(), 1, rect(1000, 800)));
  const id = rebarOf(plan)[0].id;
  const first = (rebarOf(plan)[0] as { layers: { id: string }[] }).layers[0].id;
  plan = updateRebarLayer(plan, id, first, { diameterMm: 12, spacingM: 0.2, direction: 'long' });
  const l = (rebarOf(plan)[0] as { layers: { diameterMm: number; spacingM: number; direction: 'long' | 'short' }[] }).layers[0];
  plan = addRebarLayer(plan, id, { diameterMm: l.diameterMm, spacingM: l.spacingM, direction: oppositeDirection(l.direction) });
  const layers = (rebarOf(plan)[0] as { layers: { diameterMm: number; spacingM: number; direction: string }[] }).layers;
  assert.deepEqual(layers.map((x) => [x.diameterMm, x.spacingM, x.direction]), [[12, 0.2, 'long'], [12, 0.2, 'short']]);
  assert.equal(oppositeDirection('short'), 'long');
  near(calculateRebar(rebarOf(plan)[0], CAL).totalLengthM, 410 + 51 * 8); // 41 × 10 m + 51 × 8 m
});

test('manual bars: calculated without any scale or shape, and have no overlay notation', () => {
  let plan = addRebarItem(fresh(), newRebarBars(fresh(), 2));
  const id = rebarOf(plan)[0].id;
  plan = updateRebarItem(plan, id, { diameterMm: 16, count: 10, lengthM: 6, wastePercent: 10 });
  const c = calculateRebar(rebarOf(plan)[0], null);
  assert.equal(c.status, 'ok');
  near(c.totalLengthM, 60);
  near(c.orderLengthM, 66);
  assert.equal((rebarOf(plan)[0] as { pageNumber: number }).pageNumber, 2);
});

test('an irregular mesh zone is an estimate with no bar count', () => {
  let plan = addRebarItem(fresh(), newRebarMesh(fresh(), 1, L_SHAPE));
  const id = rebarOf(plan)[0].id;
  const layer = (rebarOf(plan)[0] as { layers: { id: string }[] }).layers[0].id;
  plan = updateRebarLayer(plan, id, layer, { diameterMm: 12, spacingM: 0.15 });
  const c = calculateRebar(rebarOf(plan)[0], CAL);
  assert.equal(c.estimated, true);
  assert.equal(c.layers[0].barCount, null);
  near(c.totalLengthM, 180);
});

test('rooms → rebar: outlines copied (deep) as independent mesh zones with new ids and marks; rooms untouched', () => {
  const plan = fresh();
  const before = JSON.stringify(plan.rooms);
  const rooms = plan.rooms.filter((r) => r.apartmentNumber === '7');
  const { plan: out, created } = addRebarMeshFromRooms(plan, rooms);
  assert.equal(created.length, rooms.length);
  created.forEach((m, i) => {
    assert.deepEqual(m.points, rooms[i].points);
    assert.notEqual(m.points[0], rooms[i].points[0]);
    assert.equal(m.pageNumber, rooms[i].pageNumber);
    assert.equal(m.autoNumber, i + 1);
    assert.equal(m.layers.length, 1);
    assert.deepEqual(Object.keys(m).sort(), ['autoNumber', 'id', 'kind', 'layers', 'mark', 'pageNumber', 'points', 'wastePercent']);
  });
  assert.equal(new Set(created.map((m) => m.id)).size, created.length);
  assert.equal(JSON.stringify(plan.rooms), before);
  assert.equal(out.rooms, plan.rooms);
  assert.equal(rebarOf(plan).length, 0);
  const flat = { ...plan.rooms[0], id: 'flat', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }] };
  assert.equal(addRebarMeshFromRooms(plan, [flat]).created.length, 0);
});

test('persistence and duplication: mesh layers and manual bars survive a round trip and a duplicate gets new ids', () => {
  let plan = addRebarItem(fresh(), newRebarMesh(fresh(), 1, rect(1000, 800)));
  plan = addRebarItem(plan, newRebarBars(plan, 2));
  const meshId = rebarOf(plan)[0].id;
  plan = addRebarLayer(plan, meshId, { diameterMm: 12, spacingM: 0.2, direction: 'short' });
  const viaClone = structuredClone(plan);
  assert.deepEqual(rebarOf(viaClone), rebarOf(plan));
  assert.deepEqual(rebarOf(JSON.parse(JSON.stringify(plan)) as Plan), rebarOf(plan));

  const copy = clonePlanForDuplicate(plan, 'copy');
  const ids = (items: RebarItem[]) => items.flatMap((i) => [i.id, ...(i.kind === 'mesh' ? i.layers.map((l) => l.id) : [])]);
  assert.equal(ids(rebarOf(copy)).filter((id) => ids(rebarOf(plan)).includes(id)).length, 0);
  assert.equal(rebarOf(copy).length, 2);
});

// ---------- through the store ----------

const store = () => useAppStore.getState();
const items = () => rebarOf(store().project!);

function openRebar(page = 1) {
  store().setProject(structuredClone(PLAN_A));
  store().setCurrentPage(page);
  store().setDrawTarget('rebar');
}

test('store: drawing creates a mesh, manual bars use the current page, layers/edits/delete are history steps, undo/redo clear selection', () => {
  openRebar(2);
  store().finishRectangle({ x: 0, y: 0 }, { x: 100, y: 100 });
  assert.equal(items().length, 1);
  assert.equal(items()[0].pageNumber, 2);
  assert.equal(store().selectedRebarId, items()[0].id);

  store().addRebarBars();
  assert.equal(items().length, 2);
  assert.equal(items()[1].kind, 'bars');
  assert.equal(items()[1].pageNumber, 2);
  assert.equal(store().selectedRebarId, items()[1].id);
  store().updateRebarItem(items()[1].id, { diameterMm: 16, count: 4, lengthM: 6 });

  const meshId = items()[0].id;
  const layerId = (items()[0] as { layers: { id: string }[] }).layers[0].id;
  store().updateRebarLayer(meshId, layerId, { diameterMm: 12, spacingM: 0.2 });
  store().addRebarLayer(meshId, { diameterMm: 12, spacingM: 0.2, direction: 'short' });
  assert.equal((items()[0] as { layers: unknown[] }).layers.length, 2);
  store().removeRebarLayer(meshId, layerId);
  assert.equal((items()[0] as { layers: unknown[] }).layers.length, 1);

  store().undo(); // the layer removal
  assert.equal((items()[0] as { layers: unknown[] }).layers.length, 2);
  assert.equal(store().selectedRebarId, null);
  store().redo();
  assert.equal((items()[0] as { layers: unknown[] }).layers.length, 1);

  store().setSelectedRebarId(meshId);
  store().deleteRebarItem(meshId);
  assert.equal(items().length, 1);
  assert.equal(store().selectedRebarId, null);
  store().undo();
  assert.equal(items().length, 2);
});

test('store: page change and plan switch clear the rebar selection; a nonexistent layer edit is not a history step', () => {
  openRebar();
  store().finishRectangle({ x: 0, y: 0 }, { x: 100, y: 100 });
  store().setCurrentPage(2);
  assert.equal(store().selectedRebarId, null);
  store().setSelectedRebarId(items()[0].id);
  store().setProject(structuredClone(PLAN_A));
  assert.equal(store().selectedRebarId, null);
  assert.equal(store().drawTarget, 'room');

  openRebar();
  store().finishRectangle({ x: 0, y: 0 }, { x: 100, y: 100 });
  const h = store().history.length;
  store().removeRebarLayer(items()[0].id, 'no-such-layer');
  store().addRebarLayer('no-such-item');
  assert.equal(store().history.length, h);
});

test('store: copyRoomsToRebar — one room selects its zone, an apartment makes one per room, one undo step, rooms unchanged', () => {
  store().setProject(structuredClone(PLAN_A));
  store().setDrawTarget('rebar');
  const rooms = store().project!.rooms;
  const roomsBefore = JSON.stringify(rooms);

  assert.equal(store().copyRoomsToRebar([rooms[0].id]), 1);
  assert.equal(items().length, 1);
  assert.equal(store().selectedRebarId, items()[0].id);
  assert.deepEqual((items()[0] as { points: Point[] }).points, rooms[0].points);

  const apartment = rooms.filter((r) => r.apartmentNumber === '7');
  assert.equal(store().copyRoomsToRebar(apartment.map((r) => r.id)), apartment.length);
  assert.equal(items().length, 1 + apartment.length);
  assert.equal(JSON.stringify(store().project!.rooms), roomsBefore);

  store().undo();
  assert.equal(items().length, 1);
  store().redo();
  assert.equal(items().length, 1 + apartment.length);
  assert.equal(store().copyRoomsToRebar([]), 0);
  assert.equal(store().copyRoomsToRebar(['nope']), 0);

  // editing and deleting a copy never reaches the room
  store().updateRebarItem(items()[0].id, { mark: 'X' });
  store().deleteRebarItem(items()[0].id);
  assert.equal(JSON.stringify(store().project!.rooms), roomsBefore);
});
