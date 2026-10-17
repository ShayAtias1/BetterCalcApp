import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { formatDate, useLanguage, useT } from '../i18n';
import { authStore } from '../store/authStore';
import { accountStore, LEGAL_VERSION_PENDING } from '../store/accountStore';
import { useAccountUi, type AccountSection } from '../store/accountUi';
import { ACCOUNTS_ENABLED } from '../lib/access/accessPolicy';
import { getSupabase } from '../lib/supabase/client';
import {
  AccountError, cancelAccountDeletion, planName, EMPTY_BILLING, getBillingProfile, getDeletionStatus, listAiUsage, listPayments,
  requestAccountDeletion, saveBillingProfile, type AccountClient, type AiUsageRow, type BillingProfile, type DeletionStatus, type PaymentRow,
} from '../lib/account/accountApi';
import PricingPreview from './PricingPreview';
import { confirmDialog, notify } from '../lib/appDialogs';
import LanguageSwitch from './LanguageSwitch';
import BrandLogo from './BrandLogo';
import Icon from './Icon';
import CloudBackupDialog from './CloudBackupDialog';
import AccountMenu, { confirmSignOut, useAccountIdentity } from './AccountMenu';
import './Account.css';
import Select from './Select';

const SECTIONS: AccountSection[] = ['profile', 'subscription', 'plans', 'billing'];
const SECTION_LABEL: Record<AccountSection, 'menuProfile' | 'menuSubscription' | 'menuPlans' | 'menuBilling'> = {
  profile: 'menuProfile', subscription: 'menuSubscription', plans: 'menuPlans', billing: 'menuBilling',
};

/** Runs `load` with the Supabase client once; returns the result, or null while loading / when unavailable. */
function useAccountData<T>(load: (client: AccountClient) => Promise<T>): [T | null, () => void, boolean] {
  const [value, setValue] = useState<T | null>(null);
  const [settled, setSettled] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const client = (await getSupabase()) as AccountClient | null;
        if (client) { const v = await load(client); if (alive) setValue(v); }
      } catch { /* offline or not allowed: the section shows its empty state */ }
      if (alive) setSettled(true);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  return [value, () => setTick((n) => n + 1), settled];
}

async function withClient<T>(run: (client: AccountClient) => Promise<T>): Promise<T | null> {
  const client = (await getSupabase()) as AccountClient | null;
  return client ? run(client) : null;
}

const SoonBadge = () => <span className="soon-badge">{useT()('acct.soon')}</span>;
const Card = ({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) => (
  <section className="acct-card"><h2>{title}{aside}</h2>{children}</section>
);
const errorKey = (e: unknown) => `acct.errors.${e instanceof AccountError ? e.code : 'unknown'}` as const;

/** Full-screen account area: profile, subscription & credits, plans, billing. Opens over the app; closing returns to the same place. */
export default function AccountPage() {
  const t = useT();
  const open = useAccountUi((s) => s.pageOpen);
  const section = useAccountUi((s) => s.section);
  const openPage = useAccountUi((s) => s.openPage);
  const close = useAccountUi((s) => s.closePage);
  const status = useStore(authStore, (s) => s.status);
  const language = useLanguage();
  const publicPreview = section === 'plans';
  const { name, email, initials } = useAccountIdentity();
  useEffect(() => { if (open && status !== 'signedIn' && !publicPreview) close(); }, [open, status, publicPreview, close]);
  // Keep the current section visible in the phone's scrolling tab strip.
  useEffect(() => { if (open) document.querySelector('.account-nav-btn.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }, [open, section]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);
  if (!ACCOUNTS_ENABLED || !open || (status !== 'signedIn' && !publicPreview)) return null;
  return (
    <div className="account-page" dir={language === 'he' ? 'rtl' : 'ltr'} role="dialog" aria-modal="true" aria-label={t('acct.pageTitle')}>
      <header className="account-page-bar">
        <button type="button" className="app-brand app-brand-link" onClick={close} aria-label={t('acct.back')} title={t('acct.back')}><BrandLogo responsive /></button>
        {/* The same "Projects" control as the project screens: ghost button, exit icon, regular text colour. */}
        <nav className="account-crumbs" aria-label="breadcrumb">
          <button type="button" className="btn-ghost small account-back" onClick={close} title={t('projectOverview.backToProjects')}>
            <Icon name="exit" />
            <span className="btn-label">{t('acct.crumbProjects')}</span>
          </button>
          <span aria-hidden="true" className="account-crumb-sep">/</span>
          <strong>{t(`acct.${SECTION_LABEL[section]}`)}</strong>
        </nav>
        <span className="grow" />
        <LanguageSwitch />
        <AccountMenu />
      </header>
      <div className={`account-page-body${status !== 'signedIn' ? ' pricing-guest-body' : ''}`}>
        {status === 'signedIn' && (
          <nav className="account-side" aria-label={t('acct.pageTitle')}>
            <div className="account-side-identity">
              <span className="account-avatar large" aria-hidden="true">{initials}</span>
              <span>{name && <strong><bdi>{name}</bdi></strong>}<span className="muted" dir="ltr">{email}</span></span>
            </div>
            {SECTIONS.map((s) => (
              <button key={s} type="button" aria-current={section === s ? 'page' : undefined} className={`account-nav-btn${section === s ? ' active' : ''}`} onClick={() => openPage(s)}>
                {t(`acct.${SECTION_LABEL[s]}`)}
              </button>
            ))}
            <hr />
            <button type="button" className="account-nav-btn danger" onClick={() => void confirmSignOut(t)}>{t('account.signOut')}</button>
          </nav>
        )}
        <main className="account-main">
          {section === 'profile' && <ProfileSection />}
          {section === 'subscription' && <SubscriptionSection />}
          {section === 'plans' && <PricingPreview />}
          {section === 'billing' && <BillingSection />}
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- shared summary of the (not yet available) plan
function PlanSummaryCard({ withShortcuts = false }: { withShortcuts?: boolean }) {
  const t = useT();
  const language = useLanguage();
  const openPage = useAccountUi((s) => s.openPage);
  const overview = useStore(accountStore, (s) => s.overview);
  const plans = useStore(accountStore, (s) => s.plans);
  const sub = overview?.subscription;
  return (
    <div className="account-stack">
      <Card title={t('acct.subscription.planTitle')} aside={<span className={`acct-status${sub ? ' on' : ''}`}>{sub ? t('acct.active') : t('acct.noPlanShort')}</span>}>
        <div className="acct-big">{sub ? planName(sub.planCode, plans, language) : t('acct.noPlanShort')}</div>
        {sub?.periodEnd && <p className="acct-note">{t('acct.subscription.renews', { date: formatDate(sub.periodEnd, language) })}</p>}
        <div className="acct-row"><strong>{t('acct.subscription.credits')}</strong><SoonBadge /></div>
        <div className="acct-row"><span>{t('acct.subscription.monthly')}</span><strong>{overview?.monthlyCredits ?? 0}</strong></div>
        <div className="acct-row"><span>{t('acct.subscription.purchased')}</span><strong>{overview?.purchasedCredits ?? 0}</strong></div>
        <div className="acct-actions">
          <button type="button" className="btn-primary" disabled title={t('acct.comingSoon')}>{t('acct.upgrade')}</button>
          <button type="button" className="btn-secondary" disabled title={t('acct.comingSoon')}>{t('acct.manage')}</button>
        </div>
      </Card>
      {withShortcuts && (
        <Card title={t('acct.shortcuts')}>
          <div className="acct-links">
            <button type="button" className="link-button" style={{ textAlign: 'start' }} onClick={() => openPage('subscription')}>{t('acct.linkHistory')}</button>
            <button type="button" className="link-button" style={{ textAlign: 'start' }} onClick={() => openPage('plans')}>{t('acct.linkPlans')}</button>
            <button type="button" className="link-button" style={{ textAlign: 'start' }} onClick={() => openPage('billing')}>{t('acct.linkBilling')}</button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- profile
function ProfileSection() {
  const t = useT();
  const language = useLanguage();
  const { email, initials, name: shownName } = useAccountIdentity();
  const profile = useStore(accountStore, (s) => s.profile);
  const [name, setName] = useState(profile?.displayName ?? shownName ?? '');
  const [busy, setBusy] = useState(false);
  const [deletion, reloadDeletion] = useAccountData<DeletionStatus>(getDeletionStatus);
  const setCloudOpen = useAccountUi((s) => s.setCloudOpen);
  useEffect(() => { setName(profile?.displayName ?? shownName ?? ''); }, [profile?.displayName, shownName]);

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
      <h1>{t('acct.profile.title')}</h1>
      <div className="account-grid">
        <div className="account-stack">
          <Card title={t('acct.profile.card')}>
            <form className="account-stack" onSubmit={(e) => { e.preventDefault(); void saveName(); }}>
              <div className="acct-profile-head"><span className="account-avatar large" aria-hidden="true">{initials}</span></div>
              <div className="acct-fields">
                <label className="auth-field">{t('acct.profile.name')}<input className="app-dialog-input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label>
                <label className="auth-field">{t('acct.profile.email')}<input className="app-dialog-input" value={email ?? ''} readOnly dir="ltr" /></label>
              </div>
              <div className="acct-actions"><button type="submit" className="btn-primary" disabled={busy || !profile || !name.trim() || name.trim() === (profile?.displayName ?? '')}>{t('acct.profile.save')}</button></div>
            </form>
          </Card>
          <Card title={t('acct.profile.preferences')}>
            <div className="acct-row"><span>{t('acct.profile.language')}</span><LanguageSwitch /></div>
          </Card>
          <Card title={t('acct.profile.data')}>
            <div className="acct-row"><span>{t('acct.profile.locationRow')}</span><span>{t('acct.profile.locationValue')}</span></div>
            <div className="acct-row"><span>{t('acct.profile.cloudRow')}</span><button type="button" className="btn-secondary" onClick={() => setCloudOpen(true)}>{t('acct.menuCloud')}</button></div>
            <p className="acct-note">{t('acct.profile.dataInfo')}</p>
            <p className="acct-note">
              {profile?.termsAcceptedAt
                ? (profile.termsVersion && profile.termsVersion !== LEGAL_VERSION_PENDING
                  ? t('acct.profile.consent', { version: profile.termsVersion, date: formatDate(profile.termsAcceptedAt, language) })
                  : t('acct.profile.consentNoVersion', { date: formatDate(profile.termsAcceptedAt, language) }))
                : t('acct.profile.noConsent')}
            </p>
            <p className="acct-note acct-legal-links">
              <a href="/terms" target="_blank" rel="noopener noreferrer">{t('acct.terms')}</a>{' · '}
              <a href="/privacy" target="_blank" rel="noopener noreferrer">{t('acct.privacy')}</a>
            </p>
          </Card>
          <Card title={t('acct.profile.deleteTitle')}>
            <div className="acct-row">
              <span>{t('acct.profile.deleteRow')}<br /><span className="acct-note">{t('acct.profile.deleteRowNote')}</span></span>
              {deletion === 'requested' ? <button type="button" className="btn-secondary" onClick={() => void cancelDeletion()}>{t('acct.profile.deleteCancel')}</button>
                : deletion === 'processing' ? <span role="status">{t('acct.profile.deleteProcessing')}</span>
                : <button type="button" className="btn-outline-danger" onClick={() => void requestDeletion()}>{t('acct.profile.deleteRequest')}</button>}
            </div>
            {deletion === 'requested' && <p className="acct-note" role="status">{t('acct.profile.deleteRequested')}</p>}
          </Card>
        </div>
        <PlanSummaryCard withShortcuts />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- subscription and credits
const AI_KIND_LABEL: Record<string, 'kindSpaces' | 'kindOpenings' | 'kindMulti' | 'kindRevision'> = { space_detection: 'kindSpaces', openings_detection: 'kindOpenings', multi_plan: 'kindMulti', revision_detection: 'kindRevision' };
const AI_STATUS: Record<string, 'completed' | 'failed' | 'held' | 'cancelled'> = { completed: 'completed', failed: 'failed', held: 'held', cancelled: 'cancelled' };

function SubscriptionSection() {
  const t = useT();
  const language = useLanguage();
  const overview = useStore(accountStore, (s) => s.overview);
  const [usage] = useAccountData<AiUsageRow[]>((c) => listAiUsage(c));
  return (
    <>
      <h1>{t('acct.subscription.title')}</h1>
      <p className="acct-soon" role="status"><SoonBadge /><span>{t('acct.subscription.aiSoon')}</span></p>
      <div className="account-grid three">
        <PlanSummaryCard />
        <Card title={t('acct.subscription.remaining')}>
          <div className="acct-big">{(overview?.monthlyCredits ?? 0) + (overview?.purchasedCredits ?? 0)}</div>
          <div className="acct-row"><span>{t('acct.subscription.monthly')}</span><strong>{overview?.monthlyCredits ?? 0}</strong></div>
          <div className="acct-row"><span>{t('acct.subscription.purchased')}</span><strong>{overview?.purchasedCredits ?? 0}</strong></div>
          <p className="acct-note">{t('acct.subscription.monthlyNote')}</p>
          <button type="button" className="btn-secondary" disabled>{t('acct.subscription.buy')} · {t('acct.comingSoon')}</button>
        </Card>
        <Card title={t('acct.subscription.costTitle')}>
          {(['costSpaces', 'costOpenings', 'costMulti'] as const).map((k) => <div className="acct-row" key={k}><span>{t(`acct.subscription.${k}`)}</span><SoonBadge /></div>)}
          <p className="acct-note">{t('acct.subscription.costNote')}</p>
        </Card>
      </div>
      <Card title={t('acct.subscription.history')} aside={<Select className="acct-select" aria-label={t('acct.subscription.period')} defaultValue="current"><option value="current">{t('acct.subscription.period')}</option></Select>}>
        {!usage?.length ? <p className="acct-note">{t('acct.subscription.noHistory')}</p> : (
          <div className="acct-table-wrap">
            <table className="acct-table">
              <thead><tr><th>{t('acct.subscription.colDate')}</th><th>{t('acct.subscription.colAction')}</th><th>{t('acct.subscription.colPages')}</th><th>{t('acct.subscription.colCredits')}</th><th>{t('acct.subscription.colStatus')}</th></tr></thead>
              <tbody>{usage.map((u) => <tr key={u.id}><td>{formatDate(u.createdAt, language)}</td><td>{AI_KIND_LABEL[u.kind] ? t(`acct.subscription.${AI_KIND_LABEL[u.kind]}`) : u.kind}{u.label ? ` · ${u.label}` : ''}</td><td>{u.pages}</td><td>{u.creditsCharged}</td><td>{AI_STATUS[u.status] ? t(`acct.subscription.status.${AI_STATUS[u.status]}`) : u.status}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        <p className="acct-note">{t('acct.subscription.usageNote')}</p>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- billing
const PAYMENT_STATUS: Record<string, 'paid' | 'failed' | 'pending' | 'refunded'> = { paid: 'paid', failed: 'failed', pending: 'pending', refunded: 'refunded' };

function BillingSection() {
  const t = useT();
  const language = useLanguage();
  const user = useStore(authStore, (s) => s.user);
  const [saved, , loaded] = useAccountData<BillingProfile>(getBillingProfile);
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
      <h1>{t('acct.billing.title')}</h1>
      <div className="account-grid three">
        <Card title={t('acct.billing.method')}>
          <p className="acct-soon"><SoonBadge /><span>{t('acct.billing.methodSoon')}</span></p>
          <button type="button" className="btn-secondary" disabled>{t('acct.billing.update')}</button>
        </Card>
        <Card title={t('acct.billing.next')}>
          <div className="acct-big">—</div>
          <p className="acct-note">{t('acct.billing.nextNone')}</p>
          <div className="acct-actions">
            <button type="button" className="btn-secondary" disabled>{t('acct.billing.changePlan')}</button>
            <button type="button" className="btn-outline-danger" disabled>{t('acct.billing.cancelAuto')}</button>
          </div>
        </Card>
        <Card title={t('acct.billing.invoice')}>
          <form className="account-stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <label className="auth-field">{t('acct.billing.invoiceName')}<input className="app-dialog-input" disabled={!loaded} maxLength={200} value={form.invoiceName} onChange={set('invoiceName')} /></label>
            <label className="auth-field">{t('acct.billing.taxId')}<input className="app-dialog-input" disabled={!loaded} maxLength={40} dir="ltr" value={form.taxId} onChange={set('taxId')} /></label>
            <label className="auth-field">{t('acct.billing.address')}<input className="app-dialog-input" disabled={!loaded} maxLength={200} value={form.addressLine} onChange={set('addressLine')} /></label>
            <div className="acct-fields">
              <label className="auth-field">{t('acct.billing.city')}<input className="app-dialog-input" disabled={!loaded} maxLength={100} value={form.city} onChange={set('city')} /></label>
              <label className="auth-field">{t('acct.billing.postal')}<input className="app-dialog-input" disabled={!loaded} maxLength={20} dir="ltr" value={form.postalCode} onChange={set('postalCode')} /></label>
            </div>
            <div className="acct-actions"><button type="submit" className="btn-primary" disabled={busy || !loaded}>{t('acct.billing.save')}</button></div>
            <p className="acct-note">{t('acct.billing.invoiceNote')}</p>
          </form>
        </Card>
      </div>
      <Card title={t('acct.billing.history')}>
        {!payments?.length ? <p className="acct-note">{t('acct.billing.noHistory')}</p> : (
          <div className="acct-table-wrap">
            <table className="acct-table">
              <thead><tr><th>{t('acct.billing.colDate')}</th><th>{t('acct.billing.colDesc')}</th><th>{t('acct.billing.colAmount')}</th><th>{t('acct.billing.colStatus')}</th><th /></tr></thead>
              <tbody>{payments.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.createdAt, language)}</td><td>{p.description ?? ''}</td><td dir="ltr">{(p.amountMinor / 100).toFixed(2)} {p.currency}</td>
                  <td>{PAYMENT_STATUS[p.status] ? t(`acct.billing.${PAYMENT_STATUS[p.status]}`) : p.status}</td>
                  <td>{p.invoiceUrl && <a href={p.invoiceUrl} target="_blank" rel="noopener noreferrer">{t('acct.billing.download')}</a>}</td>
                </tr>))}</tbody>
            </table>
          </div>
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
