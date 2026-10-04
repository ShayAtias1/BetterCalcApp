import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Point } from '../../src/types/index.ts';
import type { RebarMesh } from '../../src/types/structural.ts';
import { calculateMeshSheetPlacements, type MeshSheetPlacement } from '../../src/lib/meshSheetPlacement.ts';
import { calculateMeshSheets } from '../../src/lib/meshSheets.ts';
import { MAX_MESH_PREVIEW_SHEETS, prepareMeshLayoutPreview, meshLayoutViewLevel, meshPreviewLabelsVisible, type MeshPreviewSheet } from '../../src/lib/meshLayoutPreview.ts';
import { useMeshLayoutPreviewStore } from '../../src/store/meshLayoutPreviewStore.ts';

const CAL = { pixelDistance: 100, realDistanceMeters: 1, metersPerPixel: 0.01 };
const rectangle: Point[] = [{ x: 100, y: 100 }, { x: 1100, y: 100 }, { x: 1100, y: 500 }, { x: 100, y: 500 }];
const mesh = (extra: Partial<RebarMesh> = {}): RebarMesh => ({ id: 'm', kind: 'mesh', pageNumber: 1, mark: '', points: structuredClone(rectangle), bottom: { mode: 'uniform', spec: { diameterMm: 12, spacingM: 0.2 } }, ...extra });
const corners = (points: string): Point[] => points.split(' ').map((p) => { const [x, y] = p.split(',').map(Number); return { x, y }; });
const nearPoint = (actual: Point, expected: Point) => assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-6);

test('preview mapping consumes every V2A placement with its deterministic ID and keeps full sheet edges', () => {
  for (const sheets of [undefined, { lengthM: 4, widthM: 2, overlapM: 0.5 }, { overlapM: 0 }]) {
    const item = mesh({ sheets, top: { mode: 'uniform', spec: { diameterMm: 10, spacingM: 0.15 } } });
    const before = structuredClone(item);
    const layout = calculateMeshSheetPlacements(item, CAL);
    const preview = prepareMeshLayoutPreview(item, CAL);
    assert.equal(layout.status, 'ok');
    assert.equal(preview.status, 'ready');
    for (const level of preview.levels) {
      const originals: MeshSheetPlacement[] = layout.placementsByLevel[level]!;
      const shown: MeshPreviewSheet[] = preview.sheetsByLevel[level]!;
      assert.equal(shown.length, originals.length);
      assert.deepEqual(shown.map((p) => p.id), originals.map((p) => p.id));
      assert.deepEqual(shown.map((p) => p.number), originals.map((_, i) => i + 1));
      for (const [index, sheet] of shown.entries()) {
        const p = originals[index];
        assert.deepEqual(corners(sheet.points), [
          { x: 100 + p.x / CAL.metersPerPixel, y: 100 + p.y / CAL.metersPerPixel },
          { x: 100 + (p.x + p.width) / CAL.metersPerPixel, y: 100 + p.y / CAL.metersPerPixel },
          { x: 100 + (p.x + p.width) / CAL.metersPerPixel, y: 100 + (p.y + p.height) / CAL.metersPerPixel },
          { x: 100 + p.x / CAL.metersPerPixel, y: 100 + (p.y + p.height) / CAL.metersPerPixel },
        ]);
      }
    }
    assert.deepEqual(item, before);
  }
  const preview = prepareMeshLayoutPreview(mesh(), CAL);
  assert.equal(preview.status, 'ready');
  const last = corners(preview.sheetsByLevel.bottom!.at(-1)!.points);
  nearPoint(last[2], { x: 1220, y: 520 }); // Extends beyond the marked 1100 × 500 boundary.
});

test('rotated and reversed rectangle preview follows V2A frame, never an axis-aligned bounding box', () => {
  const angle = Math.PI / 6;
  const rotate = (p: Point): Point => ({ x: 200 + p.x * Math.cos(angle) - p.y * Math.sin(angle), y: 300 + p.x * Math.sin(angle) + p.y * Math.cos(angle) });
  const points = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 400 }, { x: 0, y: 400 }].map(rotate);
  const preview = prepareMeshLayoutPreview(mesh({ points }), CAL);
  assert.equal(preview.status, 'ready');
  const actual = corners(preview.sheetsByLevel.bottom![0].points);
  const expected = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 250 }, { x: 0, y: 250 }].map(rotate);
  actual.forEach((p, i) => nearPoint(p, expected[i]));
  for (const outline of [[...points].reverse(), [points[1], points[2], points[3], points[0]]]) {
    const mapped = prepareMeshLayoutPreview(mesh({ points: outline }), CAL);
    assert.equal(mapped.status, 'ready');
    assert.equal(mapped.sheetsByLevel.bottom!.length, 4);
    const first = corners(mapped.sheetsByLevel.bottom![0].points);
    assert.ok(Math.abs(first[0].x - first[1].x) > 1 && Math.abs(first[0].y - first[1].y) > 1);
  }
});

test('single-level fallback and Top/Bottom viewing never combine placement sets', () => {
  assert.equal(meshLayoutViewLevel(['bottom'], 'top'), 'bottom');
  assert.equal(meshLayoutViewLevel(['top'], 'bottom'), 'top');
  assert.equal(meshLayoutViewLevel(['bottom', 'top'], 'top'), 'top');
  assert.equal(meshLayoutViewLevel([], 'bottom'), null);
});

test('Manual Size requires real drawn rectangle and page scale; never fit/stretch to override dimensions', () => {
  const item = mesh({ sizeOverride: { lengthM: 12, widthM: 5 } });
  assert.equal(prepareMeshLayoutPreview(item, null).status, 'no-plan-geometry');
  const preview = prepareMeshLayoutPreview(item, CAL);
  assert.equal(preview.status, 'ready');
  assert.equal(preview.sheetsByLevel.bottom!.length, calculateMeshSheets(item, CAL).levels[0].sheets);
  const first = corners(preview.sheetsByLevel.bottom![0].points);
  nearPoint(first[0], { x: 100, y: 100 });
  nearPoint(first[1], { x: 350, y: 100 }); // Orientation B; real 2.5 m / 0.01 m/px, not scaled to the drawn area.
  for (const points of [[], [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 40, y: 80 }]]) {
    const manual = mesh({ points, sizeOverride: { lengthM: 10, widthM: 4 } });
    assert.equal(calculateMeshSheets(manual, CAL).status, 'ok');
    assert.equal(prepareMeshLayoutPreview(manual, CAL).status, 'no-plan-geometry');
  }
});

test('irregular, unavailable and invalid layouts supply no physical sheet preview', () => {
  assert.equal(prepareMeshLayoutPreview(mesh({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 40, y: 80 }] }), CAL).status, 'not-rectangular');
  assert.equal(prepareMeshLayoutPreview(mesh(), null).status, 'no-plan-geometry');
  assert.equal(prepareMeshLayoutPreview(mesh({ sheets: { overlapM: 6 } }), CAL).status, 'unavailable');
  assert.equal(prepareMeshLayoutPreview(mesh({ sheets: { widthM: 0 } }), CAL).status, 'unavailable');
  assert.equal(prepareMeshLayoutPreview(mesh({ bottom: undefined }), CAL).status, 'unavailable');
});

test('preview performance cap skips the entire layout and preserves procurement quantities', () => {
  const item = mesh({ sizeOverride: { lengthM: MAX_MESH_PREVIEW_SHEETS * 6, widthM: 4 } });
  const before = calculateMeshSheets(item, CAL);
  assert.ok(before.plan!.chosen.sheets > MAX_MESH_PREVIEW_SHEETS);
  assert.deepEqual(prepareMeshLayoutPreview(item, CAL), { status: 'too-large' });
  assert.deepEqual(calculateMeshSheets(item, CAL), before);
});

test('labels respond to zoom and disappear for dense layouts, without dropping sheet outlines', () => {
  const preview = prepareMeshLayoutPreview(mesh(), CAL);
  assert.equal(preview.status, 'ready');
  assert.equal(meshPreviewLabelsVisible(preview, 'bottom', 1), true);
  assert.equal(meshPreviewLabelsVisible(preview, 'bottom', 0.01), false);
  const dense = prepareMeshLayoutPreview(mesh({ sizeOverride: { lengthM: 45, widthM: 45 } }), CAL);
  assert.equal(dense.status, 'ready');
  assert.ok(dense.sheetsByLevel.bottom!.length > 200);
  assert.equal(meshPreviewLabelsVisible(dense, 'bottom', 10), false);
});

test('session preferences start off and are scoped by plan and mesh without writing layouts', () => {
  const store = useMeshLayoutPreviewStore;
  store.setState({ views: {} });
  store.getState().setEnabled('plan-a', 'mesh-1', true);
  store.getState().setLevel('plan-a', 'mesh-1', 'top');
  store.getState().setEnabled('plan-b', 'mesh-1', false);
  assert.deepEqual(store.getState().views, {
    '["plan-a","mesh-1"]': { enabled: true, level: 'top' },
    '["plan-b","mesh-1"]': { enabled: false, level: 'bottom' },
  });
  assert.ok(!('["plan-a","mesh-2"]' in store.getState().views));
});
