# Local One-Click + Multi-Plan integration

Worktree: `/Users/ADMIN/Documents/BetterCalc-ai-integrated`
Branch: `integration/ai-oneclick-multiplan`
Base: exact checkpoint `a7c2162d60416c071108a0224bc7740b7c2c4704`.

Merged `feat/one-click-ai` at `5f62555` first, then `feat/multi-plan-ai` at
`bcf14fff28ec402cf9927356ff6d00ca8916c32d`, using normal history-preserving merges.
The checkpoint tag currently points to a different commit (`8723e86`); the explicit
checkpoint SHA, as requested, was used. The original checkout's tracked diff and
status hashes were unchanged after integration; its unrelated files were not edited.

## Resolution and integration safeguards

The only Git conflict was `src/lib/ai/workflow.ts`. The single-page entry retains
One-Click's capability checks, target handling and synchronous duplicate-start guard.
The batch adapter and single-page entry share one preparation/admission/persistence/
polling implementation. Jobs carry `full-page-v1` or `one-click-v1`; legacy jobs with
no mode continue to mean full-page. Batch starts disarm any pending target click.

Additional integration changes in `contracts.ts`, `batchModel.ts` and
`batchWorkflow.ts` distinguish modes, require a completed full-page job plus its
source-matched persisted review for batch reuse, and exclude One-Click metrics from
full-page cost estimates. A target-only, rejected-target or uncertain-target review
cannot cause a batch to skip full-page detection. Edited target suggestions and
full-page suggestions coexist in the original source/page review store.

The automatic merge retained `App.tsx`'s Multi-Plan launcher and the existing Rooms
panel/full-page/One-Click entry points, AI review workspace and PDF click handlers.
Existing geometry edits, warnings, classifications, Room approval and quantity
engines remain shared. AI Rooms receive no automatic finish work items.

IndexedDB retains the Multi-Plan version 5 additive `aiBatches` migration. Existing
version 4 AI jobs/reviews and Plan/PDF stores are retained; no extra migration or
parallel review store was introduced. Close older tabs before upgrading; older
version 4 builds cannot reopen the upgraded database.

The frozen full-page assets, model request, prompt, image policy and spending
limits are unchanged. Both modes use the original service admission and ledger,
and ambiguous submissions recover through free GETs without repeating POSTs.

## Focused verification

44 tests passed with frozen outputs, mocked providers, mocked persistence and
existing Room actions:

```sh
node --experimental-test-module-mocks --import ./tests/resolve-ts.mjs --test \
  tests/ai/oneClick.test.mjs tests/ai/service.test.mjs \
  tests/ai/workflow.test.mjs tests/ai/review.test.ts \
  tests/ai/batchModel.test.ts tests/ai/batchQueue.test.ts \
  tests/takeoff/localAiImport.test.ts
```

Integration regressions cover target-only/uncertain cache exclusion, compatible
legacy full-page jobs, mode-specific cost estimates, cross-page identity and draft
preservation, same-page merging of edited target drafts, duplicate request guards,
sequential batch admissions, and cached results avoiding new submissions.

Focused TypeScript compiler diagnostics for the AI integration files and their
entry points: zero. Six unrelated dependency diagnostics were excluded, without
repairing unrelated code. Server module syntax checks and `git diff --check` passed.
Frozen asset hashes passed the existing service fixture check.

The local service started on a temporary loopback port and returned HTTP 200 from
`/ai/health`, with `configured:false`, `active:false`, the unchanged 20-request /
USD 20 defaults and USD 5.61 reservation. It used an empty environment and a provider
stub that prohibits inference; provider calls: zero. The temporary server was
closed and its temporary ledger removed. No secret files were read or copied.

No browser, Playwright, UI automation, OpenAI calls, broad QA, full build, lint,
deployment or push was performed. Dependencies are reused through an ignored
`node_modules` symlink to the original checkout; dependency files were not changed.

## Manual local testing

The owner must create/configure the ignored `.env.ai.local` in this worktree with
`OPENAI_API_KEY` and any existing `AI_MAX_REQUESTS` / `AI_SPEND_LIMIT_USD` settings.
Do not use `VITE_*` for the server key. Defaults have not been increased. The ledger
is local to this worktree; retain it between runs. Use one local AI service process.

Terminal 1:

```sh
cd /Users/ADMIN/Documents/BetterCalc-ai-integrated
npm run dev:ai
```

Terminal 2:

```sh
cd /Users/ADMIN/Documents/BetterCalc-ai-integrated
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://127.0.0.1:5173` manually. If port 4781 is already occupied, the owner
must stop the other local AI service first. The default Vite proxy targets 4781.
Review full-page detection, target-click editing/approval, then multiple PDFs/pages
with calculation selections, sequential jobs and page review. Check navigation,
refresh recovery, source replacement and cached full-page reuse. Configure quantities
through ordinary Room controls after approval and calibration.

Real model acceptance/accuracy, PDFium rendering, UI interactions and real IndexedDB
migration/recovery remain for manual verification. One-Click is experimental and
requires desktop mouse authoring. Batch execution requires browser Web Locks.
Stop scheduling cannot cancel the current inference; refresh pauses queued jobs
until explicit resume. Service outputs expire after about an hour and are lost on
restart, while admission identities remain protected by the spending ledger. The
full build is not certified because it was outside the requested checks.
