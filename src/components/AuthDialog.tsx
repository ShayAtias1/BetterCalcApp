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
import BrandLogo from './BrandLogo';
import { AgreeLabel } from './LegalDialog';
import './Account.css';

type Step = 'start' | 'code';
type Mode = 'signIn' | 'create';
type Problem = AuthFailure | 'need-name' | 'need-agree';

/** The Google "G" mark, in the brand's own colours. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
    </svg>
  );
}

/**
 * Registration and sign-in with Google or an emailed 6-digit code. No passwords. Creating an account asks for a
 * name and agreement to the terms first. Signing in never touches local projects.
 */
export default function AuthDialog() {
  const t = useT();
  const { open, reason, mode, close } = useAccessPrompt();
  if (!ACCOUNTS_ENABLED || !open) return null;
  return <AuthForm key="auth" reason={reason} initialMode={mode} onClose={close} t={t} />;
}

/**
 * `inline` renders the same form (same logic, same fields) as a panel inside the welcome screen instead of a modal;
 * the welcome screen then owns the logo, the Back button and the way back to the guest start.
 */
export function AuthForm({ reason, initialMode, onClose, t, inline = false }: { reason: PromptReason; initialMode: Mode; onClose: () => void; t: ReturnType<typeof useT>; inline?: boolean }) {
  const [mode, setMode] = useState<Mode>(initialMode);
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
  const fullName = creating ? (normalizeDisplayName(name) ?? undefined) : undefined;
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
  const switchTo = (next: Mode) => { setMode(next); setStep('start'); setProblem(null); };

  const lead = reason === 'edit' ? t('account.reasonEdit') : reason === 'create' ? t('account.reasonCreate') : t('account.reasonAccount');
  const problemText = problem === 'need-name' ? t('acct.needName') : problem === 'need-agree' ? t('acct.needAgree') : problem ? t(`account.errors.${problem}`) : null;

  const body = (
    <>
      <p className="auth-lead">{lead}</p>
      {step === 'start' ? (
        <>
          {creating && (
            <>
              <label className="auth-field">
                {t('acct.fullName')}
                <input className="app-dialog-input" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
                <span className="muted">{t('acct.nameHint')}</span>
              </label>
              <label className="auth-field auth-agree">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <AgreeLabel />
              </label>
            </>
          )}
          <button type="button" className="btn-secondary auth-google" disabled={busy} onClick={() => guarded(() => auth.signInWithGoogle())}>
            <GoogleMark />{t('account.google')}
          </button>
          <div className="auth-or" role="separator">{t('account.or')}</div>
          <form onSubmit={(e) => { e.preventDefault(); guarded(() => auth.requestEmailCode(email, fullName), () => setStep('code')); }}>
            <label className="auth-field">
              {t('account.email')}
              <input className="app-dialog-input" type="email" inputMode="email" autoComplete="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <button type="submit" className="btn-primary auth-submit" disabled={busy || !email.trim()}>{busy ? t('account.sending') : t('account.sendCode')}</button>
          </form>
          {problemText && <p className="auth-error" role="alert">{problemText}</p>}
          {creating && <p className="auth-note">{t('acct.aiNote')}</p>}
          <p className="auth-switch">
            {creating ? t('acct.haveAccount') : t('acct.noAccount')}{' '}
            <button type="button" className="link-button" onClick={() => switchTo(creating ? 'signIn' : 'create')}>{creating ? t('acct.signInTab') : t('acct.registerLink')}</button>
          </p>
          {!creating && !inline && reason === 'account' && (
            <p className="auth-continue">
              <button type="button" className="link-button" onClick={onClose}>{t('acct.continueWithout')}</button>
              <span className="muted">{t('acct.withoutNote')}</span>
            </p>
          )}
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void run(() => auth.confirmEmailCode(email, code)); }}>
          <p>{t('account.codeSent', { email })}</p>
          <label className="auth-field">
            {t('account.code')}
            <input className="app-dialog-input" inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
          </label>
          <button type="submit" className="btn-primary auth-submit" disabled={busy || !code.trim()}>{busy ? t('account.verifying') : t('account.verify')}</button>
          {problemText && <p className="auth-error" role="alert">{problemText}</p>}
          <div className="auth-code-actions">
            <button type="button" className="link-button" disabled={busy} onClick={() => { setStep('start'); setCode(''); setProblem(null); }}>{t('account.changeEmail')}</button>
            <button type="button" className="link-button" disabled={busy} onClick={() => void run(() => auth.requestEmailCode(email, fullName))}>{t('account.resend')}</button>
          </div>
        </form>
      )}
    </>
  );
  const title = creating ? t('acct.createTitle') : t('acct.signInTitle');
  if (inline) return <div className="auth-inline"><h2>{title}</h2>{body}</div>;
  return (
    <AppModal title={title} onCancel={onClose} showClose className="auth-dialog"
      eyebrow={<div className="auth-brand"><BrandLogo /></div>}>
      {body}
    </AppModal>
  );
}
