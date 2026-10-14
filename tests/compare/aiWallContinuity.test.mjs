import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
await mock.module('idb', { namedExports: { openDB: async () => ({}) } });
const { indexDrawing, verifyWallNear } = await import('../../src/lib/revision/vectorDiff.ts');
const { buildAiChanges } = await import('../../src/lib/revision/aiPageAnalysis.ts');

const W = 400, H = 200, mpp = .01, tol = 1;
const dimension = [200, 10, 200, 180];
const faces = (lo, hi, y = 80) => [lo, y, hi, y, lo, y + 10, hi, y + 10];
const page = segments => ({ width: W, height: H, segments: new Float32Array(segments),
  curve: new Uint8Array(segments.length / 4), arcs: [], texts: [] });
const verify = (own, other, line = [{x:30,y:85},{x:370,y:85}], side = 'added') =>
  verifyWallNear(indexDrawing(page(own), W, H), indexDrawing(page(other), W, H), line, side, mpp, tol);

for (const side of ['added', 'removed']) test(`crossing dimension does not fragment a continuous ${side} wall`, () => {
  const result = verify([...faces(30, 370), ...dimension], dimension, undefined, side);
  assert.equal(result.walls.length, 1);
  assert.equal(result.walls[0].lengthPx, 340);
  assert.equal(result.walls[0].thicknessPx, 10);
  assert.equal(result.conflict, false);
});
test('parallel wall faces remain unchanged even with a crossing dimension', () => {
  const geometry = [...faces(30, 370), ...dimension];
  const result = verify(geometry, geometry);
  assert.equal(result.walls.length, 0);
  assert.equal(result.conflict, true);
});
test('an actual opening or structural gap is never bridged', () => {
  const result = verify([...faces(30, 170), ...faces(230, 370), ...dimension], dimension);
  assert.equal(result.walls.length, 2);
  assert.ok(result.walls.every(w => w.footprint.every(p => p.x <= 170) || w.footprint.every(p => p.x >= 230)));
});
test('a corner is not merged into the straight wall', () => {
  const result = verify([...faces(30, 200), 200,80,200,160, 210,80,210,160, ...dimension], dimension,
    [{x:30,y:85},{x:190,y:85}]);
  assert.equal(result.walls.length, 1);
  assert.ok(result.walls[0].footprint.every(p => p.x <= 200));
});
test('uncertain short ticks do not authorize joining changed faces', () => {
  const tick = [200,79,200,91];
  const result = verify(faces(30,370),tick);
  assert.ok(result.walls.length !== 1 || result.walls[0].lengthPx < 340);
});

const manifest = {pageNumber:1,renderScale:1,tiles:[{tileId:'TILE_A',pageX:0,pageY:0,pageWidth:W,pageHeight:H}]};
const proposal = (id, lo, hi, type = 'wall-added', y = 85) => ({changeId:id,changeType:type,geometryTile:'TILE_A',
  before:type==='wall-removed'?{a:{x:lo/W,y:y/H},b:{x:hi/W,y:y/H}}:null,
  after:type==='wall-added'?{a:{x:lo/W,y:y/H},b:{x:hi/W,y:y/H}}:null,
  bbox:{x1:lo/W,y1:(y-5)/H,x2:hi/W,y2:(y+5)/H},confidence:.9,requiresReview:false,
  summary:'קיר',evidence:['wall faces']});
const build = (raw, base, revised) => buildAiChanges(raw,manifest,{W,H,mpp,tol,vector:true,baseV:page(base),revV:page(revised)});
test('disjoint AI fragments verified to the same continuous wall produce one quantity-bearing change', () => {
  const changes=build([proposal('a',30,160),proposal('b',240,370)],dimension,[...faces(30,370),...dimension]);
  assert.equal(changes.length,1);
  assert.equal(changes[0].walls.length,1);
  assert.equal(changes[0].walls[0].lengthPx,340);
});
test('different change types and disconnected walls remain separate proposals', () => {
  const different=build([proposal('a',30,160),proposal('b',240,370,'wall-removed',135)],
    [...faces(30,370,130),...dimension],[...faces(30,370),...dimension]);
  assert.equal(different.length,2);
  const disconnected=build([proposal('a',30,160),proposal('b',240,370)],dimension,
    [...faces(30,170),...faces(230,370),...dimension]);
  assert.equal(disconnected.length,2);
});
