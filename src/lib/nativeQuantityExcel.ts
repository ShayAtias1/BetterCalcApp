import type ExcelJS from 'exceljs';
import type { Measurement, ReportColumn } from '../types';
import type { ExportContext } from './exportLanguage';
import { buildQuantitySchedule, roomNotesText } from './quantitySchedule';
import { roomOpeningDisplay } from './openingQuantityReport';
import { BALCONY_ROW_COLOR, isBalconyRoom } from './reportRoomStyle';
import { colLetter, DASH, fillRow, newSheet, NUM_FMT, styleHeader, XL, type ScheduleEntry } from './excelReport';
import { sheetRef } from './excelSheetRef';
import type { MatrixTotals } from './quantityScheduleExcel';
import { primaryReading, totalColumnInfo, type ProjectQuantities } from './projectQuantities';
import { numberAreaMeasurements } from './areaMeasurements';

const numeric = (cell: ExcelJS.Cell, value: ExcelJS.CellValue) => { cell.value = value; cell.numFmt = NUM_FMT; };

function order(net: string, waste: string, amount: number | null, percent: number | null, result: number | null): ExcelJS.CellValue {
  if (amount === null || result === null) return DASH;
  // Keep the calculation engine's rounded result until an Excel input is edited.
  return { formula: `IF(ISNUMBER(${net}),IF(AND(${net}=${amount},${waste}=${percent ?? 0}),${result},ROUND(${net}*(1+IF(ISNUMBER(${waste}),${waste},0)/100),2)),"${DASH}")`, result };
}

function rowStyle(row: ExcelJS.Row, width: number, x: ExportContext, color: string, bold = false) {
  fillRow(row, color, width, bold);
  row.height = 30;
  for (let c = 1; c <= width; c++) {
    const cell = row.getCell(c);
    cell.font = { name: 'Arial', size: 11, bold, color: { argb: 'FF1E293B' } };
    cell.alignment = { vertical: 'middle', horizontal: typeof cell.value === 'number' || typeof cell.value === 'object' && cell.value !== null && 'formula' in cell.value ? 'center' : x.rtl ? 'right' : 'left', wrapText: true };
  }
}

function header(sheet: ExcelJS.Worksheet, labels: string[], widths: number[], x: ExportContext) {
  const row = sheet.addRow(labels);
  styleHeader(row, labels.length);
  widths.forEach((width, i) => { sheet.getColumn(i + 1).width = width; });
  sheet.views = [{ state: 'frozen', ySplit: row.number, rightToLeft: x.rtl, showGridLines: true }];
  return row.number;
}

/** Flat, filterable records; room/category baselines are never mixed with material shares. */
export function writeNativeSchedule(sheet: ExcelJS.Worksheet, entries: ScheduleEntry[], x: ExportContext, withPlan: boolean): MatrixTotals[] {
  const models = entries.map(entry => buildQuantitySchedule(entry.plan, entry.summaries, x.t));
  const strip = models.some(model => model.some(category => category.strip));
  const labels = [
    ...(withPlan ? [x.t('exports.common.plan')] : []), x.t('exports.common.apartment'), x.t('exports.common.room'),
    x.t('exports.excel.schedule.headers.category'), x.t('exports.excel.native.specification'), x.t('exports.excel.schedule.headers.unit'),
    x.t('exports.excel.native.net'), x.t('exports.excel.schedule.headers.waste'), x.t('exports.excel.schedule.headers.order'),
    ...(strip ? [x.t('exports.excel.schedule.headers.area'), x.t('exports.excel.schedule.headers.areaOrder')] : []),
    x.t('exports.quantityPdf.columns.openings'), x.t('exports.common.notes'),
  ];
  const offset = withPlan ? 1 : 0, netColumn = 6 + offset, wasteColumn = 7 + offset, orderColumn = 8 + offset;
  const head = header(sheet, labels, [...(withPlan ? [20] : []), 12, 22, 22, 28, 9, 14, 10, 14, ...(strip ? [14, 16] : []), 24, 42], x);
  const keyColumn = labels.length + 1;
  const apartmentKeyColumn = keyColumn + 1;
  sheet.getCell(head, keyColumn).value = 'Category key';
  sheet.getCell(head, apartmentKeyColumn).value = 'Apartment key';
  sheet.getColumn(keyColumn).hidden = true;
  sheet.getColumn(apartmentKeyColumn).hidden = true;
  const references = models.map(() => new Map<ReportColumn, { net: string[]; order: string[]; area: string[]; areaOrder: string[]; apartments: Map<string, { rows: number[]; net: number; order: number }> }>());
  let zebra = 0;
  let previousRoom: { entryIndex: number; roomId: string; apartment: string; row: ExcelJS.Row } | null = null;
  let roomGroupStart = head + 1;
  const roomGroups: { first: number; last: number }[] = [];
  const apartmentGroups: { identity: string; first: number; last: number }[] = [];
  entries.forEach((entry, index) => {
    const categoryRooms = models[index].map(category => new Map(category.apartments.flatMap(apt => apt.rooms).map(room => [room.summary.roomId, room])));
    for (const summary of entry.summaries) for (const [i, category] of models[index].entries()) {
      const room = categoryRooms[i].get(summary.roomId);
      if (!room) continue;
      const source = entry.plan?.rooms.find(item => item.id === summary.roomId);
      const scoped = entry.plan ? buildQuantitySchedule(entry.plan, [summary], x.t).find(item => item.column === category.column) : undefined;
      const specifications = scoped?.types.map(type => [type.label, type.specification].filter(Boolean).join(' · ')).join(' / ') || category.info.label;
      const openings = entry.plan ? roomOpeningDisplay(entry.plan, summary.roomId, x) : null;
      const notes = [source?.notes, ...roomNotesText(room.notes, x.t, x.number), openings?.partial ? x.t('openingQuantities.partial') : '',
        room.unavailable ? x.t('exports.common.notCalibrated') : '', scoped?.over ? x.t('workCatalog.overAllocated', { amount: x.number(scoped.over), unit: category.info.unitLabel }) : ''].filter(Boolean).join(' · ');
      const row = sheet.addRow([...(withPlan ? [entry.planName] : []), room.apartment || DASH, room.name, category.info.label, specifications, category.info.unitLabel,
        room.net ?? DASH, room.waste ?? 0, room.order ?? DASH, ...(strip ? [category.strip ? room.areaNet ?? DASH : '', category.strip ? room.areaOrder ?? DASH : ''] : []), openings?.text || DASH, notes]);
      const r = row.number, n = `${colLetter(netColumn)}${r}`, w = `${colLetter(wasteColumn)}${r}`;
      // The saved apartment number is its canonical key within a plan; no separate entity exists.
      const apartmentIdentity = JSON.stringify([index, source?.apartmentNumber ?? summary.apartmentNumber]);
      row.getCell(keyColumn).value = withPlan ? `${index}:${category.column}` : category.column;
      row.getCell(apartmentKeyColumn).value = apartmentIdentity;
      numeric(row.getCell(netColumn), room.net ?? DASH);
      row.getCell(wasteColumn).numFmt = '0.0';
      numeric(row.getCell(orderColumn), order(n, w, room.net, room.waste, room.order));
      if (category.strip) {
        numeric(row.getCell(9 + offset), room.areaNet ?? DASH);
        numeric(row.getCell(10 + offset), order(`${colLetter(9 + offset)}${r}`, w, room.areaNet, room.waste, room.areaOrder));
      }
      rowStyle(row, labels.length, x, isBalconyRoom(source) ? `FF${BALCONY_ROW_COLOR.slice(1)}` : zebra++ % 2 ? XL.zebraB : XL.zebraA);
      if (previousRoom && (previousRoom.entryIndex !== index || previousRoom.roomId !== summary.roomId || previousRoom.apartment !== room.apartment)) {
        roomGroups.push({ first: roomGroupStart, last: previousRoom.row.number });
        roomGroupStart = row.number;
        const separator = { style: 'medium' as const, color: { argb: 'FF94A3B8' } };
        for (let c = 1; c <= labels.length; c++) {
          const above = previousRoom.row.getCell(c), below = row.getCell(c);
          above.border = { ...above.border, bottom: separator };
          below.border = { ...below.border, top: separator };
        }
      }
      previousRoom = { entryIndex: index, roomId: summary.roomId, apartment: room.apartment, row };
      const previousApartment = apartmentGroups.at(-1);
      if (previousApartment?.identity === apartmentIdentity) previousApartment.last = row.number;
      else {
        if (previousApartment) {
          const separator = { style: 'thick' as const, color: { argb: 'FF64748B' } };
          for (let c = 1; c <= labels.length; c++) {
            const above = sheet.getCell(previousApartment.last, c), below = row.getCell(c);
            above.border = { ...above.border, bottom: separator };
            below.border = { ...below.border, top: separator };
          }
        }
        apartmentGroups.push({ identity: apartmentIdentity, first: row.number, last: row.number });
      }
      row.height = Math.max(30, Math.ceil(notes.length / 42) * 13, Math.ceil(specifications.length / 28) * 13);
      let refs = references[index].get(category.column);
      if (!refs) { refs = { net: [], order: [], area: [], areaOrder: [], apartments: new Map() }; references[index].set(category.column, refs); }
      refs.net.push(n); refs.order.push(`${colLetter(orderColumn)}${r}`);
      if (category.strip) { refs.area.push(`${colLetter(9 + offset)}${r}`); refs.areaOrder.push(`${colLetter(10 + offset)}${r}`); }
      const apt = refs.apartments.get(room.apartment) ?? { rows: [], net: 0, order: 0 };
      apt.rows.push(r); apt.net += room.net ?? 0; apt.order += room.order ?? 0; refs.apartments.set(room.apartment, apt);
    }
  });
  const lastData = sheet.rowCount;
  if (lastData > head) roomGroups.push({ first: roomGroupStart, last: lastData });
  const roomColumn = 2 + offset;
  for (const group of roomGroups) {
    const cell = sheet.getCell(group.first, roomColumn);
    const bottom = sheet.getCell(group.last, roomColumn).border.bottom;
    if (group.last > group.first) sheet.mergeCells(group.first, roomColumn, group.last, roomColumn);
    cell.alignment = { ...cell.alignment, vertical: 'middle', horizontal: x.rtl ? 'right' : 'left', wrapText: true };
    cell.border = { ...cell.border, bottom };
  }
  const apartmentColumn = 1 + offset;
  for (const group of apartmentGroups) {
    const cell = sheet.getCell(group.first, apartmentColumn);
    const bottom = sheet.getCell(group.last, apartmentColumn).border.bottom;
    if (group.last > group.first) sheet.mergeCellsWithoutStyle(group.first, apartmentColumn, group.last, apartmentColumn);
    cell.alignment = { ...cell.alignment, vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { ...cell.border, bottom };
  }
  sheet.autoFilter = { from: { row: head, column: 1 }, to: { row: Math.max(head, lastData), column: apartmentKeyColumn } };
  if (lastData === head) { const row = sheet.addRow([x.t('exports.excel.native.empty')]); row.height = 30; sheet.getColumn(1).width = 45; }
  const totals = models.map(() => new Map() as MatrixTotals);
  const hasTotals = references.some(plan => plan.size);
  if (hasTotals) { sheet.addRow([]); sheet.addRow([]); }
  const sum = (column: number, row: ExcelJS.Row, apartment = false) => {
    const range = (c: number) => `$${colLetter(c)}$${head + 1}:$${colLetter(c)}$${lastData}`;
    const criteria = [range(keyColumn), row.getCell(keyColumn).address,
      ...(apartment ? [range(apartmentKeyColumn), row.getCell(apartmentKeyColumn).address] : [])];
    return `ROUND(SUMIFS(${range(column)},${criteria.join(',')}),2)`;
  };
  entries.forEach((entry, index) => {
    for (const category of models[index]) {
      const refs = references[index].get(category.column);
      if (!refs) continue;
      if (refs.apartments.size > 1) for (const [apartment, apt] of refs.apartments) {
        const row = sheet.addRow([...(withPlan ? [entry.planName] : []), apartment || DASH, x.t('exports.excel.schedule.levels.apartment'), category.info.label, '', category.info.unitLabel]);
        row.getCell(keyColumn).value = withPlan ? `${index}:${category.column}` : category.column;
        row.getCell(apartmentKeyColumn).value = JSON.stringify([index, apartment]);
        numeric(row.getCell(netColumn), { formula: sum(netColumn, row, true), result: Math.round(apt.net * 100) / 100 });
        numeric(row.getCell(orderColumn), { formula: sum(orderColumn, row, true), result: Math.round(apt.order * 100) / 100 });
        rowStyle(row, labels.length, x, XL.group, true);
        sheet.mergeCells(row.number, roomColumn, row.number, 4 + offset);
        row.getCell(roomColumn).value = `${x.t('exports.excel.schedule.total')} · ${category.info.label}`;
        row.getCell(roomColumn).alignment = { vertical: 'middle', horizontal: x.rtl ? 'right' : 'left', wrapText: true };
      }
      const row = sheet.addRow([...(withPlan ? [entry.planName] : []), '', x.t('exports.excel.schedule.total'), category.info.label, '', category.info.unitLabel]);
      row.getCell(keyColumn).value = withPlan ? `${index}:${category.column}` : category.column;
      const cells: { net: string; order: string; area?: string; areaOrder?: string } = { net: row.getCell(netColumn).address, order: row.getCell(orderColumn).address };
      for (const [column, , amount] of [[netColumn, refs.net, category.net], [orderColumn, refs.order, category.order],
        ...(category.strip ? [[9 + offset, refs.area, category.areaNet], [10 + offset, refs.areaOrder, category.areaOrder]] : [])] as [number, string[], number | null][]) {
        numeric(row.getCell(column), { formula: sum(column, row), result: amount ?? 0 });
      }
      if (category.strip) { cells.area = row.getCell(9 + offset).address; cells.areaOrder = row.getCell(10 + offset).address; }
      totals[index].set(category.column, cells);
      rowStyle(row, labels.length, x, XL.category, true);
      sheet.mergeCells(row.number, roomColumn, row.number, 4 + offset);
      row.getCell(roomColumn).value = `${x.t('exports.excel.schedule.total')} · ${category.info.label}`;
      row.getCell(roomColumn).alignment = { vertical: 'middle', horizontal: x.rtl ? 'right' : 'left', wrapText: true };
    }
  });
  const verticalBorder = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } };
  for (let r = head; r <= sheet.rowCount; r++) for (let c = 1; c <= labels.length; c++) {
    if (hasTotals && (r === lastData + 1 || r === lastData + 2)) continue;
    const cell = sheet.getCell(r, c);
    cell.border = { ...cell.border, left: verticalBorder, right: verticalBorder };
  }
  // Material allocations have their own filterable dataset, not additional additive room rows.
  const materials = models.flatMap((model, index) => model.filter(category => category.types.length).map(category => ({ category, index })));
  if (materials.length) {
    const material = newSheet(sheet.workbook, x.t('exports.excel.sheets.workItems'), x);
    const titles = [...(withPlan ? [x.t('exports.common.plan')] : []), x.t('exports.excel.schedule.headers.category'), x.t('exports.excel.native.specification'), x.t('exports.excel.schedule.headers.unit'), x.t('exports.excel.native.net'), x.t('exports.excel.schedule.headers.waste'), x.t('exports.excel.schedule.headers.order'), ...(strip ? [x.t('exports.excel.schedule.headers.area'), x.t('exports.excel.schedule.headers.areaOrder')] : [])];
    header(material, titles, [...(withPlan ? [20] : []), 22, 36, 9, 14, 12, 14, ...(strip ? [14, 16] : [])], x);
    for (const { category, index } of materials) for (const type of category.types) {
      const waste = type.net ? (type.order / type.net - 1) * 100 : 0;
      const row = material.addRow([...(withPlan ? [entries[index].planName] : []), category.info.label, [type.label, type.specification].filter(Boolean).join(' · '), category.info.unitLabel, type.net, waste, type.order, ...(strip ? [type.areaNet ?? '', type.areaOrder ?? ''] : [])]);
      numeric(row.getCell(4 + offset), type.net);
      row.getCell(5 + offset).numFmt = '0.0';
      numeric(row.getCell(6 + offset), order(row.getCell(4 + offset).address, row.getCell(5 + offset).address, type.net, waste, type.order));
      if (strip) { row.getCell(7 + offset).numFmt = NUM_FMT; row.getCell(8 + offset).numFmt = NUM_FMT; }
      rowStyle(row, titles.length, x, row.number % 2 ? XL.zebraB : XL.zebraA);
    }
    material.autoFilter = `A1:${colLetter(titles.length)}${material.rowCount}`;
  }
  return totals;
}

/** One consolidated summary only for exports containing multiple plans. */
export function writeNativeProjectSummary(sheet: ExcelJS.Worksheet, q: ProjectQuantities, layouts: MatrixTotals[], scheduleName: string, x: ExportContext) {
  const area = q.totals.some(total => { const info = totalColumnInfo(total, x.t); return info.unit === 'lm' && info.hasArea; });
  header(sheet, [x.t('exports.excel.schedule.headers.category'), x.t('exports.excel.schedule.headers.unit'), x.t('exports.excel.native.net'), x.t('exports.excel.schedule.headers.order'), ...(area ? [x.t('exports.excel.schedule.headers.area'), x.t('exports.excel.schedule.headers.areaOrder')] : []), x.t('exports.common.notes')], [28, 10, 16, 16, ...(area ? [16, 18] : []), 42], x);
  for (const total of q.totals) {
    const info = totalColumnInfo(total, x.t), value = primaryReading(total, info);
    const strip = info.unit === 'lm' && info.hasArea;
    const row = sheet.addRow([total.label, info.unitLabel, value.net ?? DASH, value.order ?? DASH, ...(area ? [strip ? total.quantityM2 ?? DASH : '', strip ? total.orderM2 ?? DASH : ''] : []), q.uncalibratedRoomCount ? x.t('exports.projectPdf.uncalibratedNote', { count: q.uncalibratedRoomCount }) : '']);
    for (const [column, key, amount] of [[3, 'net', value.net], [4, 'order', value.order]] as const) {
      const refs = layouts.flatMap(layout => layout.get(total.category)?.[key] ? [`${sheetRef(scheduleName)}${layout.get(total.category)![key]}`] : []);
      if (refs.length) numeric(row.getCell(column), { formula: `ROUND(SUM(${refs.join(',')}),2)`, result: amount ?? 0 });
    }
    if (strip) for (const [column, key, amount] of [[5, 'area', total.quantityM2], [6, 'areaOrder', total.orderM2]] as const) {
      const refs = layouts.flatMap(layout => layout.get(total.category)?.[key] ? [`${sheetRef(scheduleName)}${layout.get(total.category)![key]}`] : []);
      if (refs.length) numeric(row.getCell(column), { formula: `ROUND(SUM(${refs.join(',')}),2)`, result: amount ?? 0 });
    }
    rowStyle(row, area ? 7 : 5, x, row.number % 2 ? XL.zebraB : XL.zebraA, true);
  }
  sheet.autoFilter = `A1:${area ? 'G' : 'E'}${sheet.rowCount}`;
}

/** Area measurements remain a separate tally, with one filterable table across exported plans. */
export function writeNativeAreas(sheet: ExcelJS.Worksheet, entries: { planName: string; measurements: Measurement[] }[], x: ExportContext, withPlan: boolean) {
  const keys = ['number', 'page', 'kind', 'calcMode', 'length', 'height', 'area'] as const;
  const labels = [...(withPlan ? [x.t('exports.common.plan')] : []), ...keys.map(key => x.t(`exports.common.areaHeaders.${key}`))];
  const offset = withPlan ? 1 : 0;
  header(sheet, labels, [...(withPlan ? [22] : []), 8, 10, 24, 26, 16, 16, 16], x);
  const totals = new Map<string, { area: number; length: number }>();
  for (const entry of entries) {
    const numbers = numberAreaMeasurements(entry.measurements);
    for (const measurement of entry.measurements) {
      const wall = measurement.calcMode === 'wall';
      const length = wall ? Math.round((measurement.wallLengthM ?? 0) * 100) / 100 : 0;
      const area = Math.round((measurement.areaM2 ?? 0) * 100) / 100;
      const kind = x.t(`areaKinds.${measurement.areaKind!}`);
      const row = sheet.addRow([...(withPlan ? [entry.planName] : []), numbers.get(measurement.id) ?? '', measurement.pageNumber, kind,
        x.t(wall ? 'exports.common.calcWall' : 'exports.common.calcFootprint'), wall ? length : DASH,
        wall ? Math.round((measurement.wallHeightM ?? 0) * 100) / 100 : DASH, area]);
      for (const c of [5, 6, 7]) row.getCell(c + offset).numFmt = NUM_FMT;
      rowStyle(row, labels.length, x, row.number % 2 ? XL.zebraB : XL.zebraA);
      const total = totals.get(kind) ?? { area: 0, length: 0 };
      total.area += area; total.length += length; totals.set(kind, total);
    }
  }
  const last = sheet.rowCount;
  sheet.autoFilter = `A1:${colLetter(labels.length)}${last}`;
  for (const [kind, total] of totals) {
    const row = sheet.addRow([]);
    row.getCell(3 + offset).value = kind;
    row.getCell(4 + offset).value = x.t('exports.excel.schedule.total');
    for (const [column, amount] of [[5 + offset, total.length], [7 + offset, total.area]]) {
      const range = (c: number) => `$${colLetter(c)}$2:$${colLetter(c)}$${last}`;
      numeric(row.getCell(column), { formula: `ROUND(SUMIF(${range(3 + offset)},${row.getCell(3 + offset).address},${range(column)}),2)`, result: Math.round(amount * 100) / 100 });
    }
    rowStyle(row, labels.length, x, XL.category, true);
  }
}
