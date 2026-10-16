import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Reads and the few writes a signed-in user may make on their own account, all through Supabase with the
 * publishable key: row-level security and the database functions decide what is allowed. Nothing here
 * touches local project data, and nothing here can grant credits, change a subscription or run AI.
 */
export type AccountClient = Pick<SupabaseClient, 'rpc' | 'from'>;

export type AccountErrorCode = 'invalid-name' | 'network' | 'unknown';
export class AccountError extends Error {
  readonly code: AccountErrorCode;
  constructor(code: AccountErrorCode, detail?: string) {
    super(detail ?? code);
    this.name = 'AccountError';
    this.code = code;
  }
}

function toAccountError(error: unknown): AccountError {
  if (error instanceof AccountError) return error;
  const { name, message, status } = (error ?? {}) as { name?: string; message?: string; status?: number };
  const text = message ?? '';
  if (name === 'TypeError' || status === 0 || /failed to fetch|network|load failed/i.test(text)) return new AccountError('network', text);
  if (/invalid_name|check constraint/i.test(text)) return new AccountError('invalid-name', text);
  return new AccountError('unknown', text);
}

async function guard<T>(call: () => PromiseLike<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw toAccountError(error);
  }
}
const unwrap = <T>(result: { data: T; error: unknown }): T => {
  if (result.error) throw result.error;
  return result.data;
};

// ---------------------------------------------------------------- name
export const NAME_MAX = 80;
/** A single-line display name: control characters collapse to spaces, edges are trimmed. Null when empty or too long. */
export function normalizeDisplayName(raw: string): string | null {
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return name.length >= 1 && name.length <= NAME_MAX ? name : null;
}
/** Up to two initials for the avatar; the email's first letter when there is no name. */
export function initialsOf(name: string | null, email: string | null): string {
  const words = (name ?? '').split(/\s+/).filter(Boolean);
  const letters = words.length ? (words.length === 1 ? [...words[0]].slice(0, 2) : [[...words[0]][0], [...words[words.length - 1]][0]]) : [...(email ?? '?')].slice(0, 1);
  return letters.join('').toUpperCase();
}

// ---------------------------------------------------------------- switches
export interface CommercialFlags {
  aiEnabled: boolean;
  paymentsEnabled: boolean;
  creditPurchasesEnabled: boolean;
  /** Version of the terms and privacy policy to accept; null until the texts are published. */
  legalVersion: string | null;
}
/** Everything off: what the app assumes whenever the flags cannot be read. */
export const FLAGS_OFF: CommercialFlags = { aiEnabled: false, paymentsEnabled: false, creditPurchasesEnabled: false, legalVersion: null };

export async function getCommercialFlags(client: AccountClient): Promise<CommercialFlags> {
  try {
    const { data, error } = await client.rpc('commercial_flags');
    if (error || !data) return FLAGS_OFF;
    const f = data as Record<string, unknown>;
    return {
      aiEnabled: f.ai_enabled === true,
      paymentsEnabled: f.payments_enabled === true,
      creditPurchasesEnabled: f.credit_purchases_enabled === true,
      legalVersion: typeof f.legal_version === 'string' ? f.legal_version : null,
    };
  } catch {
    return FLAGS_OFF;
  }
}

// ---------------------------------------------------------------- profile and onboarding
export interface Profile {
  displayName: string | null;
  locale: 'he' | 'en' | null;
  termsVersion: string | null;
  termsAcceptedAt: number | null;
  onboardingCompleted: boolean;
}

const ms = (value: unknown) => (typeof value === 'string' ? Date.parse(value) : null);

export function getProfile(client: AccountClient): Promise<Profile | null> {
  return guard(async () => {
    const row = unwrap(await client.from('profiles').select('display_name, locale, terms_version, terms_accepted_at, onboarding_completed_at').maybeSingle()) as Record<string, unknown> | null;
    if (!row) return null;
    return {
      displayName: (row.display_name as string | null) ?? null,
      locale: row.locale === 'he' || row.locale === 'en' ? row.locale : null,
      termsVersion: (row.terms_version as string | null) ?? null,
      termsAcceptedAt: ms(row.terms_accepted_at),
      onboardingCompleted: row.onboarding_completed_at != null,
    };
  });
}

export function completeOnboarding(client: AccountClient, rawName: string, legalVersion: string): Promise<void> {
  return guard(async () => {
    const name = normalizeDisplayName(rawName);
    if (!name) throw new AccountError('invalid-name');
    unwrap(await client.rpc('complete_onboarding', { p_name: name, p_legal_version: legalVersion }));
  });
}

export function updateDisplayName(client: AccountClient, userId: string, rawName: string): Promise<string> {
  return guard(async () => {
    const name = normalizeDisplayName(rawName);
    if (!name) throw new AccountError('invalid-name');
    unwrap(await client.from('profiles').update({ display_name: name }).eq('id', userId));
    return name;
  });
}

export function updateLocale(client: AccountClient, userId: string, locale: 'he' | 'en'): Promise<void> {
  return guard(async () => void unwrap(await client.from('profiles').update({ locale }).eq('id', userId)));
}

// ---------------------------------------------------------------- credits, subscription, usage
export interface AccountOverview {
  purchasedCredits: number;
  monthlyCredits: number;
  monthlyExpiresAt: number | null;
  subscription: { planCode: string; status: string; interval: string; periodEnd: number | null; cancelAtPeriodEnd: boolean } | null;
}

export function getAccountOverview(client: AccountClient): Promise<AccountOverview> {
  return guard(async () => {
    const o = unwrap(await client.rpc('account_overview')) as Record<string, any>;
    const sub = o.subscription;
    return {
      purchasedCredits: Number(o.purchased_credits ?? 0),
      monthlyCredits: Number(o.monthly_credits ?? 0),
      monthlyExpiresAt: ms(o.monthly_expires_at),
      subscription: sub ? { planCode: sub.plan_code, status: sub.status, interval: sub.billing_interval, periodEnd: ms(sub.current_period_end), cancelAtPeriodEnd: sub.cancel_at_period_end === true } : null,
    };
  });
}

export interface AiUsageRow { id: string; kind: string; status: string; pages: number; creditsCharged: number; label: string | null; createdAt: number }

export function listAiUsage(client: AccountClient, limit = 50): Promise<AiUsageRow[]> {
  return guard(async () => {
    const rows = unwrap(await client.from('ai_usage').select('id, kind, status, pages, credits_charged, context_label, created_at').order('created_at', { ascending: false }).limit(limit)) as Record<string, any>[] | null;
    return (rows ?? []).map((r) => ({ id: r.id, kind: r.kind, status: r.status, pages: Number(r.pages), creditsCharged: Number(r.credits_charged), label: r.context_label ?? null, createdAt: Date.parse(r.created_at) }));
  });
}

export interface PaymentRow { id: string; description: string | null; status: string; amountMinor: number; currency: string; invoiceUrl: string | null; createdAt: number }

export function listPayments(client: AccountClient, limit = 50): Promise<PaymentRow[]> {
  return guard(async () => {
    const rows = unwrap(await client.from('payments').select('id, description, status, amount_minor, currency, invoice_url, created_at').order('created_at', { ascending: false }).limit(limit)) as Record<string, any>[] | null;
    return (rows ?? []).map((r) => ({ id: r.id, description: r.description ?? null, status: r.status, amountMinor: Number(r.amount_minor), currency: r.currency, invoiceUrl: r.invoice_url ?? null, createdAt: Date.parse(r.created_at) }));
  });
}

// ---------------------------------------------------------------- catalogue (empty until plans are decided)
export interface PlanSummary { code: string; nameHe: string; nameEn: string; descriptionHe: string | null; descriptionEn: string | null; monthlyCredits: number; storageQuotaBytes: number }

export function listPublicPlans(client: AccountClient): Promise<PlanSummary[]> {
  return guard(async () => {
    const rows = unwrap(await client.from('plans').select('code, name_he, name_en, description_he, description_en, monthly_credits, storage_quota_bytes').order('sort_order', { ascending: true })) as Record<string, any>[] | null;
    return (rows ?? []).map((r) => ({ code: r.code, nameHe: r.name_he, nameEn: r.name_en, descriptionHe: r.description_he ?? null, descriptionEn: r.description_en ?? null, monthlyCredits: Number(r.monthly_credits), storageQuotaBytes: Number(r.storage_quota_bytes) }));
  });
}

/** A plan's display name in the given language; the plan code while the plan is not published (or not found). */
export function planName(code: string, plans: PlanSummary[], language: 'he' | 'en'): string {
  const plan = plans.find((p) => p.code === code);
  return plan ? (language === 'he' ? plan.nameHe : plan.nameEn) : code;
}

// ---------------------------------------------------------------- invoice details
export interface BillingProfile { invoiceName: string; taxId: string; addressLine: string; city: string; postalCode: string }
export const EMPTY_BILLING: BillingProfile = { invoiceName: '', taxId: '', addressLine: '', city: '', postalCode: '' };

export function getBillingProfile(client: AccountClient): Promise<BillingProfile> {
  return guard(async () => {
    const r = unwrap(await client.from('billing_profiles').select('invoice_name, tax_id, address_line, city, postal_code').maybeSingle()) as Record<string, string | null> | null;
    return r ? { invoiceName: r.invoice_name ?? '', taxId: r.tax_id ?? '', addressLine: r.address_line ?? '', city: r.city ?? '', postalCode: r.postal_code ?? '' } : EMPTY_BILLING;
  });
}

export function saveBillingProfile(client: AccountClient, userId: string, b: BillingProfile): Promise<void> {
  return guard(async () => {
    const orNull = (v: string) => v.trim() || null;
    const fields = { invoice_name: orNull(b.invoiceName), tax_id: orNull(b.taxId), address_line: orNull(b.addressLine), city: orNull(b.city), postal_code: orNull(b.postalCode) };
    // Update first, then insert if there was no row. An upsert would also try to rewrite user_id, which clients may not change.
    const updated = unwrap(await client.from('billing_profiles').update(fields).eq('user_id', userId).select('user_id')) as unknown[] | null;
    if (!updated?.length) unwrap(await client.from('billing_profiles').insert({ user_id: userId, ...fields }));
  });
}

// ---------------------------------------------------------------- account deletion
export type DeletionStatus = 'requested' | 'cancelled' | 'processing' | null;

export function getDeletionStatus(client: AccountClient): Promise<DeletionStatus> {
  return guard(async () => {
    const row = unwrap(await client.from('account_deletion_requests').select('status').maybeSingle()) as { status: DeletionStatus } | null;
    return row?.status ?? null;
  });
}
export const requestAccountDeletion = (client: AccountClient) => guard(async () => void unwrap(await client.rpc('request_account_deletion')));
export const cancelAccountDeletion = (client: AccountClient) => guard(async () => void unwrap(await client.rpc('cancel_account_deletion')));
