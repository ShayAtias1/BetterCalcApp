# A4.3 — openings AI UI

The existing Doors & Windows panel now offers **זיהוי דלתות וחלונות באמצעות AI**
(**Detect doors and windows with AI**). Like existing room AI, the paid launch
control is development-only because the service is localhost-only. No deployment
or production admission changes are included.

Clicking prepares the current page and obtains the free A4.2 cost preview. The
existing app confirmation modal displays the estimated USD API cost, conservative
reservation, frozen-pricing caveat, image disclosure, retention/billing notice and
manual-review requirement. Only affirmative confirmation submits its bound request.
Cancel or navigation before confirmation discards the ephemeral preparation without
paid submission. Double clicks are blocked. Preparation and inference use indeterminate
progress; failures remain visible. Failed attempts are not retried automatically.

Opening the panel resumes saved openings jobs with free GETs, loads page/PDF-bound
results and imports them into the existing canonical Plan.openings editor. Import
uses deterministic candidate IDs. Canonical drafts and a consumed-review marker are
committed atomically in IndexedDB; repeated activation, deletion or undo cannot replay
that review. A completed detection disables another scan of the same page/PDF rather
than causing a new paid request on reopening. Import rebases on the current Plan and
aborts the persistence transaction if the Plan changes during its writes.

Every imported opening is a draft with unknown width, height, base and count, no room
associations, no quantity consent and retained AI provenance. Existing span editing,
classification, explicit calibrated-width action, room-side selection, approval,
undo/redo and quantity feedback remain authoritative. The list shows AI/review status;
the editor exposes model evidence and ambiguity. Model review flags never approve.

Deferred observations have null geometry and appear as selectable dashed amber boxes
with question marks. Selecting a marker opens the same editor. **Place opening endpoints
on plan** reuses two-click endpoint placement on that record. No snapping or inferred
endpoints/dimensions are added. An unresolved marker cannot be approved; classification
and valid geometry need manual review. Ordinary uncertain spans retain their source
endpoints and require classification/geometry review through the same editor.

A PDF replacement hides old AI geometry in the active source frame and returns stale
AI approvals and quantity consent to draft/unconfirmed. Copied standalone editor
openings detach AI identity. Manual openings and room AI are otherwise unchanged.
Existing quantity eligibility and export rules remain untouched: drafts, unresolved
geometry, missing dimensions/count, unconfirmed room faces and legacy ambiguity do
not add deductions. Explicitly reviewed eligible approvals use the existing engine.

Focused mocked validation covers modal cancellation, navigation, consent, repeat
activation, consumed-result persistence, deferred placement, edits/approval/undo,
quantity eligibility and rendered Hebrew controls/markers. Room, one-click, batch,
manual opening and quantity lifecycle regressions are included. Real-browser storage,
visual pointer interaction and live provider access remain unverified. No real paid
calls, commits or deployment were performed.
