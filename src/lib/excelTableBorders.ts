import type ExcelJS from 'exceljs';

/** Only style the supplied table cells, never the surrounding worksheet. */
export function borderTableRow(row: ExcelJS.Row, columns: number, kind: 'data' | 'header' | 'total' = 'data') {
  const vertical = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } };
  const horizontal = { style: 'hair' as const, color: { argb: 'FFCBD5E1' } };
  const boundary = { style: 'medium' as const, color: { argb: 'FF94A3B8' } };
  for (let c = 1; c <= columns; c++) {
    const cell = row.getCell(c);
    cell.border = {
      ...cell.border,
      left: vertical,
      right: vertical,
      ...(kind === 'data' ? { bottom: cell.border?.bottom ?? horizontal } : { top: boundary, bottom: boundary }),
    };
  }
}
