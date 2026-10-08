# Local AI Space Detection — Phase 3

This is a development-only feature. It has not been deployed or verified with a real paid request. The frontend production build does not show the AI service controls or the local JSON importer.

## Start locally

Use Node.js 24.11 or later (native TypeScript stripping and `--env-file-if-exists` are used). From the BetterCalc app directory:

1. Create `.env.ai.local` containing `OPENAI_API_KEY=your_real_key`. This file is gitignored. Do not use a `VITE_` variable, put a key in source, or copy a real key into `.env.example`.
2. In one terminal, run `npm run dev:ai`.
3. In another, run `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`.
4. Open the frontend locally. Open a plan's Spaces tab and click **AI Space Detection** (Hebrew: **זיהוי חללים באמצעות AI**).

Restart an already running Vite process to load the new proxy configuration. The service defaults to `127.0.0.1:4781`. Vite forwards `/ai` to it. If changing `AI_PORT`, update the development proxy target too. `AI_ALLOWED_ORIGINS` accepts only exact local HTTP origins; defaults are `http://127.0.0.1:5173,http://localhost:5173`. It never binds publicly. This is a localhost development safeguard, not production authentication.

## Frozen request and preparation

The assets in `server/ai-assets` are byte copies of the accepted high-detail experiment. `provenance.json` records hashes and source scripts. There is no runtime dependency on BetterCalc-AI-Lab.

The request follows `local_tiles_005.py`: one user message containing the unchanged product prompt and the same five image descriptions, no additional system/developer prompt, five HIGH-detail PNG images, `gpt-6.1-sol`, low reasoning, default service tier, 24,000 maximum output tokens, `store:false`, 420-second provider timeout, zero automatic inference retries. The original structured-output schema is unchanged.

`ViewerPdfPage.prepareAiRaster` renders a separate full-page PDFium image at `scale = 5500 / max(nativeWidth,nativeHeight)`, with ceil-rounded raster bounds. It does not read a viewer canvas or use its lower render budget. The browser's existing pinned PDFium WASM adapter replaces the lab's Python wrapper; pixel-identical output between those binaries is not claimed. AI preparation does not fall back to PDF.js or reduce quality if rendering fails.

The four corner crops are exactly `ceil(imageWidth / 1.82)` by `ceil(imageHeight / 1.82)`. Tile overlap is approximately 18% of tile dimensions. There is no content-dependent preprocessing, snapping or extra inference pass. One page may contain multiple apartments; approval uses BetterCalc's existing active-apartment assignment.

The preparation manifest records the plan, page, SHA-256 of the complete PDF bytes, renderer/version, native size, intrinsic rotation, PDF page box/unit, scale, image dimensions and all crop rectangles. Mapping is:

`nativePage = (tileCropOriginPixels + tileLocalNormalized * tileCropSizePixels) / renderScale`

The native frame already includes intrinsic rotation. Viewer zoom/pan are never applied. Current preparation rejects nonzero page-box origins, nonstandard rotations and non-unit PDF UserUnit; unsupported PDFs fail explicitly.

## Job lifecycle and persistence

An explicit click creates a local PREPARING record, then persists the request identity and manifest before admission. `POST /ai/space-jobs` returns a job ID immediately after admission. The long-lived local Node process performs the one provider request; the frontend polls `GET /ai/space-jobs/:id` every 2.5 seconds. Status is indeterminate, with no invented percentage. Navigation remains available.

A lost admission response is recovered with `GET /ai/space-jobs?requestId=...`, never another POST. Refresh resumes saved PROCESSING jobs and polling. Interrupted PREPARING jobs fail and require an explicit retry because their images are not persisted. Temporarily unavailable status requests are retried for recovery; paid requests are not. Cancellation is not offered: closing the browser does not cancel inference or guarantee that billing stops.

Server jobs/results are in process memory and terminal results expire after one hour. Restarting the service loses running jobs and uncollected results. The persistent admission ledger rejects reuse of their paid request identities; the frontend marks these jobs unavailable without resubmission. Completed drafts already stored in IndexedDB survive a service restart. Starting a new request after an unavailable job requires an explicit owner decision and may add another charge.

IndexedDB v4 adds separate `aiJobs` and `aiReviews` stores without changing existing Room storage or measurement/history behavior. Reviews are scoped to `planId + pageNumber + PDF SHA-256`. Draft edits, original points, warning metadata/acknowledgments, semantic choices, validation problems and resolved IDs persist. Approval and rejection record resolved IDs so a completed job cannot reimport the same candidate, including after Room undo. Approved Room IDs are checked as an additional guard. New detections have new identities and do not perform geometric deduplication against earlier runs: inspect overlapping suggestions before approving.

Completed results use the Phase 1 parser and Phase 2–2.1 review UI. Geometry approval remains necessary. Hard validation errors remain blocking; uncertainty warnings can be acknowledged. Semantic confirmation stays separate. No automatic finish work items are created. Replacing a source PDF invalidates its proposal binding; old results cannot attach to the replacement. The development JSON importer remains available.

## Admission, cost and privacy

The service validates local host/origin, a required custom request header, JSON size, exact five-image order, PNG header/dimensions, native/raster scale and frozen tile layout. It accepts no client model or upstream selection. Defaults: one active inference, 20 admitted requests, $20 estimated-spending cap. Each PNG is limited to 20 MB, all images together to 40 MB, and the JSON body to 60 MB. Large image encoding may briefly use significant browser memory.

Configure `AI_MAX_REQUESTS` and `AI_SPEND_LIMIT_USD` in `.env.ai.local`. Admission reserves **$5.61** conservatively: the full published 1,050,000-token context at the highest frozen long-context input/cache-write rate, plus the 24,000-token output maximum. This is intentionally much larger than the observed $0.076 average. With valid standard-tier usage, it reconciles to the frozen pricing estimate; unknown usage and ambiguous failures keep their reservation. The cap survives restarts via gitignored `.ai-local/spending.json`, which contains admission IDs/status/charges only. Use one local service instance; do not delete its ledger to recover a failed job. Pricing estimates are not invoice guarantees; configure provider project budgets too and recheck pricing before production.

Images exist only in frontend preparation/request memory and service request memory. No raw PDF or image files, provider response bodies or keys are logged or written by the service. Job results retain polygons/metadata temporarily; local review/job records remain in browser storage. There is no training-data collection. `store:false` disables response storage as supported by OpenAI; it does not promise zero provider-side retention. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) and the [frozen model's current pricing/context](https://developers.openai.com/api/docs/models/gpt-6.1-sol).

## Owner's first manual test

1. Configure the server-side key and start both terminals as above. Open a previously unseen PDF.
2. Open Spaces and read the disclosure. Click AI Space Detection once. Check PREPARING then PROCESSING; do not expect a progress percentage.
3. Navigate to another page while it runs. Return to the source page and verify suggestions align with walls, including on a rotated standard PDF.
4. Optionally refresh during PROCESSING; it must resume status polling without a new paid submission.
5. Check actual warning details, individual/bulk acknowledgment and restoration. Edit vertices, insert/delete a vertex, and restore an original polygon.
6. Change a supported Space type; confirm it separately if desired. Approve one valid draft and several together. Verify ordinary Rooms, expected active-apartment assignment, no automatic finish items, and existing undo/redo.
7. Leave an edited draft with an acknowledged warning, navigate away/back and refresh. Verify all draft state persists. Invalid geometry must remain blocked.
8. Replace the source PDF and verify old suggestions do not attach. If testing a server restart during a paid request, expect possible billing and an unavailable job; never assume restarting cancels it.

The owner must verify actual rendering, alignment and paid provider access. Focused mocked tests do not establish real inference success.

## Future Netlify deployment — not implemented

A regular synchronous function is not a reliable home for requests that exceed 90 seconds. Netlify's [Background Functions](https://docs.netlify.com/build/functions/background-functions/) can execute for up to 15 minutes, enough for the current 420-second timeout, but background execution alone is not a durable job/status system.

A production deployment needs protected admission (identity or another approved access gate, abuse controls and quotas), durable idempotency/budget records, temporary input storage with expiry, a persisted job/status/result store, and a background worker with safe recovery. Netlify Background Functions could run the request if the site's plan/payload limits support the design; large images should be temporarily stored and referenced rather than embedded in an invocation. Platform retries must be guarded by a durable paid-admission record and must not rerun ambiguous paid attempts. A small external durable worker is an alternative if Netlify's available capabilities/limits are unsuitable. Polling client routes can stay the same. Do not transplant the local service's detached promise into a short-lived function. No production infrastructure or deployment is included here.

## Phase 3 file map

New files:

- `server/ai-server.mjs`: localhost admission, job status, bounded provider requests and spending ledger.
- `server/ai-pipeline.mjs`: frozen request assembly, image/response validation and usage-cost estimates.
- `server/ai-assets/config-used.json`, `product-prompt.txt`, `output-schema.json`, `provenance.json`: copied assets and hashes.
- `src/lib/ai/contracts.ts`, `preparePage.ts`, `jobClient.ts`, `workflow.ts`: transport contract, dedicated image preparation, polling and page-bound persistence.
- `src/components/AiSpaceDetectionPanel.tsx`: explicit launch/disclosure and indeterminate status.
- `tests/ai/service.test.mjs`, `workflow.test.mjs`, `frozen-spaces.json`: focused mocked service/workflow checks and recorded JSON fixture.
- `docs/AI-SPACE-DETECTION.md`: setup, retention/recovery behavior, manual test and production requirements.

Modified files:

- `src/lib/pdfViewerSource.ts`, `src/lib/pdfium/protocol.ts`, `src/lib/pdfium/pdfium.worker.ts`: dedicated high-resolution render path; existing viewer budgets remain unchanged.
- `src/lib/localAiImport.ts`: recognizes the explicitly versioned browser PDFium preparation adapter while retaining research imports.
- `src/db/database.ts`: isolated AI job/review stores and accessors.
- `src/components/RoomPanel.tsx`: development-only entry point.
- `src/i18n/he.ts`, `src/i18n/en.ts`, `src/index.css`: local feature copy and compact status styling.
- `package.json`, `vite.config.ts`, `.env.example`, `.gitignore`: service command, local proxy, safe configuration template and ledger exclusion.

Pre-existing Phase 1–2.1 and owner changes are preserved. Phase 3 does not modify Room types, quantities or the existing Room mutation/history actions. No dependencies were added.
