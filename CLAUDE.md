# BetterCalc development instructions

## Working rules

1. Work only on the explicitly requested task.
2. Read only relevant files; never scan the entire repository unnecessarily.
3. Reuse existing code and components.
4. No unnecessary planning, refactoring, or features.
5. Run only focused tests when necessary.
6. No browser automation or broad QA unless requested.
7. No paid API calls without explicit permission.
8. Work directly on main. No branches or worktrees.
9. No commits, pushes, or deployments unless requested.
10. For small fixes: implement immediately and STOP.
11. Keep responses short and report only what changed.

## Project conventions

- Browser-only quantity takeoff and revision comparison for Israeli contractors. PDFs and project data stay client-side in IndexedDB; no server or authentication. UI text is inline Hebrew with RTL layout.
- Analytics must go through `src/lib/analytics.ts` and never include plan content. Read `docs/ANALYTICS.md` before changing events.
- Takeoff and Compare use separate types, stores, and viewers. Decide whether shared markup or measurement changes apply to both. Projects contain plans and comparisons; store `project` is the open plan, while `currentProject` describes its folder. Persist a plan before leaving it. Project totals reuse each plan's `buildRoomSummaries` through `src/lib/projectQuantities.ts`.
- Persist coordinates in native PDF page pixels (`getViewport({ scale: 1 })`, top-left origin). Convert input through `useCanvasTransform.screenToNative`; SVG overlays use native coordinates regardless of canvas render scale. Calibration is per page; uncalibrated areas and lengths are zero. Compare alignment helpers must match the CSS transform and revised-page centre pivot.
- Stores replace immutable document objects. Use `createHistoryTracker` for undo/redo: discrete actions use `push`, every mutation in a continuous burst uses `pushDebounced`. Quiet mutations skip autosave; persist when the drag ends. Normal autosave is debounced by 800 ms; history is not persisted.
- Preserve IndexedDB compatibility: `projects` stores plans, `takeoffProjects` stores folders. Saved-document migrations run lazily on load, tolerate legacy shapes, and remain idempotent. Load PDF pages through `loadPdfPlanSource` and the session cache, not direct `pdfjsLib.getDocument` calls.
- Keep on-screen SVG annotations and canvas export renderers in sync. Reuse `geometry.ts` and `dimensionChain.ts`; apply `orderMarkups` in both paths so masks draw first.
- Hebrew PDF reports use `pdfText.ts` (embedded Noto Sans Hebrew, bidi-js, and vector `PdfPainter`); standard pdf-lib fonts cannot encode Hebrew. Preserve logical Hebrew order for fontkit. Canvas annotations use RTL direction and right alignment when matching SVG RTL start anchors.
- Reuse `quantities.ts` work-type calculations and shared area-measurement numbering. Room work items and demolition/construction area measurements are separate tallies. Auto-calculation fills only detected rooms with no work items, preserving user choices. `diffEngine.ts` is an intentional stub.

## Commands (only when relevant)

- `npm run dev`: Vite development server on port 5173.
- `npm run build`: TypeScript check and Vite build; unused imports and variables fail typechecking. Run when needed for the requested code change.
- `npm run lint`: oxlint.
- `npm test`: node:test analytics privacy, ledger, and milestone tests in `tests/`; select focused tests when necessary.
