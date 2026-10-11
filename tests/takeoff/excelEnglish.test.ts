// The English workbooks: the same quantities and live formulas as the Hebrew ones, in English, left to
// right. Both are built, written to xlsx bytes and read back, then compared cell by cell — the numbers
// and formulas must match exactly, only the words, sheet names and layout direction may differ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildQuantitiesWorkbook } from '../../src/lib/exportExcel.ts';
import { buildProjectWorkbook } from '../../src/lib/exportProjectExcel.ts';
import { buildRoomSummaries } from '../../src/lib/quantities.ts';
import { sheetRef } from '../../src/lib/excelSheetRef.ts';
import { columnWidths } from '../../src/lib/exportLanguage.ts';
import type { Project } from '../../src/types/index.ts';
import { PLAN_A, PLAN_B } from './fixtures.ts';

const HEBREW = /[֐-׿]/;

interface Sheet {
  name: string;
  rightToLeft: boolean;
  widths: (number | null)[];
  cells: Record<string, unknown>;
}

async function dump(workbook: ExcelJS.Workbook): Promise<Sheet[]> {
  const reread = new ExcelJS.Workbook();
  await reread.xlsx.load(await workbook.xlsx.writeBuffer());
  return reread.worksheets.map((sheet) => {
    const cells: Record<string, unknown> = {};
    sheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell) => (cells[cell.address] = cell.value)));
    return { name: sheet.name, rightToLeft: sheet.views[0]?.rightToLeft ?? false, widths: sheet.columns?.map((c) => c.width ?? null) ?? [], cells };
  });
}

const PROJECT: Project = { id: 'project-1', name: 'פרויקט חרצית 7', createdAt: 0, updatedAt: 0, planIds: ['plan-a', 'plan-b'] };
const areas = PLAN_A.measurements.filter((m) => m.tool === 'area' && m.areaKind && typeof m.areaM2 === 'number');

const isFormula = (v: unknown): v is { formula: string; result: unknown } => typeof v === 'object' && v !== null && 'formula' in v;

/** Formula text with every sheet name replaced by its position, so Hebrew and English can be compared. */
function normalise(formula: string, names: string[]): string {
  let out = formula;
  names.forEach((n, i) => (out = out.split(sheetRef(n)).join(`#${i}!`)));
  return out;
}

async function parity(he: Sheet[], en: Sheet[]) {
  assert.equal(en.length, he.length, 'same number of sheets');
  const heNames = he.map((s) => s.name);
  const enNames = en.map((s) => s.name);
  let formulas = 0;
  let numbers = 0;
  en.forEach((enSheet, i) => {
    const heSheet = he[i];
    assert.deepEqual(Object.keys(enSheet.cells), Object.keys(heSheet.cells), `${enSheet.name}: same cells`);
    for (const [addr, enValue] of Object.entries(enSheet.cells)) {
      const heValue = heSheet.cells[addr];
      if (isFormula(enValue)) {
        assert.ok(isFormula(heValue), `${enSheet.name}!${addr} is a formula in both`);
        assert.equal(normalise(enValue.formula, enNames), normalise(heValue.formula, heNames), `${enSheet.name}!${addr} formula`);
        assert.deepEqual(enValue.result, heValue.result, `${enSheet.name}!${addr} cached result`);
        formulas++;
      } else if (typeof heValue === 'number') {
        assert.equal(enValue, heValue, `${enSheet.name}!${addr} number`);
        numbers++;
      }
    }
  });
  return { formulas, numbers };
}

test('English plan workbook: names, direction, formulas and numbers match the Hebrew one', async () => {
  const summaries = buildRoomSummaries(PLAN_A);
  const he = await dump(buildQuantitiesWorkbook(summaries, areas, 'he'));
  const en = await dump(buildQuantitiesWorkbook(summaries, areas, 'en'));

  assert.deepEqual(
    en.map((s) => s.name),
    ['Overall Summary', 'Quantity Takeoff', 'Opening Deductions', 'Demolition & New Construction']
  );
  assert.ok(en.every((s) => !s.rightToLeft), 'English sheets run left to right');
  assert.ok(he.every((s) => s.rightToLeft), 'Hebrew sheets are unchanged: right to left');
  // Excel limits sheet names to 31 characters.
  assert.ok(en.every((s) => s.name.length <= 31));

  const { formulas, numbers } = await parity(he, en);
  assert.ok(formulas > 20, `formulas were compared (${formulas})`);
  assert.ok(numbers > 20, `numbers were compared (${numbers})`);

  // The summary's formulas reach the data sheet by its English name, and that sheet exists.
  const referenced = new Set<string>();
  for (const s of en)
    for (const v of Object.values(s.cells))
      if (isFormula(v)) for (const m of v.formula.matchAll(/'((?:[^']|'')+)'!/g)) referenced.add(m[1].replace(/''/g, "'"));
  assert.deepEqual([...referenced], ['Quantity Takeoff']);
  assert.ok(en.some((s) => s.name === 'Quantity Takeoff'));
  const summary = en[0].cells;
  assert.ok(Object.values(summary).some((v) => isFormula(v) && v.formula.startsWith("'Quantity Takeoff'!")));
});

test('English plan workbook: headers, units and labels are English; only the user\'s own text stays Hebrew', async () => {
  const summaries = buildRoomSummaries(PLAN_A);
  const en = await dump(buildQuantitiesWorkbook(summaries, areas, 'en'));
  const data = en.find((s) => s.name === 'Quantity Takeoff')!;
  const headers = Object.entries(data.cells).filter(([a]) => /^[A-Z]+1$/.test(a)).map(([, v]) => v);
  assert.deepEqual(headers.slice(0, 6), ['Apartment', 'Room', 'Standard floor tiling area (m²)', 'AS floor tiling area (m²)', 'Wall cladding area (m²)', 'Skirting area (m²)']);
  for (const h of headers) assert.ok(!HEBREW.test(String(h)), `header ${h}`);

  // Every Hebrew string left in the workbook is something the project's own data says.
  const own = new Set<string>();
  for (const plan of [PLAN_A]) {
    own.add(plan.name);
    for (const r of plan.rooms) [r.name, r.notes, r.apartmentNumber].forEach((v) => v && own.add(v));
  }
  for (const s of en)
    for (const [addr, v] of Object.entries(s.cells))
      if (typeof v === 'string' && HEBREW.test(v)) assert.ok([...own].some((o) => v.includes(o)), `${s.name}!${addr} is Hebrew but not user data: ${v}`);
  for (const s of en) assert.ok(!HEBREW.test(s.name));
  const areaSheet = en.find((s) => s.name === 'Demolition & New Construction')!;
  assert.ok(Object.values(areaSheet.cells).includes('Demolition'));
  assert.ok(Object.values(areaSheet.cells).includes('Area (m²)'));
});

test('English project workbook: names, direction, formulas and numbers match the Hebrew one', async () => {
  const he = await dump(buildProjectWorkbook(PROJECT, [PLAN_A, PLAN_B], 'he'));
  const en = await dump(buildProjectWorkbook(PROJECT, [PLAN_A, PLAN_B], 'en'));
  assert.deepEqual(
    en.map((s) => s.name),
    ['Project Summary', 'Plans', 'Rooms', 'Work Types', 'Physical opening counts', 'Opening schedule']
  );
  assert.ok(en.every((s) => !s.rightToLeft));
  assert.ok(he.every((s) => s.rightToLeft));
  const { formulas, numbers } = await parity(he, en);
  assert.ok(formulas > 10 && numbers > 20, `compared ${formulas} formulas and ${numbers} numbers`);
  assert.ok(Object.values(en[0].cells).some((v) => isFormula(v) && v.formula.startsWith("'Plans'!")));
  // The metadata line carries an English date, not a Hebrew-locale one.
  const meta = Object.values(en[0].cells).find((v) => typeof v === 'string' && /plans? ·/.test(v)) as string;
  assert.match(meta, /^2 plans · \d{1,2} [A-Z][a-z]{2} \d{4}$/);
  // Units are English and the quantities stay real numbers.
  const workItems = en[3];
  assert.ok(Object.values(workItems.cells).includes('m²') && Object.values(workItems.cells).includes('lm'));
  assert.ok(Object.values(en[1].cells).some((v) => typeof v === 'number'));
});

test('English column widths: Hebrew widths untouched, English widened only as far as the headers need', () => {
  const base = [10, 20, 8];
  const headers = ['Apartment', 'Standard tiling area (m²)', 'm²'];
  assert.deepEqual(columnWidths(base, headers, 'he'), base);
  const en = columnWidths(base, headers, 'en');
  assert.ok(en[0] >= 10 && en[1] > 20 && en[2] === 8);
  en.forEach((w, i) => assert.ok(w >= base[i]));
});
