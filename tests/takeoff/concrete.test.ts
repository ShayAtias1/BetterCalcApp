// Zone geometry and the concrete calculation. Scale used throughout: 1 native px = 1 cm
// (metersPerPixel 0.01), so a 1000 × 800 px rectangle is 10 m × 8 m = 80 m².
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateConcrete } from '../../src/lib/concrete.ts';
import { isRectangle, zoneGeometry } from '../../src/lib/zoneGeometry.ts';
import type { Calibration, Point } from '../../src/types/index.ts';
import type { ConcreteElement } from '../../src/types/structural.ts';

const CAL: Calibration = { pixelDistance: 100, realDistanceMeters: 1, metersPerPixel: 0.01 };
const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];
const rotate = (pts: Point[], deg: number): Point[] => {
  const a = (deg * Math.PI) / 180;
  return pts.map((p) => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) }));
};
const near = (actual: number | null, expected: number, eps = 1e-9) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);

const el = (extra: Partial<ConcreteElement>): ConcreteElement => ({
  id: 'e', pageNumber: 1, kind: 'slab', mark: 'S01', points: rect(0, 0, 1000, 800), depthM: 0.2, ...extra,
});

test('rectangle detection works at any rotation and rejects other four-sided shapes', () => {
  assert.equal(isRectangle(rect(0, 0, 1000, 800)), true);
  assert.equal(isRectangle(rotate(rect(50, 50, 1000, 800), 30)), true);
  assert.equal(isRectangle([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 800, y: 500 }, { x: 0, y: 500 }]), false); // trapezoid
  assert.equal(isRectangle([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1100, y: 800 }, { x: 100, y: 800 }]), false); // parallelogram
  assert.equal(isRectangle(rect(0, 0, 1000, 800).slice(0, 3)), false);
  assert.equal(isRectangle([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]), false); // repeated point
});

test('zone geometry: area and side lengths from the drawn outline and the scale', () => {
  const z = zoneGeometry(rect(0, 0, 1000, 800), 0.01)!;
  near(z.areaM2, 80);
  near(z.sides!.longM, 10);
  near(z.sides!.shortM, 8);
  assert.equal(z.fromOverride, false);
  // a rotated copy measures the same
  const r = zoneGeometry(rotate(rect(0, 0, 1000, 800), 37), 0.01)!;
  near(r.areaM2, 80, 1e-6);
  near(r.sides!.longM, 10, 1e-6);
  near(r.sides!.shortM, 8, 1e-6);
  // an L-shape has an area but no long side
  const l = zoneGeometry([{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 600 }, { x: 0, y: 600 }], 0.01)!;
  near(l.areaM2, 27);
  assert.equal(l.sides, null);
});

test('zone geometry: no scale means no size, but a size override needs no scale', () => {
  assert.equal(zoneGeometry(rect(0, 0, 1000, 800), 0), null);
  assert.equal(zoneGeometry(rect(0, 0, 1000, 800), NaN), null);
  assert.equal(zoneGeometry([{ x: 0, y: 0 }, { x: 5, y: 5 }], 0.01), null);
  const o = zoneGeometry([], 0, { lengthM: 0.3, widthM: 0.5 })!;
  near(o.areaM2, 0.15);
  near(o.sides!.longM, 0.5);
  assert.equal(o.fromOverride, true);
  // an unusable override falls back to the outline
  assert.equal(zoneGeometry(rect(0, 0, 100, 100), 0.01, { lengthM: 0, widthM: 2 })!.fromOverride, false);
});

test('slab: area × thickness, with waste', () => {
  const c = calculateConcrete(el({ kind: 'slab', depthM: 0.2, wastePercent: 5 }), CAL);
  assert.equal(c.status, 'ok');
  near(c.footprintM2, 80);
  near(c.volumeM3, 16);
  near(c.orderM3, 16.8);
});

test('wall: footprint 5.00 m × 0.20 m drawn as a rectangle, height 3 m', () => {
  const c = calculateConcrete(el({ kind: 'wall', points: rect(0, 0, 500, 20), depthM: 3 }), CAL);
  near(c.volumeM3, 3); // 5 × 0.2 × 3
  near(c.orderM3, 3);
});

test('beam: footprint 6.00 m × 0.30 m, height 0.5 m', () => {
  near(calculateConcrete(el({ kind: 'beam', points: rect(0, 0, 600, 30), depthM: 0.5 }), CAL).volumeM3, 0.9);
});

test('column: drawn footprint, or a manual size on a page with no scale, times quantity', () => {
  near(calculateConcrete(el({ kind: 'column', points: rect(0, 0, 40, 40), depthM: 3, quantity: 4 }), CAL).volumeM3, 1.92);
  const manual = calculateConcrete(el({ kind: 'column', points: [], sizeOverride: { lengthM: 0.4, widthM: 0.4 }, depthM: 3, quantity: 4 }), null);
  assert.equal(manual.status, 'ok');
  near(manual.volumeM3, 1.92);
});

test('not calculable is reported as such, never as zero', () => {
  const noScale = calculateConcrete(el({}), null);
  assert.equal(noScale.status, 'no-scale');
  assert.equal(noScale.volumeM3, null);
  assert.equal(noScale.orderM3, null);
  assert.equal(noScale.footprintM2, null);

  for (const depthM of [undefined, 0, -0.2, NaN]) {
    const c = calculateConcrete(el({ depthM }), CAL);
    assert.equal(c.status, 'missing-depth');
    assert.equal(c.volumeM3, null);
    near(c.footprintM2, 80); // the footprint is still known
  }
  // a missing scale is reported before a missing depth
  assert.equal(calculateConcrete(el({ depthM: undefined }), null).status, 'no-scale');
});

test('unusable waste and quantity fall back instead of poisoning the result', () => {
  const c = calculateConcrete(el({ wastePercent: NaN, quantity: NaN }), CAL);
  assert.equal(c.wastePercent, 0);
  assert.equal(c.quantity, 1);
  near(c.orderM3, 16);
  const neg = calculateConcrete(el({ wastePercent: -10, quantity: -2 }), CAL);
  assert.equal(neg.wastePercent, 0);
  assert.equal(neg.quantity, 1);
  // zero identical elements is a real zero, not a fallback
  near(calculateConcrete(el({ quantity: 0 }), CAL).volumeM3, 0);
});

test('irregular footprint: volume follows the polygon area', () => {
  const l: Point[] = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 600 }, { x: 0, y: 600 }];
  near(calculateConcrete(el({ points: l, depthM: 0.25 }), CAL).volumeM3, 6.75); // 27 m² × 0.25
});
