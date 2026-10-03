/**
 * The words the structural parts of the plan reports (Excel and PDF) share: status of an item,
 * basis of a rebar quantity, the reinforcement notation. Written in the export language through the
 * export context, like every other export text.
 */

import type { ConcreteStatus } from './concrete';
import type { RebarStatus } from './rebar';
import type { RebarBasis } from './structuralQuantities';
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

/** `Ø12 @ 200` — the notation is data and is never translated. Null when the diameter is unknown. */
export function reinforcementNotation(diameterMm: number | null, spacingMm: number | null): string | null {
  if (diameterMm === null) return null;
  return spacingMm === null ? `Ø${diameterMm}` : `Ø${diameterMm} @ ${spacingMm}`;
}
