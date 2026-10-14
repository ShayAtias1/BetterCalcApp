import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeRevisionLabel, type LabelBox } from '../../src/lib/revision/labelLayout';

const bounds = { left: 0, top: 0, right: 2000, bottom: 1200 };
const intersects = (a: LabelBox, b: LabelBox) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const connectorLength = (tip: { x: number; y: number }, box: LabelBox) => Math.hypot(
  Math.max(box.x - tip.x, tip.x - box.x - box.width, 0), Math.max(box.y - tip.y, tip.y - box.y - box.height, 0));

test('clustered labels stay near their walls, without overlapping labels or geometry at different zooms', () => {
  for (const zoom of [.25, 1, 4]) {
    const tip = { x: 700 / zoom, y: 500 / zoom };
    const wall = { x: 620 / zoom, y: 500 / zoom, width: 80 / zoom, height: 20 / zoom };
    const occupied: LabelBox[] = [];
    for (let number = 1; number <= 24; number++) {
      const size = { width: 44 / zoom, height: 22 / zoom };
      const position = placeRevisionLabel(tip, size.width, size.height, zoom, occupied, [wall], bounds);
      const box = { ...position, ...size };
      assert.ok(connectorLength(tip, box) * zoom <= 128);
      assert.ok(occupied.every(other => !intersects(box, other)), `label ${number} at zoom ${zoom}`);
      assert.ok(!intersects(box, wall));
      occupied.push(box);
    }
    assert.equal(occupied.length, 24);
  }
});

test('panning past the geometry does not drag labels to remote viewport edges', () => {
  const tip = { x: 700, y: 500 };
  const wall = { x: 620, y: 500, width: 80, height: 20 };
  for (const viewport of [bounds, { left: 2000, top: 1500, right: 2400, bottom: 1800 }, { left: 650, top: 480, right: 750, bottom: 580 }]) {
    const position = placeRevisionLabel(tip, 44, 22, 1, [], [wall], viewport);
    assert.ok(connectorLength(tip, { ...position, width: 44, height: 22 }) <= 12);
  }
});

test('expanded labels and line-only geometry retain nearby non-overlapping positions on resize', () => {
  const tip = { x: 300, y: 250 };
  const line = { x: 200, y: 250, width: 100, height: 0 };
  for (const right of [1200, 400]) {
    const occupied: LabelBox[] = [];
    for (const size of [{ width: 220, height: 78 }, { width: 44, height: 22 }]) {
      const position = placeRevisionLabel(tip, size.width, size.height, 1, occupied, [line], { ...bounds, right });
      const box = { ...position, ...size };
      assert.ok(occupied.every(other => !intersects(box, other)));
      assert.ok(!intersects(box, { x: line.x - 2, y: line.y - 2, width: line.width + 4, height: 4 }));
      assert.ok(connectorLength(tip, box) <= 128);
      occupied.push(box);
    }
  }
});
