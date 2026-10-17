import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { useT } from '../i18n';
import { ACCOUNTS_ENABLED } from '../lib/access/accessPolicy';
import { AccountError, normalizeDisplayName } from '../lib/account/accountApi';
import { accountStore } from '../store/accountStore';
import { authStore } from '../store/authStore';
import AppModal from './AppModal';
import { AgreeLabel } from './LegalDialog';
import BrandLogo from './BrandLogo';
import './Account.css';

/** Set when the user chooses "later"; the step returns on the next visit. */
let postponed = false;

/** Explicit account acceptance; registration cannot be postponed or completed automatically. */
export default function OnboardingDialog() {
  const t = useT();
  const needsRegistration = useStore(accountStore, (s) => s.needsOnboarding);
  const needsName = useStore(accountStore, (s) => s.needsName);
  const needs = needsRegistration || needsName;
  const profile = useStore(accountStore, (s) => s.profile);
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(postponed);
  const known = profile?.displayName ?? '';

  useEffect(() => { setName((current) => current || known); }, [known]);

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      if (needsRegistration) await accountStore.getState().submitOnboarding(value);
      else await accountStore.getState().saveName(value);
    } catch (e) {
      setError(t(`acct.errors.${e instanceof AccountError ? e.code : 'unknown'}`));
    } finally {
      setBusy(false);
    }
  };

  if (!ACCOUNTS_ENABLED || !needs || (hidden && !needsRegistration)) return null;
  const later = () => { postponed = true; setHidden(true); };
  const valid = !!normalizeDisplayName(name) && (agree || !needsRegistration);
  return (
    <AppModal title={needsRegistration ? t('acct.onboardingTitle') : t('acct.nameOnlyTitle')} onCancel={needsRegistration ? () => undefined : later} showClose={!needsRegistration} className="onboarding-dialog auth-dialog" eyebrow={<div className="auth-brand"><BrandLogo /></div>}>
      <p className="auth-lead">{needsRegistration ? t('acct.onboardingIntro') : t('acct.nameOnlyIntro')}</p>
      <form onSubmit={(e) => { e.preventDefault(); if (valid) void submit(name); }}>
        <label className="auth-field">
          {t('acct.fullName')}
          <input className="app-dialog-input" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        {needsRegistration && (
          <label className="auth-field auth-agree">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <AgreeLabel />
          </label>
        )}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <div className="app-dialog-actions">
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void authStore.getState().signOut()}>{t('account.signOut')}</button>
          <button type="submit" className="btn-primary" disabled={busy || !valid}>{busy ? t('acct.onboardingSaving') : t('acct.onboardingSave')}</button>
        </div>
      </form>
    </AppModal>
  );
}
