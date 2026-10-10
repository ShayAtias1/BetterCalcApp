import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Point } from '../../src/types/index.ts';
import type { RebarMesh } from '../../src/types/structural.ts';
import { calculateRebar } from '../../src/lib/rebar.ts';
import { calculateMeshSheets } from '../../src/lib/meshSheets.ts';
import { calculateMeshSheetPlacements } from '../../src/lib/meshSheetPlacement.ts';
import { applyPlacementOverrides, localToPlan, planToLocal, movePlacement, rotatePlacement } from '../../src/lib/meshLayoutEditing.ts';
import { prepareMeshLayoutPreview, renderMeshLayoutPreview } from '../../src/lib/meshLayoutPreview.ts';
import { meshLayoutCanInteract, useMeshLayoutPreviewStore } from '../../src/store/meshLayoutPreviewStore.ts';

const CAL = { pixelDistance: 100, realDistanceMeters: 1, metersPerPixel: 0.01 };
const mesh: RebarMesh = { id: 'mesh', kind: 'mesh', pageNumber: 1, mark: '',
  points: [{ x: 100, y: 100 }, { x: 1100, y: 100 }, { x: 1100, y: 500 }, { x: 100, y: 500 }],
  bottom: { mode: 'uniform', spec: { diameterMm: 12, spacingM: 0.2 } }, top: { mode: 'uniform', spec: { diameterMm: 10, spacingM: 0.15 } } };
const near = (a: Point, b: Point) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9);
function automatic() {
  const layout = calculateMeshSheetPlacements(mesh, CAL);
  assert.equal(layout.status, 'ok');
  return layout;
}
function session() {
  useMeshLayoutPreviewStore.setState({ views: {} });
  const actions = useMeshLayoutPreviewStore.getState();
  const view = () => useMeshLayoutPreviewStore.getState().views['["p","mesh"]'];
  actions.setEnabled('p', 'mesh', true);
  const preview = prepareMeshLayoutPreview(mesh, CAL);
  actions.setEditing('p', 'mesh', true, preview, true);
  return { actions, view, preview };
}

test('overrides move full sheets outside the zone and preserve automatic objects and stable IDs', () => {
  const layout = automatic();
  const original = structuredClone(layout);
  const sheets = layout.placementsByLevel.bottom!;
  for (const p of sheets) Object.freeze(p);
  const first = sheets[0];
  const moved = movePlacement(first, 0, { x: 1, y: 2 }, { x: -20, y: 40 });
  const result = applyPlacementOverrides(sheets, { [first.id]: moved });
  assert.equal(result[0].x, first.x - 21);
  assert.equal(result[0].y, first.y + 38);
  assert.equal(result[0].width, first.width);
  for (let i = 1; i < sheets.length; i++) assert.equal(result[i], sheets[i]);
  assert.deepEqual(result.map((p) => p.id), sheets.map((p) => p.id));
  assert.deepEqual(layout, original);
  assert.deepEqual(applyPlacementOverrides(sheets, {}), sheets);
});

test('90-degree rotation swaps bounds around the center, including moved sheets and four turns', () => {
  const first = automatic().placementsByLevel.bottom![0];
  const moved = movePlacement(first, 0, { x: 0, y: 0 }, { x: -8, y: 12 });
  let current = applyPlacementOverrides([first], { [first.id]: moved })[0];
  const center = { x: current.x + current.width / 2, y: current.y + current.height / 2 };
  let rotation = moved.rotation;
  for (let i = 1; i <= 4; i++) {
    const override = rotatePlacement(current, rotation);
    rotation = override.rotation;
    current = applyPlacementOverrides([first], { [first.id]: override })[0];
    near({ x: current.x + current.width / 2, y: current.y + current.height / 2 }, center);
    assert.equal(current.width, i % 2 ? first.height : first.width);
    assert.equal(current.height, i % 2 ? first.width : first.height);
    assert.equal(current.id, first.id);
    assert.equal(current.rotationRadians, first.rotationRadians + rotation * Math.PI / 180);
  }
  assert.equal(rotation, 0);
  near(current, moved);
});

test('plan/local transforms round-trip rotated and reversed zones independently of screen zoom and pan', () => {
  const angle = Math.PI / 5;
  const rotate = (p: Point) => ({ x: 300 + p.x * Math.cos(angle) - p.y * Math.sin(angle), y: 200 + p.x * Math.sin(angle) + p.y * Math.cos(angle) });
  const points = mesh.points.map(rotate);
  for (const outline of [points, [...points].reverse()]) {
    const layout = calculateMeshSheetPlacements({ ...mesh, points: outline }, CAL);
    assert.equal(layout.status, 'ok');
    const frame = layout.zoneFrame!;
    for (const local of [{ x: -8, y: 20 }, { x: 3, y: 1 }]) {
      const native = localToPlan(local, frame, CAL.metersPerPixel);
      near(planToLocal(native, frame, CAL.metersPerPixel), local);
      for (const zoom of [0.1, 1, 4, 8]) {
        const pan = { x: -112, y: 257 }, viewport = { x: 90, y: 32 };
        const screen = { x: native.x * zoom + pan.x + viewport.x, y: native.y * zoom + pan.y + viewport.y };
        // Same inverse screen transform used by the existing viewer.
        const plan = { x: (screen.x - pan.x - viewport.x) / zoom, y: (screen.y - pan.y - viewport.y) / zoom };
        near(planToLocal(plan, frame, CAL.metersPerPixel), local);
      }
    }
  }
});

test('Bottom and Top edits are isolated; reset clears only the viewed level; scopes do not leak', () => {
  const { actions, view } = session();
  const layout = automatic();
  const bottom = layout.placementsByLevel.bottom![0], top = layout.placementsByLevel.top![0];
  actions.select('p', 'mesh', bottom.id);
  const bottomMove = movePlacement(bottom, 0, bottom, { x: 11, y: 15 });
  actions.setOverride('p', 'mesh', 'bottom', bottomMove);
  actions.setLevel('p', 'mesh', 'top');
  assert.equal(view().selectedPlacementId, null);
  assert.equal(view().overrides.top, undefined);
  actions.setOverride('p', 'mesh', 'top', rotatePlacement(top));
  actions.setLevel('p', 'mesh', 'bottom');
  assert.deepEqual(view().overrides.bottom![bottom.id], bottomMove);
  actions.resetLevel('p', 'mesh', 'bottom');
  assert.deepEqual(view().overrides.bottom, {});
  assert.ok(view().overrides.top![top.id]);
  assert.deepEqual(applyPlacementOverrides(layout.placementsByLevel.bottom!, view().overrides.bottom!), layout.placementsByLevel.bottom);
  actions.setEnabled('another-plan', 'mesh', true);
  assert.deepEqual(useMeshLayoutPreviewStore.getState().views['["another-plan","mesh"]'].overrides, {});
  actions.setEnabled('p', 'another-mesh', true);
  assert.deepEqual(useMeshLayoutPreviewStore.getState().views['["p","another-mesh"]'].overrides, {});
});

test('OFF and hidden prevent interaction; session overrides survive visibility and exit', () => {
  const { actions, view, preview } = session();
  const p = automatic().placementsByLevel.bottom![0];
  actions.setOverride('p', 'mesh', 'bottom', rotatePlacement(p));
  const before = structuredClone(view().overrides);
  assert.equal(meshLayoutCanInteract(view(), preview, true), true);
  assert.equal(meshLayoutCanInteract(view(), preview, false), false);
  actions.setEditing('p', 'mesh', false, preview, true);
  actions.setEditing('p', 'mesh', true, preview, false);
  assert.equal(view().editing, false);
  actions.setEditing('p', 'mesh', true, preview, true);
  actions.setEnabled('p', 'mesh', false);
  assert.equal(view().editing, false);
  actions.select('p', 'mesh', p.id);
  actions.setOverride('p', 'mesh', 'bottom', { placementId: p.id, x: 999, y: 999, rotation: 0 });
  assert.equal(view().selectedPlacementId, null);
  assert.deepEqual(view().overrides, before);
  actions.setEditing('p', 'mesh', true, preview, true);
  assert.equal(view().editing, false);
  actions.setEnabled('p', 'mesh', true);
  actions.setEditing('p', 'mesh', true, preview, true);
  assert.deepEqual(view().overrides, before);
});

test('unsupported and stale automatic sources cannot interact; changed sources start without old overrides', () => {
  const { actions, view, preview } = session();
  const p = automatic().placementsByLevel.bottom![0];
  actions.setOverride('p', 'mesh', 'bottom', rotatePlacement(p));
  actions.setEditing('p', 'mesh', false, preview, true);
  for (const unavailable of [
    prepareMeshLayoutPreview({ ...mesh, sheets: { widthM: 0 } }, CAL),
    prepareMeshLayoutPreview(mesh, null),
    prepareMeshLayoutPreview({ ...mesh, points: mesh.points.slice(0, 3) }, CAL),
    prepareMeshLayoutPreview({ ...mesh, sizeOverride: { lengthM: 4000, widthM: 4 } }, CAL),
  ]) {
    actions.setEditing('p', 'mesh', true, unavailable, true);
    assert.equal(view().editing, false);
    assert.equal(meshLayoutCanInteract(view(), unavailable, true), false);
  }
  const changed = prepareMeshLayoutPreview({ ...mesh, sheets: { lengthM: 4 } }, CAL);
  actions.setEditing('p', 'mesh', true, preview, true);
  assert.equal(meshLayoutCanInteract(view(), changed, true), false);
  actions.setEditing('p', 'mesh', true, changed, true);
  assert.deepEqual(view().overrides, {});
});

test('manual rendering leaves source mesh, V2A grid and procurement count/area untouched', () => {
  const source = structuredClone(mesh);
  const procurement = calculateMeshSheets(mesh, CAL);
  const weights = calculateRebar(mesh, CAL);
  const layout = automatic(), before = structuredClone(layout);
  const p = layout.placementsByLevel.bottom![0];
  const move = movePlacement(p, 0, p, { x: -50, y: 50 });
  const moved = applyPlacementOverrides([p], { [p.id]: move })[0];
  const rotated = rotatePlacement(moved);
  const rendered = renderMeshLayoutPreview(layout, { bottom: { [p.id]: rotated } });
  const normal = renderMeshLayoutPreview(layout);
  assert.equal(rendered.status, 'ready'); assert.equal(normal.status, 'ready');
  assert.notEqual(rendered.sheetsByLevel.bottom![0].points, normal.sheetsByLevel.bottom![0].points);
  assert.deepEqual(rendered.sheetsByLevel.top, normal.sheetsByLevel.top);
  assert.equal(rendered.sheetsByLevel.bottom!.length, layout.sheetsPerLevel);
  assert.deepEqual(layout, before);
  assert.deepEqual(mesh, source);
  assert.deepEqual(calculateMeshSheets(mesh, CAL), procurement);
  assert.deepEqual(calculateRebar(mesh, CAL), weights);
});
