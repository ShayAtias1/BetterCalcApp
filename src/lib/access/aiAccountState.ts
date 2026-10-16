import type { AuthStatus } from '../../store/authStore';

/**
 * How the AI header button presents itself. Presentation only: no state here lets an AI action run, and none
 * of them touches credits or payments.
 * - guest: not signed in; the button is locked and explains that an account is needed.
 * - free: signed in without a subscription; the button opens the menu with locked actions.
 * - subscribed: an active subscription; pending suggestions show as a count.
 * - low-credits: subscribed and the balance is under the warning threshold; the balance shows on the button.
 */
export type AiAccountState = 'guest' | 'free' | 'subscribed' | 'low-credits';

/** Warning threshold for the credit chip. Not decided yet (the design marks it "TBD"), so the state never triggers. */
export const LOW_CREDIT_THRESHOLD: number | null = null;

const ACTIVE = new Set(['active', 'trialing']);

export function aiAccountState(input: {
  accountsAvailable: boolean;
  auth: AuthStatus;
  subscription: { status: string } | null;
  credits: number;
  lowThreshold?: number | null;
}): AiAccountState {
  const { accountsAvailable, auth, subscription, credits, lowThreshold = LOW_CREDIT_THRESHOLD } = input;
  // Without accounts (purely local build) there is no sign-in to ask for: behave like a signed-in free user.
  if (!accountsAvailable) return 'free';
  if (auth !== 'signedIn') return 'guest';
  if (!subscription || !ACTIVE.has(subscription.status)) return 'free';
  if (lowThreshold !== null && credits <= lowThreshold) return 'low-credits';
  return 'subscribed';
}
