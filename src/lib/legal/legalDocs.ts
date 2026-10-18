/**
 * One immutable release identity for both approved bilingual legal documents.
 * The matching Supabase setting is prepared in scripts/sql/early-access-legal-release.sql.
 * Preparation does not update production; publish the matching client/backend only
 * after the consolidated release approval. Earlier consent history is preserved.
 */
export type LegalKind = 'terms' | 'privacy';

export const LEGAL_DOC_VERSION_PENDING = 'pending';
export const LEGAL_DOC_VERSION: string = 'ea-2026-10-18-v1';
export const LEGAL_EFFECTIVE_DATE = '2026-10-18';

/** Finalized locally; production publication remains a separate approval. */
export const LEGAL_IS_DRAFT = LEGAL_DOC_VERSION === LEGAL_DOC_VERSION_PENDING;

export const LEGAL_PATH: Record<LegalKind, string> = { terms: '/terms', privacy: '/privacy' };
