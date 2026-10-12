import type { PlanOpening, PlanOpeningKind } from '../types';
import type { TranslateFn } from '../i18n';

/** Persisted kind IDs remain compatible with existing plans and legacy quantity adapters. */
export const openingKinds: PlanOpeningKind[] = ['door', 'window', 'open-passage', 'custom', 'unknown'];
export const openingMechanisms = ['hinged', 'sliding', 'fragmentation-resistant', 'mamad', 'tilt-and-turn', 'fixed', 'open', 'unknown'] as const;
export const openingDimensionFields = ['widthM', 'heightM', 'sillHeightM', 'quantity'] as const;
export type OpeningDimensionField = typeof openingDimensionFields[number];
const options: Record<PlanOpeningKind, { label: 'door' | 'window' | 'passage' | 'custom' | 'unknown'; access: PlanOpening['walkableAccess']; mechanisms: readonly PlanOpening['mechanism'][] }> = {
  door: { label: 'door', access: 'supported', mechanisms: ['unknown', 'hinged', 'sliding', 'fragmentation-resistant', 'mamad'] },
  window: { label: 'window', access: 'unsupported', mechanisms: ['unknown', 'tilt-and-turn', 'sliding', 'fixed'] },
  'open-passage': { label: 'passage', access: 'supported', mechanisms: ['unknown', 'open'] },
  custom: { label: 'custom', access: 'supported', mechanisms: ['unknown', 'open'] },
  unknown: { label: 'unknown', access: 'unknown', mechanisms: ['unknown'] },
};
export const mechanismsForOpening = (kind: PlanOpeningKind) => options[kind].mechanisms;
export const openingAccessDefault = (kind: PlanOpeningKind) => options[kind].access;
export const openingKindLabel = (kind: PlanOpeningKind, t: TranslateFn) => t(`openingTools.${options[kind].label}`);
export function openingMechanismLabel(mechanism: PlanOpening['mechanism'], t: TranslateFn): string {
  switch (mechanism) {
    case 'unknown': return t('openingTools.unknownMechanism');
    case 'hinged': return t('openingTools.hingedMechanism');
    case 'sliding': return t('openingTools.slidingMechanism');
    case 'fragmentation-resistant': return t('openingTools.fragmentationResistant');
    case 'mamad': return t('openingTools.mamad');
    case 'tilt-and-turn': return t('openingTools.tiltAndTurn');
    default: return t(`openingTools.${mechanism}`);
  }
}
/** Used by both the plan overlay and shared Excel/PDF schedule. */
export function openingDescription(o: Pick<PlanOpening, 'kind' | 'mechanism'>, t: TranslateFn): string {
  // Retain familiar labels for existing door exports.
  if (o.kind === 'door' && (o.mechanism === 'hinged' || o.mechanism === 'sliding')) return t(`openingTools.${o.mechanism}`);
  const label = openingKindLabel(o.kind, t);
  return o.mechanism === 'unknown' || o.mechanism === 'open' ? label : `${label} · ${openingMechanismLabel(o.mechanism, t)}`;
}
/** Suggestions only, applied to newly imported AI candidates; existing openings are never filled. */
export function aiOpeningDefaults(kind: PlanOpeningKind): Partial<Pick<PlanOpening, OpeningDimensionField | 'suggestedDimensions'>> {
  const dimensions = kind === 'door' ? {widthM: 0.8, heightM: 2.1, sillHeightM: 0, quantity: 1} :
    kind === 'window' ? {widthM: 1.2, heightM: 1.2, sillHeightM: 1, quantity: 1} : null;
  return dimensions ? {...dimensions, suggestedDimensions: [...openingDimensionFields]} : {};
}
