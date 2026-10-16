import { useId, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useLanguage, useT } from '../i18n';
import { authStore } from '../store/authStore';
import { accountStore } from '../store/accountStore';
import { useAccountUi, type AccountSection } from '../store/accountUi';
import { useAccessPrompt } from '../lib/access/editGuard';
import { accessSync } from '../lib/access/accessSync';
import { ACCESS_ENFORCEMENT_ENABLED, ACCOUNTS_ENABLED } from '../lib/access/accessPolicy';
import { initialsOf, planName, readCachedName } from '../lib/account/accountApi';
import { confirmDialog, notify } from '../lib/appDialogs';
import ResponsivePopover from './ResponsivePopover';
import './Account.css';

/** Signs out after the confirmation. Projects stay in this browser either way. */
export async function confirmSignOut(t: ReturnType<typeof useT>): Promise<void> {
  if (!await confirmDialog(t('acct.signOutConfirm'), { title: t('acct.signOutTitle'), confirmLabel: t('account.signOut'), destructive: true })) return;
  if ((await authStore.getState().signOut()).ok) {
    useAccountUi.getState().closePage();
    notify(t('acct.signedOutNote'), { label: t('account.signIn'), run: () => useAccessPrompt.getState().show('account') });
  }
}

/**
 * The account's display name and avatar. The saved name is shown as soon as it is known without waiting for the
 * network: the profile when loaded, else this device's last saved copy, else the name in the session. While none of
 * those exist `pending` is true and the header shows a placeholder, never the email standing in for a name.
 */
export function useAccountIdentity() {
  const user = useStore(authStore, (s) => s.user);
  const profile = useStore(accountStore, (s) => s.profile);
  const loadFailed = useStore(accountStore, (s) => s.loadFailed);
  const settled = profile !== null || loadFailed;
  // A failed or offline load must not turn the name into the email: the last saved copy and the session's name still apply.
  const known = profile?.displayName ?? (user ? readCachedName(typeof localStorage === 'undefined' ? null : localStorage, user.id) ?? user.metaName : null);
  const pending = !settled && !known;
  const email = user?.email ?? null;
  return { name: known, email, pending, initials: pending ? '' : initialsOf(known, email) };
}

/** Plan and credits summary line for the menu: no subscription exists yet, and AI credits are coming soon. */
function PlanLines() {
  const t = useT();
  const overview = useStore(accountStore, (s) => s.overview);
  const plans = useStore(accountStore, (s) => s.plans);
  const language = useLanguage();
  const plan = overview?.subscription ? planName(overview.subscription.planCode, plans, language) : t('acct.noPlanShort');
  return (
    <div className="account-plan-line">
      <span>{t('acct.planLine', { plan })}</span>
      <span>{t('acct.creditsLineSoon')}</span>
    </div>
  );
}

/** The same account actions as plain menu items, for the compact header's settings menu. */
export function AccountMenuItems() {
  const t = useT();
  const status = useStore(authStore, (s) => s.status);
  const { email } = useAccountIdentity();
  const show = useAccessPrompt((s) => s.show);
  const openPage = useAccountUi((s) => s.openPage);
  const setCloudOpen = useAccountUi((s) => s.setCloudOpen);
  if (!ACCOUNTS_ENABLED || status === 'unconfigured' || status === 'loading') return null;
  if (status !== 'signedIn') return <button type="button" className="menu-item" onClick={() => show('account')}>{t('account.signIn')}</button>;
  return (
    <>
      <span className="muted account-email" dir="ltr">{email}</span>
      <button type="button" className="menu-item" onClick={() => openPage('profile')}>{t('acct.menuProfile')}</button>
      <button type="button" className="menu-item" onClick={() => openPage('subscription')}>{t('acct.menuSubscription')}</button>
      <button type="button" className="menu-item" onClick={() => setCloudOpen(true)}>{t('acct.menuCloud')}</button>
      <button type="button" className="menu-item" onClick={() => void confirmSignOut(t)}>{t('account.signOut')}</button>
    </>
  );
}

/**
 * The top-bar account control: a sign-in button for guests (with the trial status once restrictions are
 * enforced) and, when signed in, a name chip whose menu holds the account screens, cloud backup and sign-out.
 * Renders nothing when accounts are not available, so a purely local build looks as before.
 */
export default function AccountMenu() {
  const t = useT();
  const status = useStore(authStore, (s) => s.status);
  const access = useStore(accessSync.store, (s) => s);
  const { name, email, initials, pending } = useAccountIdentity();
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

  const go = (section: AccountSection) => { setOpen(false); openPage(section); };
  const items: Array<[AccountSection, string]> = [
    ['profile', t('acct.menuProfile')], ['subscription', t('acct.menuSubscription')], ['billing', t('acct.menuBilling')],
  ];
  return (
    <div className="account-menu">
      <button ref={anchorRef} type="button" className="account-chip" aria-haspopup="menu" aria-expanded={open} aria-label={t('account.menu')} title={name ?? email ?? ''} onClick={() => setOpen(!open)}>
        <span className="account-avatar" aria-hidden="true">{initials}</span>
        <span className={`account-chip-name${pending ? ' skeleton' : ''}`}><bdi>{pending ? '' : (name ?? email)}</bdi></span>
        <span className="account-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <ResponsivePopover id={menuId} label={t('account.menu')} anchorRef={anchorRef} onClose={() => setOpen(false)} desktopMaxWidth={320}>
          <div className="account-popover">
            <div className="account-identity">
              <span className="account-avatar large" aria-hidden="true">{initials}</span>
              <span>{name && <strong><bdi>{name}</bdi></strong>}<span className="muted" dir="ltr">{email}</span></span>
            </div>
            <PlanLines />
            {items.map(([section, label]) => <button key={section} type="button" className="account-item" onClick={() => go(section)}>{label}</button>)}
            <button type="button" className="account-item" onClick={() => { setOpen(false); setCloudOpen(true); }}>{t('acct.menuCloud')}</button>
            <button type="button" className="account-item danger" onClick={() => { setOpen(false); void confirmSignOut(t); }}>{t('account.signOut')}</button>
          </div>
        </ResponsivePopover>
      )}
    </div>
  );
}
