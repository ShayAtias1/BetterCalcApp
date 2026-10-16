import { useLanguage, useT } from '../i18n';
import { LEGAL_TEXTS, type LegalKind } from '../lib/legal/legalDocs';
import { useAccountUi } from '../store/accountUi';
import AppModal from './AppModal';

/** Terms of use / privacy policy viewer. Shows a plain notice while the legally reviewed text is not published. */
export default function LegalDialog() {
  const t = useT();
  const language = useLanguage();
  const kind = useAccountUi((s) => s.legal);
  const close = useAccountUi((s) => s.closeLegal);
  if (!kind) return null;
  const text = LEGAL_TEXTS[kind]?.[language];
  return (
    <AppModal title={kind === 'terms' ? t('acct.legalTitleTerms') : t('acct.legalTitlePrivacy')} onCancel={close} showClose wide className="legal-dialog">
      {text ? <div className="legal-text">{text}</div> : <p>{t('acct.legalPending')}</p>}
    </AppModal>
  );
}

/** "I agree to the Terms of use and the Privacy policy" with both names opening their text. */
export function AgreeLabel({ kind = null }: { kind?: LegalKind | null }) {
  const t = useT();
  const open = useAccountUi((s) => s.openLegal);
  void kind;
  return (
    <span>
      {t('acct.agree')}
      <button type="button" className="link-button" onClick={() => open('terms')}>{t('acct.terms')}</button>
      {t('acct.and')}
      <button type="button" className="link-button" onClick={() => open('privacy')}>{t('acct.privacy')}</button>
    </span>
  );
}
