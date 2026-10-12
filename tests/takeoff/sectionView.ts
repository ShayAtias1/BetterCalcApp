// A section of a workbook sheet (e.g. "Concrete" inside "Structural Quantities") read as if it were its
// own table: row 1 is the section's column header, its rows run to the first empty row. `at(r)` gives the
// sheet's real row number, for checking the live formulas, which address the sheet itself.
import type ExcelJS from 'exceljs';

export interface SectionView {
  rowCount: number;
  views: Partial<ExcelJS.WorksheetView>[];
  at(r: number): number;
  getRow(r: number): ExcelJS.Row;
  getCell(address: string): ExcelJS.Cell;
  eachRow(cb: (row: ExcelJS.Row, r: number) => void): void;
}

export function sectionOf(workbook: ExcelJS.Workbook, sheetName: string, title: string): SectionView | undefined {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) return undefined;
  let titleRow = 0;
  sheet.eachRow((row, r) => {
    if (!titleRow && row.getCell(1).value === title && row.cellCount <= 1) titleRow = r;
  });
  if (!titleRow) return undefined;
  let end = titleRow + 1;
  while (end + 1 <= sheet.rowCount && sheet.getRow(end + 1).cellCount > 0 && (sheet.getRow(end + 1).values as unknown[]).some((v) => v !== undefined && v !== null)) end++;
  const at = (r: number) => titleRow + r;
  return {
    rowCount: end - titleRow,
    views: sheet.views,
    at,
    getRow: (r) => sheet.getRow(at(r)),
    getCell: (address) => {
      const [, col, row] = /^([A-Z]+)(\d+)$/.exec(address)!;
      return sheet.getCell(`${col}${at(Number(row))}`);
    },
    eachRow: (cb) => {
      for (let r = 1; r <= end - titleRow; r++) cb(sheet.getRow(at(r)), r);
    },
  };
}
