import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { useT } from '../i18n';
import { ACCOUNTS_ENABLED } from '../lib/access/accessPolicy';
import { AccountError, normalizeDisplayName } from '../lib/account/accountApi';
import { accountStore } from '../store/accountStore';
import { authStore } from '../store/authStore';
import { takeConsentPending } from '../store/accountUi';
import AppModal from './AppModal';
import { AgreeLabel } from './LegalDialog';
import BrandLogo from './BrandLogo';
import './Account.css';

/** Set when the user chooses "later"; the step returns on the next visit. */
let postponed = false;

/**
 * The step after a first sign-in: confirm the name and agree to the terms. If the user already agreed on the
 * registration form (and the name is known), it completes silently. Never blocks local work.
 */
export default function OnboardingDialog() {
  const t = useT();
  const needs = useStore(accountStore, (s) => s.needsOnboarding);
  const profile = useStore(accountStore, (s) => s.profile);
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(postponed);
  const [auto, setAuto] = useState<boolean | null>(null);
  const known = profile?.displayName ?? '';

  useEffect(() => { setName((current) => current || known); }, [known]);

  // Decide once whether the registration form already covered this step.
  useEffect(() => {
    if (!needs || auto !== null) return;
    setAuto(takeConsentPending() && !!normalizeDisplayName(known));
  }, [needs, known, auto]);

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await accountStore.getState().submitOnboarding(value);
    } catch (e) {
      setError(t(`acct.errors.${e instanceof AccountError ? e.code : 'unknown'}`));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { if (needs && auto === true && !busy) void submit(known); }, [needs, auto]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ACCOUNTS_ENABLED || !needs || hidden || auto !== false) return null;
  const later = () => { postponed = true; setHidden(true); };
  const valid = !!normalizeDisplayName(name) && agree;
  return (
    <AppModal title={t('acct.onboardingTitle')} onCancel={later} showClose className="onboarding-dialog auth-dialog" eyebrow={<div className="auth-brand"><BrandLogo /></div>}>
      <p className="auth-lead">{t('acct.onboardingIntro')}</p>
      <form onSubmit={(e) => { e.preventDefault(); if (valid) void submit(name); }}>
        <label className="auth-field">
          {t('acct.fullName')}
          <input className="app-dialog-input" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="auth-field auth-agree">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <AgreeLabel />
        </label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <div className="app-dialog-actions">
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void authStore.getState().signOut()}>{t('account.signOut')}</button>
          <button type="submit" className="btn-primary" disabled={busy || !valid}>{busy ? t('acct.onboardingSaving') : t('acct.onboardingSave')}</button>
        </div>
      </form>
    </AppModal>
  );
}
