/**
 * What the structural part of the plan PDF prints, as plain data: sections of tables and notes.
 * Pure (no pdf-lib, no fonts), so the content is testable; `exportStructuralPdf` draws it. Compact on
 * purpose — a summary and an item table per domain, not every internal field. Estimates are marked
 * with "~" in the text (it is a printed document) and in the Basis column; anything that cannot be
 * calculated prints a dash and is counted in a missing-data note, never as 0.
 */

import { round } from './geometry';
import { markLabel } from './structuralMarks';
import type { ExportContext } from './exportLanguage';
import { basisText, concreteStatusText, levelText, rebarStatusText } from './structuralExportText';
import type { ProjectStructural, RebarLevelRow, StructuralReport } from './structuralQuantities';

export interface PdfTableRow {
  cells: string[];
  bg?: string;
  bold?: boolean;
}

export type PdfBlock =
  | { type: 'section'; title: string }
  | { type: 'table'; headers: string[]; weights: number[]; rows: PdfTableRow[] }
  | { type: 'note'; text: string };

/** What a report writer must be able to do for `writeBlocks` — the plan report's and the project report's writers both can. */
export interface BlockWriter {
  section(title: string): void;
  table(headers: string[], weights: number[], rows: PdfTableRow[]): void;
  note(text: string): void;
}

/** Writes layout blocks (sections, tables, notes) with a report writer. */
export function writeBlocks(writer: BlockWriter, blocks: PdfBlock[]): void {
  for (const block of blocks) {
    if (block.type === 'section') writer.section(block.title);
    else if (block.type === 'table') writer.table(block.headers, block.weights, block.rows);
    else writer.note(block.text);
  }
}

/** Printed in front of an estimated number. A plain "~": the report font has no "≈". */
export const ESTIMATE_PREFIX = '~ ';
/** The report font has no ² or ³: print "m2" / "m3" rather than a missing glyph. */
const pdfSafe = (text: string) => text.replace(/³/g, '3').replace(/²/g, '2');
const DASH = '-';
const C_GRAND = '#D5F5E3';

/** Which structural sections of the report to print - the user's choice in the export dialog. */
export interface StructuralInclude {
  concrete: boolean;
  rebar: boolean;
}

/**
 * One bill of quantities per domain: a detail row per item, then one total row - no separate
 * summary table. Concrete is a row per element; rebar a row per mesh level (its two directions are
 * one specification) or per manual-bars item.
 */
export function buildStructuralPdfLayout(report: StructuralReport, x: ExportContext, include: StructuralInclude = { concrete: true, rebar: true }): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  if (report.concrete && include.concrete) blocks.push(...concreteBlocks(report.concrete, x));
  if (report.rebar && include.rebar) blocks.push(...rebarBlocks(report.rebar, x));
  return blocks;
}

function concreteBlocks(concrete: NonNullable<StructuralReport['concrete']>, x: ExportContext): PdfBlock[] {
  const { t } = x;
  const fmt = (v: number | null) => (v === null ? DASH : x.number(round(v, 2)));
  const m3 = pdfSafe(t('units.m3'));
  const { items, summary } = concrete;
  // A slab's thickness is read in centimetres (as it is typed); a wall, beam or column's height in metres.
  const dimension = (it: (typeof items)[number]) =>
    it.depthM === null ? DASH : it.kind === 'slab' ? `${x.number(round(it.depthM * 100, 2))} ${t('units.cm')}` : `${x.number(round(it.depthM, 2))} ${t('units.m')}`;
  const totalOk = summary.elementCount > summary.missingCount;

  return [
    { type: 'section', title: t('exports.structural.concrete') },
    {
      type: 'table',
      headers: [
        t('exports.structural.headers.page'),
        t('exports.structural.headers.type'),
        t('exports.structural.headers.mark'),
        t('exports.structural.headers.grade'),
        t('exports.structural.headers.dimension'),
        t('exports.projectPdf.netUnit', { unit: m3 }),
        t('exports.projectPdf.orderUnit', { unit: m3 }),
        t('exports.structural.headers.status'),
      ],
      weights: [7, 11, 17, 14, 12, 13, 13, 20],
      rows: [
        ...items.map((it, i) => ({
          cells: [
            i === 0 || items[i - 1].pageNumber !== it.pageNumber ? `${it.pageNumber}` : '',
            t(`concrete.kinds.${it.kind}`),
            markLabel(it, t),
            it.grade || DASH,
            dimension(it),
            fmt(it.netM3),
            fmt(it.orderM3),
            it.status === 'ok' ? '' : concreteStatusText(it.status, it.kind, x),
          ],
        })),
        {
          cells: ['', t('concrete.summary.total'), '', '', '', totalOk ? fmt(summary.volumeM3) : DASH, totalOk ? fmt(summary.orderM3) : DASH, summary.missingCount > 0 ? t('exports.structural.missingShort', { count: summary.missingCount }) : ''],
          bg: C_GRAND,
          bold: true,
        },
      ],
    },
  ];
}

/** `6.00 × 2.50 m · 80 cm` - the sheet size and overlap a sheet count was made with. */
export function sheetConfigText(settings: { lengthM: number; widthM: number; overlapM: number }, x: ExportContext): string {
  const m = (v: number) => v.toFixed(2);
  const cm = Math.round(settings.overlapM * 1000) / 10;
  return `${m(settings.lengthM)} × ${m(settings.widthM)} ${x.t('units.m')} · ${x.number(cm)} ${x.t('units.cm')}`;
}

function rebarBlocks(rebar: NonNullable<StructuralReport['rebar']>, x: ExportContext): PdfBlock[] {
  const { t } = x;
  const kg = t('units.kg');
  const { levels, summary } = rebar;
  const fmt = (v: number | null, estimated = false) => (v === null ? DASH : `${estimated ? ESTIMATE_PREFIX : ''}${x.number(round(v, 2))}`);
  const notation = (r: RebarLevelRow['parts'][number]) => (r.diameterMm === null ? null : r.spacingCm === null ? `Ø${r.diameterMm}` : `Ø${r.diameterMm} @ ${x.number(r.spacingCm)}`);
  const specification = (d: RebarLevelRow): string => {
    if (d.kind === 'bars') return notation(d.parts[0]) ?? DASH;
    const first = d.parts[0];
    if (first.level === null) return DASH;
    if (first.direction === 'both') {
      const n = notation(first);
      return n ? `${n} ${t('units.cm')} - ${t('exports.structural.bothDirections')}` : DASH;
    }
    return d.parts.map((p) => `${t(p.direction === 'short' ? 'exports.structural.shortSide' : 'exports.structural.longSide')} ${notation(p) ?? DASH}`).join(' | ');
  };
  const quantity = (d: RebarLevelRow): string => {
    if (d.kind === 'bars') {
      const count = d.parts[0].barCount;
      return count === null ? DASH : t('exports.structural.barsQty', { count });
    }
    return d.sheets?.count == null ? DASH : t('exports.structural.sheetsQty', { count: d.sheets.count });
  };
  const status = (d: RebarLevelRow) => (d.status === 'ok' ? basisText(d.estimated ? 'estimated' : 'exact', x) : rebarStatusText(d.status, x));

  return [
    { type: 'section', title: t('exports.structural.rebar') },
    {
      type: 'table',
      headers: [
        t('exports.structural.headers.page'),
        t('exports.structural.headers.type'),
        t('exports.structural.headers.mark'),
        t('exports.structural.headers.levelShort'),
        t('exports.structural.headers.specification'),
        t('exports.structural.headers.quantity'),
        t('exports.structural.headers.sheetSize'),
        t('exports.structural.headers.netWeight', { unit: kg }),
        t('exports.projectPdf.orderUnit', { unit: kg }),
        t('exports.structural.headers.status'),
      ],
      weights: [5, 7, 11, 8, 20, 10, 15, 9, 9, 12],
      rows: [
        ...levels.map((d, i) => ({
          cells: [
            i === 0 || levels[i - 1].pageNumber !== d.pageNumber ? `${d.pageNumber}` : '',
            t(d.kind === 'mesh' ? 'rebar.mesh' : 'rebar.bars'),
            markLabel(d, t),
            levelText(d.level, x) || DASH,
            specification(d),
            quantity(d),
            // Only a counted mesh needs its sheet size to be read.
            d.sheets && d.sheets.count !== null ? sheetConfigText(d.sheets.settings, x) : DASH,
            fmt(d.netWeightKg, d.estimated),
            fmt(d.orderWeightKg, d.estimated),
            status(d),
          ],
        })),
        {
          cells: [
            '',
            t('rebar.summary.total'),
            '',
            '',
            '',
            '',
            '',
            summary.basis === null ? DASH : fmt(summary.weightKg, summary.basis === 'estimated'),
            summary.basis === null ? DASH : fmt(summary.orderWeightKg, summary.basis === 'estimated'),
            [summary.basis ? basisText(summary.basis, x) : '', summary.missingItemCount > 0 ? t('exports.structural.missingShort', { count: summary.missingItemCount }) : ''].filter(Boolean).join(' · '),
          ],
          bg: C_GRAND,
          bold: true,
        },
      ],
    },
  ];
}

// ---------- project report: summarized, no item schedules ----------


/**
 * The structural part of the project PDF: per domain, an aggregate (type + grade for concrete,
 * diameter for rebar) with a project total, and a by-plan table — never the item-by-item schedule,
 * which the plan PDF carries. Estimates and missing items are visible exactly as in the plan report.
 */
export function buildProjectStructuralPdfLayout(project: ProjectStructural, x: ExportContext): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  const { t } = x;
  const fmt = (v: number | null, estimated = false) => (v === null ? DASH : `${estimated ? ESTIMATE_PREFIX : ''}${x.number(round(v, 2))}`);

  if (project.concrete) {
    const c = project.concrete;
    const m3 = pdfSafe(t('units.m3'));
    const title = t('exports.structural.concrete');
    const noGrade = t('concrete.summary.noGrade');
    const net = t('exports.projectPdf.netUnit', { unit: m3 });
    const order = t('exports.projectPdf.orderUnit', { unit: m3 });
    const missing = t('exports.structural.headers.notCalculable');
    blocks.push(
      { type: 'section', title: `${title} - ${t('exports.structural.concreteByGrade')}` },
      {
        type: 'table',
        headers: [t('exports.structural.headers.type'), t('exports.structural.headers.grade'), t('exports.structural.headers.elements'), net, order, missing],
        weights: [14, 18, 12, 14, 14, 14],
        rows: [
          ...c.rows.map((r) => {
            const calculable = r.elementCount > r.missingCount;
            return { cells: [t(`concrete.kinds.${r.kind}`), r.grade || noGrade, `${r.elementCount}`, calculable ? fmt(r.volumeM3) : DASH, calculable ? fmt(r.orderM3) : DASH, r.missingCount > 0 ? `${r.missingCount}` : ''] };
          }),
          { cells: [t('exports.common.grandTotal'), '', `${c.elementCount}`, fmt(c.volumeM3), fmt(c.orderM3), c.missingCount > 0 ? `${c.missingCount}` : ''], bg: C_GRAND, bold: true },
        ],
      },
      { type: 'section', title: `${title} - ${t('exports.structural.byPlan')}` },
      {
        type: 'table',
        headers: [t('exports.common.plan'), t('exports.structural.headers.elements'), net, order, missing],
        weights: [24, 12, 14, 14, 14],
        rows: c.perPlan.map((p) => {
          const calculable = p.itemCount > p.missingCount;
          return { cells: [p.planName, `${p.itemCount}`, calculable ? fmt(p.volumeM3) : DASH, calculable ? fmt(p.orderM3) : DASH, p.missingCount > 0 ? `${p.missingCount}` : ''] };
        }),
      }
    );
    if (c.missingCount > 0) blocks.push({ type: 'note', text: t('exports.structural.missing', { count: c.missingCount }) });
  }

  if (project.rebar) {
    const r = project.rebar;
    const lm = t('units.lm');
    const kg = t('units.kg');
    const title = t('exports.structural.rebar');
    const amountHeaders = [
      t('exports.projectPdf.netUnit', { unit: lm }),
      t('exports.projectPdf.netUnit', { unit: kg }),
      t('exports.projectPdf.orderUnit', { unit: lm }),
      t('exports.projectPdf.orderUnit', { unit: kg }),
    ];
    blocks.push(
      { type: 'section', title: `${title} - ${t('exports.structural.rebarByDiameter')}` },
      {
        type: 'table',
        headers: ['Ø', ...amountHeaders, t('exports.structural.headers.basis')],
        weights: [8, 14, 14, 14, 14, 20],
        rows: [
          ...r.rows.map((row) => {
            const est = row.basis === 'estimated';
            return { cells: [`${row.diameterMm}`, fmt(row.lengthM, est), fmt(row.weightKg, est), fmt(row.orderLengthM, est), fmt(row.orderWeightKg, est), basisText(row.basis, x)] };
          }),
          {
            cells: [
              t('exports.common.grandTotal'),
              fmt(r.lengthM, r.basis === 'estimated'),
              fmt(r.weightKg, r.basis === 'estimated'),
              fmt(r.orderLengthM, r.basis === 'estimated'),
              fmt(r.orderWeightKg, r.basis === 'estimated'),
              r.basis ? basisText(r.basis, x) : DASH,
            ],
            bg: C_GRAND,
            bold: true,
          },
        ],
      }
    );
    if (r.basis === 'mixed') {
      blocks.push({ type: 'note', text: t('exports.structural.estimateNote', { length: `${x.number(round(r.estimatedLengthM, 2))} ${lm}`, weight: `${x.number(round(r.estimatedWeightKg, 2))} ${kg}` }) });
    } else if (r.basis === 'estimated') {
      blocks.push({ type: 'note', text: t('exports.structural.estimateOnlyNote') });
    }
    blocks.push(
      { type: 'section', title: `${title} - ${t('exports.structural.byPlan')}` },
      {
        type: 'table',
        headers: [t('exports.common.plan'), ...amountHeaders, t('exports.structural.headers.basis'), t('exports.structural.headers.notCalculable')],
        weights: [22, 12, 12, 12, 12, 18, 12],
        rows: r.perPlan.map((p) => {
          const est = p.basis === 'estimated';
          return {
            cells: [p.planName, fmt(p.basis ? p.lengthM : null, est), fmt(p.basis ? p.weightKg : null, est), fmt(p.basis ? p.orderLengthM : null, est), fmt(p.basis ? p.orderWeightKg : null, est), p.basis ? basisText(p.basis, x) : DASH, p.missingItemCount > 0 ? `${p.missingItemCount}` : ''],
          };
        }),
      }
    );
    if (r.missingItemCount > 0) blocks.push({ type: 'note', text: t('exports.structural.missing', { count: r.missingItemCount }) });
  }
  return blocks;
}
