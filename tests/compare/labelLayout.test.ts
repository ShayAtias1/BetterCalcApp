import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutNotePopup, layoutZoom, NOTE_POPUP, placeRevisionLabel, UNBOUNDED, wrapNoteText, type LabelBox } from '../../src/lib/revision/labelLayout';

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

/** Lays out numbered bubbles at the zoom step, then renders them at the real zoom about their layout centre. */
function layoutBubbles(tips: { x: number; y: number }[], walls: LabelBox[], zoom: number) {
  const step = layoutZoom(zoom);
  const occupied: LabelBox[] = [];
  const centers = tips.map((tip, i) => {
    const width = (26 + String(i + 1).length * 6) / step, height = 22 / step;
    const position = placeRevisionLabel(tip, width, height, step, occupied, walls, UNBOUNDED);
    occupied.push({ ...position, width, height });
    return { x: position.x + width / 2, y: position.y + height / 2 };
  });
  return centers.map((center, i) => {
    const width = (26 + String(i + 1).length * 6) / zoom, height = 22 / zoom;
    return { x: center.x - width / 2, y: center.y - height / 2, width, height };
  });
}

test('5, 15 and 30 changes on a crowded plan keep every bubble, close and clear of each other and walls', () => {
  for (const count of [5, 15, 30]) {
    for (const zoom of [.3, 1, 1.37, 3]) {
      // A dense grid of short walls, every change sitting on one of them.
      const walls: LabelBox[] = [];
      const tips = Array.from({ length: count }, (_, i) => {
        const x = (400 + (i % 6) * 60) / zoom, y = (300 + Math.floor(i / 6) * 50) / zoom;
        walls.push({ x: x - 40 / zoom, y, width: 40 / zoom, height: 4 / zoom });
        return { x, y };
      });
      const boxes = layoutBubbles(tips, walls, zoom);
      assert.equal(boxes.length, count);
      boxes.forEach((box, i) => {
        assert.ok(connectorLength(tips[i], box) * zoom <= 256, `#${i + 1} of ${count} near its change at zoom ${zoom}`);
        boxes.slice(0, i).forEach((other, j) => assert.ok(!intersects(box, other), `#${i + 1} overlaps #${j + 1} (${count} @ ${zoom})`));
      });
    }
  }
});

test('layout zoom steps are stable within a step and never exceed the real zoom', () => {
  for (const zoom of [.1, .25, .5, .9, 1, 1.18, 1.19, 2, 7.3]) {
    const step = layoutZoom(zoom);
    assert.ok(step <= zoom + 1e-9 && step > zoom / 2 ** .25 - 1e-9);
  }
  assert.equal(layoutZoom(1.01), layoutZoom(1.15));
  assert.equal(layoutZoom(1), 1);
});

test('unbounded placement does not depend on the visible viewport, so panning never moves bubbles', () => {
  const tip = { x: 700, y: 500 };
  const wall = { x: 620, y: 500, width: 80, height: 20 };
  const first = placeRevisionLabel(tip, 44, 22, 1, [], [wall], UNBOUNDED);
  assert.deepEqual(placeRevisionLabel(tip, 44, 22, 1, [], [wall], UNBOUNDED), first);
  assert.ok(connectorLength(tip, { ...first, width: 44, height: 22 }) <= 12);
});

// Wide Hebrew-like glyphs: 7 px per character at 10 px, scaled by size and weight.
const measure = (text: string, size: number, bold: boolean) => Array.from(text).length * size * 0.7 * (bold ? 1.08 : 1);

test('expanded Hebrew descriptions wrap inside the padded popup and size from their content', () => {
  const description = 'הקיר בין המטבח לסלון הוסר והוקם קיר חדש בצד המערבי של החדר עם פתח דלת רחב יותר ' + 'אאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאאא';
  for (const viewport of [1400, 320, 140]) {
    const popup = layoutNotePopup('#12 הסרת קיר והקמת קיר חדש', description, 'הריסה · בנייה', viewport, measure);
    const inner = popup.width - NOTE_POPUP.padding * 2;
    for (const line of popup.titleLines) assert.ok(measure(line, NOTE_POPUP.titleSize, true) <= inner, `title "${line}" @ ${viewport}`);
    for (const line of popup.lines) assert.ok(measure(line, NOTE_POPUP.bodySize, false) <= inner, `line "${line}" @ ${viewport}`);
    assert.ok(popup.width <= Math.max(viewport - 16, 60 + NOTE_POPUP.padding * 2));
    assert.ok(popup.lines.length > 1, 'long descriptions are multiline');
    assert.equal(popup.lines.join('').replace(/\s/g, ''), description.replace(/\s/g, ''), 'no text is dropped');
    assert.equal(popup.height, NOTE_POPUP.padding * 2 + popup.titleLines.length * NOTE_POPUP.titleLine
      + NOTE_POPUP.sectionGap + popup.lines.length * NOTE_POPUP.bodyLine + NOTE_POPUP.sectionGap + NOTE_POPUP.bodyLine);
  }
  const short = layoutNotePopup('#1 קיר', 'קיר', 'בנייה', 1400, measure);
  assert.ok(short.width < 120, 'short notes stay compact');
});

test('wrapping splits only words wider than the line', () => {
  const byChar = (text: string) => text.length * 10;
  assert.deepEqual(wrapNoteText('אב גד הוזח', 50, byChar), ['אב גד', 'הוזח']);
  assert.deepEqual(wrapNoteText('אבגדהוזחטי', 40, byChar), ['אבגד', 'הוזח', 'טי']);
});
