// Safety net for the Hebrew Excel exports: the workbooks are written to xlsx bytes and read back, and
// every sheet name, view, column width and cell (value, live formula with its cached result, number
// format) is pinned to a snapshot. Update only for an intended export change:
//   npm test -- --test-update-snapshots
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildQuantitiesWorkbook } from '../../src/lib/exportExcel.ts';
import { buildProjectWorkbook } from '../../src/lib/exportProjectExcel.ts';
import { buildRoomSummaries } from '../../src/lib/quantities.ts';
import type { Project } from '../../src/types/index.ts';
import { PLAN_A, PLAN_B } from './fixtures.ts';

/** Today's date as the exports print it; masked so the snapshot does not depend on the day it runs. */
const TODAY = new Date().toLocaleDateString('he-IL');

async function dump(workbook: ExcelJS.Workbook) {
  const reread = new ExcelJS.Workbook();
  await reread.xlsx.load(await workbook.xlsx.writeBuffer());
  return reread.worksheets.map((sheet) => {
    const cells: Record<string, unknown> = {};
    sheet.eachRow({ includeEmpty: false }, (row) =>
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        const value = typeof v === 'string' ? v.replace(TODAY, '<today>') : v;
        cells[cell.address] = cell.numFmt ? { value, numFmt: cell.numFmt } : value;
      })
    );
    return {
      name: sheet.name,
      rightToLeft: sheet.views[0]?.rightToLeft ?? false,
      widths: sheet.columns?.map((c) => c.width ?? null) ?? [],
      cells,
    };
  });
}

/** Every `'sheet'!` a formula names, so a renamed sheet can never leave a dangling reference. */
function referencedSheets(sheets: Awaited<ReturnType<typeof dump>>): string[] {
  const names = new Set<string>();
  for (const s of sheets)
    for (const cell of Object.values(s.cells)) {
      const v = (cell as { value?: unknown })?.value ?? cell;
      const formula = (v as { formula?: string })?.formula;
      for (const m of formula?.matchAll(/'((?:[^']|'')+)'!/g) ?? []) names.add(m[1].replace(/''/g, "'"));
    }
  return [...names];
}

const PROJECT: Project = { id: 'project-1', name: 'פרויקט חרצית 7', createdAt: 0, updatedAt: 0, planIds: ['plan-a', 'plan-b'] };

test('plan workbook: sheets, formulas and values', async (t) => {
  const summaries = buildRoomSummaries(PLAN_A);
  const areas = PLAN_A.measurements.filter((m) => m.tool === 'area' && m.areaKind && typeof m.areaM2 === 'number');
  const sheets = await dump(buildQuantitiesWorkbook(summaries, areas, 'he'));
  assert.deepEqual(
    sheets.map((s) => s.name),
    // A compact plan workbook: the schedule (summary, schedule, areas) and the openings sheet.
    ['כתב כמויות', 'הריסה ובנייה', 'פתחים וניכויים']
  );
  assert.ok(sheets.every((s) => s.rightToLeft));
  // The plan's summary reads the schedule on the same sheet: no cross-sheet references.
  assert.deepEqual(referencedSheets(sheets), []);
  t.assert.snapshot(sheets);
});

test('plan workbook with area measurements only', async (t) => {
  const sheets = await dump(buildQuantitiesWorkbook([], PLAN_A.measurements.filter((m) => m.areaKind && typeof m.areaM2 === 'number'), 'he'));
  assert.deepEqual(
    sheets.map((s) => s.name),
    ['הריסה ובנייה']
  );
  t.assert.snapshot(sheets);
});

test('project workbook: sheets, formulas and values', async (t) => {
  const sheets = await dump(buildProjectWorkbook(PROJECT, [PLAN_A, PLAN_B], 'he'));
  assert.deepEqual(
    sheets.map((s) => s.name),
    // Project summary, one schedule for all plans, and the openings sheet (the fixtures have room openings).
    ['סיכום פרויקט', 'כתב כמויות', 'הריסה ובנייה', 'פתחים וניכויים']
  );
  assert.ok(sheets.every((s) => s.rightToLeft));
  assert.deepEqual(referencedSheets(sheets), ['כתב כמויות']);
  t.assert.snapshot(sheets);
});
