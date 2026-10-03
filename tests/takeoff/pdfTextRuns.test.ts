// PDF report text layout: RTL stays the default and lays out exactly as before; LTR can be asked for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import bidiFactory from 'bidi-js';
import { fontRuns, lineStartX, startAlign, visualOrder } from '../../src/lib/pdfTextRuns.ts';

const HEBREW_REPORT_STRINGS = [
  'כתב כמויות — פרויקט חרצית 7 — קומה 3',
  'אורך להזמנה (מ"א)',
  'שים לב: 2 חדרים לא נכללו בסיכום — העמוד שלהם אינו מכויל',
  'פחת %',
  'ריצוף AS',
  'עמוד תוכנית 1 · 2.10.2026',
  '12.65',
  '-',
];

test('RTL reordering is exactly the previous implementation', () => {
  // The code pdfText.ts ran before direction became a parameter, verbatim.
  const bidi = bidiFactory();
  const previous = (text: string) => bidi.getReorderedString(text, bidi.getEmbeddingLevels(text, 'rtl'));
  for (const s of HEBREW_REPORT_STRINGS) assert.equal(visualOrder(s, 'rtl'), previous(s));
});

test('LTR puts neutral punctuation where English expects it', () => {
  assert.equal(visualOrder('Total (m²):', 'ltr'), 'Total (m²):');
  // On an RTL base the same string's trailing colon moves to the far (left) end.
  assert.notEqual(visualOrder('Total (m²):', 'rtl'), 'Total (m²):');
});

test('font runs split Hebrew from Latin and hand Hebrew over in logical order', () => {
  const pair = { hebrew: 'H', latin: 'L' };
  const runs = fontRuns(visualOrder('ריצוף AS', 'rtl'), pair);
  assert.deepEqual(runs, [
    { text: 'AS ', font: 'L' },
    { text: 'ריצוף', font: 'H' },
  ]);
});

test('default alignment is the start side; placement matches canvas textAlign', () => {
  assert.equal(startAlign('rtl'), 'right');
  assert.equal(startAlign('ltr'), 'left');
  assert.equal(lineStartX(100, 40, 'right'), 60);
  assert.equal(lineStartX(100, 40, 'center'), 80);
  assert.equal(lineStartX(100, 40, 'left'), 100);
});
