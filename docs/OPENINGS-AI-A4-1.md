# A4.1 — openings AI foundation

This is offline foundation only. No UI, job admission, paid request, canonical Plan
mutation, persistence migration or quantity integration is added. Room AI files are unchanged.

`server/openings-ai-assets` contains byte copies of the Vision-002 Original prompt,
schema and config from `BetterCalc-AI-Lab/openings-poc/runs/vision-002`. Provenance
records SHA-256 hashes. `server/openings-pipeline.mjs` verifies them on load and exposes
the frozen assets and offline response parser. It has no network execution path and
does not depend on the lab at runtime. Frozen pricing is historical, not a live estimate.

`src/types/aiOpenings.ts` defines a separate `openings-v1` task, candidates, deferred
observations and review envelope. `src/lib/ai/openings.ts` validates parsed output or a
completed Responses envelope. Invalid schema, coordinates, spans, bboxes or duplicate
IDs reject the entire result; an invalid response never becomes an empty success.

Geometry uses the existing PDFium five-image manifest. Mapping is exactly:

`native = (tile origin pixels + normalized coordinate * tile size pixels) / renderScale`

Intrinsic rotation is already represented by the native frame. No viewer zoom/pan or
second rotation is applied. Only the supported standard page frame, 5500px preparation
and frozen tile layout are accepted. Nonfinite/out-of-range coordinates, zero spans,
endpoints outside their bbox and mapped coordinates outside the native page are rejected.
Coordinates in ceil-rounded raster padding are rejected, never clamped. Raster dimension
validation tolerates machine epsilon from serialized DPI; endpoint mapping is unchanged.

Hinged/sliding doors map to door + hinged/sliding; doorway maps to door + open;
open passage maps to open-passage + open. Windows retain unknown mechanism, with
unsupported walkable access. Other access proposals remain unknown. Raw types and model
confidence/review flags are retained in source evidence, never treated as authorization.
All candidates require review and start as drafts. No dimension/count defaults are created.

Valid uncertain spans remain editable proposals outside Plan.openings. Deferred observations
are a separate array with bbox, evidence and reason, and explicitly null geometry. They never
receive inferred endpoints. Coverage notes are retained. Review and candidate identities
include task, plan, page, PDF hash and import ID; repeated parsing is deterministic and
separate jobs remain distinguishable. Each candidate retains independent copies of its
original tile-local evidence and preparation manifest. Future integration must persist these
records and prevent reimport; this foundation does not write them to IndexedDB.

Tests use copied saved JSON responses/metadata and synthetic coordinates; no PDF/image
assets, credentials or network calls are required:

`node --import ./tests/resolve-ts.mjs --test tests/ai/openings.test.ts`
