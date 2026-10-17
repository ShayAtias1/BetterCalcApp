import { useId } from 'react';
import { useT } from '../i18n';
import { useAccountUi } from '../store/accountUi';
import { useAccessPrompt } from '../lib/access/editGuard';
import AppModal from './AppModal';
import './Account.css';

export const LockIcon = () => (
  <svg className="acct-lock" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4.5" y="9" width="11" height="8" rx="2" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
  </svg>
);

/** Explains locked AI tools without running AI, spending credits or taking payment. */
export default function AiComingSoonDialog() {
  const t = useT();
  const descriptionId = useId();
  const kind = useAccountUi((s) => s.aiDialog);
  const action = useAccountUi((s) => s.aiAction);
  const setDialog = useAccountUi((s) => s.setAiDialog);
  const openPage = useAccountUi((s) => s.openPage);
  const showAuth = useAccessPrompt((s) => s.show);
  if (!kind) return null;
  const close = () => setDialog(null);
  const guest = kind === 'guest';
  const actionName = action ? t(`acct.${action}`).replace(/…$/, '') : null;
  return (
    <AppModal title={t('acct.aiSoonTitle')} descriptionId={descriptionId} onCancel={close} className="ai-soon-dialog" eyebrow={<div className="ai-soon-icon"><LockIcon /></div>}>
      {guest ? (
        <p id={descriptionId} className="ai-soon-body">{t('acct.aiGuestBody')}</p>
      ) : actionName ? (
        <p id={descriptionId} className="ai-soon-body"><strong>{actionName}</strong>{t('acct.aiSoonBodyPost')}</p>
      ) : (
        <p id={descriptionId} className="ai-soon-body">{t('acct.aiSoonBody')}</p>
      )}
      <div className="ai-soon-actions">
        <button type="button" className="btn-primary" autoFocus onClick={close}>{t('acct.aiSoonOk')}</button>
        <div className="ai-soon-links">
          <button type="button" className="link-button" onClick={() => { close(); openPage('plans'); }}>{t('acct.aiViewPlans')}</button>
          {guest && (
            <>
              <button type="button" className="link-button" onClick={() => { close(); showAuth('account', 'create'); }}>{t('acct.createTab')}</button>
              <button type="button" className="link-button" onClick={() => { close(); showAuth('account', 'signIn'); }}>{t('account.signIn')}</button>
            </>
          )}
        </div>
      </div>
    </AppModal>
  );
}
