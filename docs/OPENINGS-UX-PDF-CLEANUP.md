# Doors & Windows UX and PDF cleanup

## Creation workflows

The Doors & Windows tab now separates two creation actions:

- **Place Opening on Plan / סימון פתח על התוכנית:** select a type and mark two jamb
  endpoints. This explicit single-opening action creates one draft physical record with quantity
  1; existing records with unknown counts are not changed. Width is measured only when the page
  is calibrated. Complete height/base, associations and review, then approve. No second legacy
  quantity row or quantity-only entry is needed. The opening remains on the drawing.
- **Add Opening to Quantity Takeoff / הוספת פתח לכתב הכמויות:** choose apartment and room,
  door/window/other, width, height, base and quantity in the compact inline form. Save a draft,
  confirm room faces and resolve any legacy conflicts, then approve in the same editor. No
  drawing coordinates are required or invented. Walkable access remains explicit; for skirting,
  confirm floor-access eligibility in the editor rather than inferring it from an uncertain door.

New quantity-only records carry an optional `entryMethod: 'takeoff'` marker. This explicit method
allows architectural approval without geometry when an actual room is associated. Old records
without the marker retain their existing geometry approval rule. Neither method automatically
approves, confirms room faces, invents dimensions or bypasses the existing quantity checks.
Existing calibration, base/height overlap, work-item settings, legacy precedence, duplicate guards,
shared-room treatment and waste remain in the same quantity engine. An approved canonical record
is counted physically once, with valid deductions on either associated face where applicable.

Choose one method per physical opening. Resolve matching historical rows using explicit legacy
links; confirm distinction only when rows truly represent different openings. Positionless records
cannot be automatically matched physically from identical dimensions alone. No automatic migration,
merge or destructive rewrite was added.

Existing legacy rows remain editable in **Existing legacy quantity rows / שורות כמות ישנות קיימות**,
with apartment/room selectors and their historical behavior preserved. New creation is routed
through the two canonical actions, avoiding a competing legacy-add path. Empty legacy sections
are hidden; existing rows are neither deleted nor converted.

## Cancellation

The placement panel and PDF viewer both show a visible Cancel / Esc action. The viewer control
stops drawing click propagation. Escape works even while an opening input has focus. Cancel clears
only the transient first-endpoint/session state, preserving saved openings and history. The inline
quantity form has both Cancel and an accessible X; its local values are discarded without writing
anything to the plan. Starting either method cancels the other temporary creation workflow.

## PDF exports

Plan and project PDF export dialogs have **Include detailed openings schedule / צרף פירוט דלתות וחלונות**,
default off, shown only when Finishes is selected. The option is presentation-only, not stored in
project data, and does not affect Excel.

Default PDFs retain the primary quantity tables and concise positive gross/deduction/net entries.
Redundant legacy opening-detail blocks, separate physical-count tables, detailed exclusion ledgers
and explanatory opening-only notes are removed. Zero deductions are filtered from PDF deduction
summaries. The main room table retains its concise existing opening information.

When enabled, one compact physical opening schedule is added, with type/label, width, height,
base, counted quantity, associations and status. Relevant deductions remain in the primary
report's deduction summary rather than being repeated in the schedule. Shared canonical openings
appear once in the schedule, while room-side deductions may appear for both faces. Existing
explicitly linked legacy rows remain grouped by the shared schedule implementation.

No separate explanation-only opening page is created. Optional section headings reserve space
for a header and first row. Hebrew RTL, English LTR, existing vector styling and local fonts remain.

## Files changed for this request

- `src/types/openings.ts`, `src/lib/planOpenings.ts`: explicit coordinate-free method and safe approval validation.
- `src/lib/manualOpenings.ts`, `src/store/appStore.ts`: quantity-only draft input and one-per-mark placement count.
- `src/components/OpeningsPanel.tsx`, `src/components/QuantityOpeningForm.tsx`: separated creation actions and cancellable inline form.
- `src/components/RoomPanel.tsx`, `src/components/PdfViewer.tsx`, `src/components/Openings.css`: legacy editing layout, viewport cancel and spacing.
- `src/lib/openingQuantityReport.ts`: PDF-only schedule and positive deduction presentation helpers.
- `src/lib/exportQuantitiesPdf.ts`, `src/lib/exportProjectPdf.ts`: default cleanup and optional schedule rendering.
- `src/components/QuantityExportDialogs.tsx`, `src/components/ProjectOverview.tsx`: off-by-default PDF option.
- `src/i18n/he.ts`, `src/i18n/en.ts`: workflow and export labels.
- `tests/openings/creationMethods.test.ts`, `tests/openings/pdfCleanup.test.ts`, `tests/openings/persistence.test.ts`,
  `tests/openings/manual.test.ts`, `tests/openings/quantityLifecycle.test.ts`: focused checks and updated single-mark count expectations.
- This document.

## Verification and limits

43 distinct focused tests passed covering creation, approval, common quantities, legacy snapshots,
shared faces, cancellation, history, persistence at the mocked IndexedDB adapter boundary, bilingual
report data and actual plan/project PDF serialization. The PDF exporter check uses local fonts and
captured downloads, without rendering a plan or opening a browser. Changed-source TypeScript checks
passed. Visual UI/PDF review and real-browser storage remain for manual testing.

The pre-existing working changes were preserved, with a targeted pre-edit backup. No quantity
formula, Excel exporter, AI pipeline or Revision Compare change was made. No branch/worktree,
browser/Playwright, paid call, broad test/build/lint, commit, push or deployment was used.
