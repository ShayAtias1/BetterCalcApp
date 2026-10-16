import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { formatDate, useLanguage, useT } from '../i18n';
import { authStore } from '../store/authStore';
import { accountStore } from '../store/accountStore';
import { useAccountUi, type AccountSection } from '../store/accountUi';
import { ACCOUNTS_ENABLED } from '../lib/access/accessPolicy';
import { getSupabase } from '../lib/supabase/client';
import {
  AccountError, cancelAccountDeletion, EMPTY_BILLING, getBillingProfile, getDeletionStatus, listAiUsage, listPayments, listPublicPlans,
  requestAccountDeletion, saveBillingProfile, type AccountClient, type AiUsageRow, type BillingProfile, type DeletionStatus, type PaymentRow, type PlanSummary,
} from '../lib/account/accountApi';
import { confirmDialog, notify } from '../lib/appDialogs';
import { toMegabytes } from '../lib/backup/backupLimits';
import LanguageSwitch from './LanguageSwitch';
import BrandLogo from './BrandLogo';
import CloudBackupDialog from './CloudBackupDialog';
import { confirmSignOut } from './AccountMenu';

const SECTIONS: AccountSection[] = ['profile', 'subscription', 'plans', 'billing'];
const SECTION_LABEL: Record<AccountSection, 'menuProfile' | 'menuSubscription' | 'menuPlans' | 'menuBilling'> = {
  profile: 'menuProfile', subscription: 'menuSubscription', plans: 'menuPlans', billing: 'menuBilling',
};

/** Runs `load` with the Supabase client once; returns the result, or null while loading / when unavailable. */
function useAccountData<T>(load: (client: AccountClient) => Promise<T>): [T | null, () => void] {
  const [value, setValue] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const client = (await getSupabase()) as AccountClient | null;
        if (client) { const v = await load(client); if (alive) setValue(v); }
      } catch { /* offline or not allowed: the section shows its empty state */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  return [value, () => setTick((n) => n + 1)];
}

async function withClient<T>(run: (client: AccountClient) => Promise<T>): Promise<T | null> {
  const client = (await getSupabase()) as AccountClient | null;
  return client ? run(client) : null;
}

const SoonBadge = () => <span className="soon-badge">{useT()('acct.soon')}</span>;

/** Full-screen account area: profile, subscription & credits, plans, billing. Opens over the app; closing returns to the same place. */
export default function AccountPage() {
  const t = useT();
  const open = useAccountUi((s) => s.pageOpen);
  const section = useAccountUi((s) => s.section);
  const openPage = useAccountUi((s) => s.openPage);
  const close = useAccountUi((s) => s.closePage);
  const status = useStore(authStore, (s) => s.status);
  useEffect(() => { if (open && status !== 'signedIn') close(); }, [open, status, close]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);
  if (!ACCOUNTS_ENABLED || !open || status !== 'signedIn') return null;
  return (
    <div className="account-page" role="dialog" aria-modal="true" aria-label={t('acct.pageTitle')}>
      <header className="account-page-bar">
        <button type="button" className="btn-secondary" onClick={close}>‹ {t('acct.back')}</button>
        <BrandLogo />
        <span className="grow" />
        <LanguageSwitch />
      </header>
      <div className="account-page-body">
        <nav className="account-nav" aria-label={t('acct.pageTitle')}>
          {SECTIONS.map((s) => <button key={s} type="button" aria-current={section === s ? 'page' : undefined} className={section === s ? 'active' : ''} onClick={() => openPage(s)}>{t(`acct.${SECTION_LABEL[s]}`)}</button>)}
          <button type="button" onClick={() => void confirmSignOut(t)}>{t('account.signOut')}</button>
          <p className="muted">{t('acct.localNote')}</p>
        </nav>
        <main className="account-content">
          {section === 'profile' && <ProfileSection />}
          {section === 'subscription' && <SubscriptionSection />}
          {section === 'plans' && <PlansSection />}
          {section === 'billing' && <BillingSection />}
        </main>
      </div>
    </div>
  );
}

const Card = ({ title, children }: { title: string; children: ReactNode }) => <section className="account-card"><h3>{title}</h3>{children}</section>;
const errorKey = (e: unknown) => `acct.errors.${e instanceof AccountError ? e.code : 'unknown'}` as const;

// ---------------------------------------------------------------- profile
function ProfileSection() {
  const t = useT();
  const language = useLanguage();
  const user = useStore(authStore, (s) => s.user);
  const profile = useStore(accountStore, (s) => s.profile);
  const [name, setName] = useState(profile?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [deletion, reloadDeletion] = useAccountData<DeletionStatus>(getDeletionStatus);
  const setCloudOpen = useAccountUi((s) => s.setCloudOpen);
  useEffect(() => { setName(profile?.displayName ?? ''); }, [profile?.displayName]);

  const saveName = async () => {
    setBusy(true);
    try { await accountStore.getState().saveName(name); notify(t('acct.profile.saved')); }
    catch (e) { notify(t(errorKey(e))); }
    finally { setBusy(false); }
  };
  const requestDeletion = async () => {
    if (!await confirmDialog(t('acct.profile.deleteConfirm'), { destructive: true, confirmLabel: t('acct.profile.deleteRequest') })) return;
    try { await withClient(requestAccountDeletion); reloadDeletion(); notify(t('acct.profile.deleteRequested')); } catch (e) { notify(t(errorKey(e))); }
  };
  const cancelDeletion = async () => {
    try { await withClient(cancelAccountDeletion); reloadDeletion(); notify(t('acct.profile.deleteCancelled')); } catch (e) { notify(t(errorKey(e))); }
  };
  return (
    <>
      <h2>{t('acct.profile.title')}</h2>
      <Card title={t('acct.profile.title')}>
        <form onSubmit={(e) => { e.preventDefault(); void saveName(); }}>
          <label>{t('acct.profile.name')}<input className="app-dialog-input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>{t('acct.profile.email')}<input className="app-dialog-input" value={user?.email ?? ''} readOnly dir="ltr" /></label>
          <button type="submit" className="btn-primary" disabled={busy || !name.trim() || name.trim() === (profile?.displayName ?? '')}>{t('acct.profile.save')}</button>
        </form>
      </Card>
      <Card title={t('acct.profile.signIn')}><p>{t('acct.profile.signInInfo')}</p></Card>
      <Card title={t('acct.profile.preferences')}>
        <div className="account-row"><span>{t('acct.profile.language')}</span><LanguageSwitch /></div>
      </Card>
      <Card title={t('acct.profile.data')}>
        <p>{t('acct.profile.dataInfo')}</p>
        <button type="button" className="btn-secondary" onClick={() => setCloudOpen(true)}>{t('acct.menuCloud')}</button>
        <p className="muted">
          {profile?.termsAcceptedAt
            ? t('acct.profile.consent', { version: profile.termsVersion ?? '', date: formatDate(profile.termsAcceptedAt, language) })
            : t('acct.profile.noConsent')}
        </p>
      </Card>
      <Card title={t('acct.profile.deleteTitle')}>
        <p>{t('acct.profile.deleteInfo')}</p>
        {deletion === 'requested' && <><p role="status">{t('acct.profile.deleteRequested')}</p><button type="button" className="btn-secondary" onClick={() => void cancelDeletion()}>{t('acct.profile.deleteCancel')}</button></>}
        {deletion === 'processing' && <p role="status">{t('acct.profile.deleteProcessing')}</p>}
        {(deletion === null || deletion === 'cancelled') && <button type="button" className="btn-danger" onClick={() => void requestDeletion()}>{t('acct.profile.deleteRequest')}</button>}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- subscription and credits
const AI_KIND_KEY: Record<string, string> = { space_detection: 'Space detection', openings_detection: 'Door & window detection', multi_plan: 'Multi-plan AI', revision_detection: 'Revision detection' };

function SubscriptionSection() {
  const t = useT();
  const language = useLanguage();
  const overview = useStore(accountStore, (s) => s.overview);
  const [usage] = useAccountData<AiUsageRow[]>((c) => listAiUsage(c));
  const sub = overview?.subscription;
  return (
    <>
      <h2>{t('acct.subscription.title')}</h2>
      <p className="soon-note" role="status"><SoonBadge /> {t('acct.subscription.aiSoon')}</p>
      <Card title={t('acct.subscription.planTitle')}>
        {sub ? (
          <>
            <p><strong>{sub.planCode}</strong> · {sub.status}</p>
            {sub.periodEnd && <p className="muted">{t('acct.subscription.renews', { date: formatDate(sub.periodEnd, language) })}</p>}
          </>
        ) : <p>{t('acct.subscription.noPlan')}</p>}
      </Card>
      <Card title={t('acct.subscription.credits')}>
        <div className="account-row"><span>{t('acct.subscription.monthly')}</span><strong>{overview?.monthlyCredits ?? 0}</strong></div>
        <div className="account-row"><span>{t('acct.subscription.purchased')}</span><strong>{overview?.purchasedCredits ?? 0}</strong></div>
        <p className="muted">{t('acct.subscription.monthlyNote')}</p>
        <button type="button" className="btn-secondary" disabled>{t('acct.subscription.buy')} · {t('acct.comingSoon')}</button>
      </Card>
      <Card title={t('acct.subscription.history')}>
        {!usage?.length ? <p className="muted">{t('acct.subscription.noHistory')}</p> : (
          <table className="account-table">
            <thead><tr><th>{t('acct.subscription.colDate')}</th><th>{t('acct.subscription.colAction')}</th><th>{t('acct.subscription.colPages')}</th><th>{t('acct.subscription.colCredits')}</th><th>{t('acct.subscription.colStatus')}</th></tr></thead>
            <tbody>{usage.map((u) => <tr key={u.id}><td>{formatDate(u.createdAt, language)}</td><td>{AI_KIND_KEY[u.kind] ?? u.kind}{u.label ? ` · ${u.label}` : ''}</td><td>{u.pages}</td><td>{u.creditsCharged}</td><td>{u.status}</td></tr>)}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- plans
function PlansSection() {
  const t = useT();
  const language = useLanguage();
  const [plans] = useAccountData<PlanSummary[]>(listPublicPlans);
  const Check = () => <span aria-label="✓">✓</span>;
  return (
    <>
      <h2>{t('acct.plans.title')}</h2>
      {!plans?.length && <p className="soon-note" role="status"><SoonBadge /> {t('acct.plans.soon')}</p>}
      <Card title={t('acct.plans.free')}>
        <table className="account-table">
          <thead><tr><th /><th>{t('acct.plans.guestCol')}</th><th>{t('acct.plans.accountCol')}</th><th>{t('acct.plans.subscriberCol')}</th></tr></thead>
          <tbody>
            <tr><td>{t('acct.plans.free')}</td><td><Check /></td><td><Check /></td><td><Check /></td></tr>
            <tr><td>{t('acct.plans.cloud')}</td><td>—</td><td>—</td><td><Check /></td></tr>
            <tr><td>{t('acct.plans.ai')}</td><td colSpan={3}><SoonBadge /></td></tr>
          </tbody>
        </table>
        <p className="muted">{t('acct.plans.freeNote')}</p>
      </Card>
      {plans?.map((p) => (
        <Card key={p.code} title={language === 'he' ? p.nameHe : p.nameEn}>
          <p>{(language === 'he' ? p.descriptionHe : p.descriptionEn) ?? ''}</p>
          <p className="muted">{p.monthlyCredits > 0 && t('acct.plans.credits', { count: p.monthlyCredits })} {t('acct.plans.storage', { size: `${toMegabytes(p.storageQuotaBytes)} MB` })}</p>
          <button type="button" className="btn-primary" disabled>{t('acct.comingSoon')}</button>
        </Card>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- billing
function BillingSection() {
  const t = useT();
  const language = useLanguage();
  const user = useStore(authStore, (s) => s.user);
  const [saved] = useAccountData<BillingProfile>(getBillingProfile);
  const [payments] = useAccountData<PaymentRow[]>((c) => listPayments(c));
  const [form, setForm] = useState<BillingProfile>(EMPTY_BILLING);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (saved) setForm(saved); }, [saved]);
  const set = (key: keyof BillingProfile) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const save = async () => {
    if (!user) return;
    setBusy(true);
    try { await withClient((c) => saveBillingProfile(c, user.id, form)); notify(t('acct.billing.saved')); }
    catch (e) { notify(t(errorKey(e))); }
    finally { setBusy(false); }
  };
  return (
    <>
      <h2>{t('acct.billing.title')}</h2>
      <Card title={t('acct.billing.method')}><p className="soon-note"><SoonBadge /> {t('acct.billing.methodSoon')}</p></Card>
      <Card title={t('acct.billing.invoice')}>
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label>{t('acct.billing.invoiceName')}<input className="app-dialog-input" maxLength={200} value={form.invoiceName} onChange={set('invoiceName')} /></label>
          <label>{t('acct.billing.taxId')}<input className="app-dialog-input" maxLength={40} dir="ltr" value={form.taxId} onChange={set('taxId')} /></label>
          <label>{t('acct.billing.address')}<input className="app-dialog-input" maxLength={200} value={form.addressLine} onChange={set('addressLine')} /></label>
          <label>{t('acct.billing.city')}<input className="app-dialog-input" maxLength={100} value={form.city} onChange={set('city')} /></label>
          <label>{t('acct.billing.postal')}<input className="app-dialog-input" maxLength={20} dir="ltr" value={form.postalCode} onChange={set('postalCode')} /></label>
          <button type="submit" className="btn-primary" disabled={busy}>{t('acct.billing.save')}</button>
        </form>
      </Card>
      <Card title={t('acct.billing.history')}>
        {!payments?.length ? <p className="muted">{t('acct.billing.noHistory')}</p> : (
          <table className="account-table">
            <tbody>{payments.map((p) => <tr key={p.id}><td>{formatDate(p.createdAt, language)}</td><td>{p.description ?? ''}</td><td>{(p.amountMinor / 100).toFixed(2)} {p.currency}</td><td>{p.status}</td>
              <td>{p.invoiceUrl && <a href={p.invoiceUrl} target="_blank" rel="noopener noreferrer">{t('acct.billing.download')}</a>}</td></tr>)}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}

/** Cloud backup opened from the menu or the profile page. */
export function CloudBackupHost() {
  const open = useAccountUi((s) => s.cloudOpen);
  const setOpen = useAccountUi((s) => s.setCloudOpen);
  const status = useStore(authStore, (s) => s.status);
  if (!ACCOUNTS_ENABLED || !open || status !== 'signedIn') return null;
  return <CloudBackupDialog onClose={() => setOpen(false)} />;
}
