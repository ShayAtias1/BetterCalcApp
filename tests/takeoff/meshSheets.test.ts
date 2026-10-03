// Mesh-sheet procurement: the one-dimension count, both orientations, levels, manual size, invalid
// settings, old data without settings, and persistence. Rebar quantities are untouched by all of it.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_A } from './fixtures.ts';
import { calculateMeshSheets, planSheetsForRectangle, resolveSheetSettings, sheetsAlong, DEFAULT_MESH_SHEETS } from '../../src/lib/meshSheets.ts';
import { calculateRebar } from '../../src/lib/rebar.ts';
import { addRebarItem, newRebarMesh, updateRebarItem } from '../../src/lib/structuralMutations.ts';
import { rebarOf } from '../../src/lib/structuralPlan.ts';
import { clonePlanForDuplicate } from '../../src/lib/planDuplication.ts';
import type { Plan, Point } from '../../src/types/index.ts';
import type { MeshReinforcement, RebarMesh } from '../../src/types/structural.ts';

Object.assign(globalThis, { DOMMatrix: class {}, DOMPoint: class {}, DOMRect: class {}, Path2D: class {} });
const { useAppStore } = await import('../../src/store/appStore.ts');
after(() => useAppStore.getState().setProject(null));

const CAL = { pixelDistance: 100, realDistanceMeters: 1, metersPerPixel: 0.01 };
/** A rectangle of `w × h` metres at 0.01 m/px. */
const zone = (wM: number, hM: number): Point[] => {
  const w = Math.round(wM * 100);
  const h = Math.round(hM * 100);
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
};
const L_SHAPE: Point[] = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 600 }, { x: 0, y: 600 }];
const u = (d: number, s: number): MeshReinforcement => ({ mode: 'uniform', spec: { diameterMm: d, spacingM: s } });
let n = 0;
const mesh = (wM: number, hM: number, extra: Partial<RebarMesh> = {}): RebarMesh => ({
  id: `m${n++}`, kind: 'mesh', pageNumber: 1, mark: '', autoNumber: n, points: zone(wM, hM), bottom: u(12, 0.2), wastePercent: 0, ...extra,
});
const sheets = (m: RebarMesh) => calculateMeshSheets(m, CAL);
const total = (m: RebarMesh) => sheets(m).totalSheets;

test('one dimension: a zone within one sheet needs one; each extra sheet adds length minus overlap', () => {
  assert.equal(sheetsAlong(3, 6, 0.8), 1);
  assert.equal(sheetsAlong(6, 6, 0.8), 1);
  assert.equal(sheetsAlong(6.01, 6, 0.8), 2);
  assert.equal(sheetsAlong(11.2, 6, 0.8), 2); // 6 + 5.2 exactly - no phantom sheet from float noise
  assert.equal(sheetsAlong(11.3, 6, 0.8), 3);
  assert.equal(sheetsAlong(12, 6, 0), 2);
  assert.equal(sheetsAlong(12.01, 6, 0), 3);
  assert.equal(sheetsAlong(10, 6, 6), null); // overlap >= sheet
  assert.equal(sheetsAlong(0, 6, 0.8), null);
  assert.equal(sheetsAlong(10, 6, -1), null);
});

test('smaller than a sheet and exactly one 6 × 2.5 sheet', () => {
  assert.equal(total(mesh(3, 2)), 1);
  const exact = sheets(mesh(6, 2.5));
  assert.equal(exact.totalSheets, 1);
  assert.equal(exact.purchasedAreaM2, 15);
  assert.equal(exact.basis, 'exact');
});

test('multiple sheets with the default 80 cm overlap, and the purchased and zone areas', () => {
  const r = sheets(mesh(10, 4));
  assert.deepEqual(r.settings, DEFAULT_MESH_SHEETS);
  assert.equal(r.status, 'ok');
  assert.equal(r.plan!.chosen.countAlongLong, 2);
  assert.equal(r.plan!.chosen.countAlongShort, 2);
  assert.equal(r.totalSheets, 4);
  assert.equal(r.purchasedAreaM2, 60);
  assert.ok(Math.abs(r.zoneAreaM2! - 40) < 1e-9);
});

test('overlap 0, changed overlap and changed sheet dimensions', () => {
  assert.equal(total(mesh(12, 5, { sheets: { overlapM: 0 } })), 4);
  assert.equal(total(mesh(12, 5)), 7); // 80 cm: orientation B (2.5 m along the long side, 6 m across): 7 × 1 beats 3 × 3
  assert.equal(total(mesh(12, 5, { sheets: { overlapM: 1.5 } })), 11); // a bigger overlap needs more sheets (7 → 11)
  const big = sheets(mesh(12, 5, { sheets: { lengthM: 8, widthM: 3, overlapM: 0.5 } }));
  assert.equal(big.totalSheets, 4);
  assert.equal(big.purchasedAreaM2, 4 * 24);
});

test('orientation: A better, B better, tie picks length along the long side', () => {
  const a = sheets(mesh(10, 4)).plan!;
  assert.equal(a.chosen.orientation, 'length-along-long');
  assert.equal(a.chosen.sheets, 4);
  assert.equal(a.alternate.sheets, 6);

  const b = sheets(mesh(7, 6)).plan!; // 6 m sheet length across the 6 m short side
  assert.equal(b.chosen.orientation, 'width-along-long');
  assert.equal(b.chosen.alongLongM, 2.5);
  assert.equal(b.chosen.sheets, 4);
  assert.equal(b.alternate.sheets, 8);

  const tie = sheets(mesh(5, 5)).plan!;
  assert.equal(tie.chosen.sheets, tie.alternate.sheets);
  assert.equal(tie.chosen.orientation, 'length-along-long');
  // the zone's side order never matters: a tall rectangle gives the same plan as a wide one
  assert.deepEqual(sheets(mesh(4, 10)).plan, sheets(mesh(10, 4)).plan);
});

test('levels: Bottom, Top and Top + Bottom are one set each; the level identity is kept', () => {
  const bottom = sheets(mesh(10, 4));
  assert.deepEqual(bottom.levels.map((l) => [l.level, l.sheets]), [['bottom', 4]]);
  const top = sheets(mesh(10, 4, { bottom: undefined, top: u(10, 0.15) }));
  assert.deepEqual(top.levels.map((l) => [l.level, l.sheets]), [['top', 4]]);
  const both = sheets(mesh(10, 4, { top: u(10, 0.15) }));
  assert.deepEqual(both.levels.map((l) => [l.level, l.sheets]), [['bottom', 4], ['top', 4]]);
  assert.equal(both.totalSheets, 8);
  assert.equal(both.purchasedAreaM2, 120);
  // Long/Short directions inside one level are NOT extra sheets
  const directional = sheets(mesh(10, 4, { bottom: { mode: 'directional', long: { diameterMm: 12, spacingM: 0.2 }, short: { diameterMm: 10, spacingM: 0.15 } } }));
  assert.equal(directional.totalSheets, 4);
  // an enabled level whose bars are not filled in yet still needs its sheets
  assert.equal(sheets(mesh(10, 4, { bottom: u(0, 0) })).totalSheets, 4);
  assert.equal(sheets(mesh(10, 4, { bottom: undefined })).status, 'no-levels');
});

test('manual size on an uncalibrated page is a rectangle; a missing size or scale is not calculable', () => {
  const manual = mesh(1, 1, { sizeOverride: { lengthM: 10, widthM: 4 } });
  const r = calculateMeshSheets(manual, null);
  assert.equal(r.status, 'ok');
  assert.equal(r.totalSheets, 4);
  assert.equal(calculateMeshSheets(mesh(10, 4), null).status, 'no-scale');
  const half = calculateMeshSheets(mesh(1, 1, { sizeOverride: { lengthM: 10, widthM: 0 } }), null);
  assert.equal(half.status, 'missing-size');
  assert.equal(half.totalSheets, null);
});

test('invalid settings are not calculable - never NaN, Infinity or 0', () => {
  for (const [sheetsSettings, problem] of [
    [{ overlapM: 2.5 }, 'overlap'], // = the sheet width
    [{ overlapM: 6 }, 'overlap'],
    [{ overlapM: -0.1 }, 'overlap'],
    [{ overlapM: NaN }, 'overlap'],
    [{ lengthM: 0 }, 'size'],
    [{ widthM: -1 }, 'size'],
    [{ lengthM: Infinity }, 'size'],
  ] as const) {
    const r = sheets(mesh(10, 4, { sheets: sheetsSettings }));
    assert.equal(r.status, 'invalid-settings', JSON.stringify(sheetsSettings));
    assert.equal(r.settingsProblem, problem);
    assert.equal(r.totalSheets, null);
    assert.equal(r.plan, null);
    assert.deepEqual(r.levels, []);
  }
  assert.equal(planSheetsForRectangle(10, 4, { lengthM: 6, widthM: 2.5, overlapM: 2.5 }), null);
});

test('a zone that is not a rectangle gets no sheet count (no layout is invented), while its rebar estimate stays', () => {
  const m = mesh(1, 1, { points: L_SHAPE });
  const r = calculateMeshSheets(m, CAL);
  assert.equal(r.status, 'not-rectangular');
  assert.equal(r.totalSheets, null);
  assert.ok(r.zoneAreaM2! > 0);
  const rebar = calculateRebar(m, CAL);
  assert.equal(rebar.status, 'ok');
  assert.equal(rebar.estimated, true);
});

test('sheets never change the rebar quantities; overlap is not waste', () => {
  const plain = mesh(10, 4, { wastePercent: 5 });
  const custom = { ...plain, sheets: { lengthM: 4, widthM: 2, overlapM: 0.1 } };
  assert.deepEqual(calculateRebar(custom, CAL), calculateRebar(plain, CAL));
});

test('an old mesh without settings uses the defaults and reading it writes nothing', () => {
  const old = mesh(10, 4);
  const before = JSON.stringify(old);
  assert.equal(old.sheets, undefined);
  assert.deepEqual(resolveSheetSettings(old.sheets), { lengthM: 6, widthM: 2.5, overlapM: 0.8 });
  sheets(old);
  assert.equal(JSON.stringify(old), before);
  assert.equal('sheets' in old, false);
  // a partly customised mesh keeps the rest at the default
  assert.deepEqual(resolveSheetSettings({ overlapM: 0.5 }), { lengthM: 6, widthM: 2.5, overlapM: 0.5 });
});

const fresh = (): Plan => {
  const p = structuredClone(PLAN_A);
  p.pages = { 1: { pageNumber: 1, calibration: CAL }, 2: { pageNumber: 2, calibration: null } };
  return p;
};

test('custom settings are stored only when edited, survive a round trip and a duplicate', () => {
  let plan = addRebarItem(fresh(), newRebarMesh(fresh(), 1, zone(10, 4)));
  const id = rebarOf(plan)[0].id;
  assert.equal('sheets' in rebarOf(plan)[0], false);
  plan = updateRebarItem(plan, id, { sheets: { overlapM: 0.5 } });
  assert.deepEqual((rebarOf(plan)[0] as RebarMesh).sheets, { overlapM: 0.5 });
  assert.deepEqual((rebarOf(JSON.parse(JSON.stringify(plan)) as Plan)[0] as RebarMesh).sheets, { overlapM: 0.5 });
  const copy = clonePlanForDuplicate(plan, 'copy');
  assert.deepEqual((rebarOf(copy)[0] as RebarMesh).sheets, { overlapM: 0.5 });
  assert.notEqual(rebarOf(copy)[0].id, id);
});

test('store: editing the settings is an undoable step', () => {
  const s = () => useAppStore.getState();
  s().setProject(fresh());
  s().setCurrentPage(1);
  s().setDrawTarget('rebar');
  s().finishRectangle({ x: 0, y: 0 }, { x: 1000, y: 400 });
  const id = rebarOf(s().project!)[0].id;
  const get = () => rebarOf(s().project!)[0] as RebarMesh;
  assert.equal(get().sheets, undefined);
  s().updateRebarItem(id, { sheets: { lengthM: 4 } });
  assert.deepEqual(get().sheets, { lengthM: 4 });
  s().undo();
  assert.equal(get().sheets, undefined);
  s().redo();
  assert.deepEqual(get().sheets, { lengthM: 4 });
});
