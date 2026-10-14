import type { Language } from '../../i18n';
import type { ComparisonContext, RevisionEditType } from '../../types/revisionAnalysis';

/** Version ownership and physical work actions have different wording in design revisions. */
export function revisionTypeLabelKey(type: RevisionEditType, context: ComparisonContext | undefined,
  language: Language) {
  if (language === 'he' && (context ?? 'design') === 'design') {
    if (type === 'wall-added') return 'revisionAi.edit.designWallAdded';
    if (type === 'wall-removed') return 'revisionAi.edit.designWallRemoved';
  }
  return `revisionAi.edit.types.${type}` as const;
}
