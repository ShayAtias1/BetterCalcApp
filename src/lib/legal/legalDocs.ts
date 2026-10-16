/**
 * The terms of use and privacy policy. The texts are not final and must be reviewed legally before launch,
 * so they are not invented here: while a text is null the app says so, and acceptance is recorded against
 * the version the server announces (`legal_version` in commercial_settings, "pending" until it is set).
 * To publish: fill in `LEGAL_TEXTS`, then set `legal_version` in Supabase.
 */
export type LegalKind = 'terms' | 'privacy';
export type LegalText = { he: string; en: string } | null;

export const LEGAL_TEXTS: Record<LegalKind, LegalText> = {
  terms: null,
  privacy: null,
};
