import { useStore } from 'zustand';
import { useT } from '../i18n';
import { authStore } from '../store/authStore';
import { useAccessPrompt } from '../lib/access/editGuard';
import { accessSync } from '../lib/access/accessSync';
import { ACCESS_ENFORCEMENT_ENABLED, ACCOUNTS_ENABLED } from '../lib/access/accessPolicy';

/**
 * Sign-in entry, signed-in identity with sign-out, and (once restrictions are enforced) the guest trial
 * status. Renders nothing when accounts are not configured, so a purely local build looks as before.
 */
export default function AccountMenu() {
  const t = useT();
  const status = useStore(authStore, (s) => s.status);
  const user = useStore(authStore, (s) => s.user);
  const access = useStore(accessSync.store, (s) => s);
  const show = useAccessPrompt((s) => s.show);
  if (!ACCOUNTS_ENABLED || status === 'unconfigured' || status === 'loading') return null;
  const trialChip = ACCESS_ENFORCEMENT_ENABLED && status === 'signedOut' && (access.level === 'trial' || access.level === 'expired')
    ? <span className="muted account-trial">{access.level === 'trial' ? t('account.trialDays', { days: access.daysLeft ?? 0 }) : t('account.trialEnded')}</span>
    : null;
  return status === 'signedIn' ? (
    <div className="account-menu">
      <span className="muted account-email" dir="ltr" title={t('account.signedInAs', { email: user?.email ?? '' })}>{user?.email}</span>
      <button type="button" className="btn-secondary" onClick={() => void authStore.getState().signOut()}>{t('account.signOut')}</button>
    </div>
  ) : (
    <div className="account-menu">
      {trialChip}
      <button type="button" className="btn-secondary" onClick={() => show('account')}>{t('account.signIn')}</button>
    </div>
  );
}
