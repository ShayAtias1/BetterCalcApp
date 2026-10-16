import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { authStore, type AuthState } from '../store/authStore';
import { useStore } from 'zustand';
import type { AuthFailure } from '../lib/supabase/authService';
import { ACCOUNTS_ENABLED } from '../lib/access/accessPolicy';
import { useAccessPrompt } from '../lib/access/editGuard';
import AppModal from './AppModal';

type Step = 'start' | 'code';

/** Registration and sign-in: Google or an emailed 6-digit code. Signing in never touches local projects. */
export default function AuthDialog() {
  const t = useT();
  const { open, reason, close } = useAccessPrompt();
  if (!ACCOUNTS_ENABLED || !open) return null;
  return <AuthForm key="auth" reason={reason} onClose={close} t={t} />;
}

function AuthForm({ reason, onClose, t }: { reason: 'edit' | 'create' | 'account'; onClose: () => void; t: ReturnType<typeof useT> }) {
  const [step, setStep] = useState<Step>('start');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthFailure | null>(null);
  const auth = authStore.getState();
  const status = useStore(authStore, (s: AuthState) => s.status);
  // Signing in (including the return from Google) closes the dialog; nothing else changes.
  useEffect(() => { if (status === 'signedIn') onClose(); }, [status, onClose]);

  const run = async (action: () => Promise<{ ok: true } | { ok: false; reason: AuthFailure }>, onOk?: () => void) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) onOk?.();
    else setError(result.reason);
  };
  const reasonText = reason === 'edit' ? t('account.reasonEdit') : reason === 'create' ? t('account.reasonCreate') : t('account.reasonAccount');

  return (
    <AppModal title={t('account.dialogTitle')} onCancel={onClose} showClose className="auth-dialog">
      <p className="app-dialog-message">{reasonText}</p>
      <p className="muted">{t('account.localSafe')}</p>
      {step === 'start' ? (
        <>
          <button type="button" className="btn-secondary auth-google" disabled={busy} onClick={() => void run(() => auth.signInWithGoogle())}>
            {t('account.google')}
          </button>
          <p className="auth-or muted">{t('account.or')}</p>
          <form onSubmit={(e) => { e.preventDefault(); void run(() => auth.requestEmailCode(email), () => setStep('code')); }}>
            <label>
              {t('account.email')}
              <input className="app-dialog-input" type="email" inputMode="email" autoComplete="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <div className="app-dialog-actions">
              <button type="submit" className="btn-primary" disabled={busy || !email.trim()}>{busy ? t('account.sending') : t('account.sendCode')}</button>
            </div>
          </form>
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void run(() => auth.confirmEmailCode(email, code)); }}>
          <p>{t('account.codeSent', { email })}</p>
          <label>
            {t('account.code')}
            <input className="app-dialog-input" inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
          </label>
          <div className="app-dialog-actions">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setStep('start'); setCode(''); setError(null); }}>{t('account.changeEmail')}</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run(() => auth.requestEmailCode(email))}>{t('account.resend')}</button>
            <button type="submit" className="btn-primary" disabled={busy || !code.trim()}>{busy ? t('account.verifying') : t('account.verify')}</button>
          </div>
        </form>
      )}
      {error && <p className="auth-error" role="alert">{t(`account.errors.${error}`)}</p>}
    </AppModal>
  );
}
