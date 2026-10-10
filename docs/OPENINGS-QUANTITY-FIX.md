# Manual opening quantity investigation and fix

## Findings

The canonical calculation connection is present: `Plan.openings` is filtered by page and
associated room in `calculateWorkItem`; its eligibility audit supplies deductions to the
existing formulas, room summaries, project totals and PDF/Excel report data. Immutable store
updates refresh the quantity table through its Plan dependency. No second calculator or legacy
conversion is needed.

Manual placement deliberately starts as draft, with measured width only when calibrated,
no room associations, and unknown height, base and quantity. Architectural approval is allowed
before quantity review is complete. Consequently an “approved” opening can still deduct zero.
The editor previously showed generic warnings without identifying the missing fields or actual
work-item exclusions. The new feedback exposes this distinction directly. This reproduces the
reported symptom; the owner's persisted project was not inspected, so its exact blocker cannot
be inferred from the report alone.

Two state/interaction defects could also remove an existing deduction:

- Canonical updates treated identical submitted values as edits, resetting approval and sometimes
  room confirmation. Updates now compare persisted values structurally before invalidating review.
  Unchanged submissions preserve Plan identity, approval, consent, history and save state.
- Endpoint drag release assigned the pointer position directly to the endpoint, so clicking a
  handle off-center could move it without dragging. Drag geometry now preserves the grab offset.
  An unchanged click leaves geometry intact; actual movement still invalidates review normally.

## Changes

- `planOpenings.ts`: ignore equivalent whitelisted patches; only actual geometry/association/page
  changes invalidate association review. Actual edits still return openings to draft.
- `manualOpenings.ts`, `OpeningsOverlay.tsx`: preserve endpoint grab offset during drag/release.
- `openingQuantityReport.ts`: editor feedback derived from the same schedule and item audits used
  by quantity reports/exports; no new formulas. Reports missing dimensions/count, review status,
  calibration, legacy ambiguity, disabled work, height exclusions and gross caps.
- `OpeningsPanel.tsx`, `Openings.css`, Hebrew/English dictionaries: live quantity status in the
  opening list and editor, counted quantity, named missing fields, affected rooms/work items,
  deduction amounts and exclusion reasons. Legacy-precedence help is conditional on actual links.
- `quantityLifecycle.test.ts`: full manual placement → review → deduction workflow, no-op edits,
  off-center handle geometry, genuine invalidation, undo/redo, calibration, legacy precedence,
  disabled deductions, missing inputs and bilingual diagnostics.

No quantity formula, legacy row, automatic approval/default, autosave mechanism, export formula,
AI detection or unrelated feature was changed. Existing uncommitted work remains in place.

## Focused verification

37 distinct focused tests passed across opening quantity/lifecycle, legacy quantity fixtures,
persistence, foundation and manual-placement checks. These include existing common PDF/Excel
report consistency, workbook round-trip and PDF serialization tests. Changed-source TypeScript
checks report zero diagnostics. The final handle fix was checked with the focused lifecycle
suite and changed-source type check. No browser, build, lint, broad QA, paid call, commit or
publication was performed. Persistence checks use the existing mocked IndexedDB adapter boundary.

## Manual verification

1. Use a calibrated page and a room with painting enabled, finish height at least 2 m, and no
   historical opening rows. Place a door and enter width 1 m, height 2 m, base 0 and quantity 1.
2. Associate that room, explicitly confirm its room face, then approve. The editor should show
   a 2 m² painting deduction, and gross minus net should equal 2 m² before waste. Skirting, if
   enabled, should deduct 1 running metre.
3. Click a handle off-center without dragging, or submit unchanged coordinates/calibrated width:
   approval and quantities should remain intact. Actually move a handle: the opening must return
   to draft with quantities excluded until associations are reviewed and it is approved again.
4. Clear height/base/count, turn off a work item's deductions, or remove calibration: inspect the
   specific exclusion feedback rather than expecting an implicit value or bypass.
5. In a room with legacy rows, link a matching physical row, or confirm distinction only when
   they truly represent separate openings. Linked rows remain authoritative without a second
   canonical deduction. Check undo/redo, reopen the saved plan and compare PDF/Excel totals.

Visual interaction and real-browser persistence remain for the requested manual verification.
