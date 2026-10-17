import { useState } from 'react';
import { useStore } from 'zustand';
import { useT } from '../i18n';
import { ACCOUNTS_ENABLED } from '../lib/access/accessPolicy';
import { guestNeedsAck, readGuestAck, writeGuestAck, type GuestAck } from '../lib/access/guestAck';
import { welcomeStore } from '../lib/access/welcome';
import { LEGAL_DOC_VERSION } from '../lib/legal/legalDocs';
import { authStore } from '../store/authStore';
import AppModal from './AppModal';
import BrandLogo from './BrandLogo';
import { AgreeLabel } from './LegalDialog';
import './Account.css';

const storage = (): Storage | null => { try { return window.localStorage; } catch { return null; } };

/**
 * The guest's acknowledgement of the Terms and the "verify every result" notice, once per version of the texts. It asks for
 * a checkbox and records the version and time in this browser; local projects are not touched and nothing is sent anywhere.
 * Signed-in users accept through the account's own step (OnboardingDialog), which the server records.
 */
export default function GuestAckDialog() {
  const t = useT();
  const authStatus = useStore(authStore, (s) => s.status);
  const welcomeSeen = welcomeStore((s) => s.seen);
  const [ack, setAck] = useState<GuestAck | null>(() => readGuestAck(storage()));
  const [agree, setAgree] = useState(false);
  if (!guestNeedsAck({ accountsEnabled: ACCOUNTS_ENABLED, authStatus, welcomeSeen, ack, version: LEGAL_DOC_VERSION })) return null;
  // Escape does nothing: the acknowledgement is part of starting to use the tool.
  return (
    <AppModal title={t('guestAck.title')} onCancel={() => undefined} className="auth-dialog guest-ack-dialog" eyebrow={<div className="auth-brand"><BrandLogo /></div>}>
      <p className="auth-lead">{t('guestAck.body')}</p>
      <form onSubmit={(e) => { e.preventDefault(); if (agree) setAck(writeGuestAck(storage(), LEGAL_DOC_VERSION, Date.now())); }}>
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
