import type ExcelJS from 'exceljs';
import type { Language } from '../../i18n';

/**
 * The short notice every PDF and Excel export carries (Terms sections 3, 4 and 6): the report is the user's own work with
 * an auxiliary tool, PDF-based measurement can be inaccurate, and the figures must be verified before use. Reports reach
 * clients and suppliers who never accepted the Terms, so the warning travels with the file. Nothing here touches a quantity:
 * the PDF gets an extra strip under each page (the page content is only moved up), the workbook a note below the last row
 * of each sheet, so no cell or formula reference moves.
 */
export const EXPORT_NOTICE: Record<Language, { headline: string; body: string; excel: string }> = {
  en: {
    headline: 'Auxiliary calculation only. Verify before use.',
    body: 'Prepared by the user with BetterCalc, an auxiliary calculation tool. PDF-based measurements may be inaccurate. Verify all quantities independently before use. Not engineering or quantity-surveying certification.',
    excel: 'Auxiliary calculation by the user with BetterCalc. PDF-based measurements may be inaccurate. Verify independently before use. Not engineering certification. Values may have been edited after export.',
  },
  he: {
    headline: 'חישוב עזר בלבד. יש לאמת לפני שימוש.',
    body: 'הוכן על ידי המשתמש באמצעות BetterCalc, כלי עזר לחישוב. מדידות מתוך PDF עלולות להיות לא מדויקות. יש לאמת את כל הכמויות באופן עצמאי לפני שימוש. אינו אישור הנדסי או כמאות.',
    excel: 'חישוב עזר שבוצע על ידי המשתמש ב-BetterCalc. מדידות מתוך PDF עלולות להיות לא מדויקות. יש לאמת באופן עצמאי לפני שימוש. אינו אישור הנדסי. ייתכן שהערכים שונו לאחר הייצוא.',
  },
};

/** A note under the last row of every sheet (merged across the used columns). Rows above are not moved, so formulas stay valid. */
export function addExcelNotice(workbook: ExcelJS.Workbook, language: Language, rtl: boolean): void {
  const text = EXPORT_NOTICE[language].excel;
  workbook.description = text;
  for (const sheet of workbook.worksheets) {
    const columns = Math.min(Math.max(sheet.columnCount, 4), 12);
    const row = (sheet.lastRow?.number ?? 0) + 2;
    let width = 0;
    for (let c = 1; c <= columns; c++) width += sheet.getColumn(c).width ?? 10;
    sheet.mergeCells(row, 1, row, columns);
    const cell = sheet.getCell(row, 1);
    cell.value = text;
    cell.font = { italic: true, size: 9, color: { argb: 'FF64748B' } };
    cell.alignment = { wrapText: true, vertical: 'top', horizontal: rtl ? 'right' : 'left', readingOrder: rtl ? 'rtl' : 'ltr' };
    sheet.getRow(row).height = Math.max(15, Math.ceil(text.length / Math.max(width * 1.1, 20)) * 12.5);
  }
}
