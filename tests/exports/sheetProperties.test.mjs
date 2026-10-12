import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import BrowserExcelJS from 'exceljs/dist/exceljs.min.js';
import JSZip from 'jszip';

for (const [name, engine] of [['node', ExcelJS], ['browser', BrowserExcelJS]]) {
  test(`${name}: grouped rows and page setup serialize sheetPr in schema order`, async () => {
    const workbook = new engine.Workbook();
    const sheet = workbook.addWorksheet('Quantities', {
      properties: { tabColor: { argb: 'FF1F4E79' }, outlineProperties: { summaryBelow: false, summaryRight: false } },
      pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0, orientation: 'landscape' },
      views: [{ state: 'normal', showGridLines: true }],
    });
    sheet.mergeCells('A1:B1');
    sheet.getCell('A1').value = 'Quantity Schedule';
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    sheet.addRow(['Room', 12.5]);
    sheet.addRow(['Explanation', 'Net quantity']).outlineLevel = 1;
    sheet.addRow(['Total', { formula: 'SUM(B2:B3)', result: 12.5 }]);
    sheet.getCell('B2').numFmt = '#,##0.00';
    sheet.pageSetup.printArea = 'A1:B4';
    workbook.addWorksheet('Specifications').addRow(['Preserved specification']);

    const buffer = await workbook.xlsx.writeBuffer();
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
    const properties = xml.match(/<sheetPr(?:\s[^>]*)?>([\s\S]*?)<\/sheetPr>/)?.[1];
    assert.ok(properties, 'sheetPr must be present');
    assert.deepEqual([...properties.matchAll(/<(tabColor|outlinePr|pageSetUpPr)\b/g)].map(match => match[1]),
      ['tabColor', 'outlinePr', 'pageSetUpPr']);
    assert.match(xml, /<outlinePr[^>]*summaryBelow="0"[^>]*summaryRight="0"/);
    assert.match(xml, /<pageSetUpPr[^>]*fitToPage="1"/);
    assert.match(xml, /<row[^>]*outlineLevel="1"/);

    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(buffer);
    assert.equal(restored.worksheets.length, 2);
    const result = restored.getWorksheet('Quantities');
    assert.equal(result.getCell('B2').value, 12.5);
    assert.deepEqual(result.getCell('B4').value, { formula: 'SUM(B2:B3)', result: 12.5 });
    assert.equal(result.getCell('B2').numFmt, '#,##0.00');
    assert.equal(result.getCell('A1').fill.fgColor.argb, 'FF1F4E79');
    assert.equal(result.getCell('B1').master.address, 'A1');
    assert.equal(result.getRow(3).outlineLevel, 1);
    assert.equal(result.pageSetup.fitToPage, true);
    assert.equal(result.pageSetup.printArea, 'A1:B4');

    if (process.env.BETTERCALC_XLSX_REGRESSION_DIR) {
      await mkdir(process.env.BETTERCALC_XLSX_REGRESSION_DIR, { recursive: true });
      await writeFile(join(process.env.BETTERCALC_XLSX_REGRESSION_DIR, `${name}-grouped-page-setup.xlsx`), buffer);
    }
  });
}
