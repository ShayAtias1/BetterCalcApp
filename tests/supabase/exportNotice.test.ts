import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { decodePDFRawStream, PDFDocument, StandardFonts } from 'pdf-lib';

// pdfText reads its logo with DOMParser when it loads; the logo is irrelevant here, so a stand-in with no paths is enough.
(globalThis as any).DOMParser ??= class { parseFromString() { return { documentElement: { getAttribute: () => null }, querySelectorAll: () => [] }; } };
const { addExcelNotice, EXPORT_NOTICE } = await import('../../src/lib/legal/exportNotice.ts');
const { stampExportNotice } = await import('../../src/lib/legal/pdfExportNotice.ts');

test('the PDF notice is added in a strip under each page; page content is only moved up', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { regular: { hebrew: font, latin: font }, bold: { hebrew: bold, latin: bold } };
  doc.addPage([595, 842]);
  doc.addPage([2000, 1400]);
  const before = doc.getPages().map((p) => p.getSize());
  stampExportNotice(doc, fonts, 'en', '17.10.2026');
  const after = doc.getPages().map((p) => p.getSize());
  after.forEach((size, i) => {
    assert.equal(size.width, before[i].width);
    assert.ok(size.height > before[i].height, 'a strip was added');
    assert.ok(size.height - before[i].height < before[i].height * 0.12, 'the strip stays small');
  });
  const saved = await PDFDocument.load(await doc.save());
  assert.equal(saved.getPageCount(), 2);
  assert.equal(saved.getPage(0).getMediaBox().height, after[0].height);
  // Everything, the notice included, sits inside the one translation wrapper: nothing is drawn after its closing Q, so
  // the notice lands in the new strip and the original content is moved up by exactly the strip's height.
  const streams = (saved.getPage(0).node.Contents() as any).asArray().map((ref: any) => Buffer.from(decodePDFRawStream(saved.context.lookup(ref) as any).decode()).toString('latin1').trim());
  const used = streams.filter(Boolean);
  assert.match(used[0], /^q\s+1 0 0 1 0 [\d.]+ cm$/);
  assert.equal(used[used.length - 1], 'Q');
  assert.ok(/T[jJ]/.test(used.slice(1, -1).join('\n')), 'the notice text is inside the wrapper');
});

test('the Excel notice goes below the last row and moves nothing above it', () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Schedule');
  sheet.getCell('A1').value = 'Room';
  sheet.getCell('B1').value = 3;
  sheet.getCell('B2').value = { formula: 'B1*2', result: 6 };
  addExcelNotice(workbook, 'he', true);
  assert.equal(sheet.getCell('A1').value, 'Room');
  assert.deepEqual(sheet.getCell('B2').value, { formula: 'B1*2', result: 6 });
  assert.equal(sheet.getCell('A4').value, EXPORT_NOTICE.he.excel);
  assert.equal(sheet.lastRow?.number, 4);
  assert.equal(workbook.description, EXPORT_NOTICE.he.excel);
});

test('the notices say it is an auxiliary calculation to verify and not certification, never "exact" or "approved"', () => {
  for (const lang of ['he', 'en'] as const) {
    const all = Object.values(EXPORT_NOTICE[lang]).join(' ');
    assert.ok(!/exact|approved|certified|מדויק(?!ות)|מאושר/i.test(all.replace(/not engineering[^.]*certification/i, '')), lang);
  }
  assert.match(EXPORT_NOTICE.en.body, /Verify all quantities independently/);
  assert.match(EXPORT_NOTICE.he.body, /יש לאמת/);
});
