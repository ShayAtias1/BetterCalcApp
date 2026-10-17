import { useT } from '../i18n';
import { LEGAL_PATH, type LegalKind } from '../lib/legal/legalDocs';

/** "I agree to the Terms of use and the Privacy policy", both names linking to their public pages. */
export function AgreeLabel({ kind = null }: { kind?: LegalKind | null }) {
  const t = useT();
  void kind;
  // The public pages open in a new tab so a half-filled form or the welcome screen stays as it is.
  return (
    <span>
      {t('acct.agree')}
      <a className="link-button" href={LEGAL_PATH.terms} target="_blank" rel="noopener noreferrer">{t('acct.terms')}</a>
      {t('acct.and')}
      <a className="link-button" href={LEGAL_PATH.privacy} target="_blank" rel="noopener noreferrer">{t('acct.privacy')}</a>
    </span>
  );
}
