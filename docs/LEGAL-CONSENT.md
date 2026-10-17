# Early Access consent implementation

The document version remains `pending`. This change does not finalize the draft
Terms or Privacy Policy and does not enable any commercial or AI capability.

- Both authentication modes require an unchecked agreement before Google OAuth
  (or the existing email-code request). Authentication itself is unchanged.
- An explicit pre-OAuth agreement carries its displayed document version and time
  in session storage. After authentication, the account RPC records that acceptance
  before access, including for existing accounts. Only receipts under one hour old
  matching both the displayed and server versions are reused; legacy boolean
  markers are ignored. Storage failures fall back to explicit onboarding.
- Accounts without complete acceptance evidence or a valid OAuth receipt must
  explicitly submit non-dismissible onboarding. Signing out remains available.
- The service gate requires legal acceptance, independently of network availability.
  Previously server-verified acceptance is retained in memory and in a user- and
  document-specific local cache for reloads. A temporary account failure does not
  revoke that evidence or unmount local projects. Without verified account evidence,
  the user can explicitly acknowledge local use; this never marks the account as
  registered or its consent as verified. Guest use also requires that acknowledgement.
- Returning to the app can refresh account state at most once per minute, with no
  automatic retries after failure. Overlapping loads share one request; auth changes
  invalidate old responses. Credit/catalogue failures do not invalidate legal verification.
  A server/client document-version mismatch
  blocks acceptance and asks for a reload; the app never records consent to text
  that this build does not display. Trial and authentication policies are unchanged.
- Guest acknowledgements append to `bettercalc.guestAckHistory` in local storage,
  preserving the old single record. If storage is blocked, acceptance lasts only
  for the current page; historical persistence cannot be guaranteed in that mode.

## Database prerequisite — not deployed by this change

Apply `20261023000000_early_access_legal_consent.sql` through the normal deployment
process before releasing the client. It adds owner-readable, API-immutable
`legal_consents` history and updates the existing acceptance RPC transactionally.
Each acceptance records the exact shared Terms/Privacy version and fresh server
timestamps. The latest profile timestamps are updated as well; original
onboarding completion time stays intact. Deleting the account also deletes its
consent history, consistent with the existing account deletion flow.

The migration copies the legacy evidence that exists, preserving null/unknown
versions and timestamps as unknown. Records already overwritten before migration
cannot be reconstructed. Future published document versions must be immutable and
their text retained with the corresponding release. Publish matching document and
server versions together once the legal drafts are complete.

Invoice fields are not mounted or fetched while payments are disabled. The API
refuses saves, and database row policies reject inserts/updates while the payment
flag is off. Existing invoice rows remain stored and owner-readable. No commercial
flags, credit balances or entitlements are changed.
