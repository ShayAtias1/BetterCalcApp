# Application dialogs and Bulk Takeoff

Implemented in `/Users/ADMIN/Documents/BetterCalc/app`, branch `integration/ai-oneclick-multiplan`.

## Phase A

### 1. Native-dialog audit and replacements

All 25 user-facing browser popup call sites were migrated. Existing operation messages were preserved.

| Classification | Call sites | Replacement |
| --- | --- | --- |
| Paid-processing confirmations (2) | Full-page AI detection; One-Click arming | Shared application confirmation with AI title and explicit start/arm action |
| Room confirmations (5) | Room detail deletion; list deletion; keyboard deletion; replacing template items; duplicating into an existing apartment | Shared confirmation; room deletions use destructive styling |
| Structural deletion confirmations (4) | Concrete element; rebar item; rebar layout removal; keyboard stirrup deletion | Shared destructive confirmation; existing mutations untouched |
| Project/Plan/comparison deletion confirmations (3) | Delete project, Plan, comparison | Shared destructive confirmation; existing content warnings retained |
| Revision removal (1) | Comparison revision layer removal | Shared destructive confirmation |
| Input prompts (4) | Rename Plan, comparison, revision; name an apartment | Shared input dialog, prefilled where appropriate |
| Notices (6) | Invalid Plan PDF; invalid comparison original/revision PDFs; export failure; nothing to export; skipped comparison pages | Non-blocking, individually dismissible notices |

The remaining textual `confirm()` occurrence in ProjectOverview is an existing local async add-Plan function. It does not invoke the browser popup API.

### 2. Shared dialog system

`AppModal` uses an HTML `<dialog>` rendered inside the application and styled with existing BetterCalc tokens. `showModal()` provides browser focus containment and an inert background. Escape cancels; closing restores prior focus when the element still exists. Dialog keyboard events do not reach canvas shortcuts. Simple confirmations remain compact. Destructive actions have a distinct primary action, with cancellation focused first. Prompt inputs are labeled and prefilled. Hebrew RTL and English LTR follow the existing language setting.

`appDialogs` provides queued async confirmation, destructive confirmation, input prompt, and informational dialog APIs plus non-blocking notices. `AppDialogs` mounts once at the app root. Workspace navigation cancels outstanding requests to avoid applying a delayed decision to another workspace. Queued confirmation requests also suppress canvas keyboard shortcuts before the modal has rendered.

### 3. AI confirmations

Full-page detection opens an application dialog before submission. One-Click opens it before arming the next room click. Both retain the complete existing disclosures concerning paid OpenAI processing, image transmission, retention, local drafts, and review. Cancel does not authorize the operation. The existing Multi-Plan scope/cost review and paid-request confirmation remain intact, with no additional consent step.

### 4. Destructive confirmations

The same existing deletion/removal functions run only after a positive decision. Existing names, marks, and content warnings appear in the message. Room deletion remains connected to existing history. Template replacement and duplication into an existing apartment retain their prior confirmation safeguards. No concrete/rebar business logic changed.

### 5. Intentionally retained native behavior

The existing `beforeunload` guard still protects unsaved Plan/comparison work during browser close or refresh. This requires browser-native behavior. Native file selection remains an ordinary platform file picker. No user-facing alert/confirm/prompt calls remain.

## Phase B

### 6. Opening Bulk Takeoff

Use **Assign work items in bulk / שיוך עבודות למספר חדרים** in the Room list or Room detail navigation. It opens a wide four-step workspace.

Each Multi-Plan result page with approved rooms also offers the action. It uses the existing Plan-open/navigation path, then opens Bulk Takeoff filtered to that PDF page. The user can broaden the page filter to the whole current Plan. Pending AI suggestions remain in the existing AI review workflow.

### 7. Selection and filters

Choose all Rooms matching the current filters, choose/deselect individual Rooms, or clear selection. Filters cover confirmed `roomType`, apartment, and PDF page; a search field matches room/apartment names. Unclassified rooms are available without treating suggested AI labels as confirmed classifications.

Selection persists across filter changes. A notice states how many selected Rooms are outside the visible filter, and the final preview includes every selected ID. Only persisted closed Room records qualify. Both manual and approved AI Rooms use the same workflow. AI review metadata is preserved; a provenance `requiresReview` flag does not turn an already approved Room back into a suggestion.

### 8. Work items and configuration

All six existing finish types are supported: flooring (`tiling`, regular/AS), wall cladding, skirting (`panels`), painting, plaster, and waterproofing.

Each selected type is configured once using only existing fields: tiling category, applicable height, waste percentage, and applicable opening deductions. Starting values come from the existing Plan defaults/catalogue through the quantity helpers. An AS-category change follows the AS waste default if the waste value still matched its prior default. A manually customized waste value remains unchanged.

Room geometry, classification, apartment membership, page ownership, notes, AI provenance, and openings are preserved. No material-specification fields were added because the current WorkItem model does not contain them.

### 9. Protecting existing work

- **Add missing** is the default: preserve existing matching configurations and add missing types only.
- **Update existing** updates matching configurations and adds missing types; a separate explicit acknowledgment is required in the final preview. Matching item IDs remain stable; unrelated types remain intact.
- **Skip conflicts** skips the entire Room when it already contains any selected type.

Existing multiple items of a selected type are preserved by Add missing and Skip conflicts. Update existing blocks such Rooms rather than guessing which item to replace or collapsing data. Resolve those items individually first. Repeating the same assignment creates no new duplicates and records no history action when nothing changes.

### 10. Preview and final confirmation

The preview uses the same pure planner that the store rechecks at commit. It shows selected count, changed/skipped/blocked counts, conflict count, selected settings and policy, each Room/page, additions/updates, conflict types, and blocked reasons.

Missing/nonfinite/nonpositive page scale, incomplete/invalid geometry, invalid work configuration, unavailable Room IDs, and ambiguous duplicate-item updates block the affected operations. Height must be positive where required; waterproofing upturn can be zero. Waste must be finite and between 0 and 100. Blocked and skipped Rooms remain unchanged; eligible changes can still be applied after reviewing these outcomes.

Net/order quantities for the added or updated items use `roomMetrics`, `calculateWorkItem`, and `effectiveWastePercent`, including each Room's existing opening deductions. The preview explicitly states its quantity scope. Blocked/skipped entries show no fabricated quantities. Existing report/export engines remain unchanged.

The final action is **Apply to X Rooms / החל על X חדרים**. Update existing requires the acknowledgment checkbox. A changed Plan invalidates the reviewed snapshot; apply stays disabled until the user refreshes and reviews it. The store rejects stale references and unconfirmed overwrite requests independently of UI controls.

### 11. Undo/redo and persistence

All eligible Room changes are materialized before mutation, then committed through one immutable Plan replacement and one existing history `push`. Pending debounced edits are flushed as separate prior actions. One undo restores the whole bulk operation; redo restores the same item IDs/configurations. Empty/no-op operations do not create history entries.

The existing dirty state and autosave scheduler persist the ordinary Plan model through IndexedDB. Existing save-failure feedback remains in use. Application success feedback means the in-memory mutation succeeded; it does not replace the application's saved/unsaved indicator. No persistence schema or export format changed.

### 12. Plan scope

Complete current-Plan workflow, including multiple PDF pages. No cross-Plan mutations or atomic cross-Plan undo are claimed. Entry state carries explicit Plan/page identity, keeping future scope extensions possible. Multi-Plan AI remains responsible for inference/review; Bulk Takeoff is responsible for approved-Room work-item configuration.

## General

### 13. Files changed by this task

Shared dialogs and notices:

- `src/components/AppModal.tsx` (new)
- `src/components/AppDialogs.tsx` (new)
- `src/components/AppDialogs.css` (new)
- `src/lib/appDialogs.ts` (new)

Bulk workflow:

- `src/components/BulkTakeoff.tsx` (new)
- `src/components/BulkTakeoff.css` (new)
- `src/components/bulkTakeoffEntry.ts` (new)
- `src/lib/bulkTakeoff.ts` (new)
- `src/store/appStore.ts`

Integration, translations, and migrated call sites:

- `src/App.tsx`
- `src/components/AiSpaceDetectionPanel.tsx`
- `src/components/MultiPlanAi.tsx`
- `src/components/RoomPanel.tsx`
- `src/components/PdfViewer.tsx`
- `src/components/ConcretePanel.tsx`
- `src/components/RebarPanel.tsx`
- `src/components/ProjectOverview.tsx`
- `src/components/StartScreen.tsx`
- `src/components/compare/LayerPanel.tsx`
- `src/components/compare/NewComparisonDialog.tsx`
- `src/components/compare/CompareWorkspace.tsx`
- `src/lib/exportFailure.ts`
- `src/i18n/he.ts`
- `src/i18n/en.ts`

Focused tests and report:

- `tests/takeoff/appDialogs.test.ts` (new)
- `tests/takeoff/bulkTakeoff.test.ts` (new)
- `tests/takeoff/bulkTakeoffStore.test.ts` (new)
- `docs/NATIVE-DIALOGS-BULK-TAKEOFF.md` (new)

### 14. Focused verification

- 18 tests passed: new dialog-service/planner/store tests plus the existing quantity regression file. Real store/history/autosave scheduling was exercised; only the IndexedDB persistence boundary was intercepted in the store test.
- Focused TypeScript check from the App entry against HEAD: zero added diagnostics. Existing structural diagnostics remain. A project no-emit check also identified the existing errors in RebarZones, StirrupShapeBuilder, useTouchMeshLayout, structuralPdfLayout, and structuralPlan; these were not modified.
- Oxlint on new modules, tests, and migrated call sites passed.
- New CSS parsed successfully; new Hebrew/English translation keys and placeholders match.
- Native-popup source audit and `git diff --check` passed.

No browser, Playwright, UI automation, manual UI QA, broad test suite, full build, paid API call, push, deployment, or merge was performed. This task did not commit.

The existing UX work was initially uncommitted. During implementation, the owner authorized another chat to commit that earlier work as `59470d7` (`feat: refine multi-plan workflow and unify AI tool entry points`). That chat explicitly excluded the new dialog changes from its staged versions and was idle when the external commit was detected. This task's changes remain uncommitted; existing UX work was preserved.

### 15. Known limitations

- Current Plan only; no cross-Plan atomic editing/history.
- Existing phone review-only authoring restrictions are respected.
- Invalid calibration must be corrected in the Plan workspace before blocked Rooms can receive the bulk changes.
- Multiple pre-existing matching items require individual cleanup before Update existing.
- Configuration exposes only the existing finish model; no material names/tile dimensions were invented.
- Native-dialog focus, layout, RTL/LTR, and Multi-Plan entry presentation need owner manual testing.
- The repository's existing structural type errors prevent an entirely clean project type check.

### 16. Owner manual test checklist

1. In Hebrew and English, verify AI full-page and One-Click consent content, cancel/confirm, keyboard focus, Escape, and returning focus to the trigger. Confirm that opening/cancelling consent sends no request.
2. Check room/project/Plan/comparison/revision and structural-item deletion messages, red action, cancellation, and existing undo where supported. Verify canvas shortcuts do not operate behind a dialog.
3. Check rename prompts, apartment naming, template replacement, existing-target apartment duplication, and dismissible invalid-file/export notices.
4. Verify unsaved close/refresh protection still uses the browser warning.
5. Open Bulk Takeoff from Room list/detail and a Multi-Plan result page. Confirm the latter opens the correct Plan/page and does not invoke inference.
6. Select manual and approved AI Rooms across apartments/pages, use confirmed-type filters, deselect individual Rooms, change filters, and check that hidden selections are clearly counted. Ensure pending suggestions are excluded.
7. Configure all six types with regular/AS flooring, heights, waste, and opening deduction choices. Review per-Room net/order values against existing Room detail/report values.
8. Exercise all three policies on mixed empty/configured Rooms. Confirm Add missing retains specifications, Skip conflicts skips whole Rooms, and Update existing requires acknowledgment and preserves unrelated items.
9. Test uncalibrated pages, cleared/invalid fields, duplicate matching items, and an all-skipped/blocked selection. Check preview reasons/counts and the final action count.
10. Apply to dozens/hundreds of Rooms; verify one undo/redo covers the entire batch. Wait for the existing saved indicator, refresh, and verify persistence and normal Excel/PDF exports.
11. Check keyboard navigation, background isolation, focus restoration, scrolling, and dark/light appearance. Layout has not been manually inspected by the agent.
