/**
 * Provider-independent payment architecture. The app and the database speak only these shapes; a concrete
 * provider (Cardcom, PayPlus or another, not chosen yet) is an adapter that implements them. No provider is
 * wired, so every function below fails closed.
 *
 * Browser side: `PaymentProvider` starts a checkout or opens the provider's customer page. It never sees card
 * data: the provider hosts the form. Server side (not part of the web bundle): a webhook handler verifies the
 * provider's signature, turns the payload into a `NormalizedBillingEvent`, records it with
 * `record_payment_event` (idempotent) and applies it with `apply_subscription_state` and the credit
 * functions, all of which refuse to run while `payments_enabled` / `credit_purchases_enabled` are off.
 */
export interface CheckoutRequest {
  kind: 'subscription' | 'credit_pack';
  /** plans.code or credit_packs.code */
  productCode: string;
  interval?: 'month' | 'year';
  returnUrl: string;
}

export interface PaymentProvider {
  readonly id: string;
  /** Returns the URL of the provider-hosted checkout page. */
  createCheckout(request: CheckoutRequest): Promise<{ url: string }>;
  /** Returns the URL of the provider-hosted page to update the payment method or cancel. */
  openCustomerPortal(returnUrl: string): Promise<{ url: string }>;
}

export class PaymentsUnavailableError extends Error {
  constructor() {
    super('payments are not available');
    this.name = 'PaymentsUnavailableError';
  }
}

/** The only provider until one is chosen. */
export const unavailablePaymentProvider: PaymentProvider = {
  id: 'none',
  createCheckout: () => Promise.reject(new PaymentsUnavailableError()),
  openCustomerPortal: () => Promise.reject(new PaymentsUnavailableError()),
};

/** Payments run only when the server switch is on AND a provider has been registered. */
let registered: PaymentProvider | null = null;
export function registerPaymentProvider(provider: PaymentProvider | null): void {
  registered = provider;
}
export function getPaymentProvider(paymentsEnabled: boolean): PaymentProvider {
  return paymentsEnabled && registered ? registered : unavailablePaymentProvider;
}

// ---------------------------------------------------------------- the normalized events a server adapter produces
export type NormalizedBillingEvent =
  | { type: 'subscription.updated'; eventRef: string; userId: string; planCode: string; status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'ended';
      interval: 'month' | 'year'; customerRef: string | null; subscriptionRef: string; periodStart: string | null; periodEnd: string | null; cancelAtPeriodEnd: boolean }
  | { type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded'; eventRef: string; userId: string; paymentRef: string; kind: 'subscription' | 'credit_pack';
      amountMinor: number; currency: string; creditPackCode?: string; invoiceNumber?: string; invoiceUrl?: string };

/** The database call that applies a subscription event (service role only). */
export function subscriptionRpcArgs(provider: string, e: Extract<NormalizedBillingEvent, { type: 'subscription.updated' }>) {
  return {
    p_user: e.userId, p_plan: e.planCode, p_status: e.status, p_interval: e.interval, p_provider: provider,
    p_customer_ref: e.customerRef, p_subscription_ref: e.subscriptionRef, p_period_start: e.periodStart, p_period_end: e.periodEnd,
    p_cancel_at_period_end: e.cancelAtPeriodEnd,
  };
}
