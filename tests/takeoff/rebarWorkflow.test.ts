// The rebar workflow without the UI: pure mutations (marks, mesh, manual bars, layers, two directions,
// copy from rooms) and the same through the store (history, selection, persistence-shaped data,
// duplication). Calculation goes through the M5 engine.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_A } from './fixtures.ts';
import {
  addRebarItem,
  addRebarMeshFromRooms,
  copyBottomToTop,
  newRebarBars,
  newRebarMesh,
  removeRebarItem,
  setMeshLevels,
  setMeshReinforcement,
  updateRebarItem,
} from '../../src/lib/structuralMutations.ts';
import { rebarOf } from '../../src/lib/structuralPlan.ts';
import { nextAutoNumber } from '../../src/lib/structuralMarks.ts';
import { calculateRebar } from '../../src/lib/rebar.ts';
import { levelChoice, specNotation, withMode, withSpec } from '../../src/lib/rebarMesh.ts';
import { clonePlanForDuplicate } from '../../src/lib/planDuplication.ts';
import type { Plan, Point } from '../../src/types/index.ts';
import type { MeshReinforcement, RebarItem, RebarMesh } from '../../src/types/structural.ts';

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

test('a new mesh zone is minimal: points, page, mark number, an empty Bottom level, zero waste — not calculable until filled in', () => {
  const plan = fresh();
  const m = newRebarMesh(plan, 2, rect(1000, 800));
  assert.equal(m.kind, 'mesh');
  assert.equal(m.pageNumber, 2);
  assert.deepEqual(m.bottom, { mode: 'uniform', spec: { diameterMm: 0, spacingM: 0 } });
  assert.equal(m.top, undefined);
  assert.equal('layers' in m, false);
  assert.equal(calculateRebar(m, CAL).status, 'invalid-input');
  assert.equal(calculateRebar(m, CAL).totalLengthM, null);
  assert.equal(calculateRebar({ ...m, bottom: undefined }, CAL).status, 'no-layers');
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

const mesh0 = (plan: Plan) => rebarOf(plan)[0] as RebarMesh;
const uniform = (diameterMm: number, spacingM: number): MeshReinforcement => ({ mode: 'uniform', spec: { diameterMm, spacingM } });

test('levels: choose Bottom / Top / both, keep what stays, drop what is switched off; a bars row or unknown id does nothing', () => {
  let plan = addRebarItem(fresh(), newRebarMesh(fresh(), 1, rect(1000, 800)));
  const id = rebarOf(plan)[0].id;
  plan = setMeshReinforcement(plan, id, 'bottom', uniform(12, 0.2));
  assert.equal(levelChoice(mesh0(plan)), 'bottom');

  plan = setMeshLevels(plan, id, 'both');
  assert.equal(levelChoice(mesh0(plan)), 'both');
  assert.deepEqual(mesh0(plan).bottom, uniform(12, 0.2)); // Bottom kept
  assert.deepEqual(mesh0(plan).top, uniform(0, 0)); // Top starts empty — never copied from Bottom
  assert.equal(calculateRebar(mesh0(plan), CAL).status, 'invalid-input'); // an enabled level that is empty: not calculable, no partial total
  assert.equal(calculateRebar(mesh0(plan), CAL).totalLengthM, null);

  plan = setMeshReinforcement(plan, id, 'top', uniform(10, 0.25));
  plan = setMeshLevels(plan, id, 'top'); // Bottom switched off
  assert.equal(mesh0(plan).bottom, undefined);
  assert.equal('bottom' in mesh0(plan), false);
  assert.deepEqual(mesh0(plan).top, uniform(10, 0.25));
  assert.equal(levelChoice(mesh0(plan)), 'top');

  assert.equal(setMeshLevels(plan, id, 'top'), plan); // no change → same plan
  assert.equal(setMeshLevels(plan, 'nope', 'both'), plan);
  assert.equal(setMeshReinforcement(plan, id, 'bottom', uniform(8, 0.1)), plan); // Bottom is not enabled
  const bars = addRebarItem(fresh(), newRebarBars(fresh(), 1));
  assert.equal(setMeshLevels(bars, rebarOf(bars)[0].id, 'both'), bars);
});

test('a valid Bottom is not invalidated by a Top that is not enabled; an enabled incomplete Top makes the item incomplete', () => {
  let plan = addRebarItem(fresh(), newRebarMesh(fresh(), 1, rect(1000, 800)));
  const id = rebarOf(plan)[0].id;
  plan = setMeshReinforcement(plan, id, 'bottom', uniform(12, 0.2));
  const bottomOnly = calculateRebar(mesh0(plan), CAL);
  assert.equal(bottomOnly.status, 'ok');
  near(bottomOnly.totalLengthM, 41 * 10 + 51 * 8); // 41 long bars × 10 m + 51 short bars × 8 m

  const withEmptyTop = calculateRebar(mesh0(setMeshLevels(plan, id, 'both')), CAL);
  assert.equal(withEmptyTop.status, 'invalid-input');
  assert.equal(withEmptyTop.totalLengthM, null);
  assert.equal(withEmptyTop.layers.filter((l) => l.level === 'bottom').every((l) => l.valid), true); // Bottom itself is fine
});

test('uniform = one specification in both directions; directional = a specification per side, kept apart', () => {
  let plan = addRebarItem(fresh(), newRebarMesh(fresh(), 1, rect(1000, 800)));
  const id = rebarOf(plan)[0].id;
  plan = setMeshReinforcement(plan, id, 'bottom', uniform(12, 0.2));
  const u = calculateRebar(mesh0(plan), CAL);
  assert.deepEqual(u.layers.map((l) => [l.level, l.direction, l.uniform, l.diameterMm, l.spacingM]), [['bottom', 'long', true, 12, 0.2], ['bottom', 'short', true, 12, 0.2]]);
  near(u.totalLengthM, 410 + 408);

  // switching to directional starts both sides from the one specification; they then differ freely
  let r = withMode(uniform(12, 0.2), 'directional');
  r = withSpec(r, 'short', { diameterMm: 10, spacingM: 0.15 });
  plan = setMeshReinforcement(plan, id, 'bottom', r);
  const d = calculateRebar(mesh0(plan), CAL);
  assert.deepEqual(d.layers.map((l) => [l.direction, l.uniform, l.diameterMm, l.spacingM]), [['long', false, 12, 0.2], ['short', false, 10, 0.15]]);
  near(d.layers[0].totalLengthM, 41 * 10); // 8 m ÷ 0.2 = 40 → 41 bars along 10 m
  near(d.layers[1].totalLengthM, 68 * 8); // 10 m ÷ 0.15 = 66.7 → 67 → 68 bars along 8 m
  // and back: the long side's values are kept
  assert.deepEqual(withMode(r, 'uniform'), uniform(12, 0.2));
});

test('Top + Bottom: independent specifications that add up; "Copy Bottom to Top" makes an independent copy', () => {
  let plan = addRebarItem(fresh(), newRebarMesh(fresh(), 1, rect(1000, 800)));
  const id = rebarOf(plan)[0].id;
  plan = setMeshReinforcement(plan, id, 'bottom', { mode: 'directional', long: { diameterMm: 12, spacingM: 0.2 }, short: { diameterMm: 10, spacingM: 0.15 } });
  const topOnly = setMeshLevels(plan, id, 'top'); // Bottom switched off
  assert.equal(copyBottomToTop(topOnly, id), topOnly); // nothing to copy from
  plan = copyBottomToTop(plan, id);
  assert.deepEqual(mesh0(plan).top, mesh0(plan).bottom);
  assert.notEqual(mesh0(plan).top, mesh0(plan).bottom); // not the same object
  const both = calculateRebar(mesh0(plan), CAL);
  near(both.totalLengthM, 2 * (41 * 10 + 68 * 8)); // Top + Bottom

  // independent afterwards
  plan = setMeshReinforcement(plan, id, 'top', withSpec(mesh0(plan).top!, 'long', { diameterMm: 16 }));
  assert.equal((mesh0(plan).bottom as { long: { diameterMm: number } }).long.diameterMm, 12);
  assert.equal((mesh0(plan).top as { long: { diameterMm: number } }).long.diameterMm, 16);
  const c = calculateRebar(mesh0(plan), CAL);
  assert.deepEqual(c.layers.map((l) => [l.level, l.direction, l.diameterMm]), [['bottom', 'long', 12], ['bottom', 'short', 10], ['top', 'long', 16], ['top', 'short', 10]]);
  const untouched = fresh();
  assert.equal(copyBottomToTop(untouched, 'nope'), untouched);
});

test('notation is compact and in centimetres', () => {
  assert.equal(specNotation({ diameterMm: 12, spacingM: 0.2 }), 'Ø12 @ 20');
  assert.equal(specNotation({ diameterMm: 10, spacingM: 0.125 }), 'Ø10 @ 12.5');
  assert.equal(specNotation({ diameterMm: 0, spacingM: 0.2 }), null);
  assert.equal(specNotation(undefined), null);
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
  plan = setMeshReinforcement(plan, id, 'bottom', { mode: 'directional', long: { diameterMm: 12, spacingM: 0.15 } });
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
    assert.deepEqual(m.bottom, uniform(0, 0));
    assert.deepEqual(Object.keys(m).sort(), ['autoNumber', 'bottom', 'id', 'kind', 'mark', 'pageNumber', 'points', 'wastePercent']);
  });
  assert.equal(new Set(created.map((m) => m.id)).size, created.length);
  assert.equal(JSON.stringify(plan.rooms), before);
  assert.equal(out.rooms, plan.rooms);
  assert.equal(rebarOf(plan).length, 0);
  const flat = { ...plan.rooms[0], id: 'flat', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }] };
  assert.equal(addRebarMeshFromRooms(plan, [flat]).created.length, 0);
});

test('persistence and duplication: both levels and manual bars survive a round trip and a duplicate gets new ids', () => {
  let plan = addRebarItem(fresh(), newRebarMesh(fresh(), 1, rect(1000, 800)));
  plan = addRebarItem(plan, newRebarBars(plan, 2));
  const meshId = rebarOf(plan)[0].id;
  plan = setMeshReinforcement(plan, meshId, 'bottom', uniform(12, 0.2));
  plan = setMeshLevels(plan, meshId, 'both');
  const viaClone = structuredClone(plan);
  assert.deepEqual(rebarOf(viaClone), rebarOf(plan));
  assert.deepEqual(rebarOf(JSON.parse(JSON.stringify(plan)) as Plan), rebarOf(plan));

  const copy = clonePlanForDuplicate(plan, 'copy');
  const ids = (items: RebarItem[]) => items.map((i) => i.id);
  assert.equal(ids(rebarOf(copy)).filter((id) => ids(rebarOf(plan)).includes(id)).length, 0);
  assert.equal(rebarOf(copy).length, 2);
  assert.deepEqual((rebarOf(copy)[0] as RebarMesh).bottom, uniform(12, 0.2));
  assert.deepEqual((rebarOf(copy)[0] as RebarMesh).top, uniform(0, 0));
});

// ---------- through the store ----------

const store = () => useAppStore.getState();
const items = () => rebarOf(store().project!);

function openRebar(page = 1) {
  store().setProject(structuredClone(PLAN_A));
  store().setCurrentPage(page);
  store().setDrawTarget('rebar');
}

test('store: drawing creates a mesh, manual bars use the current page, levels/edits/delete are history steps, undo/redo clear selection', () => {
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
  store().setRebarMeshReinforcement(meshId, 'bottom', uniform(12, 0.2));
  store().setRebarMeshLevels(meshId, 'both');
  assert.equal(levelChoice(items()[0] as RebarMesh), 'both');
  store().setRebarMeshLevels(meshId, 'bottom');
  assert.equal(levelChoice(items()[0] as RebarMesh), 'bottom');

  store().undo(); // switching Top off
  assert.equal(levelChoice(items()[0] as RebarMesh), 'both');
  assert.equal(store().selectedRebarId, null);
  store().redo();
  assert.equal(levelChoice(items()[0] as RebarMesh), 'bottom');
  store().copyRebarBottomToTop(meshId);
  assert.deepEqual((items()[0] as RebarMesh).top, uniform(12, 0.2));
  store().undo();
  assert.equal((items()[0] as RebarMesh).top, undefined);

  store().setSelectedRebarId(meshId);
  store().deleteRebarItem(meshId);
  assert.equal(items().length, 1);
  assert.equal(store().selectedRebarId, null);
  store().undo();
  assert.equal(items().length, 2);
});

test('store: page change and plan switch clear the rebar selection; a no-op or nonexistent level edit is not a history step', () => {
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
  store().setRebarMeshLevels(items()[0].id, 'bottom'); // already so
  store().setRebarMeshLevels('no-such-item', 'both');
  store().setRebarMeshReinforcement(items()[0].id, 'top', uniform(12, 0.2)); // Top is not enabled
  store().copyRebarBottomToTop('no-such-item');
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
