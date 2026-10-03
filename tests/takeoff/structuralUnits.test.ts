// Centimetres in the forms, metres in the data and the engines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cmToMeters, metersToCm } from '../../src/lib/structuralUnits.ts';
import { calculateConcrete } from '../../src/lib/concrete.ts';
import type { ConcreteElement } from '../../src/types/structural.ts';

test('metres ↔ centimetres: round trips without float noise, and "not entered" stays not entered', () => {
  assert.equal(metersToCm(0.2), 20);
  assert.equal(metersToCm(0.07), 7); // 0.07 * 100 is 7.000000000000001 in floating point
  assert.equal(metersToCm(0.125), 12.5);
  assert.equal(cmToMeters(20), 0.2);
  assert.equal(cmToMeters(12.5), 0.125);
  for (const cm of [5, 7, 12, 12.5, 18, 20, 25, 30, 33.3]) assert.equal(metersToCm(cmToMeters(cm)), cm);
  assert.equal(metersToCm(undefined), undefined);
  assert.equal(cmToMeters(undefined), undefined);
  assert.equal(metersToCm(NaN), undefined);
});

test('a slab entered as 20 cm calculates exactly as the stored 0.20 m always did', () => {
  const slab: ConcreteElement = { id: 'a', pageNumber: 1, kind: 'slab', mark: '', autoNumber: 1, points: [], sizeOverride: { lengthM: 10, widthM: 5 }, depthM: cmToMeters(20), wastePercent: 10 };
  const calc = calculateConcrete(slab, null);
  assert.equal(calc.volumeM3, 10 * 5 * 0.2);
  assert.equal(calc.orderM3, 10 * 5 * 0.2 * 1.1);
});
