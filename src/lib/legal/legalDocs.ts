/**
 * Versioning of the Terms of Service and Privacy Policy (texts: legalContent.ts).
 *
 * LEGAL_DOC_VERSION is the version of the texts in this build. It stays 'pending' while any `[[placeholder]]` remains
 * (a test refuses anything else), which is also the placeholder the server expects until it announces a version:
 * `complete_onboarding` accepts only `commercial_settings.legal_version`, or 'pending' while that is unset.
 *
 * To publish (one release): fill every placeholder, set LEGAL_DOC_VERSION to the real id (for example '2026-11-01'),
 * and set `legal_version` in Supabase to the same value. Accounts that accepted an older version are asked again;
 * guests are asked to acknowledge the new version.
 */
export type LegalKind = 'terms' | 'privacy';

export const LEGAL_DOC_VERSION_PENDING = 'pending';
export const LEGAL_DOC_VERSION: string = LEGAL_DOC_VERSION_PENDING;

/** The texts are still a draft: placeholders remain, so the pages say so. */
export const LEGAL_IS_DRAFT = LEGAL_DOC_VERSION === LEGAL_DOC_VERSION_PENDING;

export const LEGAL_PATH: Record<LegalKind, string> = { terms: '/terms', privacy: '/privacy' };
