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

/**
 * What a locked AI control explains.
 * - Guest: AI needs an account; Create account, Sign in, or Not now.
 * - Registered without a subscription: the clicked action named in bold, a plan-information area (plan, credits, price,
 *   all Coming Soon) and View plans / Not now.
 * Nothing here runs AI, spends credits or takes payment.
 */
export default function AiComingSoonDialog() {
  const t = useT();
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
    <AppModal title={guest ? t('acct.aiGuestTitle') : t('acct.aiSoonTitle')} onCancel={close} className="ai-soon-dialog" eyebrow={<div className="ai-soon-icon"><LockIcon /></div>}>
      {guest ? (
        <p className="ai-soon-body">{t('acct.aiGuestBody')}</p>
      ) : actionName ? (
        <p className="ai-soon-body">{t('acct.aiSoonBodyPre')}<strong>{actionName}</strong>{t('acct.aiSoonBodyPost')}</p>
      ) : (
        <p className="ai-soon-body">{t('acct.aiSoonBody')}</p>
      )}
      {guest ? (
        <p className="ai-soon-note">{t('acct.aiSoonLocal')}</p>
      ) : (
        <div className="ai-soon-plan">
          <div className="ai-soon-plan-row"><strong>{t('acct.aiPlanName')}</strong><span className="soon-badge">{t('acct.soon')}</span></div>
          <div className="ai-soon-plan-row muted">{t('acct.aiPlanCredits')}</div>
        </div>
      )}
      <div className="ai-soon-actions">
        {guest ? (
          <>
            <button type="button" className="btn-primary" autoFocus onClick={() => { close(); showAuth('account', 'create'); }}>{t('acct.createTab')}</button>
            <button type="button" className="btn-secondary" onClick={() => { close(); showAuth('account', 'signIn'); }}>{t('account.signIn')}</button>
          </>
        ) : (
          <button type="button" className="btn-primary" autoFocus onClick={() => { close(); openPage('plans'); }}>{t('acct.aiViewPlans')}</button>
        )}
        <button type="button" className="btn-ghost" onClick={close}>{t('acct.aiNotNow')}</button>
      </div>
    </AppModal>
  );
}
