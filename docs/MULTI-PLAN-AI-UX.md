# Multi-plan presentation refinement

Work is limited to `integration/ai-oneclick-multiplan` in the integrated checkout. The batch scheduler, AI transport/service, calibration, quantity formulas, review persistence and IndexedDB records remain unchanged.

## Problems addressed

The previous view combined page and calculation selection, expanded every PDF's pages, lacked mixed document selection feedback and placed batch history, actions, explanatory copy and large result tables at similar visual priority. Repeated per-Room buttons made results increasingly crowded as batches grew. Selection and cost information could scroll away from the action it explained.

## Presentation pattern

A wide, temporary dialog follows four stages: select plans, choose calculations, review and start, then processing/results. Project context and the stage indicator remain above one scrolling content region. A footer keeps selection context and the current action visible. The drawing workspace returns to its existing layout when the dialog closes.

The dialog reuses BetterCalc's `Icon`, primary/secondary/ghost buttons, surface/status colors, typography tokens, spacing rhythm, radii and shadows. Colors follow light/dark tokens; alignment uses logical properties for Hebrew RTL and English LTR. Tablet layouts reflow columns instead of truncating document names. The step list describes location; Back/Edit/Continue actions perform navigation.

### Selection

- Each PDF starts collapsed, with document name, original filename, total page count and a separate expand action.
- Its native checkbox means select/deselect the entire document. Partial page selection renders an actual indeterminate checkbox with `aria-checked="mixed"` and a selected/total count.
- Expanded pages appear as comfortable individual selection targets. Selection survives collapsing, going Back and closing/reopening the dialog within the current app session.
- Select all/Clear selection affect the imported PDFs in this project. The footer shows the valid selected page and document counts. Continue requires at least one page.

### Calculations and confirmation

Geometry and finish options are separate groups. Each option explains its effect and the relevant configuration. A shared note explains calibration and explicit finish-work configuration without adding bulk configuration fields or assigning anything automatically.

The scope screen groups selected pages by PDF and compresses consecutive page numbers into ranges. It lists chosen calculation types, total pages, reusable results and new paid requests. Existing requests in progress and failed pages remain visible in their document group. The existing estimate is unchanged; its explanation sits in expandable supporting copy. New paid work requires the labeled confirmation action; no-paid-work continuation has a distinct label. Resuming a saved batch reviews its existing scope without allowing changes to its persisted selections.

### Processing and results

A single saved-batch selector replaces the history button strip. Result pages are grouped by source PDF. Counts cover total, completed, queued, awaiting review and failed pages; the actual currently processing Plan/page is prominent. Stop/resume still use existing scheduling behavior. No percentages are introduced.

Each page has a detection/review state, quantity readiness and one main page action. Reviewed/rejected-only pages remain distinct from quantity-ready pages. Source mismatch, errors and missing configuration remain visible. Accepted Room actions and geometric details are expandable; the existing selected-page quantity summary is also expandable. Page navigation closes the dialog and uses the original review/Room controls. Opening the launcher returns to the results view. Existing project reports still cover all Plans.

### Keyboard behavior

The dialog receives focus, traps Tab among visible enabled controls, supports Escape to close, restores prior focus on close, and moves focus to the stage heading on navigation. Native checkboxes, labels, expanded-state buttons and disclosure summaries retain their standard keyboard behavior. These changes do not persist a new workflow state.

## Code checks and remaining verification

The no-emit TypeScript comparison against the integrated branch found the same six existing diagnostics and no additional diagnostics. CSS parsing and whitespace checks were used. No browser, UI automation, paid inference, full build, lint or broad QA was run. Visual rendering and viewport comfort therefore require owner verification.

Manual checks:

1. Select all of Plan A, only pages 2/3 of Plan B, and none of Plan C; check mixed states/counts, expand/collapse, Back, Edit and reopen.
2. Select different measurement sets and no measurements; verify descriptions, disabled continuation, unchanged configuration consequences and persisted chosen calculation IDs.
3. Review cached/new/in-progress/failed scope and cost; ensure Back/Edit do not submit and explicit confirmation remains the only start action.
4. Open saved batches, follow an active page, stop/resume and navigate to page-specific reviews. Test many pages and multiple documents.
5. Approve/reject/edit through the existing workspace, reopen results and verify accepted counts, pending calibration/configuration, Room selection and quantity summaries.
6. Check Hebrew and English, long mixed-language PDF names, desktop/tablet sizes, dark mode and short-height windows. Test keyboard selection, Tab confinement, Escape and focus restoration.

The entry now sits alongside full-page detection and One-Click in the Rooms workflow’s AI Tools section; the floating launcher was removed. The project-scoped dialog still mounts once at the app root. Finish configuration, service recovery limits and full-project reporting scope retain the existing feature's limitations. No commit, push or deployment is part of this refinement.
