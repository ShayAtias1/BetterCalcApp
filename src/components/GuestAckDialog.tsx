import { useState } from 'react';
import { useStore } from 'zustand';
import { useT } from '../i18n';
import { ACCOUNTS_ENABLED } from '../lib/access/accessPolicy';
import { guestNeedsAck } from '../lib/access/guestAck';
import { welcomeStore } from '../lib/access/welcome';
import { LEGAL_DOC_VERSION } from '../lib/legal/legalDocs';
import { authStore } from '../store/authStore';
import AppModal from './AppModal';
import BrandLogo from './BrandLogo';
import { AgreeLabel } from './LegalDialog';
import { useGuestConsent } from '../store/guestConsentStore';
import './Account.css';

/**
 * The guest's acknowledgement of the Terms and the "verify every result" notice, once per version of the texts. It asks for
 * a checkbox and records the version and time in this browser; local projects are not touched and nothing is sent anywhere.
 * Signed-in users accept through the account's own step (OnboardingDialog), which the server records.
 */
export default function GuestAckDialog({ localAccess = false }: { localAccess?: boolean }) {
  const t = useT();
  const authStatus = useStore(authStore, (s) => s.status);
  const welcomeSeen = welcomeStore((s) => s.seen);
  const ack = useGuestConsent((s) => s.ack);
  const accept = useGuestConsent((s) => s.accept);
  const [agree, setAgree] = useState(false);
  if (localAccess ? ack?.version === LEGAL_DOC_VERSION : !guestNeedsAck({ accountsEnabled: ACCOUNTS_ENABLED, authStatus, welcomeSeen, ack, version: LEGAL_DOC_VERSION })) return null;
  // Escape does nothing: the acknowledgement is part of starting to use the tool.
  return (
    <AppModal title={t('guestAck.title')} onCancel={() => undefined} className="auth-dialog guest-ack-dialog" eyebrow={<div className="auth-brand"><BrandLogo /></div>}>
      <p className="auth-lead">{t(localAccess ? 'acct.localConsentIntro' : 'guestAck.body')}</p>
      <form onSubmit={(e) => { e.preventDefault(); if (agree) accept(LEGAL_DOC_VERSION); }}>
        <label className="auth-field auth-agree">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <AgreeLabel />
        </label>
        <div className="app-dialog-actions">
          <button type="submit" className="btn-primary" disabled={!agree} autoFocus>{t('guestAck.accept')}</button>
        </div>
      </form>
    </AppModal>
  );
}
