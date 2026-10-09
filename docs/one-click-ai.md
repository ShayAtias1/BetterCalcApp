# Stage 4.1 — One-Click AI (experimental)

Implemented from checkpoint `a7c2162` on branch `feat/one-click-ai` in `/Users/ADMIN/Documents/BetterCalc/archive/worktrees/oneclick`. No merge, push or deployment.

## Behavior

In the desktop development workspace, open a PDF and the Rooms panel. Activate **One-Click AI (experimental)**, then click inside one room. Escape cancels selection without clearing existing suggestions. Space + drag or middle-button drag pans without submitting; existing zoom/navigation remains available. Changing tool, page, plan or selection cancels the armed mode. The first target click disarms the mode, and the shared job guard prevents repeated submissions while preparation/inference is running.

The existing independent PDFium renderer prepares its 5500px page raster. One-Click sends exactly two PNGs: the complete page for context and a point-centered crop up to 3000 × 3000 pixels at the same raster resolution. It does not run full-page room enumeration. The separately versioned `server/one-click-assets/v1/` prompt/schema/config request only the selected space from the server-side `gpt-6.1-sol` model. Model access and effectiveness with this new prompt remain experimental. Full-page frozen assets are unchanged.

The prompt receives the exact target in native displayed-page units, page pixels, page-normalized coordinates and crop pixels, plus crop origin/size. Output vertices use normalized full-page coordinates. Mapping is `native = normalized × recorded page pixel dimension / recorded renderScale`; intrinsic rotation is already included. Keeping the full-page frame lets a target polygon extend beyond the detailed crop. Source imagery has no marker obscuring evidence.

A valid provider response is either one target polygon or `UNCERTAIN` with no polygon and an explanatory reason. Uncertainty produces no suggestion and displays the reason. Invalid/truncated responses fail without retry. Geometry checks block invalid topology, page bounds violations and polygons missing the target point; no topology repair occurs. Target containment remains checked after edits and at approval. Existing Room overlap is conservatively warned for interior containment/crossings, including significant overlaps; shared edges alone are allowed. Overlap warnings refresh after vertex edits/restoration and use the existing warning review controls.

The result enters the existing editable AI suggestion queue, alongside any pending full-page suggestions. Vertex editing, insertion/deletion, classification, warning review and approve/reject use existing actions. Approval creates an ordinary Room, preserves target provenance, uses existing quantity/history/persistence paths and creates no finish work items. Suggestions, source hashes, manifests, jobs and request identities use existing IndexedDB stores and recovery polling. A source replacement cannot inherit the result. Paid POSTs are never automatically repeated.

The localhost service reuses its API key isolation, exact origin checks, body/image limits, one-active-job guard, shared request/spending caps, conservative reservation ledger and free GET recovery. Both modes consume the same caps. No authentication or cloud service was added.

## Local manual test

Use two terminals in `/Users/ADMIN/Documents/BetterCalc/archive/worktrees/oneclick`:

1. Provide the existing server key/settings through your shell environment, or create ignored `.env.ai.local` in this worktree. Configure `OPENAI_API_KEY`, optionally `AI_MAX_REQUESTS` and `AI_SPEND_LIMIT_USD`, using the AI section of `.env.example`. Never put the key in a `VITE_*` setting. Keys are not copied into this worktree automatically.
2. Start the existing localhost service with `npm run dev:ai`. If your existing service occupies port 4781, stop that service manually first; no service was started or stopped during implementation.
3. In the other terminal run `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`. Open the printed local URL yourself. The default service origin allowlist includes port 5173. For another frontend port, explicitly set `AI_ALLOWED_ORIGINS` on the service to that exact local origin. Vite's existing `/ai` proxy uses port 4781.
4. Open a PDF in the Rooms panel using a desktop mouse. Activate One-Click and click inside a clearly bounded room. **That click is the first paid real inference and is for the owner to perform.** Look for preparing/processing status and then a selected editable suggestion or uncertainty reason.
5. Review warnings and classification; move, insert or delete vertices if needed. Moving the polygon away from the selected point must block approval. Approve it, check that it behaves like a manual Room and has no automatic finish items. For an overlapping existing Room, inspect the overlap warning.
6. Test Escape before clicking, Space/middle-button pan, zoom, rapid repeated clicks, a missed room alongside pending full-page drafts, and page navigation/refresh while a job is running. Revisit the source page to review its persisted result. Test a room extending outside the local crop and a rotated page.

Touch/phone authoring is intentionally disabled for this desktop MVP, consistent with the existing AI vertex review restriction. Unsupported PDFium fallback/page metadata fail preparation before any paid submission.

## Focused verification

```sh
node --experimental-test-module-mocks --import ./tests/resolve-ts.mjs --test \
  tests/ai/oneClick.test.mjs tests/ai/service.test.mjs \
  tests/ai/workflow.test.mjs tests/ai/review.test.ts \
  tests/takeoff/localAiImport.test.ts
```

31 focused tests passed using frozen outputs, header fixtures, mocked provider calls, mocked storage and existing approval/geometry actions. No paid API calls, browser, Playwright, UI automation or broad QA were used.

App TypeScript check: `./node_modules/.bin/tsc -p tsconfig.app.json --incremental false`. It reports the same six pre-existing errors as an independently extracted checkpoint: RebarZones, StirrupShapeBuilder (two), useTouchMeshLayout, structuralPdfLayout and structuralPlan. No new app type errors. The initial `tsc -b` also encountered existing structural test typing errors. Full build is therefore not certified. Focused oxlint found no errors and one existing PdfViewer `transform` dependency warning. `git diff --check` passed.

Unverified: real model/schema acceptance, target accuracy, latency/cost, actual PDFium image/crop rendering, browser click/pan/zoom behavior and real IndexedDB refresh recovery. These require the owner's manual local test. The crop is a detailed subset of the shared 5500px raster, not an additional higher-DPI rerender; very large pages may need a future crop-resolution refinement. Overlap checks are conservative review warnings, not an exact overlap percentage.

## Changed files

- `server/one-click-assets/v1/config.json`
- `server/one-click-assets/v1/prompt.txt`
- `server/one-click-assets/v1/schema.json`
- `server/one-click-pipeline.mjs`
- `server/ai-pipeline.mjs` — share schema matching support; frozen assets unchanged
- `server/ai-server.mjs`
- `src/lib/ai/oneClick.ts`
- `src/lib/ai/contracts.ts`
- `src/lib/ai/preparePage.ts`
- `src/lib/ai/workflow.ts`
- `src/lib/localAiImport.ts`
- `src/lib/localAiReview.ts`
- `src/store/appStore.ts`
- `src/types/index.ts`
- `src/components/AiSpaceDetectionPanel.tsx`
- `src/components/PdfViewer.tsx`
- `src/i18n/en.ts`
- `src/i18n/he.ts`
- `src/index.css`
- `tests/ai/oneClick.test.mjs`
- `tests/ai/workflow.test.mjs`
- `tests/takeoff/localAiImport.test.ts`
- `docs/one-click-ai.md`
