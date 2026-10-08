import { t, translate, type TranslateFn } from '../i18n';
import { ROOM_PROFILES, roomProfileLabel } from './roomProfiles';
import type { Room } from '../types';
import type { LocalAiMetadata } from './localAiImport';

interface AiReviewCandidate {
  localAi?: LocalAiMetadata;
  roomTypeKey: string | null;
  suggestedName: string;
  semanticTypeEdited?: boolean;
  reviewedWarningIds?: string[];
}

export function aiProfileKey(type: string | null | undefined): string | null {
  const normalized = type?.trim().toLocaleLowerCase();
  if (!normalized) return null;
  return ROOM_PROFILES.find(profile => [profile.key, ...profile.labels,
    translate('en', `roomTypes.${profile.key}`), translate('he', `roomTypes.${profile.key}`)]
    .some(label => label.toLocaleLowerCase() === normalized))?.key ?? null;
}

export function aiCandidateTypeKey(candidate: AiReviewCandidate): string | null {
  return candidate.semanticTypeEdited ? candidate.roomTypeKey : aiProfileKey(candidate.localAi?.suggestedType);
}

export function aiCandidateLabel(candidate: AiReviewCandidate, tr: TranslateFn = t): string {
  const key = aiCandidateTypeKey(candidate);
  if (key) return roomProfileLabel(key, tr)!;
  const raw = candidate.semanticTypeEdited ? null : candidate.localAi?.suggestedType?.trim();
  // Display-only translations: these composite descriptions are NOT mapped to a profile.
  if (raw?.toLowerCase() === 'protected bedroom') return tr('aiReview.protectedBedroom');
  if (raw?.toLowerCase() === 'living kitchen and circulation') return tr('aiReview.livingKitchenCirculation');
  return raw || tr('aiReview.genericSpace');
}

/** Stable warning IDs refer to untouched source metadata, independent of geometry edits. */
export function aiWarnings(meta: LocalAiMetadata, tr: TranslateFn = t): { id: string; text: string }[] {
  const warnings: { id: string; text: string }[] = [];
  if (meta.geometryClass === 'OPEN_CONNECTED') warnings.push({ id: 'geometryClass', text: tr('aiReview.openConnected') });
  if (meta.geometryClass === 'AMBIGUOUS') warnings.push({ id: 'geometryClass', text: tr('aiReview.ambiguous') });
  if (meta.reason) warnings.push({ id: 'reason', text: meta.reason === 'CROSS_TILE_INCOMPLETE' ? tr('aiReview.crossTile') : meta.reason });
  meta.ambiguities?.forEach((text, index) => warnings.push({ id: `ambiguity:${index}`, text }));
  if (meta.geometryConfidence === 'LOW' || meta.geometryConfidence === 'MEDIUM') {
    warnings.push({ id: 'geometryConfidence', text: tr('aiReview.geometryConfidence', { level: meta.geometryConfidence }) });
  }
  if (meta.requiresReview) warnings.push({ id: 'requiresReview', text: tr('aiReview.requiresReview') });
  // Retain compatibility with drafts imported before structured review fields were retained.
  if (meta.ambiguities === undefined) meta.reviewNotes.forEach((text, index) => warnings.push({ id: `note:${index}`, text }));
  return warnings;
}

/** Approved AI Rooms retain provenance, but no longer have actionable suggestion warnings. */
export function roomHasPendingDetectionWarning(room: Pick<Room,'id'|'aiSource'|'detectionConfidence'>): boolean {
  return room.detectionConfidence === 'low' && !room.aiSource && !room.id.startsWith('local-ai:');
}

/** Page-scoped resolution count, derived from pending IDs and existing persisted tombstones. */
export function aiReviewProgress(pendingIds: string[], resolvedIds: string[]) {
  const resolved = new Set(resolvedIds);
  return { resolved: resolved.size, total: new Set([...pendingIds, ...resolved]).size };
}
