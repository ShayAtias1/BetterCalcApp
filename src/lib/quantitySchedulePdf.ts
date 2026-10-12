/** PDF presentation only; figures come from the unchanged shared quantity schedule. */
import type { Plan, RoomQuantitySummary } from '../types';
import type { ExportContext } from './exportLanguage';
import type { ReportWriter, MatrixCell, MatrixRow, ScheduleRow } from './pdfReportWriter';
import { buildQuantitySchedule, roomNotesText, type ScheduleCategory, type ScheduleRoom } from './quantitySchedule';
import { primaryReading, type ProjectCategoryTotal, type ReportColumnInfo } from './projectQuantities';
import { roomOpeningDisplay } from './openingQuantityReport';
import { BALCONY_ROW_COLOR, isBalconyRoom } from './reportRoomStyle';

export interface ScheduleInput { plan: Plan; summaries: RoomQuantitySummary[] }
export interface RoomMatrix { categories: ScheduleCategory[]; rows: MatrixRow[] }
const DASH = '-';
const MAX_CATEGORIES = 7;

function relevant(c: ScheduleCategory): boolean {
  return c.net !== 0 || c.order !== 0 || (c.areaNet !== null && c.areaNet !== 0) || c.over > 0 || c.apartments.some(a => a.rooms.some(r => r.unavailable));
}

function quantityCells(room: ScheduleRoom | undefined, strip: boolean, x: ExportContext): MatrixCell[] {
  if (!room) return [{ main: DASH }, { main: DASH }];
  if (room.unavailable) return [0, 1].map(() => ({ main: x.t('exports.common.notCalibrated'), color: '#92400E' }));
  const fmt = (v: number | null) => v === null ? DASH : x.number(v);
  const area = (v: number | null) => strip ? `${fmt(v)} ${x.t('units.m2')}` : '';
  return [
    { main: fmt(room.net), sub: [area(room.areaNet), ...roomNotesText(room.notes, x.t, x.number)].filter(Boolean).join(' · ') },
    { main: fmt(room.order), sub: [x.t('exports.quantityPdf.waste', { percent: room.waste ?? 0 }), area(room.areaOrder)].filter(Boolean).join(' · ') },
  ];
}

/** Bounded-width bands keep paired columns legible when many custom categories exist. */
export function buildRoomMatrices(input: ScheduleInput, x: ExportContext): RoomMatrix[] {
  const categories = buildQuantitySchedule(input.plan, input.summaries, x.t).filter(relevant);
  const roomsById = new Map(input.plan.rooms.map(room => [room.id, room]));
  const detailsByRoom = new Map(input.summaries.map(summary => {
    const openings = roomOpeningDisplay(input.plan, summary.roomId, x);
    const warnings = [openings.partial ? x.t('openingQuantities.partial') : '', !summary.pageCalibrated ? x.t('exports.common.notCalibrated') : ''].filter(Boolean);
    return [summary.roomId, [
      { main: openings.text || DASH, sub: openings.areaM2 === null || openings.areaM2 === 0 ? undefined : `${x.number(openings.areaM2)} ${x.t('units.m2')}` },
      { main: roomsById.get(summary.roomId)?.notes || DASH, sub: warnings.join(' · ') || undefined, color: warnings.length ? '#92400E' : undefined },
    ] satisfies MatrixCell[]] as const;
  }));
  const result: RoomMatrix[] = [];
  // Balance bands rather than leaving one category stretched across a final, mostly empty table.
  const bandSize = categories.length ? Math.ceil(categories.length / Math.ceil(categories.length / MAX_CATEGORIES)) : MAX_CATEGORIES;
  for (let offset = 0; offset < categories.length; offset += bandSize) {
    const band = categories.slice(offset, offset + bandSize);
    const roomsByCategory = band.map(c => new Map(c.apartments.flatMap(a => a.rooms).map(r => [r.summary.roomId, r])));
    const rows: MatrixRow[] = input.summaries.filter(s => roomsByCategory.some(m => m.has(s.roomId))).map(s => ({
      bg: isBalconyRoom(roomsById.get(s.roomId)) ? BALCONY_ROW_COLOR : undefined,
      cells: [
        { main: s.apartmentNumber || DASH },
        { main: roomsByCategory.map(m => m.get(s.roomId)).find(Boolean)!.name },
        ...band.flatMap((c, i) => quantityCells(roomsByCategory[i].get(s.roomId), c.strip, x)),
        ...detailsByRoom.get(s.roomId)!,
      ],
    }));
    rows.push({ total: true, cells: [
      { main: '' }, { main: x.t('exports.common.total') },
      ...band.flatMap(c => [
        { main: x.number(c.net), sub: c.strip ? `${x.number(c.areaNet ?? 0)} ${x.t('units.m2')}` : undefined },
        { main: x.number(c.order), sub: c.strip ? `${x.number(c.areaOrder ?? 0)} ${x.t('units.m2')}` : undefined },
      ]),
      { main: '' }, { main: '' },
    ] });
    result.push({ categories: band, rows });
  }
  return result;
}

/** Actual material allocations only. Legacy, unsplit work items need no separate breakdown. */
export function buildMaterialRows(input: ScheduleInput, x: ExportContext): ScheduleRow[] {
  return buildQuantitySchedule(input.plan, input.summaries, x.t).filter(c => relevant(c) && c.types.some(type => type.specId !== null)).flatMap(c => c.types.map(type => ({
    kind: 'type' as const,
    cells: [type.specId === null ? x.t('workCatalog.sources.unassigned') : type.specification ? `${type.label} · ${type.specification}` : type.label,
      x.number(type.net), c.info.unitLabel, x.number(type.order), c.info.label,
      c.strip ? x.t('exports.quantityPdf.schedule.areaReading', { net: x.number(type.areaNet ?? 0), order: x.number(type.areaOrder ?? 0), unit: x.t('units.m2') }) : ''],
  })));
}

/** One room matrix and integrated total; material shares appear below without repeating rooms. */
export function writeRoomSchedule(writer: ReportWriter, input: ScheduleInput, x: ExportContext) {
  const matrices = buildRoomMatrices(input, x);
  for (const matrix of matrices) writer.matrix(
    [x.t('exports.common.apartment'), x.t('exports.common.room')],
    matrix.categories.map(c => x.t('exports.quantityPdf.categoryWithUnit', { label: c.info.label, unit: c.info.unitLabel })),
    [x.t('exports.quantityPdf.columns.net'), x.t('exports.quantityPdf.columns.order')], matrix.rows,
    { title: x.t('exports.quantityPdf.columns.details'), headers: [x.t('exports.quantityPdf.columns.openings'), x.t('exports.common.notes')] },
  );
  const materialRows = buildMaterialRows(input, x);
  if (materialRows.length) {
    writer.section(x.t('exports.quantityPdf.schedule.byType'), 3);
    writer.matrix([x.t('exports.quantityPdf.schedule.byType'), x.t('exports.quantityPdf.schedule.headers.unit')],
      [x.t('exports.quantityPdf.schedule.byType')], [x.t('exports.quantityPdf.columns.net'), x.t('exports.quantityPdf.columns.order')],
      materialRows.map(row => ({ cells: [
        { main: row.cells[0], sub: [row.cells[4], row.cells[5]].filter(Boolean).join(' · ') }, { main: row.cells[2] },
        { main: row.cells[1] }, { main: row.cells[3] },
      ] })), undefined, { weights: [220, 80], labelColumn: 0 });
  }
  for (const c of matrices.flatMap(m => m.categories)) if (c.over > 0) writer.note(`${c.info.label}: ${x.t('workCatalog.overAllocated', { amount: x.number(c.over), unit: c.info.unitLabel })}`);
}

export const SUMMARY_WEIGHTS = [33, 11, 8, 11, 37];
export function summaryHeaders(x: ExportContext): string[] {
  return (['item', 'net', 'unit', 'order', 'details'] as const).map(key => x.t(`exports.quantityPdf.schedule.headers.${key}`));
}
export function buildProjectSummaryRows(totals: ProjectCategoryTotal[], infoOf: (total: ProjectCategoryTotal) => ReportColumnInfo, x: ExportContext): ScheduleRow[] {
  return totals.flatMap(total => {
    const info = infoOf(total);
    const reading = primaryReading(total, info);
    if (!reading.net && !reading.order && !total.quantityM2) return [];
    return [{ kind: 'group' as const, cells: [total.label, x.number(reading.net ?? 0), info.unitLabel, x.number(reading.order ?? 0),
      info.unit === 'lm' && info.hasArea ? x.t('exports.quantityPdf.schedule.areaReading', { net: x.number(total.quantityM2 ?? 0), order: x.number(total.orderM2 ?? 0), unit: x.t('units.m2') }) : ''],
    }];
  });
}
