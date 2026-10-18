import type { AuthStatus } from '../../store/authStore';
import type { CommercialFlags, Profile } from '../account/accountApi';
import { LEGAL_DOC_VERSION } from '../legal/legalDocs';
import { hasAcceptedCurrentTerms } from '../../store/accountStore';
import { guestNeedsAck, type GuestAck } from './guestAck';

/** Legal acceptance is independent of the existing trial and manual-tool entitlement policy. */
export function legalAccessState(input: {
  accountsEnabled: boolean; authStatus: AuthStatus; welcomeSeen: boolean; ack: GuestAck | null;
  profile: Profile | null; flags: CommercialFlags; loading: boolean; loadFailed: boolean;
}, documentVersion = LEGAL_DOC_VERSION, development?: { enabled: boolean; hostname: string }): 'ready' | 'welcome' | 'guest' | 'account' | 'wait' | 'local' | 'local-consent' | 'version-mismatch' {
  if (input.accountsEnabled && input.authStatus === 'loading') return 'wait';
  if (input.accountsEnabled && input.authStatus === 'signedIn') {
    if ((input.flags.legalVersion ?? 'pending') !== documentVersion) {
      // Preview unpublished documents on the local Vite server without claiming account acceptance.
      // Production builds and non-loopback hosts retain the mandatory server-version check.
      if (development?.enabled && ['localhost', '127.0.0.1', '[::1]'].includes(development.hostname)) {
        return input.ack?.version === documentVersion ? 'local' : 'local-consent';
      }
      return 'version-mismatch';
    }
    if (hasAcceptedCurrentTerms(input.profile, input.flags, documentVersion)) return 'ready';
    // A network failure is not evidence of rejection. Keep account consent unknown,
    // and allow only explicitly acknowledged local use until verification recovers.
    if (input.loadFailed) return input.ack?.version === documentVersion ? 'local' : 'local-consent';
    if (input.loading || !input.profile) return 'wait';
    return 'account';
  }
  if (input.accountsEnabled && input.authStatus === 'signedOut' && !input.welcomeSeen) return 'welcome';
  return guestNeedsAck({ ...input, version: documentVersion }) ? 'guest' : 'ready';
}
