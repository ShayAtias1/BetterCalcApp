import { useId, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useT } from '../i18n';
import { authStore } from '../store/authStore';
import { accountStore } from '../store/accountStore';
import { useAccountUi, type AccountSection } from '../store/accountUi';
import { useAccessPrompt } from '../lib/access/editGuard';
import { accessSync } from '../lib/access/accessSync';
import { ACCESS_ENFORCEMENT_ENABLED, ACCOUNTS_ENABLED } from '../lib/access/accessPolicy';
import { initialsOf } from '../lib/account/accountApi';
import { confirmDialog, notify } from '../lib/appDialogs';
import ResponsivePopover from './ResponsivePopover';

/** Signs out after the confirmation. Projects stay in this browser either way. */
export async function confirmSignOut(t: ReturnType<typeof useT>): Promise<void> {
  if (!await confirmDialog(t('acct.signOutConfirm'), { confirmLabel: t('account.signOut') })) return;
  if ((await authStore.getState().signOut()).ok) {
    useAccountUi.getState().closePage();
    notify(t('acct.signedOut'));
  }
}

/**
 * The top-bar account control: a sign-in button for guests (with the trial status once restrictions are
 * enforced) and, when signed in, an avatar menu with the account screens, cloud backup and sign-out.
 * Renders nothing when accounts are not available, so a purely local build looks as before.
 */
export default function AccountMenu() {
  const t = useT();
  const status = useStore(authStore, (s) => s.status);
  const user = useStore(authStore, (s) => s.user);
  const profile = useStore(accountStore, (s) => s.profile);
  const access = useStore(accessSync.store, (s) => s);
  const show = useAccessPrompt((s) => s.show);
  const openPage = useAccountUi((s) => s.openPage);
  const setCloudOpen = useAccountUi((s) => s.setCloudOpen);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  if (!ACCOUNTS_ENABLED || status === 'unconfigured' || status === 'loading') return null;

  if (status !== 'signedIn') {
    const chip = ACCESS_ENFORCEMENT_ENABLED && (access.level === 'trial' || access.level === 'expired')
      ? <span className="muted account-trial">{access.level === 'trial' ? t('account.trialDays', { days: access.daysLeft ?? 0 }) : t('account.trialEnded')}</span>
      : null;
    return (
      <div className="account-menu">
        {chip}
        <button type="button" className="btn-secondary" onClick={() => show('account')}>{t('account.signIn')}</button>
      </div>
    );
  }

  const name = profile?.displayName ?? null;
  const go = (section: AccountSection) => { setOpen(false); openPage(section); };
  const items: Array<[AccountSection, string]> = [
    ['profile', t('acct.menuProfile')], ['subscription', t('acct.menuSubscription')], ['plans', t('acct.menuPlans')], ['billing', t('acct.menuBilling')],
  ];
  return (
    <div className="account-menu">
      <button ref={anchorRef} type="button" className="account-avatar" aria-haspopup="menu" aria-expanded={open} aria-label={t('account.menu')} title={name ?? user?.email ?? ''} onClick={() => setOpen(!open)}>
        {initialsOf(name, user?.email ?? null)}
      </button>
      {open && (
        <ResponsivePopover id={menuId} label={t('account.menu')} anchorRef={anchorRef} onClose={() => setOpen(false)} desktopMaxWidth={300}>
          <div className="account-popover">
            <div className="account-identity">
              {name && <strong>{name}</strong>}
              <span className="muted" dir="ltr">{user?.email}</span>
            </div>
            {items.map(([section, label]) => <button key={section} type="button" className="account-item" onClick={() => go(section)}>{label}</button>)}
            <button type="button" className="account-item" onClick={() => { setOpen(false); setCloudOpen(true); }}>{t('acct.menuCloud')}</button>
            <button type="button" className="account-item" onClick={() => { setOpen(false); void confirmSignOut(t); }}>{t('account.signOut')}</button>
          </div>
        </ResponsivePopover>
      )}
    </div>
  );
}
