import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Calibration, Point } from '../../src/types/index.ts';
import type { MeshReinforcement, RebarMesh } from '../../src/types/structural.ts';
import { calculateMeshSheetPlacements, MAX_MESH_LAYOUT_SHEETS, type MeshSheetPlacement, type MeshSheetPlacementLayout } from '../../src/lib/meshSheetPlacement.ts';
import { calculateMeshSheets, DEFAULT_MESH_SHEETS } from '../../src/lib/meshSheets.ts';
import { calculateRebar } from '../../src/lib/rebar.ts';
import { zoneGeometry } from '../../src/lib/zoneGeometry.ts';

const CAL: Calibration = { pixelDistance: 100, realDistanceMeters: 1, metersPerPixel: 0.01 };
const uniform = (diameterMm = 12): MeshReinforcement => ({ mode: 'uniform', spec: { diameterMm, spacingM: 0.2 } });
const rectangle = (widthM: number, heightM: number): Point[] => [
  { x: 0, y: 0 }, { x: widthM / CAL.metersPerPixel, y: 0 },
  { x: widthM / CAL.metersPerPixel, y: heightM / CAL.metersPerPixel }, { x: 0, y: heightM / CAL.metersPerPixel },
];
const mesh = (widthM: number, heightM: number, extra: Partial<RebarMesh> = {}): RebarMesh => ({
  id: 'mesh-layout', kind: 'mesh', pageNumber: 1, mark: '', autoNumber: 1,
  points: rectangle(widthM, heightM), bottom: uniform(), wastePercent: 5, ...extra,
});
const near = (a: number, b: number, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} vs ${b}`);
const allPlacements = (layout: MeshSheetPlacementLayout) => Object.values(layout.placementsByLevel).flat();

/** Every numeric field in success AND unavailable output must be finite (JSON alone would hide NaN). */
function finiteOutput(value: unknown): void {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `non-finite value: ${value}`);
  else if (value && typeof value === 'object') for (const part of Object.values(value)) finiteOutput(part);
}

/** Count/orientation/area come from procurement; verify geometry and coverage independently. */
function layoutOf(item: RebarMesh, calibration: Calibration | null = CAL): MeshSheetPlacementLayout {
  const procurement = calculateMeshSheets(item, calibration);
  const layout = calculateMeshSheetPlacements(item, calibration);
  finiteOutput(layout);
  assert.equal(procurement.status, 'ok');
  assert.equal(layout.status, 'ok');
  assert.equal(layout.orientation, procurement.plan!.chosen.orientation);
  assert.equal(layout.columns, procurement.plan!.chosen.countAlongLong);
  assert.equal(layout.rows, procurement.plan!.chosen.countAlongShort);
  assert.equal(layout.sheetsPerLevel, procurement.plan!.chosen.sheets);
  assert.equal(layout.totalSheets, procurement.totalSheets);
  assert.equal(allPlacements(layout).length, procurement.totalSheets);
  assert.equal(new Set(allPlacements(layout).map((p) => p.id)).size, layout.totalSheets);
  assert.deepEqual(Object.keys(layout.placementsByLevel), procurement.levels.map((l) => l.level));
  assert.deepEqual(layout.zoneDimensions, procurement.sides);
  assert.equal(layout.zoneAreaM2, procurement.zoneAreaM2);
  assert.equal(layout.purchasedAreaM2, procurement.purchasedAreaM2);
  for (const { level, sheets } of procurement.levels) {
    const placements: MeshSheetPlacement[] = layout.placementsByLevel[level]!;
    assert.equal(placements.length, sheets);
    for (const p of placements) {
      assert.equal(p.level, level);
      assert.equal(p.width, procurement.plan!.chosen.alongLongM);
      assert.equal(p.height, procurement.plan!.chosen.alongShortM);
      assert.equal(p.physicalSheetWidth, procurement.settings.lengthM);
      assert.equal(p.physicalSheetHeight, procurement.settings.widthM);
      near(p.x, p.column * (p.width - layout.overlapM));
      near(p.y, p.row * (p.height - layout.overlapM));
      assert.deepEqual(p.defaultPosition, { x: p.x, y: p.y });
    }
    near(placements[0].x, 0);
    near(placements[0].y, 0);
    const last = placements.at(-1)!;
    assert.ok(last.x + last.width >= layout.zoneDimensions.longM - 1e-8);
    assert.ok(last.y + last.height >= layout.zoneDimensions.shortM - 1e-8);
  }
  return layout;
}

for (const [name, longM, shortM] of [['smaller than one sheet', 3, 2], ['exactly 6 × 2.5 m', 6, 2.5]] as const) {
  test(name, () => {
    const layout = layoutOf(mesh(longM, shortM));
    assert.equal(layout.totalSheets, 1);
    assert.deepEqual(layout.sheetDimensions, { lengthM: 6, widthM: 2.5 });
    assert.equal(layout.purchasedAreaM2, 15);
    assert.equal(layout.placementsByLevel.bottom![0].width, 6); // Never shrunk to the target zone.
    assert.equal(layout.placementsByLevel.bottom![0].height, 2.5);
  });
}

test('10 × 4 m / 80 cm: four full sheets, overlap advances and final sheets extend beyond the zone', () => {
  const layout = layoutOf(mesh(10, 4));
  assert.equal(layout.totalSheets, 4);
  assert.equal(layout.rows, 2);
  assert.equal(layout.columns, 2);
  assert.equal(layout.zoneAreaM2, 40);
  assert.equal(layout.purchasedAreaM2, 60);
  assert.deepEqual(layout.placementsByLevel.bottom!.map((p) => [p.row, p.column, p.x, p.y]), [
    [0, 0, 0, 0], [0, 1, 5.2, 0], [1, 0, 0, 1.7], [1, 1, 5.2, 1.7],
  ]);
  const last = layout.placementsByLevel.bottom!.at(-1)!;
  near(last.x + last.width, 11.2);
  near(last.y + last.height, 4.2);
});

test('zero overlap uses edge-to-edge physical sheets', () => {
  const layout = layoutOf(mesh(12, 5, { sheets: { overlapM: 0 } }));
  assert.equal(layout.totalSheets, 4);
  assert.deepEqual(layout.placementsByLevel.bottom!.map((p) => [p.x, p.y]), [[0, 0], [6, 0], [0, 2.5], [6, 2.5]]);
});

test('custom overlap and custom sheet dimensions use procurement settings unchanged', () => {
  const overlap = layoutOf(mesh(12, 5, { sheets: { overlapM: 1.5 } }));
  assert.equal(overlap.totalSheets, 11);
  assert.equal(overlap.overlapM, 1.5);
  near(overlap.placementsByLevel.bottom![1].x, 1);
  const custom = layoutOf(mesh(12, 5, { sheets: { lengthM: 8, widthM: 3, overlapM: 0.5 } }));
  assert.equal(custom.totalSheets, 4);
  assert.deepEqual(custom.sheetDimensions, { lengthM: 8, widthM: 3 });
  assert.equal(custom.purchasedAreaM2, 96);
  near(custom.placementsByLevel.bottom![1].x, 7.5);
  near(custom.placementsByLevel.bottom![2].y, 2.5);
});

for (const [name, longM, shortM, orientation] of [
  ['orientation A', 10, 4, 'length-along-long'], ['orientation B', 7, 6, 'width-along-long'],
  ['orientation tie', 5, 5, 'length-along-long'],
] as const) {
  test(`${name} is exactly procurement's choice`, () => {
    const item = mesh(longM, shortM);
    const layout = layoutOf(item);
    assert.equal(layout.orientation, orientation);
    for (const p of allPlacements(layout)) {
      assert.equal(p.orientation, orientation);
      assert.equal(p.rotationRadians, orientation === 'length-along-long' ? 0 : Math.PI / 2);
    }
    if (name === 'orientation tie') {
      const procurement = calculateMeshSheets(item, CAL);
      assert.equal(procurement.plan!.chosen.sheets, procurement.plan!.alternate.sheets);
    }
  });
}

test('floating-point boundary never adds a placement beyond procurement', () => {
  const exact = layoutOf(mesh(11.2, 2.5));
  const noisy = layoutOf(mesh(11.2 + 1e-10, 2.5));
  assert.equal(exact.totalSheets, 2);
  assert.equal(noisy.totalSheets, 2);
  assert.deepEqual(noisy.placementsByLevel, exact.placementsByLevel);
  const beyond = layoutOf(mesh(11.2 + 1e-5, 2.5));
  assert.equal(beyond.totalSheets, 3);
  near(beyond.placementsByLevel.bottom![2].x, 10.4);
});

for (const choice of ['bottom', 'top', 'both'] as const) {
  test(`${choice}: a separate complete grid per enabled level`, () => {
    const layout = layoutOf(mesh(10, 4, { bottom: choice === 'top' ? undefined : uniform(), top: choice === 'bottom' ? undefined : uniform(10) }));
    assert.equal(layout.sheetsPerLevel, 4);
    assert.equal(layout.totalSheets, choice === 'both' ? 8 : 4);
    if (choice === 'both') {
      assert.notEqual(layout.placementsByLevel.bottom, layout.placementsByLevel.top);
      assert.notEqual(layout.placementsByLevel.bottom![0], layout.placementsByLevel.top![0]);
      assert.notEqual(layout.placementsByLevel.bottom![0].id, layout.placementsByLevel.top![0].id);
      assert.deepEqual(layout.placementsByLevel.bottom!.map((p) => [p.x, p.y, p.width, p.height]), layout.placementsByLevel.top!.map((p) => [p.x, p.y, p.width, p.height]));
    }
  });
}

test('Long/Short specifications and incomplete reinforcement do not create extra layouts', () => {
  for (const bottom of [uniform(0), { mode: 'directional', long: { diameterMm: 12, spacingM: 0.2 }, short: { diameterMm: 10, spacingM: 0.15 } }] as MeshReinforcement[]) {
    const layout = layoutOf(mesh(10, 4, { bottom }));
    assert.deepEqual(Object.keys(layout.placementsByLevel), ['bottom']);
    assert.equal(layout.totalSheets, 4);
  }
});

test('Manual Size is authoritative on an uncalibrated page, including an irregular/missing outline', () => {
  for (const points of [rectangle(1, 1), [{ x: 10, y: 20 }, { x: 50, y: 20 }, { x: 20, y: 60 }], []]) {
    const layout = layoutOf(mesh(1, 1, { points, sizeOverride: { lengthM: 4, widthM: 10 } }), null);
    assert.deepEqual(layout.zoneDimensions, { longM: 10, shortM: 4 });
    assert.equal(layout.fromOverride, true);
    assert.equal(layout.metersPerPixel, null);
    assert.equal(layout.totalSheets, 4);
    if (points.length !== 4) assert.equal(layout.zoneFrame, null);
  }
});

const rotated = (points: Point[], angle: number, origin: Point): Point[] => points.map((p) => ({
  x: origin.x + p.x * Math.cos(angle) - p.y * Math.sin(angle),
  y: origin.y + p.x * Math.sin(angle) + p.y * Math.cos(angle),
}));
const mapToPlan = (layout: MeshSheetPlacementLayout, x: number, y: number): Point => {
  const frame = layout.zoneFrame!;
  return { x: frame.originPx.x + (x * frame.xAxis.x + y * frame.yAxis.x) / layout.metersPerPixel!,
    y: frame.originPx.y + (x * frame.xAxis.y + y * frame.yAxis.y) / layout.metersPerPixel! };
};

test('rotated rectangles keep the local grid and carry a frame that maps back to plan corners', () => {
  const plain = layoutOf(mesh(10, 4));
  for (const angle of [0, Math.PI / 6, Math.PI / 2, -Math.PI / 3]) {
    const points = rotated(rectangle(10, 4), angle, { x: 123, y: 456 });
    for (const winding of [points, [...points].reverse()]) {
      for (let start = 0; start < 4; start++) {
        const outline = [...winding.slice(start), ...winding.slice(0, start)];
        const layout = layoutOf(mesh(10, 4, { points: outline }));
        assert.equal(layout.totalSheets, plain.totalSheets);
        assert.deepEqual(layout.placementsByLevel, plain.placementsByLevel);
        assert.ok(layout.zoneFrame);
        assert.equal(layout.metersPerPixel, CAL.metersPerPixel);
        const { longM, shortM } = layout.zoneDimensions;
        for (const [x, y] of [[0, 0], [longM, 0], [longM, shortM], [0, shortM]]) {
          const p = mapToPlan(layout, x, y);
          assert.ok(outline.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6));
        }
      }
    }
  }
});

test('tall rectangles align local X with the long edge and preserve procurement grid', () => {
  const layout = layoutOf(mesh(4, 10));
  assert.deepEqual(layout.placementsByLevel, layoutOf(mesh(10, 4)).placementsByLevel);
  near(layout.zoneFrame!.xAxis.x, 0);
  near(layout.zoneFrame!.xAxis.y, 1);
  assert.deepEqual(mapToPlan(layout, 10, 4), { x: 0, y: 1000 });
});

test('rectangle recognition uses the existing tolerance; non-rectangles stay unavailable', () => {
  const points = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1005, y: 400 }, { x: 5, y: 400 }];
  assert.ok(zoneGeometry(points, CAL.metersPerPixel)!.sides);
  const layout = layoutOf(mesh(10, 4, { points }));
  near(layout.zoneFrame!.xAxis.x * layout.zoneFrame!.yAxis.x + layout.zoneFrame!.xAxis.y * layout.zoneFrame!.yAxis.y, 0);
  const irregular = mesh(1, 1, { points: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 600 }, { x: 0, y: 600 }] });
  const result = calculateMeshSheetPlacements(irregular, CAL);
  assert.equal(result.status, 'not-rectangular');
  assert.equal(result.totalSheets, null);
  assert.equal(result.placementsByLevel, null);
  assert.equal(result.orientation, null);
  assert.ok(result.zoneAreaM2! > 0);
  assert.equal(calculateRebar(irregular, CAL).estimated, true);
});

test('invalid sheet dimensions/overlap reuse procurement status and never expose non-finite output', () => {
  for (const settings of [
    { lengthM: 0 }, { lengthM: -6 }, { widthM: 0 }, { widthM: -1 }, { lengthM: NaN }, { widthM: Infinity },
    { overlapM: -0.1 }, { overlapM: 2.5 }, { overlapM: 6 }, { overlapM: NaN }, { overlapM: Infinity },
  ]) {
    const item = mesh(10, 4, { sheets: settings });
    const result = calculateMeshSheetPlacements(item, CAL);
    const procurement = calculateMeshSheets(item, CAL);
    assert.equal(result.status, procurement.status);
    assert.equal(result.settingsProblem, procurement.settingsProblem);
    assert.equal(result.totalSheets, null);
    assert.equal(result.placementsByLevel, null);
    assert.equal(result.rows, null);
    assert.equal(result.columns, null);
    finiteOutput(result);
  }
});

test('missing scale, missing/invalid Manual Size and no levels have no fabricated zero layout', () => {
  for (const [item, calibration, expected] of [
    [mesh(10, 4), null, 'no-scale'],
    [mesh(1, 1, { sizeOverride: { lengthM: 10, widthM: 0 } }), CAL, 'missing-size'],
    [mesh(1, 1, { sizeOverride: { lengthM: NaN, widthM: 4 } }), null, 'missing-size'],
    [mesh(10, 4, { bottom: undefined }), CAL, 'no-levels'],
  ] as const) {
    const result = calculateMeshSheetPlacements(item, calibration);
    assert.equal(result.status, expected);
    assert.equal(result.totalSheets, null);
    assert.equal(result.placementsByLevel, null);
    finiteOutput(result);
  }
});

test('unsafe/extremely large geometry returns unavailable without partial arrays or non-finite numbers', () => {
  for (const sizeOverride of [
    { lengthM: 1e308, widthM: 1e308 },
    { lengthM: 1e18, widthM: 4 },
    { lengthM: MAX_MESH_LAYOUT_SHEETS * 6, widthM: 4 },
  ]) {
    const result = calculateMeshSheetPlacements(mesh(1, 1, { sizeOverride }), null);
    assert.equal(result.status, 'layout-unavailable');
    assert.equal(result.totalSheets, null);
    assert.equal(result.placementsByLevel, null);
    finiteOutput(result);
  }
});

test('old Mesh defaults and legacy reinforcement are read without writing or changing quantities', () => {
  const old = mesh(10, 4, { bottom: undefined, layers: [
    { id: 'long', direction: 'long', diameterMm: 12, spacingM: 0.2 },
    { id: 'short', direction: 'short', diameterMm: 12, spacingM: 0.2 },
  ] });
  const before = structuredClone(old);
  const quantities = calculateRebar(old, CAL);
  const procurement = calculateMeshSheets(old, CAL);
  const layout = layoutOf(old);
  assert.deepEqual(layout.sheetDimensions, { lengthM: DEFAULT_MESH_SHEETS.lengthM, widthM: DEFAULT_MESH_SHEETS.widthM });
  assert.equal(layout.overlapM, DEFAULT_MESH_SHEETS.overlapM);
  assert.deepEqual(old, before);
  assert.ok(!('sheets' in old));
  assert.deepEqual(calculateRebar(old, CAL), quantities);
  assert.deepEqual(calculateMeshSheets(old, CAL), procurement);
  assert.deepEqual(calculateMeshSheetPlacements(old, CAL), layout); // deterministic IDs and geometry
  layout.placementsByLevel.bottom![0].defaultPosition.x = 99;
  assert.equal(layout.placementsByLevel.bottom![0].x, 0);
  assert.equal(layoutOf(old).placementsByLevel.bottom![0].defaultPosition.x, 0);
});

test('procurement invariant across rectangle sizes, custom sheets, orientations and levels', () => {
  for (const longM of [0.5, 2.5, 6, 7, 10, 11.2, 12, 21.6]) {
    for (const shortM of [0.25, 2, 2.5, 4, 6]) {
      for (const sheets of [undefined, { overlapM: 0 }, { lengthM: 8, widthM: 3, overlapM: 0.5 }]) {
        const layout = layoutOf(mesh(longM, shortM, { sheets, top: uniform(10) }));
        assert.equal(layout.totalSheets, layout.sheetsPerLevel * 2);
      }
    }
  }
});
