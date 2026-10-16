import { useStore } from 'zustand';
import { useT } from '../i18n';
import { authStore } from '../store/authStore';
import { accessSync } from '../lib/access/accessSync';
import { ACCESS_ENFORCEMENT_ENABLED, ACCOUNTS_ENABLED } from '../lib/access/accessPolicy';
import { useAccessPrompt } from '../lib/access/editGuard';
import './Account.css';

/** Non-blocking notices: an expired sign-in, and (only while restrictions are enforced) the ended trial. */
export default function AccessNotices() {
  const t = useT();
  const sessionExpired = useStore(authStore, (s) => s.sessionExpired);
  const level = useStore(accessSync.store, (s) => s.level);
  const show = useAccessPrompt((s) => s.show);
  if (!ACCOUNTS_ENABLED) return null;
  if (sessionExpired) {
    return (
      <div className="access-notice" role="status">
        <span>{t('account.sessionExpired')}</span>
        <button type="button" className="btn-secondary" onClick={() => show('account')}>{t('account.signIn')}</button>
        <button type="button" className="btn-secondary" onClick={() => authStore.getState().dismissSessionExpired()}>{t('account.close')}</button>
      </div>
    );
  }
  if (ACCESS_ENFORCEMENT_ENABLED && level === 'expired') {
    return (
      <div className="access-notice" role="status">
        <span>{t('account.expiredBanner')}</span>
        <button type="button" className="btn-primary" onClick={() => show('edit')}>{t('account.signIn')}</button>
      </div>
    );
  }
  return null;
}
