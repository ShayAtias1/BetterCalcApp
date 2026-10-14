# BetterCalc — pre-commercial architecture audit

Audited 2026-10-14 against `main` @ `550c8f2`. Research and planning only: no code, Supabase
resources, payment accounts or AI calls were created or made.

Evidence labels used throughout:

- **[CODE]** verified in this repository (file references given)
- **[DOCS]** verified in current official vendor documentation (sources at the end)
- **[ASSUMPTION]** reasoned estimate or unverified; needs confirmation
- **[DECISION]** a business choice this report does not make; listed in §11

---

## 1. Current architecture findings

### 1.1 Overall shape

| Area | Finding | Evidence |
| --- | --- | --- |
| Frontend | React 19 + Zustand SPA, Vite build, fully client-side takeoff, Compare, geometry, quantities and exports. | [CODE] `package.json`, `src/store/*` |
| Backend | One Node HTTP service (`server/ai-server.mjs`) that proxies AI calls to OpenAI. No other server. | [CODE] |
| Auth / sessions | None. No user concept anywhere. | [CODE] grep; roadmap agrees |
| Billing | None. | [CODE] |
| Analytics | PostHog, anonymous device id in `localStorage`, no `identify`, off in dev. | [CODE] `src/lib/analytics.ts:218-248` |
| Production AI route | The client calls relative `/ai/*`; only the **Vite dev proxy** forwards it (`vite.config.ts` → `127.0.0.1:4781`). A production build has no AI backend. | [CODE] `vite.config.ts`, `src/lib/ai/jobClient.ts` |

### 1.2 Local storage (IndexedDB `bettercalc-qto`, version 7) [CODE] `src/db/database.ts`

| Store | Key | Contents |
| --- | --- | --- |
| `takeoffProjects` | `id` | Folder: `name`, `planIds[]`, `comparisonIds[]`, timestamps |
| `projects` (historic name) | `id` | **Plan** document: pages/calibration, rooms, openings, measurements, markups, concrete/rebar, defaults, `projectId`, `updatedAt` |
| `pdfFiles` | `planId` | Plan PDF `Blob` |
| `comparisons` | `id` | Revision Compare document (revisions, alignment, markups, measurements) |
| `comparePdfFiles` | `${comparisonId}:original` / `:revision:${id}` | Compare PDF `Blob`s |
| `planVersions` | `id` | **Full plan snapshots** (`plan: unknown`) taken before revision apply/revert |
| `aiJobs`, `aiReviews`, `aiBatches`, `openingsAiJobs`, `openingsAiReviews` | `requestId` / `key` / `id` | AI job identities, reviews and batch state |

Observations:

- All IDs are client-generated UUIDs (or derived, e.g. `legacy-${planId}`). They are globally unique enough to become cloud IDs unchanged. **Reusable.**
- Every document carries `updatedAt` (ms), and `saveComparisonWithLinkedPlan` already does an optimistic `updatedAt` check inside a transaction. **The same pattern can drive cloud version checks.**
- Migrations are lazy, idempotent and tolerate legacy shapes. A cloud snapshot restored into an older/newer app version goes through the same path. **Reusable**, but the snapshot needs its own `schemaVersion`.
- `deletePlan` / `deleteProject` do **not** delete `planVersions` rows, which hold whole plan copies. They become orphans that consume local quota and would inflate any naive "back up everything" export. [CODE] `database.ts:172-189, 334-347`
- `deleteComparison` is several separate writes, not one transaction (low risk, but relevant to backup consistency).
- **No `navigator.storage.persist()` call** anywhere. Browser eviction can silently delete every project. Safari's tracking prevention can also clear script-writable storage for sites not used for some time. [CODE] grep; [DOCS] MDN / WebKit (exact Safari behaviour around `persist()` is inconsistently documented; see §2)
- **No project import/export file.** Exports are PDF/Excel reports only (`saveAs` in `src/lib/export*.ts`). A user who loses browser data today has **no way to recover** their projects. This is the largest existing product risk, and it gets worse once a 7-day guest flow pushes people to clear or switch browsers.
- PDF import: images are capped at 100 MB / 40 MP; **PDFs have no size limit**. [CODE] `planFileImport.ts`

### 1.3 Current AI request flow [CODE] `server/*.mjs`, `src/lib/ai/*`

```
Browser: render page with PDFium at 5500 px → 1 page PNG + 4 tiles (revision: up to N images)
   → (openings/revision) POST /ai/*-previews → server returns cost preview + previewId (10 min)
   → user consents → POST /ai/*-jobs {requestId, manifest, images[base64], consent}
Server: validate frozen manifest + PNG headers (≤20 MB/image, ≤40 MB total, ≤60 MB body)
   → idempotency by requestId (+ request digest) against JSON ledger
   → global caps: count ≤ AI_MAX_REQUESTS, Σcharges + reservation ≤ AI_SPEND_LIMIT_USD
   → append reservation to .ai-local/spending.json (atomic file rename) → 202
   → detached fetch to OpenAI Responses API (gpt-6.1-sol, store:false, 420 s timeout, 0 retries)
   → parse/validate strict JSON schema → job COMPLETED/FAILED in memory (1 h expiry)
   → settle: ledger charge := measured cost from provider usage (reservation stays if unknown)
   → revision results persisted to disk; other task results lost on restart (410)
Browser: polls job; stores job/review in IndexedDB; user reviews and approves.
```

**Good, reusable foundations:**

- The API key exists only in server env (`.env.ai.local`, gitignored). Nothing is `VITE_`-exposed. Provider errors are sanitised before reaching the client.
- Strict input validation, a frozen model/config, size limits and no automatic retries.
- Client-chosen `requestId` plus a content `requestDigest` give idempotent admission. Consent is bound to a server-issued preview and digest.
- Worst-case **reservation before execution, settlement from provider usage after**. This is conceptually the right credit model already.
- Per-request metering metadata (`ai-accounting.mjs`): tokens, cached/reasoning tokens, model, tier, latency, provider request id. No prompts or images are retained.
- Durable result persistence and a recovery endpoint for revision jobs.

**Why it is not safe for public access:**

| Gap | Consequence if exposed publicly |
| --- | --- |
| No authentication. The checks are `Host` ∈ {localhost}, an `Origin` allowlist and an `X-BetterCalc-AI: 1` header. | These are CSRF/DNS-rebinding guards, not auth. Any script or curl can spoof them, and anyone could spend the OpenAI key. |
| Ledger is a single JSON file with **global**, lifetime caps (default 20 requests / $20, never reset). | No per-user balance. One user exhausts everyone's capacity. Not safe across processes or instances. |
| `active` flag: **one inference globally** at a time. | Second user gets 409. No queue, no fairness. |
| Jobs live in process memory; detached `run()` survives only in a long-lived process. | Deploys/restarts lose in-flight jobs (only revision results are persisted). Cannot run on short-lived serverless. |
| Room-detection jobs (`/ai/space-jobs`) have no consent/preview step. | The flow differs per task; the cost preview isn't uniform. |
| No rate limiting per caller or IP; 60 MB bodies accepted. | Bandwidth/memory exhaustion is easy. |
| The settled charge is in USD only; the ledger mixes provider cost and "charge". | No separation between provider cost and customer price. |
| Worst-case reservation is ≈ **$5.61** per spaces/openings request (1.05 M input tokens at the long-context rate + max output) against a ≤ $1/page mean target. | If customers must hold the reservation in credits, the entry threshold is ~5× the real price. **[DECISION]** |

### 1.4 What to reuse vs change

| Keep as is | Adapt | Add |
| --- | --- | --- |
| Geometry, calculations, viewers, exports, IndexedDB working store, lazy migrations, UUID ids | AI service: auth, per-user ledger in Postgres, durable job table, deployment target | Supabase Auth + minimal schema |
| AI preparation, validation, frozen configs, prompts, schemas, consent/preview, accounting metadata | `jobClient` / `openingsClient` transport: base URL + bearer token | Local project export/import file and `persist()` |
| Analytics privacy rules | Delete paths: also remove orphaned `planVersions` | Cloud snapshot backup/restore |
| | | Payment webhooks → entitlements |

No viewer, store or calculation rewrite is needed. All new work sits at the persistence boundary (`database.ts`), the AI transport boundary (`jobClient.ts`, `openingsClient.ts`, revision clients) and a new account UI.

---

## 2. Critical technical risks (ranked)

1. **Public AI endpoint without auth/credits** (§1.3). Direct financial loss. A blocker for any public AI exposure.
2. **Silent local data loss.** There is no `persist()`, no export file, and Safari/ITP and storage-pressure eviction exist. Once people pay, "my projects disappeared" becomes a refund/support event. It is cheap to mitigate now.
3. **The guest trial cannot be enforced** without identifying the guest (§4). This is a business-expectation risk rather than a technical one.
4. **Conflict with the current roadmap.** `PRODUCT-ROADMAP.md` says *"Manual takeoff remains free and usable without an account"*. The new requirement makes registration mandatory after 7 days. **[DECISION]** See §11.
5. **AI jobs vs serverless limits.** Edge Functions cap wall-clock at 400 s (paid) / 150 s (free) and memory at 256 MB, while the provider timeout is 420 s and request bodies reach 60 MB. [DOCS] Moving the AI service onto Edge Functions as is would fail or truncate jobs.
6. **Supabase backups exclude Storage objects** [DOCS]. A deleted or overwritten PDF is not recoverable from the database backup. The design must avoid overwrites and destructive deletes.
7. **Payment provider availability from Israel.** Stripe self-serve for an Israeli entity is not confirmed (sources conflict). The provider choice drives tax-invoice compliance. **[DECISION]** + verification.
8. **Orphaned `planVersions`** inflate local storage and any backup size. Fix before measuring project sizes for quotas.

---

## 3. Recommended commercial architecture

```
┌──────────────────────────── Browser (unchanged core) ────────────────────────────┐
│ React app · IndexedDB working store (source of truth for editing) · PDFium render │
│  + supabase-js (Auth session)   + Backup/Restore module   + AI client w/ JWT       │
└───────┬───────────────────────────────┬─────────────────────────────┬────────────┘
        │ Auth, RLS reads, RPC          │ signed upload/download URLs │ HTTPS + Bearer JWT
        ▼                               ▼                             ▼
┌──────────────── Supabase (EU region) ───────────────┐   ┌──── AI worker (existing Node) ───┐
│ Auth · Postgres (RLS) · private Storage buckets      │◄──│ verifies JWT · calls reserve/   │
│ SQL RPCs: reserve/settle credits, commit snapshot,   │   │ settle RPCs with service key ·   │
│ quota checks · Edge Functions: payment webhooks,     │   │ calls OpenAI · job state in DB   │
│ signed-URL issuing, account deletion                 │   │ (long-lived container, EU)       │
└──────────────────────────────────────────────────────┘   └─────────────────────────────────┘
                     ▲ verified webhooks
               Payment provider
```

**Why this split:**

- **Keep local-first.** Editing stays on IndexedDB, so offline use, performance and existing persistence behaviour are untouched. The cloud is a *backup/restore target*, not a live database the viewers depend on.
- **AI stays in the existing Node service, deployed as a long-lived container** (e.g. Fly.io, Render, Railway or Cloud Run with CPU always allocated), not Edge Functions. Jobs run up to 420 s with 40-60 MB payloads, and the code already expects a long-lived process (`ai-server.mjs:164`). Changes: JWT verification, Postgres in place of the JSON ledger and in-memory map, a worker concurrency pool, and binding to `0.0.0.0` behind TLS. [ASSUMPTION] Supabase's `waitUntil` background tasks are still bounded by the 400 s wall clock, so they don't solve this.
- **Edge Functions for short, privileged operations:** payment webhooks, signed upload-URL issuing, account deletion. These fit the 2 s CPU / 150 s idle limits.
- **Money and entitlements live only in Postgres, mutated only by `SECURITY DEFINER` functions or the service role.** Clients get read-only RLS access to their own rows. This is what makes client-side manipulation irrelevant.

---

## 4. User types, enforcement and permissions matrix

### 4.1 What can and cannot be enforced

| Rule | Reliably enforceable? | Why |
| --- | --- | --- |
| AI requires active subscription + credits | **Yes** | Checked server-side inside the reservation transaction. |
| Cloud storage only for entitled users, with quotas | **Yes** | Uploads only via server-issued signed URLs; commit RPC checks the quota. |
| Credits not manipulable | **Yes** | Balance only changes via ledger functions; no client write policy. |
| **Guest 7-day trial of manual tools** | **No** (soft only) | Manual tools run 100% client-side. Clearing storage, a private window, another browser/device or editing JS resets or bypasses any clock. Supabase anonymous users are also lost on storage clear [DOCS]. IP limits misfire on shared/office/mobile IPs. Fingerprinting is unreliable and privacy-sensitive under Israeli privacy law (Amendment 13). **Not recommended.** |
| Registration required after 7 days | Soft | Same as above. It works for honest users, who are the vast majority of contractors. |
| Free manual tools for registered users | Yes (as a UX gate) | It's free anyway; nothing to protect financially. |

**Recommendation:** treat the 7-day guest window as a **conversion nudge, not a security control**. Store a first-use timestamp in IndexedDB *and* `localStorage` (take the earliest). After expiry, ask for free registration before **creating new projects/plans**. **Never block opening, viewing or exporting existing local projects.** Locking someone's data to force sign-up destroys trust and contradicts the roadmap's "local data stays accessible" principle. Don't spend engineering effort on anti-abuse here: a guest who resets the clock still costs zero server money.

Why not Supabase anonymous sign-in for guests: it adds an auth dependency to the free path, inflates `auth.users`, and needs CAPTCHA [DOCS]. It also gives no enforcement benefit, because the identity disappears with storage. Use it later only if guests need any server feature.

### 4.2 Entitlement states (server-computed)

`entitlement = f(subscription.status, current_period_end, grace)` → one of `none | active | grace | expired`.
Credits are a separate balance. AI requires `entitlement ∈ {active, grace?}` **and** `available_credits ≥ reservation`.

### 4.3 Permissions matrix

| Capability | A. Guest ≤7 d | A'. Guest >7 d | B. Registered free | C. Paid, 0 credits | D. Paid + credits | E. Expired/cancelled |
| --- | --- | --- | --- | --- | --- | --- |
| Open/view/export existing local projects | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create/edit projects (manual takeoff, Compare manual) | ✅ | ⚠️ register prompt **[DECISION]** | ✅ | ✅ | ✅ | ✅ |
| PDF/Excel reports | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Local project file export/import (new) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| AI cost preview | ❌ (upsell) | ❌ | ❌ (upsell) | ✅ shows "buy credits" | ✅ | ❌ |
| AI execution | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ (in-flight jobs finish) |
| Buy credit packs | ❌ | ❌ | ❌ **[DECISION]** | ✅ | ✅ | ❌ (resubscribe) |
| Credit balance retained | — | — | — | ✅ | ✅ | ✅ frozen, usable on resubscribe **[DECISION]** |
| Cloud backup (upload) | ❌ | ❌ | ❌ **[DECISION]** | ✅ | ✅ | ❌ |
| Cloud restore/download | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ read-only for grace period, then deletion after notice **[DECISION]** |
| Cross-device access | ❌ | ❌ | ❌ | ✅ via restore | ✅ | read-only (grace) |
| Usage/billing history | ❌ | ❌ | ✅ (empty) | ✅ | ✅ | ✅ |

---

## 5. Proposed database architecture (smallest maintainable schema)

Ten tables. Several of the candidate tables were merged on purpose: purchases → `payments`, AI usage → `ai_requests`, audit → the append-only ledgers plus `admin_actions`.

```sql
profiles          (id uuid pk → auth.users, created_at, locale, deleted_at)
plan_catalog      (code text pk, name, storage_quota_bytes, max_file_bytes, max_projects,
                   ai_enabled bool, active bool)                       -- static config
subscriptions     (id, user_id, provider, provider_customer_id, provider_subscription_id unique,
                   plan_code → plan_catalog, status, current_period_end, cancel_at_period_end,
                   updated_at)                                         -- webhook-written only
credit_accounts   (user_id pk, balance bigint, reserved bigint, updated_at,
                   check (balance >= 0 and reserved >= 0))             -- in credit micro-units
credit_ledger     (id, user_id, delta bigint, kind enum(purchase, reserve, release, charge,
                   refund, grant, adjust, expire), ai_request_id?, payment_id?,
                   idempotency_key unique, created_at)                 -- append-only
ai_requests       (id, user_id, request_id, unique(user_id, request_id), task, request_digest,
                   status, reserved bigint, charged bigint, provider_cost_usd numeric(12,6),
                   provider_request_id, model, input_tokens, output_tokens, cached_tokens,
                   reasoning_tokens, error_code, created_at, started_at, finished_at)
payments          (id, user_id, provider, provider_payment_id unique, kind enum(subscription,
                   credits, refund, chargeback), amount_minor, currency, status, created_at)
webhook_events    (provider, event_id, primary key(provider, event_id), received_at,
                   processed_at, outcome)                              -- dedupe
cloud_projects    (id uuid pk = local project id, owner_id, name, head_revision int,
                   size_bytes, updated_at, deleted_at)
project_revisions (project_id, revision, manifest_path, manifest_bytes, blob_hashes text[],
                   app_schema_version, device_label, created_at, primary key(project_id, revision))
cloud_blobs       (owner_id, sha256, size_bytes, created_at, primary key(owner_id, sha256))
admin_actions     (id, actor, target_user, action, reason, payload jsonb, created_at) -- SHOULD
```

**Ownership:** every row hangs off `auth.users.id`. A cloud project is owned by one user. Teams and sharing are out of scope, and the schema doesn't preclude them later.

**Storage usage** is `Σ cloud_blobs.size_bytes + Σ project_revisions.manifest_bytes` per owner. Compute it inside the commit RPC (exact). Add a cached column later only if it gets slow.

**RLS:**

- Enable RLS on every table. Authenticated users get `SELECT … USING (user_id = auth.uid())` (or `owner_id`) on their own rows only. **No `INSERT`/`UPDATE`/`DELETE` policies** on `subscriptions`, `credit_*`, `ai_requests`, `payments`, `webhook_events`, `project_revisions`, `cloud_blobs`.
- All writes go through `SECURITY DEFINER` functions with `search_path` pinned. They take `auth.uid()` internally and never a user id parameter, or they run with the service role from the AI worker and Edge Functions.
- `plan_catalog`: readable by all, writable by none.
- Revoke `EXECUTE` on internal functions (`settle_ai`, `apply_payment`) from `authenticated` and `anon`. Expose only the user-callable ones (`commit_project_snapshot`, `request_upload_urls`, `my_entitlement`).

**Private files:**

- Bucket `project-files`, private, with `file_size_limit` set and allowed MIME types restricted. Paths: `{user_id}/blobs/{sha256}` and `{user_id}/projects/{project_id}/r{revision}.json.gz`.
- **Do not grant `INSERT` on `storage.objects` to clients.** Uploads use signed upload URLs created server-side after an entitlement and quota pre-check.
- Reads: a `SELECT` policy on `storage.objects` where `(storage.foldername(name))[1] = auth.uid()::text` (pattern from [DOCS]), or signed download URLs. Use the signed-URL route if expired users should be read-only, because entitlement is then checked at issue time.
- Content-addressed paths are never overwritten (avoids `x-upsert` races and CDN staleness [DOCS]).

**Key security:**

- Clients get only the Supabase publishable/anon key.
- The service-role key and OpenAI key live in the AI worker and Edge Function secrets only.
- Use a separate OpenAI project for production, with a provider-side monthly budget limit.

**Migrations:** use the Supabase CLI with SQL migrations in the repo (`supabase/migrations`), applied by CI to staging and then production. Add pgTAP or node tests for RLS denial and ledger invariants. Never edit production in the dashboard.

**Backup and recovery:**

- Free plan has no automatic backups. Pro has 7 days of daily backups, with PITR as an add-on [DOCS]. **Pro is the minimum for paying users.** Consider PITR once real money flows, because the ledger is financial data.
- Storage objects are **not** in DB backups [DOCS]. Mitigations: immutable content-addressed blobs, soft delete with a delayed hard delete (e.g. 30 days), and optionally a periodic copy of the bucket to independent object storage later (SHOULD).
- The local IndexedDB copy plus the local export file is the user's own extra recovery layer.

---

## 6. Local-to-cloud migration strategy

### Recommended initial model: explicit snapshot backup/restore (not sync)

**Why not sync:** documents are large, nested, and edited offline with undo history. CRDT or row-level sync would touch every store and viewer, which the roadmap explicitly says not to do. Snapshots reuse the existing whole-document persistence (`savePlan`, `saveComparison`, `saveProject`) unchanged.

**Flow:**

1. **Registration ≠ migration.** Signing up uploads nothing. This matches the roadmap ("never upload existing local PDFs automatically").
2. **On plan activation**, show a one-time dialog: "Back up your projects to the cloud?" It lists projects with sizes, has checkboxes (default: all that fit the quota), and states plainly what is uploaded and where it is stored. The user confirms. **[DECISION]**: auto vs confirmed. Recommended: confirmed, because of PDF privacy and quota.
3. **Backing up one project:**
   1. `persist()` the open plan/comparison first (existing rule).
   2. Read the project, its plans and comparisons, and decide whether to include `planVersions` (recommended: yes, for revert) and AI reviews (recommended: completed reviews yes; AI jobs/spending logs no, as the roadmap says). Build the manifest `{schemaVersion, appVersion, project, plans, comparisons, planVersions, aiReviews, blobs: [{key, sha256, size}]}`.
   3. Hash each PDF blob with SHA-256 (already done for AI `sourceHash`). Call `request_upload_urls(hashes, sizes)`. The server returns URLs **only for missing blobs** (dedupe and resume) after an entitlement and quota pre-check.
   4. Upload the blobs. Use resumable TUS for files > 6 MB ([DOCS]). **[ASSUMPTION]** Confirm that resumable uploads work with server-issued signed tokens; otherwise use per-blob signed URLs and accept per-file restart.
   5. Upload the gzipped manifest to a new revision path, then call `commit_project_snapshot(project_id, base_revision, manifest_path, blob_hashes)`. In one transaction it verifies the blobs exist in `storage.objects` with the declared sizes, checks the quota, checks `head_revision = base_revision`, and inserts the revision.
   6. Locally, record the cloud link in a **new store `cloudLinks`** `{projectId, revision, syncedAt, localUpdatedAtAtSync}` (DB v8, additive; no document shape change).
4. **Restore on another device:** list `cloud_projects`, download the manifest and missing blobs, write them in one IDB transaction per project, then run the existing lazy migrations.

**Edge cases:**

| Case | Behaviour |
| --- | --- |
| Interrupted upload | Nothing is committed and the cloud head is unchanged. The retry uploads only the missing blobs. Orphan blobs are garbage-collected after 24-48 h. |
| Version conflict | `base_revision ≠ head` → three choices: overwrite cloud, download cloud as a **copy** (new local project id), or cancel. Never silent. |
| Duplicate projects | Cloud id = local id, so re-backup updates the same project. A restore that collides with a local id that has diverged → conflict flow. Explicit "Duplicate" creates new ids. |
| Offline | Everything local keeps working. Backup buttons are disabled with an explanation. The session token may expire offline; that must never block local work. |
| Size limits | Enforced per file (bucket limit) and per user (commit RPC). Show sizes before upload. |
| Cancellation/expiry | Cloud becomes read-only and downloadable for a grace period, then is deleted after email notices. Local data is never touched. **[DECISION]** grace length |
| Data ownership | The user owns their content. Privacy terms: processing purpose, region (EU), retention, and AI sub-processor (OpenAI, `store:false`). |
| Export/recovery | A local `.bettercalc` file (zip of the same manifest + blobs) is available to **every** tier. Cloud backup reuses the same serializer, so one format serves both. |
| Account deletion | Deletes cloud rows/objects (via Storage API) and auth user. Keeps `payments`/ledger rows pseudonymised where tax law requires. Local data is untouched. |

**SHOULD (later):** an "auto-backup on save when online" toggle for subscribers. It is still snapshot-based, debounced (e.g. ≥ 5 min), and changes only the trigger, not the model.

---

## 7. AI credit and billing architecture

### 7.1 Units and pricing separation

- `credit` = integer micro-units (e.g. 1 credit = 1,000,000 units) to avoid floats.
- **Provider cost** (`ai_requests.provider_cost_usd`, from the existing `estimate*Cost` functions) is recorded separately from **customer charge** (`ai_requests.charged`). Charge = `ceil(provider_cost_usd × markup ÷ credit_price)` or a fixed per-task price. **[DECISION]**: usage-based vs fixed price per page/task. Fixed per-page pricing is easier for contractors to understand; usage-based tracks margin. Recommended: a **fixed price per task-page**, with provider cost tracked for margin monitoring and caps protecting the tail.

### 7.2 Request lifecycle (all money logic in Postgres)

```
AI worker (JWT verified → user_id)
 1. reserve_ai(user_id, request_id, task, digest, reserve_amount)      -- one transaction
      SELECT … FROM credit_accounts WHERE user_id=$1 FOR UPDATE
      check entitlement(user_id) active
      check per-user concurrency (count PROCESSING ≤ 1-2) and daily cap
      check global daily provider budget (circuit breaker)
      INSERT ai_requests … ON CONFLICT (user_id, request_id) DO NOTHING
        → if exists: digest must match → return existing job (idempotent, no new charge)
      balance -= reserve; reserved += reserve; ledger(kind=reserve, key='reserve:'||id)
 2. call OpenAI (existing run())
 3. settle_ai(id, outcome, usage, provider_cost)                        -- one transaction
      charge = min(price(task, usage), reserved_for_request)
      reserved -= reserve; balance += reserve - charge
      ledger(kind=release/charge, key='settle:'||id)    -- unique key ⇒ exactly once
```

| Concern | Design |
| --- | --- |
| Atomicity / concurrency | Row lock on `credit_accounts`; `check (balance >= 0)` is the hard backstop. |
| Idempotency | `unique(user_id, request_id)` plus the existing request digest; ledger `idempotency_key` unique. Payment webhooks dedupe on `webhook_events`. |
| Failed requests | No provider usage → full release. Invalid output, timeout or refusal **with** provider usage → recommend **no customer charge** in MVP (we absorb cost, which is logged). **[DECISION]** |
| Stuck jobs | A sweeper marks `PROCESSING` > 15 min (> 420 s timeout + margin) as `EXPIRED` and releases the reservation. A late settle on an expired row only records provider cost. |
| Subscription expires mid-request | Entitlement is checked at reservation only; the in-flight job settles normally. |
| Rate limiting | Per-user concurrency and requests/hour in the reserve function. Per-IP limit at the worker/proxy for unauthenticated hits. Body limit before JSON parse (existing). |
| Spending caps | (1) per-user daily credit cap, (2) global daily provider-USD circuit breaker in DB, (3) worker concurrency pool, (4) OpenAI project budget as last line, (5) alerting on provider cost/hour. |
| Reservation size | The current worst case is ~$5.61 per request. With fixed task pricing, reserve the **fixed price**, not the provider worst case, and absorb rare overruns (capped by circuit breakers). **[DECISION]** |
| Server-side enforcement | The worker never trusts client-side entitlement. The client only displays `my_entitlement()` / balance. |

Admin-granted credits (`kind=grant`) allow the pilot to run **before payments exist**.

### 7.3 Where AI executes — recommendation

| Option | Verdict |
| --- | --- |
| Supabase Edge Functions | ❌ 400 s wall clock < 420 s provider timeout, 256 MB memory with 60 MB bodies, 2 s CPU for base64 validation [DOCS]. |
| Existing Node service, hardened, in a long-lived container | ✅ **Recommended.** Minimal change, keeps validated pipelines. Add JWT verification (Supabase JWKS), Postgres job state, a concurrency pool, health checks and graceful drain on deploy. |
| Queue + worker (e.g. Storage upload → DB job row → worker polls) | SHOULD later, if load grows or deploys interrupt jobs. It also removes 60 MB request bodies by uploading to a temporary private bucket. |

---

## 8. Storage quota strategy

**Cost drivers [DOCS, Pro plan]:** storage $0.0213/GB-month beyond 100 GB included; uncached egress $0.09/GB beyond 250 GB; DB $0.125/GB beyond 8 GB.

**[ASSUMPTION]** Architectural PDFs are typically 1-30 MB, with outliers above 100 MB. A busy contractor might keep 20-50 projects × 3-10 PDFs, so ~1-5 GB. Storage cost per heavy user is under $0.15/month. **Egress from restores** (full re-download per new device) dominates, and is still small. Quotas mainly cap abuse and the tail, not routine margin. Measure real sizes in the pilot before finalising.

**Initial policy proposal [DECISION]:**

| Limit | Proposal | Enforced by |
| --- | --- | --- |
| Total storage per paid user | 10 GB | Commit RPC (exact, server-side) |
| Max single file | 150 MB | Bucket `file_size_limit` + server-issued URLs |
| Max projects | Unlimited (storage-bound) | — |
| Revisions kept per project | Last 5 + daily for 30 days | GC job |
| Local import limit for PDFs | Add one (e.g. 200 MB) for consistency | Client (non-security) |

**Bypass prevention:**

- No client `INSERT` on `storage.objects`, so all uploads go through signed URLs issued after a quota check.
- The commit verifies actual sizes in `storage.objects`, and only committed revisions count.
- Uncommitted uploads are GC'd.
- Worst-case overshoot is one file.

**Deletion and reclamation:**

- Deleting a project or revision is a soft delete, with a hard delete after 30 days.
- Blobs are deleted when no revision references them.
- Storage objects must be removed via the Storage API, not by deleting rows in `storage.objects`.

**Downgrade/cancellation:**

- Over quota → no new backups; restore still allowed.
- Expired → read-only for grace (e.g. 90 days) with reminders, then deletion. **[DECISION]**

---

## 9. Subscription lifecycle and payments

**Products:**

- **Subscription** (monthly/annual) grants entitlement: AI access, cloud backup and storage quota.
- **Credit packs** are one-time purchases that add credits.

Keep these **independent products**. Each has a single meaning in the ledger, refunds stay clean, and pricing can change separately. Credit packs are purchasable only with an active subscription (recommended, **[DECISION]**). Whether the subscription *includes* monthly credits is a **[DECISION]**; the requirement as written implies it does not.

**Lifecycle:** `active → (payment failed) past_due → grace N days → expired`, and `active → cancel_at_period_end → expired at period end`. Each transition comes **only** from a verified webhook (or a server-side poll of the provider API), applied in one transaction with a `webhook_events` dedupe. Redirect/success pages never grant anything.

**Refunds and chargebacks:**

- Subscription refund → entitlement ends (provider event).
- Credit-pack refund → negative ledger entry up to the remaining balance. If credits were already spent, the balance can't go below 0, so an adjustment is logged and the account is flagged.
- Chargeback → AI blocked pending review.

**Provider suitability from Israel:**

| Option | Pros | Cons |
| --- | --- | --- |
| **Israeli gateway** (e.g. Cardcom, Grow/Meshulam, PayPlus, Tranzila) + Israeli invoicing | ILS, local cards/Bit, Israeli tax invoices (important for B2B contractors claiming VAT), Hebrew checkout | Webhook signing/idempotency quality varies; some are NIS-only; more integration glue. **Verify per vendor.** |
| **Paddle** (merchant of record) | Handles subscriptions, one-time purchases, refunds, dunning and global tax; robust signed webhooks | Paddle is the seller of record, so Israeli customers' invoice/VAT deductibility needs an accountant's confirmation; possibly a weaker local checkout |
| **Stripe** | Best developer experience | Direct Israeli-entity signup **not confirmed** (sources conflict; check stripe.com/global) |

**Recommendation:** the target market is Israeli contractors who need Israeli tax invoices, so evaluate **one Israeli gateway with recurring billing and integrated tax-invoice generation** first. Keep Paddle as the fallback if international sales matter. Hide the provider behind one webhook Edge Function and one `apply_payment_event()` SQL function so it can be swapped. **[DECISION]**, plus an accountant review.

---

## 10. Security and failure scenarios

| Scenario | Safeguard |
| --- | --- |
| Unauthorized project access | RLS own-row only; private bucket; user-id path prefix; signed URLs; automated cross-account denial tests |
| Direct AI API abuse | JWT required; reserve RPC gates; per-IP + per-user limits; body limit before parse; global circuit breaker; OpenAI budget |
| Credit manipulation | No client write policies; `SECURITY DEFINER` only; `check (balance >= 0)`; append-only ledger reconciles to balance (nightly check) |
| Fake subscription status | Entitlement computed in DB from webhook-written rows; client display only |
| Duplicate webhooks | `webhook_events (provider, event_id)` PK; `payments.provider_payment_id` unique; ledger idempotency keys |
| Concurrent AI spending | Row lock + concurrency count in the same transaction |
| Storage quota bypass | No direct insert; commit-time verification; bucket file limit; orphan GC |
| Interrupted migration | Blobs-then-commit; cloud head unchanged until commit; local never modified by backup |
| Lost local data | `persist()`, local export file, cloud backup for subscribers, "last backed up" indicator |
| Account deletion | Edge Function: cancel subscription, delete Storage objects, delete rows, pseudonymise financial records, delete auth user. Never touches local IDB (tell the user) |
| Expired subscription | AI denied at reserve; cloud read-only; credits frozen; local unaffected |
| Leaked service key | Only in server secrets; rotate procedure documented; never in `VITE_` env |
| Provider outage/timeout | No auto-retry (existing); release reservation; user-visible "not charged" |

**Must exist before accepting paying users:**

1. Authenticated AI worker plus Postgres credit ledger with reserve/settle, idempotency and caps.
2. RLS on every table, with automated cross-account denial tests.
3. Verified, idempotent payment webhooks as the only entitlement writer.
4. Global spend circuit breaker and OpenAI project budget alerting.
5. `persist()`, local project export/import, and the cloud backup round-trip test (geometry and quantities match after restore).
6. Supabase Pro (backups), EU region, privacy policy/terms covering OpenAI processing, account deletion path.
7. Reconciliation query (ledger sum = balance) and an admin view for support/refunds.

---

## 11. Implementation roadmap

Complexity: S ≈ days, M ≈ 1-2 weeks, L ≈ 3+ weeks (one developer, [ASSUMPTION]).

### MUST HAVE BEFORE LAUNCH

**Phase 0: Decisions and local resilience** (S-M)

- *Objective:* lock the §12 decisions; remove the silent data-loss risk for everyone.
- *Dependencies:* none.
- *Reuse:* `database.ts` readers (`loadProjectWithPlans`, blob loaders), lazy migrations.
- *Changes:* `navigator.storage.persist()` on first project save; `.bettercalc` export/import (manifest + blobs, same serializer cloud will use); delete orphaned `planVersions` in `deletePlan`/`deleteProject`; soft guest trial clock + registration prompt (UI only).
- *Security:* imported files are untrusted. Validate the manifest and keep ids collision-safe (import as a copy on conflict).
- *Acceptance:* export → clear site data → import restores identical quantities and editable geometry; existing projects unaffected; tests for serializer round-trip.

**Phase 1: Supabase foundation and accounts** (M)

- *Objective:* optional sign-in; schema and RLS in place.
- *Dependencies:* Phase 0 decisions; Supabase Pro project in EU.
- *Reuse:* app shell/start screen; analytics privacy rules (no plan content; decide whether to link account id).
- *Changes:* `supabase/migrations`, Auth (email OTP + Google [DECISION]), `profiles`, `plan_catalog`, empty entitlement tables, account menu, session handling that never blocks offline local work.
- *Security:* RLS tests; publishable key only on client; Turnstile/CAPTCHA on sign-up.
- *Acceptance:* sign-in/out does not alter local data; user A cannot read B's rows (automated); app works fully offline when signed in.

**Phase 2: Authenticated AI and credits, pilot with granted credits** (L)

- *Objective:* AI usable by invited users with server-enforced credits; no payments yet.
- *Dependencies:* Phase 1.
- *Reuse:* entire `server/*` pipeline, validation, frozen configs, consent/preview, accounting, `jobClient`/`openingsClient` (add base URL + bearer).
- *Changes:* JWT verification; replace JSON ledger and in-memory jobs with `ai_requests`/`credit_*` + reserve/settle RPCs; concurrency pool; sweeper; containerised deploy (EU); CORS to the production origin; uniform consent/preview for room jobs; admin grant tool.
- *Security:* everything in §7.2; secrets in host secret store; separate OpenAI project with budget.
- *Acceptance:* concurrent duplicate submissions charge once; insufficient credits → 402 with no provider call; failed job releases credits; ledger reconciles; expired entitlement denied; load test of 2-5 parallel users.

**Phase 3: Cloud backup/restore** (L)

- *Objective:* subscribers back up and restore projects across devices.
- *Dependencies:* Phase 0 serializer, Phase 1.
- *Reuse:* Phase 0 manifest/serializer; `updatedAt` optimistic pattern; existing `sourceHash` hashing.
- *Changes:* `cloud_projects`, `project_revisions`, `cloud_blobs`, `request_upload_urls` + `commit_project_snapshot`, `cloudLinks` IDB store (v8), backup/restore UI with conflict dialog, GC job.
- *Security:* no client Storage insert; quota at commit; path prefix; soft delete.
- *Acceptance:* the roadmap's exit criteria: cross-account denial, round-trip with matching quantities, interruption leaves both copies intact, conflict never silently overwrites, quota cannot be exceeded via direct API.

**Phase 4: Payments and entitlements** (M-L)

- *Objective:* self-serve subscription and credit packs.
- *Dependencies:* Phases 2-3; provider contract and accountant sign-off.
- *Reuse:* ledger `purchase`/`refund` kinds; entitlement function.
- *Changes:* checkout links, webhook Edge Function, `payments`, `webhook_events`, `apply_payment_event()`, billing page (balance, history, invoices), dunning/grace states.
- *Security:* signature verification or server-side transaction lookup; idempotency; no entitlement from redirects.
- *Acceptance:* replayed/out-of-order webhooks are harmless; refund adjusts credits correctly; cancel → expiry at period end; failed payment → grace → expired.

**Phase 5: Lifecycle and operations** (M)

- *Objective:* launch-ready support and compliance.
- *Changes:* account deletion, expired read-only mode + deletion notices, admin view (grants, refunds, user lookup), cost/usage dashboards and alerts, reconciliation job, privacy/terms pages.
- *Acceptance:* deletion verified end to end; alerts fire on budget thresholds; support can resolve a refund without SQL.

### SHOULD HAVE

- Auto-backup toggle (debounced snapshot)
- Off-site copy of the Storage bucket
- Upload-then-process AI queue (removes 60 MB request bodies)
- PITR
- `admin_actions` audit
- Usage emails (low balance)

### CAN WAIT

- Real-time sync / multi-device live editing
- Teams/sharing/organisations
- Anonymous Supabase guests
- Device fingerprinting (not recommended at all)
- Multi-currency / international tax
- Per-project sharing links

**Note on ordering:** the existing roadmap puts accounts and backup first, then AI credits. Phases 2 and 3 are independent after Phase 1 and can swap or run in parallel. For a pilot, Phase 2 with granted credits validates the paid value (AI) earlier. **[DECISION]**

---

## 12. Decisions requiring product-owner approval

1. **Mandatory registration after 7 days vs the roadmap's "manual takeoff free without an account".** Which wins? And after expiry, is the gate on *creating/editing* only (recommended) or broader?
2. Accept that the guest trial is **soft** (not enforceable without identifying guests)? Recommended: yes; no fingerprinting.
3. Cloud migration on activation: **user-confirmed** (recommended) or automatic?
4. Does the subscription include any monthly credits, or are all credits purchased separately?
5. AI pricing model: fixed price per task-page (recommended) or pass-through usage × markup; target margin.
6. Charge policy for failed or invalid AI outputs where the provider still billed us (recommended: no charge in MVP).
7. Can registered free users buy credits or use small cloud storage? (Recommended: no; subscription required.)
8. Credit expiry: never, while subscribed, or N months; behaviour on cancellation (frozen recommended). Check against Israeli consumer-protection rules.
9. Storage quotas: total, per file and revisions kept (proposed 10 GB / 150 MB / 5 revisions).
10. Grace periods: past-due grace (days) and post-cancellation read-only window before deletion (proposed 90 days).
11. Payment provider: Israeli gateway vs Paddle vs Stripe (subject to Israeli-entity availability), after an accountant review of tax-invoice requirements.
12. Login methods (email OTP, Google, phone) and whether the analytics identity is linked to accounts.
13. Data region (EU recommended) and whether AI should ever run on plans without cloud backup consent (it can; inputs are sent per request).
14. Phase order: AI credits before or after cloud backup.

---

## Sources

Official documentation:

- Supabase Edge Function limits: https://supabase.com/docs/guides/functions/limits
- Supabase Storage file limits: https://supabase.com/docs/guides/storage/uploads/file-limits
- Supabase Storage access control: https://supabase.com/docs/guides/storage/security/access-control
- Supabase resumable uploads: https://supabase.com/docs/guides/storage/uploads/resumable-uploads
- Supabase backups: https://supabase.com/docs/guides/platform/backups
- Supabase anonymous sign-ins: https://supabase.com/docs/guides/auth/auth-anonymous
- Supabase pricing: https://supabase.com/pricing
- MDN storage quotas and eviction: https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- WebKit storage policy: https://webkit.org/?p=14403
- Paddle supported countries: https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle

Third-party (lower confidence; verify):

- Stripe in Israel, conflicting reports: https://www.doola.com/stripe-guide/how-to-open-a-stripe-account-in-israel/ , https://osome.com/uk/blog/stripe-account-israel-osome-uk-incorp
- Israeli gateways: https://docs.base44.com/Setting-up-your-app/accepting-payments-israel , https://skillselion.com/skills/skills-il/tax-and-finance/cardcom-payment-gateway
