# Openings Phase 2 — manual placement and editing

In the Rooms/Finishes workspace, expand **Doors & Windows**. Choose Hinged door,
Sliding door, Window, Open passage or Unknown opening, then choose **Place opening**
and click the two jamb endpoints on the current page. The first click is a transient
preview; the second creates one canonical `Plan.openings` record. Escape or Cancel
abandons placement without a saved record or undo entry. Page/plan/tool changes also
cancel placement.

Select a span or its list row to edit it. Drag a selected span to move the whole opening,
or drag either endpoint handle. Mouse dragging previews locally and saves once on release.
Escape, pointer cancellation and navigation interruption discard drag previews. The
endpoint coordinate fields and **Replace endpoints on plan** also edit geometry; replacing
endpoints keeps the opening's identity, classification, dimensions and room links.
All coordinates use the existing unscaled native page frame and viewer transformation.

The editor exposes type, mechanism and walkable access separately, label, notes, width,
height and sill/base elevation. Blank dimensions remain null. Initial width is measured
only using valid calibration on the current page. Explicitly measured widths follow
geometry edits and recalibration; manually entered widths remain unchanged. **Use calibrated
span** switches a typed width back to measured mode. Heights, sills and counts receive no
default values. Entered widths must be positive; sill zero is allowed. Zero-length and
non-finite geometry are rejected.

Select zero, one or two rooms manually. Exterior/unassociated means no associated rooms;
this phase does not distinguish exterior from unknown association. Suggestions require
consistent polygon-boundary evidence on three samples along the opening, with unambiguous
room interiors on either side. Suggestions are displayed for explicit confirmation only.
They use room geometry, not recognition of architectural walls, and may be absent for
thick walls or imperfect room outlines. Links to legacy quantity rows are detached only
when explicitly removing the corresponding room association; the legacy rows themselves
are never removed or changed. Existing records with more than two linked rooms remain
intact until explicitly edited down.

Door types have different colors and symbols; windows have parallel rails, passages a
crossing arrow, and unknown openings a neutral span. Selected spans have blue highlighting
and endpoint handles. Draft/rejected spans are dashed, approved spans solid; unresolved
classification/mechanism/access has a question indicator. Selection labels/list rows expose
review status. The overlay follows the existing Finishes layer visibility. Labels and
controls support Hebrew RTL and English LTR.

Approve uses the Phase 1 validation rules: valid nonzero geometry and a known opening kind.
Unknown dimensions or mechanism/access remain warnings and are not implicitly confirmed.
Return to draft is explicit; edits reset approval. Duplicate offsets the copied geometry
by 30 native units, retains label/notes/dimensions, clears room/apartment associations and
legacy links for independent confirmation, and starts as draft. Delete affects only the
canonical record and requires the existing confirmation dialog. Delete/Backspace and the
existing Undo/Redo controls/shortcuts work with selected openings. Canonical changes use
the existing history and autosave/IndexedDB persistence; UI selection/placement are not saved.

Legacy `Room.openings`, quantities, export deductions and existing projects retain their
previous behavior. Canonical openings, including approved or duplicated ones, are not
included in quantity calculations. No migration, AI detection or automatic deduction is added.

## Changed files in Phase 2

- `src/types/openings.ts` — optional label, notes and width provenance.
- `src/lib/planOpenings.ts` — validate/edit the additive fields; explicit return to draft.
- `src/lib/manualOpenings.ts` — classification presets, measured width and advisory room suggestions.
- `src/store/appStore.ts` — selection/placement, endpoint replacement, duplicate/draft actions and measured-width recalibration.
- `src/components/OpeningsPanel.tsx` — creation and edit controls.
- `src/components/OpeningsOverlay.tsx` — styling, selection and mouse geometry editing.
- `src/components/Openings.css` — scoped opening control styling.
- `src/components/RoomPanel.tsx` — section inside the existing workspace.
- `src/components/PdfViewer.tsx` — placement, overlay, keyboard and touch-tap integration.
- `src/i18n/he.ts` and `src/i18n/en.ts` — matching opening control text.
- `tests/openings/manual.test.ts` — focused manual workflow checks.
- `docs/OPENINGS-PHASE-2.md` — usage, behavior and limitations.

## Checks and limitations

Focused checks cover two-point placement/cancellation, one-step creation history, measured
and typed widths, recalibration, identity-preserving endpoint replacement, detached duplicates,
review state, legacy quantity invariance, explicit suggestions and translation keys. Phase 1
CRUD/history/duplication and persistence adapter checks remain in place. Type diagnostics are
restricted to touched source files. Persistence tests use the existing mocked IndexedDB adapter,
not a real browser storage engine.

No browser/Playwright, broad QA, build, lint, API calls, commits or deployment were run.
The interface still needs the requested manual test. Mouse placement/dragging is the primary
editing workflow. Tablet taps support placement/selection; tablet touch drags retain the
existing pan behavior, so use endpoint replacement or numeric fields for geometry editing.
Phone authoring retains BetterCalc's existing view-only restrictions. There is no wall/jamb
snapping or automatic geometric correction, no door swing-side editing, and no AI suggestion.
