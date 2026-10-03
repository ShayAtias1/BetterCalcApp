// Backward compatibility of the optional concrete/rebar arrays on a Plan: old plans read as having
// none, nothing is added to them, a plan with zones survives a save/load round trip, and a
// duplicate gets its own ids and its own copy of the data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_A } from './fixtures.ts';
import { clonePlanForDuplicate } from '../../src/lib/planDuplication.ts';
import { concreteOf, rebarOf } from '../../src/lib/structuralPlan.ts';
import type { Plan } from '../../src/types/index.ts';
import type { ConcreteElement, RebarItem } from '../../src/types/structural.ts';

const SLAB: ConcreteElement = {
  id: 'c-1', pageNumber: 1, kind: 'slab', mark: 'S01', grade: 'B30', depthM: 0.2, wastePercent: 5,
  points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }],
};
const MESH: RebarItem = {
  id: 'r-1', kind: 'mesh', pageNumber: 1, mark: 'M01', wastePercent: 3,
  points: SLAB.points,
  layers: [{ id: 'l-1', diameterMm: 12, spacingM: 0.15, direction: 'long' }, { id: 'l-2', diameterMm: 10, spacingM: 0.2, direction: 'short' }],
};
const BARS: RebarItem = { id: 'r-2', kind: 'bars', pageNumber: 2, mark: 'B01', diameterMm: 16, count: 10, lengthM: 6 };

const withZones = (): Plan => ({ ...structuredClone(PLAN_A), concreteElements: [SLAB], rebarItems: [MESH, BARS] });

test('a plan saved before the feature reads as having no concrete or rebar, and is not modified by reading', () => {
  const plan = structuredClone(PLAN_A);
  const before = JSON.stringify(plan);
  assert.deepEqual(concreteOf(plan), []);
  assert.deepEqual(rebarOf(plan), []);
  assert.equal(JSON.stringify(plan), before);
  assert.equal('concreteElements' in plan, false);
  assert.equal('rebarItems' in plan, false);
});

test('a damaged value is treated as empty rather than crashing the readers', () => {
  const junk = { ...structuredClone(PLAN_A), concreteElements: 'x', rebarItems: { a: 1 } } as unknown as Plan;
  assert.deepEqual(concreteOf(junk), []);
  assert.deepEqual(rebarOf(junk), []);
});

test('zones survive a save/load round trip (JSON and structured clone, as IndexedDB does)', () => {
  const plan = withZones();
  // (The fixture deliberately holds a NaN elsewhere, which JSON cannot carry — so JSON is checked on the zones only.)
  assert.deepEqual(structuredClone(plan), plan);
  const viaJson = JSON.parse(JSON.stringify(plan)) as Plan;
  assert.deepEqual(concreteOf(viaJson), [SLAB]);
  assert.deepEqual(rebarOf(viaJson), [MESH, BARS]);
});

test('duplicating a plan without zones adds no keys', () => {
  const copy = clonePlanForDuplicate(structuredClone(PLAN_A), 'copy');
  assert.equal('concreteElements' in copy, false);
  assert.equal('rebarItems' in copy, false);
});

test('duplicating a plan copies concrete and rebar with new ids and no shared references', () => {
  const source = withZones();
  const copy = clonePlanForDuplicate(source, 'copy');
  const c = concreteOf(copy);
  const r = rebarOf(copy);

  assert.equal(c.length, 1);
  assert.notEqual(c[0].id, SLAB.id);
  assert.deepEqual({ ...c[0], id: SLAB.id }, SLAB);

  assert.equal(r.length, 2);
  const [mesh, bars] = r;
  assert.ok(mesh.kind === 'mesh' && bars.kind === 'bars');
  assert.notEqual(mesh.id, MESH.id);
  assert.notEqual(bars.id, BARS.id);
  const sourceLayerIds = new Set(['l-1', 'l-2']);
  for (const l of mesh.layers) assert.equal(sourceLayerIds.has(l.id), false);
  assert.deepEqual(mesh.layers.map(({ diameterMm, spacingM, direction }) => ({ diameterMm, spacingM, direction })), [
    { diameterMm: 12, spacingM: 0.15, direction: 'long' },
    { diameterMm: 10, spacingM: 0.2, direction: 'short' },
  ]);

  // Editing the copy never reaches the original.
  c[0].points[0].x = 999;
  c[0].depthM = 9;
  assert.equal(source.concreteElements![0].points[0].x, 0);
  assert.equal(source.concreteElements![0].depthM, 0.2);
});
