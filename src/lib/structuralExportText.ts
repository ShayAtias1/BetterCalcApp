/**
 * The words the structural parts of the plan reports (Excel and PDF) share: status of an item,
 * basis of a rebar quantity, the reinforcement notation. Written in the export language through the
 * export context, like every other export text.
 */

import { round } from './geometry';
import type { ConcreteStatus } from './concrete';
import type { RebarStatus } from './rebar';
import type { RebarBasis, RebarItemRow, RebarLevelRow } from './structuralQuantities';
import type { ConcreteKind } from '../types/structural';
import type { ExportContext } from './exportLanguage';

export function concreteStatusText(status: ConcreteStatus, kind: ConcreteKind, { t }: ExportContext): string {
  switch (status) {
    case 'ok': return t('exports.structural.status.ok');
    case 'no-scale': return t('exports.structural.status.noScale');
    case 'missing-size': return t('exports.structural.status.missingSize');
    case 'missing-depth': return t(kind === 'slab' ? 'exports.structural.status.missingThickness' : 'exports.structural.status.missingHeight');
  }
}

export function rebarStatusText(status: RebarStatus, { t }: ExportContext): string {
  switch (status) {
    case 'ok': return t('exports.structural.status.ok');
    case 'no-scale': return t('exports.structural.status.noScale');
    case 'missing-size': return t('exports.structural.status.missingSize');
    case 'no-layers': return t('exports.structural.status.noLayers');
    case 'invalid-input': return t('exports.structural.status.invalidInput');
  }
}

/** Exact / Estimate / Includes estimate. */
export function basisText(basis: RebarBasis, { t }: ExportContext): string {
  return t(basis === 'exact' ? 'exports.structural.basis.exact' : basis === 'estimated' ? 'exports.structural.basis.estimate' : 'exports.structural.basis.includesEstimate');
}

/** `Ø12 @ 20 cm` — the notation is data (only the unit is a word). Null when the diameter is unknown. */
export function reinforcementNotation(diameterMm: number | null, spacingCm: number | null, unit: string): string | null {
  if (diameterMm === null) return null;
  return spacingCm === null ? `Ø${diameterMm}` : `Ø${diameterMm} @ ${spacingCm} ${unit}`;
}

/** What a rebar row says about its reinforcement and the side it runs along: `Long side: Ø12 @ 20 cm`, `Ø12 @ 20 cm — Both directions`. */
export function reinforcementDescription(row: Pick<RebarItemRow, 'diameterMm' | 'spacingCm' | 'direction'>, { t }: ExportContext): string | null {
  const notation = reinforcementNotation(row.diameterMm, row.spacingCm, t('units.cm'));
  if (!notation) return null;
  if (row.direction === 'both') return `${notation} - ${t('exports.structural.bothDirections')}`;
  if (row.direction === null) return notation;
  return `${t(row.direction === 'long' ? 'exports.structural.longSide' : 'exports.structural.shortSide')}: ${notation}`;
}

/** The level a mesh row belongs to, in the export language ("Bottom" / "Top"); '' for manual bars. */
export function levelText(level: RebarItemRow['level'], { t }: ExportContext): string {
  return level === null ? '' : t(level === 'bottom' ? 'exports.structural.levelBottom' : 'exports.structural.levelTop');
}

// ---------- the shared wording of the item-first BOQ (plan PDF, Excel) ----------

type SheetSettings = { lengthM: number; widthM: number; overlapM: number };

/** `6.00 × 2.50 m` - the physical sheet size of a mesh. */
export function sheetSizeText(settings: SheetSettings, { t }: ExportContext): string {
  const m = (v: number) => v.toFixed(2);
  return `${m(settings.lengthM)} × ${m(settings.widthM)} ${t('units.m')}`;
}

/** The overlap in centimetres, for a numeric cell. */
export const overlapCm = (settings: SheetSettings): number => Math.round(settings.overlapM * 1000) / 10;

/** `6.00 × 2.50 m · 80 cm` - the sheet size and overlap a sheet count was made with. */
export function sheetConfigText(settings: SheetSettings, x: ExportContext): string {
  return `${sheetSizeText(settings, x)} · ${x.number(overlapCm(settings))} ${x.t('units.cm')}`;
}

/** What a mesh level (or a manual-bars item) is made of: `Ø12 @ 20 cm - Both directions`, `Long side Ø12 @ 20 | Short side Ø10 @ 15`, `Ø16`. */
export function levelSpecification(d: RebarLevelRow, x: ExportContext): string {
  const { t } = x;
  const notation = (r: RebarItemRow) => (r.diameterMm === null ? null : r.spacingCm === null ? `Ø${r.diameterMm}` : `Ø${r.diameterMm} @ ${x.number(r.spacingCm)}`);
  if (d.kind === 'bars') return notation(d.parts[0]) ?? '-';
  const first = d.parts[0];
  if (first.level === null) return '-';
  if (first.direction === 'both') {
    const n = notation(first);
    return n ? `${n} ${t('units.cm')} - ${t('exports.structural.bothDirections')}` : '-';
  }
  return d.parts.map((p) => `${t(p.direction === 'short' ? 'exports.structural.shortSide' : 'exports.structural.longSide')} ${notation(p) ?? '-'}`).join(' | ');
}

/** `2 sheets` for a counted mesh level, `10 bars` for manual bars, a dash when there is no count (no layout, no bars). */
export function levelQuantity(d: RebarLevelRow, { t }: ExportContext): string {
  if (d.kind === 'bars') {
    const count = d.parts[0].barCount;
    return count === null ? '-' : t('exports.structural.barsQty', { count });
  }
  return d.sheets?.count == null ? '-' : t('exports.structural.sheetsQty', { count: d.sheets.count });
}

/** Exact / Estimate for a calculated level, otherwise the short reason it has no quantity. */
export function levelStatus(d: RebarLevelRow, x: ExportContext): string {
  return d.status === 'ok' ? basisText(d.estimated ? 'estimated' : 'exact', x) : rebarStatusText(d.status, x);
}

/** Length details added inside existing report cells; no new table/export model. */
export function barsLengthDescription(d: RebarLevelRow, x: ExportContext): string {
  const part = d.parts[0];
  const length = (value: number | null) => value === null ? '-' : `${x.number(round(value, 2))} ${x.t('units.m')}`;
  return `${x.t('rebar.barLength')}: ${length(part.barLengthM)} · ${x.t('rebar.totalLength')}: ${length(part.netLengthM)}`;
}

export function levelReportSpecification(d: RebarLevelRow, x: ExportContext): string {
  const specification = levelSpecification(d, x);
  return d.kind === 'bars' ? `${specification} · ${barsLengthDescription(d, x)}` : specification;
}
