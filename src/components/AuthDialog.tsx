import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { useT } from '../i18n';
import { authStore, type AuthState } from '../store/authStore';
import type { AuthFailure } from '../lib/supabase/authService';
import { normalizeDisplayName } from '../lib/account/accountApi';
import { ACCOUNTS_ENABLED } from '../lib/access/accessPolicy';
import { useAccessPrompt, type PromptReason } from '../lib/access/editGuard';
import { markConsentPending } from '../store/accountUi';
import AppModal from './AppModal';
import { AgreeLabel } from './LegalDialog';

type Step = 'start' | 'code';
type Mode = 'signIn' | 'create';
type Problem = AuthFailure | 'need-name' | 'need-agree';

/**
 * Registration and sign-in with Google or an emailed 6-digit code. No passwords. Creating an account asks for a
 * name and agreement to the terms first. Signing in never touches local projects.
 */
export default function AuthDialog() {
  const t = useT();
  const { open, reason, close } = useAccessPrompt();
  if (!ACCOUNTS_ENABLED || !open) return null;
  return <AuthForm key="auth" reason={reason} onClose={close} t={t} />;
}

function AuthForm({ reason, onClose, t }: { reason: PromptReason; onClose: () => void; t: ReturnType<typeof useT> }) {
  const [mode, setMode] = useState<Mode>('signIn');
  const [step, setStep] = useState<Step>('start');
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const auth = authStore.getState();
  const status = useStore(authStore, (s: AuthState) => s.status);
  // Signing in (including the return from Google) closes the dialog; nothing else changes.
  useEffect(() => { if (status === 'signedIn') onClose(); }, [status, onClose]);

  const creating = mode === 'create';
  /** Registration needs a valid name and the agreement before anything is sent. */
  const registrationProblem = (): Problem | null => {
    if (!creating) return null;
    if (!normalizeDisplayName(name)) return 'need-name';
    return agree ? null : 'need-agree';
  };

  const run = async (action: () => Promise<{ ok: true } | { ok: false; reason: AuthFailure }>, onOk?: () => void) => {
    setBusy(true);
    setProblem(null);
    const result = await action();
    setBusy(false);
    if (result.ok) onOk?.();
    else setProblem(result.reason);
  };
  const guarded = (action: () => Promise<{ ok: true } | { ok: false; reason: AuthFailure }>, onOk?: () => void) => {
    const blocked = registrationProblem();
    if (blocked) return setProblem(blocked);
    if (creating) markConsentPending();
    void run(action, onOk);
  };

  const reasonText = reason === 'edit' ? t('account.reasonEdit') : reason === 'create' ? t('account.reasonCreate') : t('account.reasonAccount');
  const problemText = problem === 'need-name' ? t('acct.needName') : problem === 'need-agree' ? t('acct.needAgree') : problem ? t(`account.errors.${problem}`) : null;

  return (
    <AppModal title={creating ? t('acct.createTab') : t('account.dialogTitle')} onCancel={onClose} showClose className="auth-dialog">
      <p className="app-dialog-message">{reasonText}</p>
      <p className="muted">{t('account.localSafe')}</p>
      <div className="auth-tabs" role="tablist">
        {(['signIn', 'create'] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'active' : ''}
            onClick={() => { setMode(m); setStep('start'); setProblem(null); }}>
            {m === 'signIn' ? t('acct.signInTab') : t('acct.createTab')}
          </button>
        ))}
      </div>
      {step === 'start' ? (
        <>
          {creating && (
            <label>
              {t('acct.fullName')}
              <input className="app-dialog-input" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
              <span className="muted">{t('acct.nameHint')}</span>
            </label>
          )}
          {creating && (
            <label className="auth-agree">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <AgreeLabel />
            </label>
          )}
          <button type="button" className="btn-secondary auth-google" disabled={busy} onClick={() => guarded(() => auth.signInWithGoogle())}>
            {t('account.google')}
          </button>
          <p className="auth-or muted">{t('account.or')}</p>
          <form onSubmit={(e) => { e.preventDefault(); guarded(() => auth.requestEmailCode(email, creating ? (normalizeDisplayName(name) ?? undefined) : undefined), () => setStep('code')); }}>
            <label>
              {t('account.email')}
              <input className="app-dialog-input" type="email" inputMode="email" autoComplete="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <div className="app-dialog-actions">
              <button type="submit" className="btn-primary" disabled={busy || !email.trim()}>{busy ? t('account.sending') : t('account.sendCode')}</button>
            </div>
          </form>
          {reason === 'account' && (
            <p className="auth-continue">
              <button type="button" className="link-button" onClick={onClose}>{t('acct.continueWithout')}</button>
              <span className="muted"> · {t('acct.withoutNote')}</span>
            </p>
          )}
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void run(() => auth.confirmEmailCode(email, code)); }}>
          <p>{t('account.codeSent', { email })}</p>
          <label>
            {t('account.code')}
            <input className="app-dialog-input" inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
          </label>
          <div className="app-dialog-actions">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setStep('start'); setCode(''); setProblem(null); }}>{t('account.changeEmail')}</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run(() => auth.requestEmailCode(email, creating ? (normalizeDisplayName(name) ?? undefined) : undefined))}>{t('account.resend')}</button>
            <button type="submit" className="btn-primary" disabled={busy || !code.trim()}>{busy ? t('account.verifying') : t('account.verify')}</button>
          </div>
        </form>
      )}
      {problemText && <p className="auth-error" role="alert">{problemText}</p>}
    </AppModal>
  );
}
