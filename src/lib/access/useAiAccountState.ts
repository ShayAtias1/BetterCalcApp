import { useStore } from 'zustand';
import { authStore } from '../../store/authStore';
import { accountStore } from '../../store/accountStore';
import { ACCOUNTS_ENABLED } from './accessPolicy';
import { aiAccountState, type AiAccountState } from './aiAccountState';

/** The signed-in state AI controls present themselves by (guest, free, subscribed). Presentation only. */
export function useAiAccountState(): { accountState: AiAccountState; credits: number } {
  const authStatus = useStore(authStore, (s) => s.status);
  const overview = useStore(accountStore, (s) => s.overview);
  const credits = (overview?.monthlyCredits ?? 0) + (overview?.purchasedCredits ?? 0);
  const accountState = aiAccountState({ accountsAvailable: ACCOUNTS_ENABLED && authStatus !== 'unconfigured', auth: authStatus, subscription: overview?.subscription ? { status: overview.subscription.status } : null, credits });
  return { accountState, credits };
}
