/**
 * What the structural part of the plan PDF prints, as plain data: sections of tables and notes.
 * Pure (no pdf-lib, no fonts), so the content is testable; `exportStructuralPdf` draws it. Compact on
 * purpose — a summary and an item table per domain, not every internal field. Estimates are marked
 * with "~" in the text (it is a printed document) and in the Basis column; anything that cannot be
 * calculated prints a dash and is counted in a missing-data note, never as 0.
 */

import type { prepareStirrupShape } from './stirrupShape';
import { round } from './geometry';
import type { Plan } from '../types';
import { markLabel } from './structuralMarks';
import type { ExportContext } from './exportLanguage';
import { basisText, concreteStatusText, levelQuantity, levelReportSpecification, levelSpecification, levelStatus, levelText, sheetConfigText } from './structuralExportText';
import { buildRebarLevelRows, type ProjectStructural, type RebarLevelRow, type StructuralReport } from './structuralQuantities';

export interface PdfTableRow {
  cells: string[];
  bg?: string;
  bold?: boolean;
}

export interface StirrupShapeCard {
  title: string;
  shape: ReturnType<typeof prepareStirrupShape>;
  details: string[];
  note?: string;
}

export type PdfBlock =
  | { type: 'section'; title: string }
  | { type: 'table'; headers: string[]; weights: number[]; rows: PdfTableRow[] }
  | { type: 'note'; text: string }
  | { type: 'shape'; card: StirrupShapeCard };

/** What a report writer must be able to do for `writeBlocks` — the plan report's and the project report's writers both can. */
export interface BlockWriter {
  section(title: string): void;
  table(headers: string[], weights: number[], rows: PdfTableRow[]): void;
  note(text: string): void;
  shapeCard?(card: StirrupShapeCard): void;
}

/** Writes layout blocks (sections, tables, notes) with a report writer. */
export function writeBlocks(writer: BlockWriter, blocks: PdfBlock[]): void {
  for (const block of blocks) {
    if (block.type === 'section') writer.section(block.title);
    else if (block.type === 'table') writer.table(block.headers, block.weights, block.rows);
    else if (block.type === 'shape') writer.shapeCard?.(block.card);
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
  if (report.rebar && include.rebar) {
    blocks.push(...rebarBlocks(report.rebar, x));
    blocks.push(...stirrupShapeBlocks(report.rebar.levels.map((row) => ({ row })), x));
  }
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

export { sheetConfigText };

function rebarBlocks(rebar: NonNullable<StructuralReport['rebar']>, x: ExportContext): PdfBlock[] {
  const { t } = x;
  const kg = t('units.kg');
  const { levels, summary } = rebar;
  const meshOnly = levels.length > 0 && levels.every((row) => row.kind === 'mesh');
  const fmt = (v: number | null, estimated = false) => (v === null ? DASH : `${estimated ? ESTIMATE_PREFIX : ''}${x.number(round(v, 2))}`);
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
        t(meshOnly ? 'rebar.requiredWeightHeader' : 'exports.structural.headers.netWeight', { unit: kg }),
        t(meshOnly ? 'rebar.purchaseWeightHeader' : 'exports.projectPdf.orderUnit', { unit: kg }),
        t('exports.structural.headers.status'),
      ],
      weights: [5, 7, 11, 8, 20, 10, 15, 9, 9, 12],
      rows: [
        ...levels.map((d, i) => ({
          cells: [
            i === 0 || levels[i - 1].pageNumber !== d.pageNumber ? `${d.pageNumber}` : '',
            t(d.kind === 'mesh' ? 'rebar.mesh' : d.kind === 'stirrup' ? 'rebar.stirrupName' : 'rebar.bars'),
            markLabel(d, t),
            levelText(d.level, x) || DASH,
            levelReportSpecification(d, x),
            levelQuantity(d, x),
            // Only a counted mesh needs its sheet size to be read.
            d.sheets && d.sheets.count !== null ? sheetConfigText(d.sheets.settings, x) : DASH,
            `${!meshOnly && d.kind === 'mesh' ? `${t('rebar.requiredWeightShort')}: ` : ''}${fmt(d.netWeightKg, d.estimated)}`,
            `${!meshOnly && d.kind === 'mesh' ? `${t('rebar.purchaseWeightShort')}: ` : ''}${fmt(d.orderWeightKg)}`,
            levelStatus(d, x),
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
            summary.basis === null ? DASH : fmt(summary.orderWeightKg),
            [summary.basis ? basisText(summary.basis, x) : '', summary.missingItemCount > 0 ? t('exports.structural.missingShort', { count: summary.missingItemCount }) : ''].filter(Boolean).join(' · '),
          ],
          bg: C_GRAND,
          bold: true,
        },
      ],
    },
  ];
}

// ---------- project report ----------

/** Concrete remains grouped by type and grade; Rebar uses the existing plan item/level rows. */
export function buildProjectStructuralPdfLayout(project: ProjectStructural, x: ExportContext, plans: Plan[], include: StructuralInclude = { concrete: true, rebar: true }): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  const { t } = x;
  const fmt = (v: number | null, estimated = false) => (v === null ? DASH : `${estimated ? ESTIMATE_PREFIX : ''}${x.number(round(v, 2))}`);

  if (project.concrete && include.concrete) {
    const c = project.concrete;
    const m3 = pdfSafe(t('units.m3'));
    const totalOk = c.elementCount > c.missingCount;
    blocks.push(
      { type: 'section', title: t('exports.structural.concrete') },
      {
        type: 'table',
        headers: [
          t('exports.structural.headers.type'),
          t('exports.structural.headers.grade'),
          t('exports.structural.headers.elements'),
          t('exports.projectPdf.netUnit', { unit: m3 }),
          t('exports.projectPdf.orderUnit', { unit: m3 }),
          t('exports.structural.headers.status'),
        ],
        weights: [14, 18, 12, 16, 16, 22],
        rows: [
          ...c.rows.map((r) => {
            const calculable = r.elementCount > r.missingCount;
            return {
              cells: [t(`concrete.kinds.${r.kind}`), r.grade || DASH, `${r.elementCount}`, calculable ? fmt(r.volumeM3) : DASH, calculable ? fmt(r.orderM3) : DASH, r.missingCount > 0 ? t('exports.structural.missingShort', { count: r.missingCount }) : ''],
            };
          }),
          { cells: [t('concrete.summary.total'), '', `${c.elementCount}`, totalOk ? fmt(c.volumeM3) : DASH, totalOk ? fmt(c.orderM3) : DASH, c.missingCount > 0 ? t('exports.structural.missingShort', { count: c.missingCount }) : ''], bg: C_GRAND, bold: true },
        ],
      }
    );
  }

  if (project.rebar && include.rebar) blocks.push(...projectRebarBlocks(plans, x));
  return blocks;
}

/** Separate product tables keep mesh procurement quantities and manual bar lengths meaningful. */
function projectRebarBlocks(plans: Plan[], x: ExportContext): PdfBlock[] {
  const { t } = x;
  const fmt = (v: number | null, estimated = false) => (v === null ? DASH : `${estimated ? ESTIMATE_PREFIX : ''}${x.number(round(v, 2))}`);
  const kg = t('units.kg');
  const m = t('units.m');
  const rows = plans.flatMap((plan) => buildRebarLevelRows(plan).map((row) => ({ planId: plan.id, planName: plan.name, row })));
  const blocks: PdfBlock[] = [];
  for (const kind of ['mesh', 'bars', 'stirrup'] as const) {
    const items = rows.filter(({ row }) => row.kind === kind);
    if (items.length === 0) continue;
    const mesh = kind === 'mesh';
    const commonHeaders = [t('exports.common.plan'), t('exports.structural.headers.page'), t('exports.structural.headers.type'), t('exports.structural.headers.mark')];
    const headers = [
      ...commonHeaders,
      ...(mesh ? [t('exports.structural.headers.levelShort'), t('exports.structural.headers.specification'), t('exports.structural.headers.sheetsCount'), t('exports.structural.headers.sheetSize')]
        : [t('exports.structural.headers.diameter'), t(kind === 'stirrup' ? 'rebar.stirrup.quantity' : 'rebar.barCount'), `${t(kind === 'stirrup' ? 'rebar.stirrup.lengthUsed' : 'rebar.barLength')} (${m})`, `${t('rebar.totalLength')} (${m})`]),
      t(mesh ? 'rebar.requiredWeightHeader' : 'exports.structural.headers.netWeight', { unit: kg }), t(mesh ? 'rebar.purchaseWeightHeader' : 'exports.projectPdf.orderUnit', { unit: kg }), t('exports.structural.headers.status'),
    ];
    const calculated = items.filter(({ row }) => row.netWeightKg !== null);
    const estimatedCount = calculated.filter(({ row }) => row.estimated).length;
    const basis = calculated.length === 0 ? null : estimatedCount === 0 ? 'exact' : estimatedCount === calculated.length ? 'estimated' : 'mixed';
    // Missing levels of one mesh still represent one missing item; IDs are scoped to their plan.
    const missing = new Set(items.filter(({ row }) => row.status !== 'ok').map(({ planId, row }) => JSON.stringify([planId, row.itemId]))).size;
    const sum = (value: (row: RebarLevelRow) => number | null, requireAll = false) => calculated.length === 0 || (requireAll && items.some(({ row }) => value(row) === null)) || calculated.some(({ row }) => value(row) === null) ? null : calculated.reduce((total, { row }) => total + value(row)!, 0);
    blocks.push(
      { type: 'section', title: `${t('exports.structural.rebar')} - ${t(mesh ? 'rebar.mesh' : kind === 'stirrup' ? 'rebar.stirrupName' : 'rebar.bars')}` },
      {
        type: 'table', headers,
        weights: mesh ? [13, 5, 7, 11, 8, 23, 8, 16, 10, 10, 13] : [13, 5, 7, 11, 9, 9, 10, 10, 10, 10, 13],
        rows: [
          ...items.map(({ planName, row: d }) => ({ cells: [
            planName, `${d.pageNumber}`, t(mesh ? 'rebar.mesh' : kind === 'stirrup' ? 'rebar.stirrupName' : 'rebar.bars'), markLabel(d, t),
            ...(mesh ? [levelText(d.level, x) || DASH, levelSpecification(d, x), levelQuantity(d, x), d.sheets?.count != null ? sheetConfigText(d.sheets.settings, x) : DASH]
              : [fmt(d.parts[0].diameterMm), fmt(d.parts[0].barCount), fmt(d.parts[0].barLengthM), fmt(d.parts[0].netLengthM)]),
            fmt(d.netWeightKg, d.estimated), fmt(d.orderWeightKg), levelStatus(d, x),
          ] })),
          {
            cells: ['', '', t('rebar.summary.total'), '', '', '', '', mesh ? '' : fmt(sum((d) => d.parts[0].netLengthM)),
              fmt(sum((d) => d.netWeightKg), basis === 'estimated'), fmt(sum((d) => d.orderWeightKg, mesh)),
              [basis ? basisText(basis, x) : '', missing > 0 ? t('exports.structural.missingShort', { count: missing }) : ''].filter(Boolean).join(' · ') || DASH],
            bg: C_GRAND, bold: true,
          },
        ],
      }
    );
  }
  blocks.push(...stirrupShapeBlocks(rows, x));
  return blocks;
}

/** Execution diagrams use the exact normalized saved vector geometry, beside the quantity row's mark. */
function stirrupShapeBlocks(rows: { planName?: string; row: RebarLevelRow }[], x: ExportContext): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  const fmt = (value: number | null) => value === null ? '-' : x.number(round(value, 3));
  for (const { planName, row } of rows) {
    const data = row.parts[0].stirrup;
    if (row.kind !== 'stirrup' || !data) continue;
    const part = row.parts[0];
    blocks.push({ type: 'shape', card: {
      title: [planName, markLabel(row, x.t)].filter(Boolean).join(' · '), shape: data.shape,
      details: [
        `Ø${part.diameterMm ?? '-'} · ${x.t(`rebar.stirrup.templates.${data.shape.template}`)}`,
        `${x.t('rebar.stirrup.dimensions')}: ${fmt(data.shape.widthM * 100)} × ${fmt(data.shape.heightM * 100)} ${x.t('units.cm')}`,
        `${x.t('rebar.stirrup.geometricLength')}: ${fmt(data.geometricLengthM)} ${x.t('units.m')}`,
        `${x.t('rebar.stirrup.lengthUsed')}: ${fmt(part.barLengthM)} ${x.t('units.m')}${data.lengthSource === 'manual' ? ` · ${x.t('rebar.stirrup.manualLength')}` : ''}`,
      ],
      note: x.t('rebar.stirrup.geometricHint'),
    } });
    if (data.placements.length) blocks.push({ type: 'table', headers: [x.t('exports.structural.headers.type'), x.t('exports.structural.headers.page'),
      x.t('rebar.stirrup.distributionSize'), x.t('rebar.stirrup.spacing'), x.t('rebar.stirrup.quantity'), x.t('exports.structural.headers.status')],
      weights: [12, 7, 18, 18, 12, 23], rows: data.placements.map((result) => {
        const p = result.placement;
        const spacing = p.quantityMode === 'manual' ? x.t('rebar.stirrup.manualQuantity') : p.kind === 'line'
          ? `${fmt(p.spacingM * 100)} ${x.t('units.cm')}` : `${fmt(p.spacingXM * 100)} × ${fmt(p.spacingYM * 100)} ${x.t('units.cm')}`;
        return { cells: [x.t(p.kind === 'line' ? 'rebar.stirrup.line' : 'rebar.stirrup.area'), String(p.pageNumber),
          p.kind === 'line' ? `${fmt(result.distributionLengthM)} ${x.t('units.m')}` : `${fmt(result.areaM2)} m2`, spacing,
          result.quantity === null ? '-' : String(result.quantity), result.status === 'ok' ? '' : x.t(result.status === 'no-scale' ? 'exports.structural.status.noScale' : 'exports.structural.status.invalidInput')] };
      }) });
  }
  return blocks;
}
