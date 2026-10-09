# Openings: Phase 1 data foundation

`Plan.openings?: PlanOpening[]` is the additive physical-opening model. The existing
`Opening` type and `Room.openings` are unchanged legacy quantity rows. All existing
quantity calculations and exports continue reading only those room rows. Canonical
CRUD, review and deletion never write room rows, and approved canonical openings do
not participate in quantities in this phase. No automatic legacy conversion occurs
on load, save or edit. This prevents double counting and preserves old quantities.

The new model carries plan/page identity, optional room/apartment attribution, native
page-coordinate endpoints, kind, mechanism, walkable access, provenance, nullable
physical dimensions/count, explicit legacy links and draft/approved/rejected review
state. Unknown dimensions/count are null; no default sizes, count or calibration-based
values are generated. Legacy row defaults retain their historical behavior.

`src/lib/planOpenings.ts` provides pure readers, CRUD, validation/review and duplication
helpers. `useAppStore` exposes add/update/remove/approve/rejectPlanOpening, using existing
history tracking and autosave. Validation happens before mutation/history creation;
updates reset approval. Approval requires structurally valid geometry and a known
kind; nullable dimensions and unresolved mechanism/access stay explicit warnings.
Approval here is not quantity eligibility or a claim of complete architectural certainty.

`legacyRefs` link existing room rows by room + row id. A row cannot be linked to two
canonical openings. `openingInventory` hides linked legacy rows from a future combined
inventory only; it is not used by quantity calculations. Adding/editing/removing canonical
records never duplicates, changes or removes those legacy rows. Editing/deleting linked
legacy rows or changing related room geometry/ownership invalidates approval, without
copying sizes into the canonical record. Removed links are detached, physical records
remain as drafts and undo restores both.

Persistence uses the existing IndexedDB `projects` plan record, saved atomically by
`savePlan` and read by `loadPlan`. Optional nested fields need no database-version change,
new store, rewrite or destructive migration. Plans with no canonical array keep no array.

Plan copies renew plan, canonical, room and legacy-row ids and remap links. Apartment
copies duplicate openings wholly owned by copied rooms, plus explicitly attributed
standalone openings, with fresh identities and draft approval. Geometry/dimensions are
copied independently; no calibration or size inference. Cross-apartment shared openings
are left on the source, not copied with dangling links to uncopied rooms. Single-room
copies translate associated opening geometry by the existing 30 native-coordinate offset.
Old Room.openings and quantity duplication remain unchanged.

Focused checks cover legacy quantity invariance, no defaults/double count, reference and
geometry validation, immutable duplication, CRUD/history/approval, apartment/room copies,
legacy edits and room detachment. Persistence checks call the actual save/load functions
against a mocked IndexedDB adapter boundary; they do not exercise a browser storage engine.
Touched-source type diagnostics are checked in memory without build output. No UI, AI,
quantity behavior, browser QA, builds, lint, commits or deployment were added/run.
