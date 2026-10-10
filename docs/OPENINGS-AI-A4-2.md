# A4.2 — openings AI service integration

Openings use their own task (`openings-v1`), HTTP routes, request namespace
(`openings-<UUID>`), workflow and IndexedDB stores. Existing room/full-page,
one-click and multi-plan detector payloads and workflows remain unchanged.
The local server shares credentials, admission limits, active-inference lock,
provider transport and persistent spending ledger across both task families.

## Preparation, cost and consent

`openingsAiService` in `src/lib/ai/openingsService.ts` exposes separate `prepare`,
`submit`, `recover` and `resume` operations. It is not connected to UI or started
on import. Preparation reuses `prepareAiPage` and PDF fingerprinting. It sends
five PNGs to the **local** free `/ai/opening-previews` endpoint, never to OpenAI.
Images remain ephemeral and are not written to IndexedDB or the ledger.

A preview includes an empirical estimated cost, a conservative USD reservation,
the frozen pricing verification date and an explicit estimate caveat. For the
Vision-002 image dimensions the estimate is $0.204385: all estimated input tokens
use the highest frozen input/cache-write rate, with the observed 2,382 output
tokens. It is a historical estimate, not an invoice guarantee or hard spend bound.
The $5.61 reservation uses full 1,050,000-token context and 24,000 output-token cap
at the frozen highest long-context rates. Frozen pricing is not a live quote.

The server hashes the openings task, request identity, complete manifest, exact
image bytes and frozen provider payload. The preview expires after ten minutes.
The future caller must present cost/disclosure and explicitly obtain owner consent;
no UI or automatic consent factory is supplied here. `submit` requires
`{ approved: true, approvedAt, previewId, requestDigest }` matching that preview.
The backend independently checks this binding. Changing source, images, identity
or settings invalidates consent. Preview requests cannot admit paid work.

`POST /ai/opening-jobs` reserves spending and durably records task, digest and
consent before the provider call. Its frozen payload matches Vision-002:
five ORIGINAL images, unchanged prompt/schema/image descriptions, gpt-6.1-sol,
low reasoning, default service tier, 24,000 maximum output tokens, store:false,
420-second timeout, one request and zero inference retries. Model/settings cannot
be selected by the client. Reported usage reconciles reservations using the frozen
openings rates; ambiguous failure or unknown usage retains the reservation.

## Tracking, recovery and persistence

The workflow saves its PROCESSING identity before POST and never changes it back
to a state permitting resubmission. A lost POST response is recovered by GET:
`/ai/opening-jobs?requestId=...` (or `/ai/opening-jobs/<jobId>`). Background tracking
repeats only free GETs every 2.5 seconds. `resume` restores pending openings jobs
without submitting anything. Interrupted preparations/consent lose ephemeral
images and require a new explicit preparation; they do not submit after refresh.

Room routes cannot retrieve openings jobs, nor openings routes room jobs.
Duplicate admissions return existing status; an admitted identity never causes
another inference. Restart/expiry produces 410 and never resubmits. Server jobs
remain in process memory and terminal results expire after one hour, matching
the existing local service limitations. The ledger survives restart; uncollected
results lost on restart cannot be regenerated automatically. No cancellation is
implemented; stopping status observation does not stop billing.

IndexedDB v6 adds `openingsAiJobs` and `openingsAiReviews`, without moving or
rewriting existing room jobs/reviews or plan records. Results are parsed with the
A4.1 parser against the persisted manifest and rechecked PDF fingerprint. Draft
candidates, deferred observations, evidence, coverage notes and AI provenance
are saved atomically with COMPLETED job status. Repeated collection preserves
an existing review rather than overwriting edits. Invalid results fail closed;
transient storage/status failures can recover via GET. Replaced PDFs cannot
inherit results. Nothing is approved or added to Plan.openings/quantities here.

## Focused verification

All provider calls in tests use injected mocked responses. No real credentials or
paid requests are used. Tests cover exact frozen payload, free previews and bound
consent, tampering/expiry, reservations/caps, task separation, one-call admission,
POST loss, GET outages, refresh/restart, parser failures, source replacement,
background collection, drafts/deferred/provenance and atomic storage adapter writes.
Existing room/full-page, one-click and batch recovery tests remain included.

Persistence is tested at the mocked IndexedDB adapter boundary; real-browser
storage and live provider behavior remain unverified. No UI, build, deployment,
commit or unrelated changes are part of this phase.
