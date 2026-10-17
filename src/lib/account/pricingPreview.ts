/** Display-only configuration. Never use these values for entitlements or billing. */
export const PREVIEW_PLANS = [
  { code: 'free', name: 'Free', monthlyCredits: 0, prices: { USD: 0, ILS: 0 } },
  { code: 'starter', name: 'Starter', monthlyCredits: 80, prices: { USD: 15, ILS: 46 } },
  { code: 'pro', name: 'Pro', monthlyCredits: 240, prices: { USD: 35, ILS: 108 } },
  { code: 'business', name: 'Business', monthlyCredits: 540, prices: { USD: 75, ILS: 232 } },
] as const;

/** Explicit preview values; no runtime currency conversion. */
export function previewCurrency(language: 'he' | 'en') {
  return language === 'he' ? { code: 'ILS', symbol: '₪' } as const : { code: 'USD', symbol: '$' } as const;
}
