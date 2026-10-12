/**
 * The quantity schedule both report formats are built on: per work category its total, the types /
 * material specifications that split it, and its apartments and rooms. Pure data, read from the room
 * summaries and the work-type breakdown — nothing is recalculated. The PDF prints it as text
 * (lib/quantitySchedulePdf), the workbook writes it as numbers and live formulas (lib/excelReport).
 */

import type { Plan, ReportColumn, RoomQuantitySummary } from '../types';
import type { TranslateFn } from '../i18n';
import { round } from './geometry';
import { usedReportCategories } from './quantities';
import { primaryReading, readingUnavailable, reportColumnInfo, roomCategoryQuantity, type ReportColumnInfo } from './projectQuantities';
import { buildWorkBreakdown, type BreakdownSource } from './workAllocation';

/** A deduction or note shown beside a room's figures. */
export type RoomNote =
  | { kind: 'openings'; amountM2: number }
  | { kind: 'doors'; lengthM: number }
  | { kind: 'manual' };

export interface ScheduleRoom {
  summary: RoomQuantitySummary;
  name: string;
  apartment: string;
  /** Not calculable: the room's sheet has no scale (typed quantities always have a number). */
  unavailable: boolean;
  net: number | null;
  order: number | null;
  waste: number | null;
  /** Strips: the m² reading and with waste. */
  areaNet: number | null;
  areaOrder: number | null;
  notes: RoomNote[];
}

export interface ScheduleApartment {
  apartment: string;
  rooms: ScheduleRoom[];
}

export interface ScheduleType {
  label: string;
  specification: string;
  /** null: the part of the category no type covers. */
  specId: string | null;
  source: BreakdownSource | 'unassigned';
  net: number;
  order: number;
  areaNet: number | null;
  areaOrder: number | null;
}

export interface ScheduleCategory {
  column: ReportColumn;
  info: ReportColumnInfo;
  /** Skirting and custom perimeter work: read in metres, with an m² reading too. */
  strip: boolean;
  net: number;
  order: number;
  areaNet: number | null;
  areaOrder: number | null;
  /** One waste % shared by every room, or null when they differ. */
  waste: number | null;
  manual: boolean;
  /** Typed shares beyond the calculated quantity (the total stays the calculated one). */
  over: number;
  types: ScheduleType[];
  apartments: ScheduleApartment[];
  /** Several apartments: rooms are grouped under apartment subtotals. */
  grouped: boolean;
}

const sum = (values: (number | null)[]) => round(values.reduce<number>((a, v) => a + (v ?? 0), 0), 2);

/**
 * The schedule of one plan's rooms (`summaries`, already limited to the exported sheets). `plan`
 * names unnamed rooms and provides the type split; without it the schedule has no type rows.
 */
export function buildQuantitySchedule(plan: Plan | null, summaries: RoomQuantitySummary[], t: TranslateFn): ScheduleCategory[] {
  const inScope = new Set(summaries.map((s) => s.roomId));
  const roomNames = new Map((plan?.rooms ?? []).map((r) => [r.id, r.name]));
  const breakdown = plan ? new Map(buildWorkBreakdown([plan], t, (_p, room) => inScope.has(room.id)).groups.map((g) => [g.key as ReportColumn, g])) : new Map();

  return usedReportCategories(summaries).map((column): ScheduleCategory => {
    const info = reportColumnInfo(column, summaries, t);
    const strip = info.unit === 'lm' && info.hasArea;
    const rooms = summaries.flatMap((s): ScheduleRoom[] => {
      const q = roomCategoryQuantity(s, column);
      if (q.wastePercent == null) return [];
      const unavailable = readingUnavailable(s, q);
      const r = unavailable ? { net: null, order: null } : primaryReading(q, info);
      const deduction = s.openingDeductions.find((d) => d.category === column);
      const notes: RoomNote[] = [];
      if (!unavailable && column === 'panels' && (s.panelsDeductedLengthM ?? 0) > 0) notes.push({ kind: 'doors', lengthM: s.panelsDeductedLengthM! });
      if (!unavailable && deduction) notes.push({ kind: 'openings', amountM2: deduction.deductedM2 });
      if (q.manual) notes.push({ kind: 'manual' });
      return [{
        summary: s,
        name: s.roomName || roomNames.get(s.roomId) || t('exports.common.unnamedRoom'),
        apartment: s.apartmentNumber || '',
        unavailable,
        net: r.net,
        order: r.order,
        waste: q.wastePercent,
        areaNet: strip && !unavailable ? q.quantityM2 : null,
        areaOrder: strip && !unavailable ? q.orderM2 : null,
        notes,
      }];
    });
    const apartments: ScheduleApartment[] = [];
    for (const room of rooms) {
      const group = apartments.find((a) => a.apartment === room.apartment);
      if (group) group.rooms.push(room);
      else apartments.push({ apartment: room.apartment, rooms: [room] });
    }
    const wastes = new Set(rooms.map((r) => r.waste));
    const group = breakdown.get(column);
    return {
      column,
      info,
      strip,
      // The same sums the report totals are made of: each room's rounded figures.
      net: sum(rooms.map((r) => r.net)),
      order: sum(rooms.map((r) => r.order)),
      areaNet: strip ? sum(rooms.map((r) => r.areaNet)) : null,
      areaOrder: strip ? sum(rooms.map((r) => r.areaOrder)) : null,
      waste: wastes.size === 1 ? [...wastes][0] : null,
      manual: rooms.some((r) => r.notes.some((n) => n.kind === 'manual')),
      over: group?.over ?? 0,
      types: (group?.lines ?? []).map((line: { label: string; specification: string; specId: string | null; source: BreakdownSource; amount: { quantity: number; order: number; areaM2: number | null; orderAreaM2: number | null } }): ScheduleType => ({
        label: line.label,
        specification: line.specification,
        specId: line.specId,
        source: line.specId === null ? 'unassigned' : line.source,
        net: line.amount.quantity,
        order: line.amount.order,
        areaNet: strip ? line.amount.areaM2 : null,
        areaOrder: strip ? line.amount.orderAreaM2 : null,
      })),
      apartments,
      grouped: apartments.length > 1,
    };
  });
}

/** An apartment's subtotal; null when every room in it is on an unscaled sheet. */
export function apartmentTotal(apartment: ScheduleApartment): { net: number | null; order: number | null; areaNet: number | null; areaOrder: number | null } {
  const rooms = apartment.rooms.filter((r) => !r.unavailable);
  if (!rooms.length) return { net: null, order: null, areaNet: null, areaOrder: null };
  const strip = rooms.some((r) => r.areaNet !== null);
  return {
    net: sum(rooms.map((r) => r.net)),
    order: sum(rooms.map((r) => r.order)),
    areaNet: strip ? sum(rooms.map((r) => r.areaNet)) : null,
    areaOrder: strip ? sum(rooms.map((r) => r.areaOrder)) : null,
  };
}

/** A room's notes as text in the report language. */
export function roomNotesText(notes: RoomNote[], t: TranslateFn, number: (n: number) => string): string[] {
  return notes.map((n) =>
    n.kind === 'doors'
      ? t('exports.quantityPdf.doorsDeducted', { length: `${number(n.lengthM)} ${t('units.lm')}` })
      : n.kind === 'openings'
        ? t('exports.quantityPdf.openingsDeducted', { amount: `${number(n.amountM2)} ${t('units.m2')}` })
        : t('workCatalog.manualBadge')
  );
}
