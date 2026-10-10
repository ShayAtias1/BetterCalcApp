# Openings Phase 3 — quantities and exports

Canonical openings now feed the existing `calculateWorkItem`, room summaries and project
aggregation; no second finish-quantity engine was added. Old plans without canonical
openings retain their original calculations, heights, opening defaults, waste, rounding
and formulas. No records are migrated, deleted, reclassified or rewritten on load.

## Eligibility and height-aware deductions

A canonical room-side deduction requires an approved, structurally valid opening, explicitly
confirmed room associations, positive finite width and height, positive integer quantity,
explicit nonnegative base elevation, valid page calibration and resolved legacy compatibility.
Nothing substitutes 1 for an unknown quantity or 0 for an unknown base: enter those values
explicitly when appropriate. Approval alone does not supply dimensions or quantity consent.
Unknown fields remain null, exclusions have reasons, and unresolved reports are marked partial.

For a wall finish covering `[0, finishHeight]`, the opening's overlap is:

`max(0, min(base + openingHeight, finishHeight) - base)`

The deduction is width × overlap × quantity. The existing work-item height override,
plan/catalogue finish defaults and deduct-openings switch remain authoritative. Painting,
wall cladding and plaster use this overlap. Skirting uses the existing net-length formula
and removes the width of confirmed floor-access doors/passages with base explicitly zero;
windows and raised openings do not remove skirting. Floor tiling/waterproofing remain unchanged.
Existing caps at gross quantity and waste applied to net quantity are preserved. Canonical
requests exceeding gross quantity are flagged rather than silently presented as complete.

One canonical record can serve two confirmed room sides: each applicable work item on each
side receives one deduction. Plan opening counts read the schedule once, not once per room.
Exact coincident canonical spans with overlapping/unknown vertical extents are flagged and
only the first approved representative contributes. Disjoint vertical extents, such as a
transom above a door, remain separate physical entries. Repeated canonical IDs are excluded.
There is no fuzzy geometry matching or destructive merge. Different work-item records remain
separate scopes under BetterCalc's existing formulas; overlapping scopes need human review.

## Legacy precedence

`Room.openings` continue calculating exactly as before, including their historical window
height treatment without sill information. Explicit `legacyRefs` make those rows authoritative
on the linked room sides; the canonical record never adds a second deduction on those sides.
A shared opening can use a legacy row on one side and an eligible canonical deduction on the
other, provided classification, dimensions and count agree with the linked physical record.
Disagreement blocks new canonical room-side deductions until reconciled. A link neither copies
dimensions nor changes the legacy row.

Linked legacy rows are grouped as one physical schedule entry across room sides. Their count
remains authoritative when all linked rows agree on type and quantity. Canonical fields and
entered quantity stay visible independently. Disagreements are flagged, including a different
canonical classification, dimensions or nonzero base; the count's legacy classification is
shown when it differs. If linked counts disagree, the counted quantity remains unknown.
Unlinked legacy rows retain their existing identity/count representation.

Without explicit links, ANY remaining legacy row in an associated room creates potential
ambiguity, even when its classification differs. A canonical addition is blocked until the
user links the matching row or explicitly confirms it is physically separate from the other
legacy openings in that room. No automatic matching is inferred from old rows, which carry no
position. Historical duplicate legacy rows cannot be safely discovered or corrected here;
existing legacy deductions remain unchanged and require explicit human reconciliation.

Quantity review is additive metadata in the existing Plan record. Geometry, association,
room-side, room geometry/ownership and related legacy edits invalidate quantity consent and
approval. Undo restores the entire prior Plan atomically. Copies reset review and approval.
Existing autosave and IndexedDB persistence carry these fields without a destructive migration.

## Manual workflow

1. Select an opening in Doors & Windows and supply width, height, base and quantity. For a
   floor-level opening, enter base `0`; for one physical opening, enter quantity `1` explicitly.
2. Select room sides using the current room selector; confirm the associated room faces.
3. Link existing legacy rows if they describe this physical opening. Otherwise confirm that
   this opening is separate from the other legacy rows in each affected room.
4. Approve after completing review. Subsequent edits return the record to draft.
5. Open the opening schedule in the Finishes quantity report to inspect physical counts,
   dimensions, associations, gross/deducted/net amounts and per-work-item exclusion reasons.

Approved known-type openings with known counts can be counted even when finish deductions
are unresolved; the overall report is still marked partial. An exterior/unassociated record
can be counted when legacy compatibility is resolved, but cannot deduct a room finish.
Unassociated records on plans with legacy rows stay excluded from new counts until their
relationship to those rows can be confirmed through actual room associations. Schedule counts describe physical entries;
per-room counts intentionally show the opening on both associated faces and must not be summed
as a physical plan count. Quantity values greater than one are explicit grouped quantities,
counted once per record, not multiplied by the number of associated rooms.

## Screen and exports

The room editor explains canonical exclusion reasons alongside gross/deducted/net quantities.
The Finishes report has a shared opening schedule and a visible partial-quantity warning.
Project totals are still the sum of the individual Plan quantities; readiness flags and the
project overview warning report unresolved opening quantities.

Plan/project Excel and PDF reuse a shared report layout for physical door/window counts,
schedules, actual work-item deductions and reasons. Excel dimensions/counts are numeric,
unknowns blank, and added sheets support the existing RTL/LTR selection. Existing worksheet
cells and live finish formulas stay intact. Project opening counts include a sum across plans.
Export page filtering applies to openings and standalone-opening sheets are exportable.
Plan PDF schedules use the existing vector writer and local report fonts; plan-image overlay
rendering itself was not redesigned in this phase. Existing legacy PDF room-row details remain
historical quantity-row detail, separate from the new physical schedule.

## Validation and limitations

Focused tests cover shared-room counting/deductions, window base overlap, all finish types,
skirting/passages, toggles, unknown inputs, explicit legacy linking/distinction, cross-type
legacy ambiguity, coincident/repeated records, gross caps, transoms, waste, project aggregation,
scoped bilingual Excel/PDF report data, Excel round-trip, actual vector PDF serialization,
review invalidation, undo and persistence at the mocked IndexedDB adapter boundary.

Legacy quantity snapshots pass. Direct comparison with the pre-change working snapshot confirms
existing plan/project Excel cells, formulas and widths are unchanged in both languages (new
information is appended). The older Excel snapshot suite still reports two pre-existing Hebrew
wording mismatches and one outdated project sheet-list assertion because schedules were added;
its snapshots were not rewritten to hide those differences.

Browser UI, visual PDF layout and real-browser storage still require the requested manual test.
Exact geometry checks do not establish general duplicate detection or wall/jamb accuracy.
Legacy window deductions intentionally retain historical formulas until explicitly reconciled.
No AI integration, Revision Compare change, browser/Playwright, broad QA, build/lint, paid API,
branch/worktree, commit, push or deployment was performed. Concurrent room-selector edits were
preserved and their focused side/persistence tests remain passing.

## Phase 3 files

- `src/lib/openingQuantities.ts`, `src/lib/openingQuantityReport.ts`: eligibility, schedule,
  duplicate guards, physical counts and shared audit/report data.
- `src/lib/quantities.ts`, `src/lib/projectQuantities.ts`: existing calculation integration and partial flags.
- `src/types/openings.ts`, `src/types/index.ts`, `src/lib/planOpenings.ts`, `src/store/appStore.ts`:
  quantity-review metadata, validation and safe invalidation/history.
- `src/components/OpeningsPanel.tsx`, `src/components/Openings.css`: explicit quantity and legacy review.
- `src/components/OpeningQuantitySummary.tsx`, `src/components/QuantityTable.tsx`,
  `src/components/RoomPanel.tsx`, `src/components/ProjectOverview.tsx`: schedule and quantity feedback.
- `src/lib/exportOpeningExcel.ts`, `src/lib/exportExcel.ts`, `src/lib/exportProjectExcel.ts`,
  `src/lib/exportQuantitiesPdf.ts`, `src/lib/exportProjectPdf.ts`: schedule/count/audit exports.
- `src/components/QuantityExportDialogs.tsx`, `src/hooks/useQuantityExportInfo.ts`: scoped opening export support.
- `src/i18n/he.ts`, `src/i18n/en.ts`: matching Hebrew/English quantity and audit text.
- `tests/openings/quantities.test.ts`, `tests/openings/quantityLifecycle.test.ts`,
  `tests/openings/persistence.test.ts`: focused Phase 3 checks.
- `docs/OPENINGS-PHASE-3.md`: usage, precedence, formulas, checks and limitations.
