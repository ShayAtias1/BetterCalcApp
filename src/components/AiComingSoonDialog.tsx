import { useT } from '../i18n';
import { useAccountUi } from '../store/accountUi';
import AppModal from './AppModal';
import './Account.css';

export const LockIcon = () => (
  <svg className="acct-lock" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4.5" y="9" width="11" height="8" rx="2" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
  </svg>
);

/** What a locked AI action explains: the tools are coming soon, and nothing else is affected. */
export default function AiComingSoonDialog() {
  const t = useT();
  const open = useAccountUi((s) => s.aiSoonOpen);
  const setOpen = useAccountUi((s) => s.setAiSoonOpen);
  if (!open) return null;
  const close = () => setOpen(false);
  return (
    <AppModal title={t('acct.aiSoonTitle')} onCancel={close} className="ai-soon-dialog" eyebrow={<div className="ai-soon-icon"><LockIcon /></div>}>
      <p className="auth-lead">{t('acct.aiSoonBody')}</p>
      <p className="auth-note">{t('acct.aiSoonLocal')}</p>
      <div className="app-dialog-actions"><button type="button" className="btn-primary" autoFocus onClick={close}>{t('acct.aiSoonOk')}</button></div>
    </AppModal>
  );
}
