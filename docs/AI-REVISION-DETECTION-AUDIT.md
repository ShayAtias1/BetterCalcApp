# AI Revision Detection — Deep Audit

Date: 2026-10-14 · Scope: AI Revision Compare detection pipeline (`revision-page-v1`), compared with AI Quantity Takeoff (`spaces`, `openings-v1`).
Audit only: no code, prompt, schema or configuration was changed, and no AI request was made.

## Evidence labels

| Label | Meaning |
|---|---|
| **[V]** | Verified by reading the code path end to end. |
| **[D]** | Observed in data already on this machine: the 7 stored `revision-page-v1` runs in `.ai-local/spending.json` and the 4 full answers in `.ai-local/revision-results/*.json`. These are real answers. Whether their geometry is correct was **not** checked, because the source PDFs and manifests are not stored with them. |
| **[H]** | Hypothesis: plausible from the code or data, but not measured. |
| **[R]** | Recommendation. |

No accuracy percentage in this document is a measurement. The project has no ground truth for Revision Compare yet (§7).

---

## 1. Current pipeline architecture

### 1.1 End-to-end flow (primary path: full-plan AI analysis)

```
runAiPageAnalysis()                       src/lib/revision/revisionWorkflow.ts:353
 ├─ /ai/health  (task support + key configured)
 ├─ prepareRevisionPage()                 src/lib/revision/detect.ts:223      FREE, local
 │    extractVectorPage() ×2              src/lib/revision/vectorExtract.ts:78
 │    refineAlignment() + grade()         src/lib/revision/fields.ts:142, detect.ts:166
 │    └─ 'poor' alignment → stop, nothing sent
 ├─ prepareRevisionPageRequest()          src/lib/revision/aiPageAnalysis.ts:107
 │    PDFium raster 5500 px (prepareAiRaster) for original/base/revision
 │    warpInto(): revision (and chained base) drawn into the source frame through the alignment matrix
 │    10 PNGs: BEFORE_PAGE, AFTER_PAGE (≤2200 px overview) + BEFORE/AFTER × TILE_A..D (aiTiles, 1/1.82 crops)
 ├─ /ai/revision-previews → cost preview → confirmAiDialog (user consent)
 ├─ durable run record (requestId, digest, manifest, alignment) persisted BEFORE paid admission
 ├─ /ai/revision-jobs                     server/ai-server.mjs → revisionPageModelRequest()  server/revision-pipeline.mjs:116
 │    gpt-6.1-sol, reasoning low, imageDetail 'original', strict JSON schema, maxOutputTokens 24000
 ├─ track(): free status polling, never resubmits      revisionWorkflow.ts:196
 └─ completePageAnalysis()                revisionWorkflow.ts:312
      parseRevisionPageResult()           aiPageAnalysis.ts:210   (drops malformed items, does not repair them)
      drawingsInSourceSpace()             detect.ts:369           (vectors re-extracted, mapped with run.alignment)
      buildAiChanges()                    aiPageAnalysis.ts:251   ← AI geometry → verified/unverified proposals
        walls:   verifyWallNear()         vectorDiff.ts:845
        doors:   verifyDoorNear()         vectorDiff.ts:956  (result then overwritten, see W-3)
        openings: isRectangle + drawnShare(jamb edges) aiPageAnalysis.ts:296-319
        normalizeRevisionWallGeometry()   wallGeometry.ts:8
        dedupe(): sameVerifiedWall / sameChange   aiPageAnalysis.ts:369, changeMatch.ts:14
      mergeRevisionAiChanges()            compareStore.ts:1392   (existing equivalent change wins)
```

Downstream:

- Review and editing: `RevisionDetectPanel.tsx`, `changeEdit.ts`. Any edit goes through `finalizeEditedChange`, which sets `edited: true` and makes the change user-authoritative.
- Quantities: `changeItems()` (`changeItems.ts:79`). Wall quantities need verified footprints (`wallGeometryNeedsVerification`, `changeEdit.ts:169`). Opening quantities need `impactVerified` plus height, sill and thickness (`openingImpactReady`, `openingImpact.ts`).
- Application to the takeoff plan: `prepareApplication`/`commitApplication` (`apply.ts:213/507`).
- Colours: `elementWorkKind()` (`workClassification.ts:8`). An added wall is construction, a removed wall is demolition, a new opening is demolition, and a removed opening is construction (infill). The defaults are construction `#16a34a` (green) and demolition `#eab308` (yellow) (`types/compare.ts:41`). **[V]** This matches the GREEN = CONSTRUCTION / YELLOW = DEMOLITION rule, including the reversed meaning for openings.

### 1.2 Secondary paths (still in the code)

| Path | Entry | What it does | Cost (stored ledger) |
|---|---|---|---|
| Local vector diff | `runChangeDetection` → `detectRevisionPage` → `diffVectorPages` (`vectorDiff.ts:547`) | Free, deterministic. Finds changed ink, wall face pairs, door arcs, hatching, clouds and relocations. Raster fallback through `rasterDiff.ts`. | $0 |
| Region labelling (`revision-v1`) | `runAiClassification` (`revisionWorkflow.ts:256`) | Up to 12 crops (≤1100×600, before/after side by side, tinted diff), labels only, no coordinates. | $0.007–$0.025 |
| Full-plan AI (`revision-page-v1`) | `runAiPageAnalysis` | Described above. The AI finds the changes and local code verifies them. | $0.19–$0.21 |

The full-plan path runs **without** the local vector diff. The prompt says "No local detections… are supplied." `buildAiChanges` never compares AI proposals with `diffVectorPages`, either before or after the request. **[V]**

### 1.3 Model configuration (`server/revision-page-ai-assets/config-used.json`)

| Setting | Revision page | Takeoff spaces | Openings |
|---|---|---|---|
| Model | gpt-6.1-sol | gpt-6.1-sol | gpt-6.1-sol |
| Reasoning | low | low | low |
| Image detail | **original** | **high** | original |
| Images | 10 (2 overviews ≤2200 px + 8 tiles) | 5 (5500 px page + 4 tiles) | 5 |
| Observed input tokens **[D]** | 70,603–71,204 | 15,899 | 56,750 |
| Observed output tokens **[D]** | 1,738–4,646 | 1,060–6,944 | 2,797–3,860 |
| Observed cost **[D]** | $0.190–$0.211 (one cached rerun: $0.042) | $0.050–$0.109 | $0.170–$0.181 |
| Observed latency **[D]** | 48–83 s | 25–106 s | 52–56 s |
| Prompt caching | explicit breakpoint after the prompt | none | none |

### 1.4 What the model is asked to return (`revision-page-ai-assets/output-schema.json`)

Each change has these fields:

- `changeType` (9 types) and `geometryTile`.
- `before`/`after`: wall **centre-line** segments (a, b), in tile-normalized coordinates.
- `beforeOpening`/`afterOpening`: 4-corner opening footprints, plus `kind`, `heightM` and `sillHeightM`.
- `bbox`, `confidence`, `requiresReview`, a Hebrew `summary`, `evidence[]`, and page-level `coverageNotes[]`.

Walls have **no footprint and no thickness** in the AI contract. Thickness comes only from local verification. **[V]**

---

## 2. Comparison with AI Quantity Takeoff

### 2.1 Why takeoff detection performs well in practice

| Factor | Takeoff (spaces) | Revision (page) |
|---|---|---|
| Task type | Recognition in **one** drawing | **Differencing** of two drawings across separate images |
| Target size | Rooms: large closed regions, many metres per edge | Walls 7–25 cm thick, openings 60–250 cm wide |
| Error tolerance | A boundary error of a few cm changes the area by about 1%. The user drags a vertex. | A few cm of error moves a centre line off the wall face. A missed change is **invisible** to the user. |
| Output semantics | An editable draft polygon is useful even when imperfect | Location evidence only. Quantities need local verification or manual drawing. |
| Local gate | Topology only: `polygonProblems()` (`localAiImport.ts:26`). Problems are flagged, never rejected. | Strict geometric gate (`verifyWallNear`, jamb `drawnShare ≥ 0.75`). On failure the proposal becomes "unverified" with no geometry. |
| Failure visibility | A missing room is obvious (an empty, unshaded room) | A missed change leaves no trace. Recall errors are silent. |
| Resolution | detail `high`, about 3.2k tokens per image **[D]**. Works at a strongly reduced effective resolution. | detail `original`, about 7k tokens per image **[D]** |

Conclusion **[H, strongly supported]**: takeoff succeeds because of the task and the review model (large tolerant targets, drafts edited by the user, visible omissions), not because of better imaging. Takeoff uses about 4.5× fewer image tokens. Revision Compare asks for a harder visual operation (cross-image differencing at wall-thickness precision), and its correctness gate is binary.

### 2.2 How takeoff gets room boundaries

- The prompt asks for ordered polygons along **inner wall faces**, in tile-local coordinates, choosing the tile with the most context. It also has a structured `reason: CROSS_TILE_INCOMPLETE` field and `geometryConfidence` (HIGH/MEDIUM/LOW).
- It does no vector snapping and no geometric correction. It imports, flags topology problems, and lets the user review and edit (`localAiReview.ts`, `aiWarnings()`).

### 2.3 Reusable techniques (several are already reused)

| Technique | Status in Revision |
|---|---|
| PDFium 5500 px raster, `aiTiles` 1/1.82 overlapping corners, tile-local normalized coordinates | **Already reused** (`aiPageAnalysis.ts:140`, server validation `revision-pipeline.mjs:92`) |
| Frozen config and consent/recovery/ledger workflow | Already reused |
| Structured incompleteness reason (`CROSS_TILE_INCOMPLETE`) | **Not reused.** Revision has only free-text `coverageNotes`, so a cross-tile fragment cannot be detected by code. |
| Categorical geometry confidence | Not reused. Revision uses a 0–1 confidence that is not discriminative (W-6). |
| "An imperfect draft is still useful" | Partly. Unverified walls get no polygon, only a location marker and placeholder editing. |
| Topology gate (`polygonProblems`) | Not used for wall or opening polygons. `isValidAreaPolygon` and `isRectangle` are used instead. |

### 2.4 Differences that prevent direct reuse

- Room polygons run along inner faces. A wall footprint lies **between** two rooms' inner faces. In principle a wall could come from the gap between adjacent room polygons, but that needs room detection on both revisions: two extra calls, and an indirect, error-compounding route. **Not recommended as the default.**
- Takeoff never has to say "same in both". Revision must also avoid reporting unchanged geometry, which takeoff has no analogue for.

---

## 3. Main detection weaknesses (root causes)

Grouped by the error categories the brief asks for.

### 3.1 Missed changes (recall)

**M-1. No local safety net for recall. [V]**
The free `diffVectorPages` already finds changed ink, wall face pairs and door arcs. It is not run on the AI path, and its output is not compared with the AI answer. Anything the model misses is lost silently. This is the most direct, zero-cost recall loss.

**M-2. Multi-scale sheets / insets. [D]**
3 of the 4 stored answers say in `coverageNotes` that TILE_D contained a small-scale key plan whose detail could not be extracted reliably. One answer (`a234…`) returned **9 of 16** changes as `room-boundary-changed` with `before = after = null`. Those cannot be quantified and can only be placed by their bbox. Another (`7040…`) said the inset repeats the enlarged apartment.

- **Root cause:** the fixed tile grid spends about half its pixels on content the user does not want compared. Existing mask markups (`exclusionsFor`, `detect.ts:76`) are applied to the local diff only, **not** to AI images or AI results. **[V]**

**M-3. Changes split across tile boundaries. [D]**
Run `f566…` reported one new partition as `change-009` (TILE_A, x≈0.653, y 0.800–0.827) plus `change-010` (TILE_C, same x). Run `af66…` reported only the TILE_C part and explained the TILE_A stub in a coverage note. Dedupe merges such fragments only when both verify to an **identical** footprint (`sameVerifiedWall`) or when bbox IoU ≥ 0.3 (`sameChange`). Unverified fragments stay separate. **[V]**

**M-4. Non-deterministic omissions. [D]**
Two runs on the same input (71,014 tokens, the second fully cached) agree on 11 changes and differ on 1–2: a door listed in TILE_C versus TILE_A, and a wall stub. At least about 10% of items are borderline per run.

**M-5. Scanned or raster plans get no verification at all. [V]**
In `buildAiChanges` every verification branch requires `drawings.vector`. Raster pages therefore yield only `unverified` proposals and no quantities.

### 3.2 False positives

**F-1. Opening "verification" checks only the own drawing. [V]**
`drawnShare(own, jamb edge) ≥ 0.75` (`aiPageAnalysis.ts:307`) confirms that jamb lines exist in the AFTER (or BEFORE) drawing. It does not check that they are **absent** in the other revision. A hallucinated `window-added` over an existing, unchanged window could reach `verified`. Walls do check absence (changed runs only, plus the `conflict` state).

**F-2. Model confidence cannot filter. [D]**
Across 47 stored changes, confidence ranges from 0.86 to 0.99. In `buildAiChanges` (`:324`) `strong = verified || (confidence ≥ 0.6 && !requiresReview)`, so nearly every unverified change is still `significance: 'high'` and shows under the default "high" filter.

**F-3. Vague `room-boundary-changed` items. [D]**
These are often grouped descriptions ("the bathroom layout was redesigned") with null geometry. They count as changes but cannot be approved into quantities, so they read as noise to a contractor.

### 3.3 Incorrect classification

**C-1. Colour and work classification are correct by construction. [V]**
GREEN/YELLOW come from `elementWorkKind`, never from the model, so the model cannot get the colour wrong. Classification errors can only come from a wrong `changeType`: added versus removed, or relocated versus added+removed.

**C-2. Relocation versus added+removed pairs. [V]**
`wall-relocated` creates one change with both sides. A move the model reports as separate `wall-added` + `wall-removed` items stays as two changes. The local `matchRelocation` pairing is applied only inside one AI change. The quantities are the same, but the presentation and the review count differ.

**C-3. Small relocations may fail verification. [H]**
`verifyWallNear` keeps only own-face samples that are absent from the other drawing. When a wall moves by less than its thickness, a new face can coincide with an old face (within `tol` ≈ 4 cm). That face is then not "changed", `wallPairs` finds one face, and the result is `incomplete`. Change `a234…/change-009` (shift ≈ 0.012 tile) is a candidate case.

### 3.4 Geometry errors

**G-1. The AI returns centre lines only, and thickness comes only from local pairing. [V]**
When the pairing fails (one face hidden by an existing line, hatch exclusion, a crossing annotation, raster input), the change keeps only a centre-line marker. It has no polygon, and the user must draw one.

**G-2. The lateral search window is ±0.5 m. [V]**
`verifyWallNear` (`vectorDiff.ts:859`) uses ±0.5 m (10–80 px). Inside that window the nearest qualifying pair wins. A dense area with two parallel new partitions within 0.5 m (shafts, double walls) can bind to the wrong one. **[H]**

**G-3. A door's swing arc is computed and then discarded. [V]**
For door changes, `verifyDoorNear()` runs first (`aiPageAnalysis.ts:287-295`). Then, because the strict schema always includes `beforeOpening`/`afterOpening` (possibly `null`), the opening block (`:315-319`) **overwrites** `doors` and `verification`. Two consequences:
- When the opening footprint is `null`, an arc-verified door ends up with no geometry and `unverified`.
- When it is present, the arc (independent, strong evidence) is not used.

Stored example: `af66…/change-004` is a `door-removed` with `beforeOpening = null`.

**G-4. Opening rectangles are axis-snapped by the model. [D]**
All 25 stored opening footprints pass `isRectangle` at a 2° tolerance under both page orientations. The worry that the rectangle gate silently drops AI openings is **not supported** by the data. However, every footprint is axis-aligned, so openings in diagonal walls are an untested case. **[H]**

**G-5. Corners and L-shaped walls are split by design. [V]**
The prompt and `wallPairs` both create one rectangle per straight run. An L-shaped removed wall becomes two changes (`f566…/change-006` + `change-007`). Quantities are correct, but the review count and the "one wall" expectation are not. There is no multi-vertex wall polygon unless the user merges regions manually (`wallRegionMerge.ts`).

**G-6. Opening heights. [D]**
`f566…/change-011` returned `heightM: 2.1`. The prompt forbids default heights. Whether 2.1 was read from the plan cannot be told from the stored data. Opening quantities still need user confirmation (`openingImpactReady`), so this cannot silently change quantities. **[V]**

### 3.5 Duplicates and fragmentation

| Mechanism | Covers | Misses |
|---|---|---|
| `sameVerifiedWall` | Verified fragments that grow to the identical full footprint | Unverified fragments; multi-piece walls (deliberately skipped) |
| `sameChange` (IoU ≥ 0.3, same family and kind) | Overlapping-tile re-reports | Long thin walls (IoU is small even for the same wall); added versus removed halves of a relocation |
| `mergeRevisionAiChanges` | A new run versus existing proposals | — |

---

## 4. Wall geometry improvement opportunities

What exists **[V]**: for vector PDFs, verified walls already have 4-corner footprints at the **measured** thickness (`wallPairs`, `vectorDiff.ts:365`). They split at real openings (an interval needs both faces drawn), continue through crossing dimension ink (`crossingInkOnly`, `:816`), and are followed beyond a partial AI line up to a bounded reach (`:863`). Tests: `tests/compare/aiWallContinuity.test.mjs`, `aiRemovedWallGeometry.test.mjs`. That is "AI identifies → existing geometry verifies" already working for the clean case.

Opportunities, in order of value:

1. **W-a. A footprint for incomplete walls, without claiming verification. [R]**
   When `verifyWallNear` returns `incomplete` or nothing, run the same `wallPairs` on all ink near the line (`nearAll`, already collected at `:887`). If a face pair at plausible thickness exists, attach its footprint as a **suggested** polygon (`geometry-incomplete`). It is not quantity-bearing until the user confirms. This turns "draw it yourself" into "confirm or adjust", which is how takeoff works.
2. **W-b. Presence-based verification for relocations and small shifts. [R]**
   For `wall-relocated`, verify each side by the full face pair in its own drawing **and** the absence of that pair in the other drawing (`wallPresentIn`, `vectorDiff.ts:949`, already exists). Do not rely on changed runs only.
3. **W-c. Suggested merges for collinear and corner-joined pieces. [R]**
   Pieces of one change that touch could be offered as a merge preview through `prepareWallRegionMerge`, which already does an exact union and refuses to bridge openings. Do not merge automatically: the opening veto and the confirmation preview must stay.
4. **W-d. Ask the AI for both wall faces (4 corners) instead of a centre line. [R, experimental]**
   Mirrors the opening contract. Corners give the verifier the AI's thickness hypothesis to check against the drawing (`|AI thickness − measured| ≤ tol`), and a geometric prior for raster pages. Cost: about +40–80 output tokens per wall, well under $0.01 per page. Needs a schema and prompt version change and a benchmark.
5. **W-e. Raster pages. [R, experimental]**
   Run face-pair detection on `inkGridFromImage` (`rasterDiff.ts`) ink instead of vector segments. This is a larger effort. Until then, raster pages should be presented as "AI locations, manual geometry".

The PDF vector data **can** verify geometry: it is the source of all verified thickness today. It is weakest where (a) faces coincide with unchanged lines, (b) walls are drawn as filled hatch with no stroke edges, or (c) the page is scanned. **[V/H]**

---

## 5. Opening and change detection improvements

| Case | Current handling | Gap | Recommendation |
|---|---|---|---|
| New or removed door | Arc via `verifyDoorNear`, then overwritten by footprint logic (G-3) | Arc evidence lost; `null` footprint → unverified | Keep the arc result. Footprint verified ⇒ verified; footprint missing but arc verified ⇒ `incomplete` with width from the arc. |
| New or removed window | Jamb `drawnShare` in own drawing | No absence check (F-1) | Require jamb edges to be absent in the other revision (mirror `wallPresentIn`). |
| Narrowed or widened opening | `opening-modified`, both footprints, `openingImpact` subtracts the overlap (`openingImpact.ts`) | Expects exactly 2 verified rectangles; one missing ⇒ incomplete | Fine as designed. Benchmark the per-side corner error. |
| Opening moved along its wall | Same, two footprints | — | Fine. |
| Opening moved to another wall | `opening-modified` across walls (`7040…/change-002`) **[D]** | Same path; no shared region | Fine. Verify the host wall per side. |
| Relocated wall | One change with both sides when the AI says `wall-relocated` | Separate added+removed reports are not paired (C-2) | Run `matchRelocation` across AI changes after verification, as `diffVectorPages` does (`vectorDiff.ts:728-767`). |
| Changed room boundaries | `room-boundary-changed` with optional segments | Often null geometry, grouped (F-3) | Present as review notes, not quantity changes. Ask the model (prompt revision) to break them down into wall and opening changes. |

---

## 6. AI output versus local verification: responsibilities

### 6.1 Evaluation of the proposed architecture

The proposed split ("AI detects, classifies and proposes polygons; the local engine validates and calculates") is **the right architecture, and about 60% of it already exists**. The remaining work is mostly connecting existing parts, not a rewrite.

| Responsibility | Proposed owner | Status |
|---|---|---|
| Find changes on the whole plan | AI | ✅ `revision-page-v1` |
| Classify construction/demolition | AI type → **local** colour/work mapping | ✅ (`elementWorkKind`; the model never picks colours) |
| BEFORE/AFTER opening polygons | AI | ✅ 4-corner footprints |
| BEFORE/AFTER wall polygons | AI | ❌ centre lines only (W-d) |
| Report uncertainty | AI | ⚠️ `requiresReview` works; `confidence` is not informative (F-2); no structured incompleteness reason |
| Validate against plan geometry | Local | ✅ walls (face pairs + absence); ⚠️ openings (no absence check); ❌ raster pages |
| Wall continuity and thickness | Local | ✅ `wallPairs`, `crossingInkOnly`, reach-following |
| Openings and intersections | Local | ⚠️ the arc is discarded (G-3); bridge veto exists for merges (`bridgeCrossesOpening`) |
| Reject unsupported geometry | Local | ✅ `conflict` / `unverified` ⇒ no quantities |
| Cross-check against independent local detection | Local | ❌ missing (M-1) |
| Deterministic quantities | Local | ✅ `changeItems`, `openingImpact`, `relocationQuantities` |
| One geometry representation for render, edit and quantities | — | ✅ `RevisionWall.footprint` / `RevisionDoor.footprint` in native px, used by the overlay, the editor and `changeItems`; `normalizeRevisionWallGeometry` repairs legacy strips |

### 6.2 Missing pieces

1. Reconciliation with the free local diff (M-1, F-1): a third verification signal.
2. A structured AI uncertainty field (`reason` enum, as in takeoff) instead of free text.
3. Verification states that separate "geometry suggested" from "geometry verified" (W-a), so unverified changes are still useful drafts.

---

## 7. Proposed accuracy benchmark

### 7.1 Principles

- **No paid calls to build it.** Re-run the local part of the pipeline (`parseRevisionPageResult` → `buildAiChanges`) offline on stored AI answers. Today that is not possible, because `.ai-local/revision-results/*.json` stores the answer without the `manifest`/`alignment` (they live only in the comparison in IndexedDB). Storing them together is a prerequisite (§9, QW-0).
- Re-evaluating a **changed verifier** against stored answers costs $0. Evaluating a **changed prompt** needs new runs. A full set of 10 pairs costs about $2. An identical-input repeat within the cache window costs about $0.04 **[D]**.
- Measure three separate layers: detection, geometry, and quantity.

### 7.2 Dataset (8–12 plan pairs)

| # | Pair type | Purpose |
|---|---|---|
| 1 | `demo/assets/BetterCalc_Demo_Apartment_A_Revision_B.pdf` + its original | Controlled baseline |
| 2–4 | The real pairs behind the stored runs (re-identify them) | Matches known behaviour |
| 5 | 1:50 apartment plan, many interior changes | Wall and opening precision |
| 6 | 1:100 floor with several apartments | Small-scale stress |
| 7 | Sheet with an enlarged plan **and** a key-plan inset | M-2 |
| 8 | Small relocations (shift < wall thickness) | C-3, W-b |
| 9 | Diagonal or curved walls | G-4 |
| 10 | Annotation-only revision (dimensions, text, hatch) | **Negative control**: expect 0 changes |
| 11 | Scanned or raster pair | M-5 |
| 12 | Construction-context pair | Demolition semantics |

Target: at least 150 ground-truth (GT) physical changes in total, with at least 30 openings and at least 10 relocations.

### 7.3 Ground truth

Author the GT **in BetterCalc itself**, using the manual change tools (`addManualRevisionChange` with footprints, wall and opening rectangle drawing), on calibrated pages. Export the comparison's `changes` as JSON. Each GT element has: type, side, footprint polygon, thickness and, for openings, kind. Two annotators for at least 2 pairs, to measure annotator agreement (the realistic ceiling).

### 7.4 Matching rule

An AI change matches a GT change when all three hold:
1. The family (wall / opening / boundary) is the same.
2. Every GT side has a predicted element on the same side, with footprint IoU ≥ 0.5. For elements without a footprint, the centre-line distance must be ≤ 0.25 m with at least 50% overlap along the line.
3. Each GT change is matched at most once, and each prediction at most once (greedy by IoU).

### 7.5 Metrics

| Layer | Metric | Definition |
|---|---|---|
| Detection | Recall | matched GT / all meaningful GT changes |
| | Precision | matched predictions / all predictions (excluding items explicitly marked as notes) |
| | Negative-control FP | predictions on pair 10 |
| | Per-category recall | wall added/removed/relocated, opening added/removed/modified |
| | Stability | Jaccard of matched sets across 2 runs of the same input (repeat costs about $0.04) |
| Classification | Work correctness | matched elements with the correct construction/demolition side ÷ matched elements. Relocations must have **both** sides. |
| Verification | Verified-TP rate | matched changes reaching `verified` |
| | Verified-FP rate | unmatched predictions reaching `verified` (**must be ≈ 0**: these make wrong quantities) |
| Geometry | Wall IoU | per verified wall element |
| | Thickness error | cm, |measured − GT| |
| | Length error | % per wall |
| | Opening corner error | cm, mean of 4 corners |
| | Fragmentation | predicted changes per GT element (> 1 = fragmented) |
| | Duplicates | predictions matched to an already-matched GT |
| Quantity | Area error | per pair, construction and demolition m² separately, % versus GT |
| Effort | Manual corrections | user actions to reach GT: add, delete, retype, vertex edit, merge. Count from the store's history pushes during a scripted session. |

### 7.6 Success criteria (proposed)

| Target | Value |
|---|---|
| Detection recall (meaningful changes) | **≥ 90%** |
| Detection precision | **≥ 90%** |
| Negative control | ≤ 1 proposal per pair, none verified |
| Work classification (matched) | ≥ 98% |
| Verified-FP rate | ≤ 1% |
| Verified-TP rate (vector pairs) | ≥ 75% |
| Wall IoU (verified) | median ≥ 0.85; thickness within ±2 cm for ≥ 90% |
| Opening corner error | median ≤ 3 cm |
| Fragmentation | ≤ 1.1 predictions per GT element |
| Quantity error | ≤ 5% per pair (construction and demolition separately) |
| Manual corrections | ≤ 0.3 per GT change |

"90% accuracy" should mean **detection recall and precision both ≥ 90% on this set**. Geometry and quantity accuracy are reported separately. They must never be folded into a single number.

---

## 8. Cost and performance implications

### 8.1 Current request (measured **[D]**)

- About 71k input tokens, almost all image tokens at `original` detail. The cost preview's pixel-density estimate (`revisionPageCostPreview`) predicts about the same.
- Output: 1.7–4.6k tokens, about $0.02–$0.05.
- Total: **$0.19–$0.21** per page analysis, matching the brief's $0.17–$0.21.
- Prompt caching: the explicit breakpoint covers about 1.1k prompt tokens, which is negligible. The one rerun was **fully** cached (71,011 of 71,014 tokens, $0.042). Identical inputs within the provider cache window are therefore about 5× cheaper. This contradicts the code comment in `revisionPageModelRequest` that cache writes end at the prompt. **[D]** It matters for benchmark stability runs, not for normal users, who rarely resend identical images.

### 8.2 Impact of the recommendations

| Recommendation | Accuracy impact | API cost | Complexity |
|---|---|---|---|
| Local reconciliation (QW-1) | High: recall safety net and FP flag | $0 | Low–medium |
| Door arc kept (QW-2) | Medium (doors) | $0 | Low |
| Opening absence check (QW-3) | Medium (precision) | $0 | Low |
| Masks/ROI applied to AI (QW-4) | Medium–high on multi-plan sheets | $0 (masking); ROI tiles have about the same token count | Low (mask) / medium (ROI) |
| Significance from verification (QW-5) | Medium (perceived precision) | $0 | Low |
| Suggested footprints (H-1) | High (fewer manual draws) | $0 | Medium |
| Relocation presence verification (H-2) | Medium | $0 | Medium |
| Diff-composite overview (H-3) | **Potentially high** recall and precision | about $0, possibly lower (same or fewer pixels) | Medium; needs a prompt change and benchmark |
| ROI tiling (H-4) | High on sheets with insets | about $0 | Medium; changes preparation and server validation |
| Wall corners in schema (E-1) | Medium | +<$0.01 | Medium |
| Reasoning `medium` (E-2) | Unknown | +$0.02–$0.08 (more output) **[H]** | Trivial; needs a benchmark |
| Two-sample self-consistency (E-3) | FP reduction, recall union | +about $0.04–$0.20 | Medium |

Latency: every local recommendation costs well under 1 s next to a 48–83 s model call. Reconciliation needs the vector diff (`diffVectorPages`), which already runs interactively for the local detector.

---

## 9. Prioritized implementation roadmap

Ranking weights: (1) expected accuracy gain, (2) regression risk, (3) extra API cost, (4) complexity.

### QUICK WINS (no API cost, low risk, existing code)

| ID | Change | Files | Accuracy | Risk | Cost | Effort |
|---|---|---|---|---|---|---|
| **QW-0** | Store `manifest` + `alignment` (+ source and revised hashes) next to stored revision results, and add an offline replay script for `buildAiChanges`. A **benchmark enabler**, not an accuracy change. | `server/ai-server.mjs` (result file), new `scripts/` replay | — (enables measurement) | None | $0 | S |
| **QW-1** | After the AI answer, run `diffVectorPages` on the same drawings. Mark AI changes with no changed ink nearby as `no-drawing-difference`. Add local **high** wall/opening changes not matched by `sameChange` as `local-only` proposals ("possibly missed by AI"). | `revisionWorkflow.ts:completePageAnalysis`, `aiPageAnalysis.ts`, `vectorDiff.ts` (reuse) | High (recall + FP) | Low–medium (more proposals; must be ranked and labelled) | $0 | M |
| **QW-2** | Keep the `verifyDoorNear` result: rectangle verified ⇒ verified; else arc ⇒ `incomplete` with arc width. | `aiPageAnalysis.ts:287-319` | Medium (doors) | Low | $0 | S |
| **QW-3** | Opening absence check in the other revision (jamb edges must **not** be drawn there). | `aiPageAnalysis.ts:307`, `vectorDiff.ts` | Medium (precision) | Low | $0 | S |
| **QW-4** | Apply existing mask markups to the AI path: white-out in `prepareRevisionPageRequest` and drop AI changes whose bbox centre is masked. | `aiPageAnalysis.ts`, `detect.ts:exclusionsFor` | Medium–high on sheets with insets | Low (opt-in by the user drawing masks) | $0 | S |
| **QW-5** | Significance: `high` only if `verified` or supported by the local diff. Unverified changes default to `medium`, and `room-boundary-changed` without geometry becomes a note. | `aiPageAnalysis.ts:324`, panel copy | Medium (precision as seen by the user) | Low | $0 | S |

### HIGH-IMPACT IMPROVEMENTS (no or little API cost, moderate effort)

| ID | Change | Accuracy | Risk | Cost | Effort |
|---|---|---|---|---|---|
| **H-1** | Suggested (unverified) wall footprints from face pairs near the AI line (W-a). | High (corrections) | Medium (must never become quantities without confirmation) | $0 | M |
| **H-2** | Relocation verification by presence/absence of full face pairs. Pair AI `wall-added` + `wall-removed` through `matchRelocation` (C-2, C-3, W-b). | Medium | Medium | $0 | M |
| **H-3** | Replace BEFORE_PAGE/AFTER_PAGE with a **diff-composite overview**: unchanged ink grey, BEFORE-only red, AFTER-only green, same 2200 px. Keep the 8 clean tiles for geometry. The proven `revision-v1` crops already use this tinting. | Potentially high (recall; the model is told **where** to look) | Medium (prompt change; the overview could bias the model toward alignment noise, so the alignment gate must stay) | About $0 (same image budget, or 9 images) | M |
| **H-4** | Region-of-interest tiling: the user picks the plan area, and the 4 tiles cover the ROI instead of the sheet (new `preparationVersion`). | High on multi-plan sheets | Medium (server validation and mapping change) | About $0 | M |

### EXPERIMENTAL IDEAS (benchmark before adopting)

| ID | Idea | Notes |
|---|---|---|
| E-1 | 4-corner wall footprints in the AI schema (W-d) | Verifier compares AI thickness with measured thickness. Provides geometry for raster pages. |
| E-2 | `reasoningEffort: medium` | Output cost increases only. Measure recall gain against cost. |
| E-3 | Two samples + intersection/union | The observed run-to-run differences (M-4) suggest the gain is real. The second call costs about $0.04 only when cached, otherwise about $0.20. |
| E-4 | Raster face-pair verification on ink grids (W-e) | Needed for scanned plans. Large effort. |
| E-5 | `revision-v1` labels for local-only candidates from QW-1 | Extra call ($0.01–$0.03), on demand only, never by default. |
| E-6 | Structured `reason` enum (`CROSS_TILE_INCOMPLETE`, `INSET_LOW_RESOLUTION`, …) as in takeoff | Lets code detect fragments and insets without parsing Hebrew notes. |

### Explicitly not recommended

- Rewriting the pipeline or replacing vector verification. The verified path is sound and tested.
- Deriving walls from room polygons by default (two extra calls, compounding error).
- Lowering verification thresholds to raise the "verified" rate. That trades silent wrong quantities for apparent accuracy.

---

## 10. Recommended first improvement

**Step 0 (prerequisite, about a day): QW-0, the offline replay benchmark.** Without stored manifests and a GT set, no change can be shown to improve accuracy, and "90%" cannot be claimed. The stored answers on this machine show that a 10-pair baseline costs about $2 to collect once. After that, every local verifier change is evaluated for free.

**First accuracy improvement: QW-1, reconcile the AI answer with the free local vector diff.**

Why it comes first:
- It addresses the largest structural weakness: recall failures are silent, and no independent signal exists today (M-1). It also flags AI proposals with no drawing difference (F-1, F-3).
- It reuses existing, tested code: `diffVectorPages`, `sameChange` and `drawingsInSourceSpace`. It needs no prompt, schema, model or request change.
- It adds no API cost and under a second of local time.
- The regression risk is contained. Proposals are only **added** (labelled "local, not confirmed by AI") or **annotated**, never removed. Quantities keep their current verification gates.

Bundle **QW-2** (keep door arcs) and **QW-3** (opening absence check) in the same change: both are small, local to `buildAiChanges`, and improve the reconciliation's opening evidence.

Measure before and after with the §7 benchmark: recall, precision, verified-FP rate and manual corrections per pair.
