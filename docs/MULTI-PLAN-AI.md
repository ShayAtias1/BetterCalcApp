# Stage 5 — Multi-plan AI MVP

Implemented locally from checkpoint `a7c2162d60416c071108a0224bc7740b7c2c4704` on `feat/multi-plan-ai`, in `/Users/ADMIN/Documents/BetterCalc/archive/worktrees/multiplan`. No work depends on the One-Click branch.

## Architecture inspected

- `src/types/index.ts`: `Project` is a folder containing ordered Plan IDs; `Plan` is one PDF document with Rooms, page calibration and work defaults. A PDF page is a numbered source within a Plan. An apartment is a Room's `apartmentNumber`, independent of a Plan or project folder.
- `src/db/database.ts`: Plans remain in the historical `projects` store, folders in `takeoffProjects`, and PDF Blobs in `pdfFiles`. Existing AI jobs/reviews already have dedicated IndexedDB stores.
- `src/store/appStore.ts`: `openPlan`, `setCurrentPage`, `persist`, candidate approval/rejection, room work-item/opening controls and ordinary Room history/persistence are reused. AI approval intentionally produces no finish items.
- `src/lib/pdfViewerSource.ts`: PDF metadata supplies the true number of pages. Sparse `Plan.pages` calibration entries are not a page inventory.
- `src/lib/ai/{workflow,preparePage,jobClient,contracts}.ts`: request IDs, preparation manifests, PDF SHA-256, result import, review tombstones and free recovery polling already exist. The new adapter starts the same page workflow independently of the visible page.
- `server/ai-server.mjs` and `server/ai-pipeline.mjs`: existing server admission checks active inference, request cap and persisted spending reservation before each provider call. Frozen model/prompt/schema/images/coordinate mapping are unchanged.
- `src/components/{AiReviewWorkspace,AiSpaceDetectionPanel,RoomPanel,ProjectOverview,QuantitiesPanel}.tsx`: existing review dock, single-page detection, accepted Room configuration and project/Plan reports remain in use.
- `src/lib/{quantities,workTypes,roomProfiles,projectQuantities}.ts`: all numeric calculations use the existing engine. Flooring is `tiling` (regular/AS); wall cladding is `cladding`; skirting is `panels`, including existing door deductions and waste. Room profiles are not inferred or applied by the batch.

## Owner workflow

1. Open a project folder and choose **Multi-plan AI**. The same button is available while viewing its Plans.
2. Choose **New batch**. Check a Plan's **All pages**, or individual pages; deselect any page. The count updates immediately. Only existing locally imported PDFs appear.
3. Select floor area, perimeter, flooring, wall cladding and/or skirting. Detection is the batch's core operation. Selected operations persist with the batch and control its metrics, finish readiness and summary categories.
4. Review the Plan/page list, selection count, usable cached results, new paid-request count and non-guaranteed USD range. Confirm explicitly to start. A resume also goes through this scope screen.
5. Close the batch panel to navigate during execution. Open it again to see completed, current, queued and failed pages. Stop scheduling leaves the current preparation/request running and prevents the next queued page.
6. Open a completed page. Its suggestions appear in the existing AI Review Workspace; edit, approve or reject there. Reopen **Multi-plan AI** to return to the saved overview. No geometry or classification is auto-approved.
7. Calibrate accepted geometry with existing calibration controls. Select an accepted Room and open its existing details to add/configure the chosen finish work items, heights, waste and opening deductions. No work items are assigned automatically.
8. The selected-page summary uses existing `roomMetrics` and `buildProjectQuantities`, restricted to ordinary accepted Rooms on selected pages and selected operation categories. Geometric values stay absent without calibration. Finish totals stay pending if any participating accepted Room lacks that finish configuration. Wall cladding requires positive explicit item heights; the batch does not substitute a fallback height. Existing project summaries/exports remain available through the project overview; they cover all Plans and retain their existing formula/default behavior.

Pages show review progress, approved Room counts, missing calibration/configuration and quantity readiness separately. Approved Room values can be viewed while other suggestions still await review; the page itself remains awaiting review. Empty/rejected-only results do not become quantity-ready. Physical values never come from unapproved candidates.

## Execution and persistence

The batch scheduler calls the existing page job workflow sequentially. The next page waits for a persisted terminal job result. The service's original POST admission is the authoritative per-page concurrency/spending check; neither the limits nor the ledger are bypassed. A failure pauses further scheduling. Failed pages are never automatically retried; a deliberate resume can process the remaining queued pages. Repeating a failed paid inference requires a newly reviewed and explicitly confirmed batch.

Every new request ID is saved in its batch **before** the existing job workflow persists/prepares/posts it. Unknown interrupted submission identities are marked failed rather than resubmitted. The original job transport recovers ambiguous POST responses using free GET requests only. Completed source-matched review records are reused, including reviewed results. New paid requests always retain the original full-page overview plus four overlapping high-detail tiles, one inference per page.

IndexedDB version 5 adds only `aiBatches`; existing Plan and PDF storage does not change. Each batch saves ID, folder ID, calculation choices, Plan/page identity, SHA-256, existing review key, job request references, page status and scheduler state. Review decisions remain in existing review/Room records, not a duplicate approval system. Refresh converts running scheduling to paused, restores results and resumes existing job polling. Queued pages require an explicit resume confirmation. Recovered terminal page statuses are persisted even while scheduling stays paused.

A browser Web Lock prevents simultaneous batch schedulers in multiple tabs. Latest persisted batch records are reread after acquiring the lock. Individual job identities and the server spending ledger provide further duplicate/admission protection. Use one local service process, as required by the existing service.

## Cost and limitations

- The indicative range uses recorded local estimated costs (half the observed minimum to twice the observed maximum). With no local observations, it uses the checkpoint documentation's observed $0.076/page mean with that same range. This is an indication, not a forecast guarantee, spending authorization beyond the confirmation, or the server's conservative reservation. Current ledger admission may reject even a cheaply estimated batch. No caps are raised.
- Stopping scheduling cannot cancel a running paid inference. Pausing/failure/refresh never authorizes new paid work.
- The original local Node service retains outputs in memory for about an hour. A restart/expiry can make an admitted result unrecoverable; the ledger still prevents replay. The existing job recovery reports this failure. Previously imported and persisted completed reviews survive.
- Browser Web Locks are required for batch execution. Missing support or local persistence errors stop scheduling.
- Plan page counts require reading local PDF metadata. Missing PDFs are excluded; corrupted PDFs report an error. Large document sets can take time to inspect.
- Missing finish configuration is completed through existing Room controls after approval, not through bulk material assignment. No new materials/specification engine exists. Existing full-project reports use their existing defaults; the batch readiness gate is intentionally explicit about missing cladding height.
- Close older application tabs before using the new IndexedDB schema. Older checkpoint builds using DB version 4 cannot open a database already upgraded to version 5. Schema coordination will be needed when integrating separately developed branches.
- Browser UI, real service recovery and paid inference were intentionally not exercised. No browser, Playwright, UI automation, full build, lint, broad test suite, or paid API call was used.

## Focused validation

Run only:

```
node --import ./tests/resolve-ts.mjs --test tests/ai/batchModel.test.ts tests/ai/batchQueue.test.ts
```

Nine focused mocked/fixture checks cover sequential jobs, cached page skipping, stop-after-current behavior, failure with explicit continuation, storage failure blocking the next page, scope/source identity, uncalibrated values, missing finishes/explicit heights and historical estimates.

A no-emit TypeScript check was necessary to validate the integration. The checkpoint has six existing diagnostics in unchanged `RebarZones.tsx`, `StirrupShapeBuilder.tsx`, `useTouchMeshLayout.ts`, `structuralPdfLayout.ts` and `structuralPlan.ts`. Comparison with the exact checkpoint sources found no additional diagnostics; those unrelated errors were left untouched.

## Manual acceptance checks

- Select multiple Plans and selected pages within each; select all, deselect one, verify count and confirmation scope.
- Confirm cached source-matched pages produce no paid request; replacing/removing a PDF must prevent reuse/attachment to the wrong source.
- Start a small batch with the existing local service and observe one active inference, exact current page identity and navigation during processing.
- Stop while a request is active: it finishes, later pages stay queued. Resume requires scope confirmation.
- Review edited suggestions on multiple pages, approve/reject some, navigate away and return. Approved Rooms must have no auto-created finish work items.
- Verify an uncalibrated page shows no m²/m; calibrate and compare approved Room geometry with the ordinary quantity panel.
- Select different calculation sets; ensure only requested metrics/categories appear. Add flooring, explicit cladding height, and skirting through existing Room details; verify waste/opening deductions and pending configuration states.
- Compare selected-page finish results with existing per-Plan quantities and full-project summaries/exports, accounting for their different scopes.
- Refresh during preparation, active inference and with queued pages: no paid resubmission or automatic queued continuation. Verify completed reviews survive. Test service restart/expired job recovery deliberately.
- Trigger a cap rejection/failure and confirm the queue pauses without automatic retry. Verify rapid repeated start clicks and a second browser tab cannot start two batch schedulers.
- Check English LTR and Hebrew RTL on the owner’s target viewport.
