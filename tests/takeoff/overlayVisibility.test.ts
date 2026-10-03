// View menu visibility: one switch per overlay domain, an old two-switch preference maps onto them,
// and starting to work in a hidden domain turns on just that domain.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_VISIBLE, exportAnnotationsVisible, overlayForTool, readOverlayVisibility } from '../../src/lib/overlayVisibility.ts';
import { PLAN_A } from './fixtures.ts';

Object.assign(globalThis, { DOMMatrix: class {}, DOMPoint: class {}, DOMRect: class {}, Path2D: class {} });
const { useAppStore } = await import('../../src/store/appStore.ts');
after(() => useAppStore.getState().setProject(null));

test('saved preferences: nothing saved or junk = all visible; new shape is read per key', () => {
  assert.deepEqual(readOverlayVisibility(null), ALL_VISIBLE);
  assert.deepEqual(readOverlayVisibility('{bad'), ALL_VISIBLE);
  assert.deepEqual(readOverlayVisibility('42'), ALL_VISIBLE);
  assert.deepEqual(readOverlayVisibility('{"concrete":false,"rebar":"no"}'), { ...ALL_VISIBLE, concrete: false });
});

test('an old two-switch preference maps onto the new controls', () => {
  assert.deepEqual(readOverlayVisibility('{"annotationsVisible":false,"measurementsVisible":true}'), {
    finishes: false, concrete: false, rebar: false, markups: false, measurements: true,
  });
  assert.deepEqual(readOverlayVisibility('{"annotationsVisible":true,"measurementsVisible":false}'), { ...ALL_VISIBLE, measurements: false });
});

test('which domain a tool works in', () => {
  assert.equal(overlayForTool('draw', 'room'), 'finishes');
  assert.equal(overlayForTool('draw-rect', 'concrete'), 'concrete');
  assert.equal(overlayForTool('draw', 'rebar'), 'rebar');
  assert.equal(overlayForTool('measure', 'room'), 'measurements');
  assert.equal(overlayForTool('markup', 'room'), 'markups');
  assert.equal(overlayForTool('select', 'room'), null);
});

test('plan exports see rooms and markups as one switch: hidden only when both are', () => {
  assert.equal(exportAnnotationsVisible({ ...ALL_VISIBLE, finishes: false }), true);
  assert.equal(exportAnnotationsVisible({ ...ALL_VISIBLE, finishes: false, markups: false }), false);
});

test('store: each switch is independent; starting to draw in a hidden domain shows only that domain', () => {
  const s = useAppStore.getState();
  s.setProject(structuredClone(PLAN_A));
  for (const k of ['finishes', 'concrete', 'rebar', 'measurements', 'markups'] as const) useAppStore.getState().setOverlayVisible(k, false);
  assert.deepEqual(Object.values(useAppStore.getState().overlayVisible), [false, false, false, false, false]);

  useAppStore.getState().setDrawTarget('concrete');
  useAppStore.getState().setToolMode('draw-rect');
  assert.deepEqual(useAppStore.getState().overlayVisible, { finishes: false, concrete: true, rebar: false, measurements: false, markups: false });

  useAppStore.getState().setDrawTarget('rebar'); // switching target while a draw tool is active
  assert.equal(useAppStore.getState().overlayVisible.rebar, true);
  assert.equal(useAppStore.getState().overlayVisible.finishes, false);

  useAppStore.getState().setToolMode('measure');
  assert.equal(useAppStore.getState().overlayVisible.measurements, true);
  useAppStore.getState().setMarkupTool('cloud');
  assert.equal(useAppStore.getState().overlayVisible.markups, true);
  useAppStore.getState().setDrawTarget('room');
  useAppStore.getState().setToolMode('draw');
  assert.equal(useAppStore.getState().overlayVisible.finishes, true);
  // selecting does not turn anything on, and the view preference never touches the plan
  for (const k of ['finishes', 'concrete'] as const) useAppStore.getState().setOverlayVisible(k, false);
  useAppStore.getState().setToolMode('select');
  assert.equal(useAppStore.getState().overlayVisible.finishes, false);
  assert.equal(JSON.stringify(useAppStore.getState().project!.rooms), JSON.stringify(PLAN_A.rooms));
});
