/**
 * The words the structural parts of the plan reports (Excel and PDF) share: status of an item,
 * basis of a rebar quantity, the reinforcement notation. Written in the export language through the
 * export context, like every other export text.
 */

import type { ConcreteStatus } from './concrete';
import type { RebarStatus } from './rebar';
import type { RebarBasis, RebarItemRow } from './structuralQuantities';
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
