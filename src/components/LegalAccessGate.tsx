import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useT } from '../i18n';
import { ACCOUNTS_ENABLED } from '../lib/access/accessPolicy';
import { accessSync } from '../lib/access/accessSync';
import { legalAccessState } from '../lib/access/legalAccess';
import { LEGAL_PATH } from '../lib/legal/legalDocs';
import { welcomeStore } from '../lib/access/welcome';
import { accountStore } from '../store/accountStore';
import { authStore } from '../store/authStore';
import { useGuestConsent } from '../store/guestConsentStore';
import BrandLogo from './BrandLogo';
import GuestAckDialog from './GuestAckDialog';
import OnboardingDialog from './OnboardingDialog';
import WelcomeScreen from './WelcomeScreen';

/** Do not mount service controls until the displayed legal documents have been accepted. */
export default function LegalAccessGate({ children }: { children: ReactNode }) {
  const t = useT();
  const [dismissed, setDismissed] = useState(false);
  const lastRefresh = useRef(Date.now());
  const auth = useStore(authStore);
  const account = useStore(accountStore);
  const welcomeSeen = welcomeStore((s) => s.seen);
  const ack = useGuestConsent((s) => s.ack);
  const state = legalAccessState({ accountsEnabled: ACCOUNTS_ENABLED, authStatus: auth.status, welcomeSeen, ack, ...account }, undefined, {
    enabled: import.meta.env?.DEV === true,
    hostname: typeof window === 'undefined' ? '' : window.location.hostname,
  });
  useEffect(() => {
    if (state === 'ready' || state === 'local') accessSync.beginUse();
  }, [state]);
  useEffect(() => {
    if (!ACCOUNTS_ENABLED || auth.status !== 'signedIn') return;
    const refresh = () => {
      if (document.visibilityState === 'visible' && !accountStore.getState().loading
        && !accountStore.getState().loadFailed && Date.now() - lastRefresh.current >= 60_000) {
        lastRefresh.current = Date.now();
        void accountStore.getState().refresh();
      }
    };
    document.addEventListener('visibilitychange', refresh);
    return () => { document.removeEventListener('visibilitychange', refresh); };
  }, [auth.status]);
  if (state === 'ready' || state === 'local') return <>
    {children}
    {state === 'ready' && <OnboardingDialog key={auth.user?.id} />}
    {account.loadFailed && !dismissed && <div className="access-notice" role="status">
      <span>{t('acct.localAccessNotice')}</span>
      <button type="button" className="btn-secondary" disabled={account.loading} onClick={() => void accountStore.getState().refresh()}>{t('acct.consentRetry')}</button>
      <button type="button" className="btn-ghost" onClick={() => setDismissed(true)}>{t('account.close')}</button>
    </div>}
  </>;
  if (state === 'welcome') return <WelcomeScreen />;
  if (state === 'guest' || state === 'local-consent') return <GuestAckDialog localAccess={state === 'local-consent'} />;
  if (state === 'account') return <OnboardingDialog key={auth.user?.id} />;
  if (state === 'wait') return (
    <div className="legal-access-screen">
      <section className="app-loading" role="status" aria-live="polite" aria-busy="true">
        <div className="app-loading-mark"><BrandLogo /></div>
        <span className="app-loading-name" dir="ltr" aria-hidden="true">BetterCalc</span>
        <span className="app-loading-label">{t('common.loading')}</span>
        <span className="app-loading-track" aria-hidden="true" />
      </section>
    </div>
  );
  return (
    <div className="legal-access-screen">
      <section className="acct-card legal-access-state" role="status">
        <p>{t(state === 'version-mismatch' ? 'acct.consentVersionMismatch' : 'acct.consentUnavailable')}</p>
        <>
          <nav className="acct-actions">
            <a className="link-button" href={LEGAL_PATH.terms} target="_blank" rel="noopener noreferrer">{t('acct.terms')}</a>
            <a className="link-button" href={LEGAL_PATH.privacy} target="_blank" rel="noopener noreferrer">{t('acct.privacy')}</a>
          </nav>
          <div className="acct-actions">
            <button type="button" className="btn-primary" disabled={account.loading} onClick={() => { if (state === 'version-mismatch') window.location.reload(); else void accountStore.getState().refresh(); }}>{t('acct.consentRetry')}</button>
            <button type="button" className="btn-secondary" onClick={() => void authStore.getState().signOut()}>{t('account.signOut')}</button>
          </div>
        </>
      </section>
    </div>
  );
}
