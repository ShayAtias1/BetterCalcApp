/**
 * What the structural part of the plan PDF prints, as plain data: sections of tables and notes.
 * Pure (no pdf-lib, no fonts), so the content is testable; `exportStructuralPdf` draws it. Compact on
 * purpose — a summary and an item table per domain, not every internal field. Estimates are marked
 * with "≈" in the text (it is a printed document) and in the Basis column; anything that cannot be
 * calculated prints a dash and is counted in a missing-data note, never as 0.
 */

import { round } from './geometry';
import type { ExportContext } from './exportLanguage';
import { basisText, concreteStatusText, rebarStatusText, reinforcementNotation } from './structuralExportText';
import type { StructuralReport } from './structuralQuantities';

export interface PdfTableRow {
  cells: string[];
  bg?: string;
  bold?: boolean;
}

export type PdfBlock =
  | { type: 'section'; title: string }
  | { type: 'table'; headers: string[]; weights: number[]; rows: PdfTableRow[] }
  | { type: 'note'; text: string };

const DASH = '—';
const C_GRAND = '#D5F5E3';

export function buildStructuralPdfLayout(report: StructuralReport, x: ExportContext): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  if (report.concrete) blocks.push(...concreteBlocks(report.concrete, x));
  if (report.rebar) blocks.push(...rebarBlocks(report.rebar, x));
  return blocks;
}

function concreteBlocks(concrete: NonNullable<StructuralReport['concrete']>, x: ExportContext): PdfBlock[] {
  const { t } = x;
  const fmt = (v: number | null) => (v === null ? DASH : x.number(round(v, 2)));
  const m3 = t('units.m3');
  const { items, summary } = concrete;
  const noGrade = t('concrete.summary.noGrade');
  const title = t('exports.structural.concrete');

  const blocks: PdfBlock[] = [
    { type: 'section', title: `${title} — ${t('exports.structural.concreteByGrade')}` },
    {
      type: 'table',
      headers: [
        t('exports.structural.headers.page'),
        t('exports.structural.headers.type'),
        t('exports.structural.headers.grade'),
        t('exports.structural.headers.elements'),
        t('exports.projectPdf.netUnit', { unit: m3 }),
        t('exports.projectPdf.orderUnit', { unit: m3 }),
        t('exports.structural.headers.notCalculable'),
      ],
      weights: [8, 14, 16, 10, 14, 14, 14],
      rows: [
        ...summary.rows.map((r) => {
          const calculable = r.elementCount > r.missingCount;
          return { cells: [`${r.pageNumber}`, t(`concrete.kinds.${r.kind}`), r.grade || noGrade, `${r.elementCount}`, calculable ? fmt(r.volumeM3) : DASH, calculable ? fmt(r.orderM3) : DASH, r.missingCount > 0 ? `${r.missingCount}` : ''] };
        }),
        { cells: [t('exports.common.grandTotal'), '', '', `${summary.elementCount}`, fmt(summary.volumeM3), fmt(summary.orderM3), summary.missingCount > 0 ? `${summary.missingCount}` : ''], bg: C_GRAND, bold: true },
      ],
    },
    { type: 'section', title: `${title} — ${t('exports.structural.concreteItems')}` },
    {
      type: 'table',
      headers: [
        t('exports.structural.headers.mark'),
        t('exports.structural.headers.type'),
        t('exports.structural.headers.grade'),
        t('exports.structural.headers.page'),
        t('exports.structural.headers.footprint', { unit: t('units.m2') }),
        t('exports.structural.headers.thicknessHeight', { unit: t('units.m') }),
        t('exports.projectPdf.netUnit', { unit: m3 }),
        t('exports.projectPdf.orderUnit', { unit: m3 }),
        t('exports.structural.headers.status'),
      ],
      weights: [10, 12, 14, 8, 12, 14, 12, 12, 18],
      rows: items.map((it) => ({
        cells: [it.mark, t(`concrete.kinds.${it.kind}`), it.grade || noGrade, `${it.pageNumber}`, fmt(it.footprintM2), fmt(it.depthM), fmt(it.netM3), fmt(it.orderM3), it.status === 'ok' ? '' : concreteStatusText(it.status, it.kind, x)],
      })),
    },
  ];
  if (summary.missingCount > 0) blocks.push({ type: 'note', text: t('exports.structural.missing', { count: summary.missingCount }) });
  return blocks;
}

function rebarBlocks(rebar: NonNullable<StructuralReport['rebar']>, x: ExportContext): PdfBlock[] {
  const { t } = x;
  const lm = t('units.lm');
  const kg = t('units.kg');
  const { items, summary } = rebar;
  const title = t('exports.structural.rebar');
  const fmt = (v: number | null, estimated = false) => (v === null ? DASH : `${estimated ? '≈ ' : ''}${x.number(round(v, 2))}`);

  const blocks: PdfBlock[] = [
    { type: 'section', title: `${title} — ${t('exports.structural.rebarByDiameter')}` },
    {
      type: 'table',
      headers: [
        t('exports.structural.headers.page'),
        'Ø',
        t('exports.projectPdf.netUnit', { unit: lm }),
        t('exports.projectPdf.netUnit', { unit: kg }),
        t('exports.projectPdf.orderUnit', { unit: lm }),
        t('exports.projectPdf.orderUnit', { unit: kg }),
        t('exports.structural.headers.basis'),
      ],
      weights: [8, 8, 14, 14, 14, 14, 18],
      rows: [
        ...summary.pages.flatMap((page) =>
          page.rows.map((r) => {
            const est = r.basis === 'estimated';
            return { cells: [`${r.pageNumber}`, `${r.diameterMm}`, fmt(r.lengthM, est), fmt(r.weightKg, est), fmt(r.orderLengthM, est), fmt(r.orderWeightKg, est), basisText(r.basis, x)] };
          })
        ),
        {
          cells: [
            t('exports.common.grandTotal'),
            '',
            fmt(summary.lengthM, summary.basis === 'estimated'),
            fmt(summary.weightKg, summary.basis === 'estimated'),
            fmt(summary.orderLengthM, summary.basis === 'estimated'),
            fmt(summary.orderWeightKg, summary.basis === 'estimated'),
            summary.basis ? basisText(summary.basis, x) : DASH,
          ],
          bg: C_GRAND,
          bold: true,
        },
      ],
    },
  ];
  if (summary.basis === 'mixed') {
    blocks.push({
      type: 'note',
      text: t('exports.structural.estimateNote', { length: `${x.number(round(summary.estimatedLengthM, 2))} ${lm}`, weight: `${x.number(round(summary.estimatedWeightKg, 2))} ${kg}` }),
    });
  } else if (summary.basis === 'estimated') {
    blocks.push({ type: 'note', text: t('exports.structural.estimateOnlyNote') });
  }

  blocks.push(
    { type: 'section', title: `${title} — ${t('exports.structural.rebarItems')}` },
    {
      type: 'table',
      headers: [
        t('exports.structural.headers.page'),
        t('exports.structural.headers.mark'),
        t('exports.structural.headers.reinforcement'),
        t('exports.structural.headers.barsTimes'),
        t('exports.projectPdf.netUnit', { unit: lm }),
        t('exports.projectPdf.netUnit', { unit: kg }),
        t('exports.projectPdf.orderUnit', { unit: kg }),
        `${t('exports.structural.headers.basis')} / ${t('exports.structural.headers.status')}`,
      ],
      weights: [7, 10, 24, 16, 12, 12, 12, 20],
      rows: items.map((it) => {
        const notation = reinforcementNotation(it.diameterMm, it.spacingMm);
        const side = it.direction === null ? '' : ` · ${t(it.direction === 'long' ? 'exports.structural.longSide' : 'exports.structural.shortSide')}`;
        const calculable = it.netLengthM !== null;
        return {
          cells: [
            `${it.pageNumber}`,
            it.mark,
            notation ? `${notation}${side}` : DASH,
            it.barCount !== null && it.barLengthM !== null ? `${it.barCount} × ${x.number(round(it.barLengthM, 2))}` : DASH,
            fmt(it.netLengthM, it.estimated),
            fmt(it.netWeightKg, it.estimated),
            fmt(it.orderWeightKg, it.estimated),
            calculable ? basisText(it.estimated ? 'estimated' : 'exact', x) : rebarStatusText(it.status, x),
          ],
        };
      }),
    }
  );
  if (summary.missingItemCount > 0) blocks.push({ type: 'note', text: t('exports.structural.missing', { count: summary.missingItemCount }) });
  return blocks;
}
