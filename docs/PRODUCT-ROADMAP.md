# BetterCalc product roadmap

Reviewed against the active `app/` checkout on 2026-10-14. This document records the
current state and proposed launch sequence; it does not authorize the next milestone.

## Preserve the product foundation

- Manual quantity takeoff remains free and usable without an account.
- IndexedDB remains the working local store; signing out, being offline, or exceeding
  a paid allowance must not remove access to local plans or manual calculations.
- Cloud backup is explicit and optional. Never upload existing local PDFs automatically
  when someone creates an account. Explain storage and AI processing separately.
- Keep the existing geometry editors, native PDF coordinates, calculation engines,
  review/approval workflow, undo/redo and Hebrew/English UI.
- Do not reopen completed workspace UX or introduce a parallel drawing/calculation system.

## Current application state

Implemented application work is distinct from real-user acceptance or launch readiness.

| Area | Current state | Remaining launch work |
| --- | --- | --- |
| Manual takeoff | Local projects/plans, calibration, editable geometry, work items, openings, concrete/rebar, quantities and PDF/Excel exports are implemented. | Validate representative contractor workflows during the pilot. |
| Revision Compare | Alignment, local/AI proposals, before/after geometry, opening wall impacts, drawing/editing, region merging, approval, application/revert and persistence are implemented. | Evaluate detection accuracy and verification workflow on owner-approved real plans; no additional inference is authorized by this review. |
| AI rooms/openings/batches | Existing preparation, review, consent, source matching and recovery workflows are implemented. Revision results can survive local-service restart. | Production job execution, authenticated admission and operational monitoring. |
| Authentication/accounts | No account/session implementation found. Analytics identity is anonymous and per browser. | Optional login, account lifecycle, secure sessions and owner authorization. |
| Backend/cloud project storage | Projects and PDFs live in browser IndexedDB. The Node AI service binds to localhost and is not a general cloud backend. | Private document/blob storage, explicit backup/restore, version conflicts and account isolation. |
| AI usage/credits | Local request IDs, token/cost metrics, reservations, spending limits, consent and duplicate-admission protection exist. | Durable per-user balances and atomic credit reservation/settlement; admission cannot trust the client. Local spending logs are not a customer credit ledger. |
| Subscriptions/payments | No subscription, checkout or payment/webhook implementation found. | Plan/credit policy, checkout, verified idempotent webhooks, entitlement updates, cancellation and support operations. |
| Mobile/tablet | Adaptive layouts, touch navigation/editing and a restricted phone field workflow exist. Revision Compare authoring remains restricted on compact layouts. | Focused real-device acceptance and fixes to actual blockers; preserve the established desktop workflow. |
| Public website/positioning | Application branding, start screen and demo assets exist. No dedicated commercial website implementation or consolidated launch plan was found in the active project. | Hebrew product messaging, clear free/paid boundaries, pricing, demo, pilot signup and privacy/support information. |
| Pilot/launch | No documented completed user pilot or commercial release gate found. | Invite a small contractor cohort, validate task completion and quantity review, record blockers and decide launch readiness. |

Evidence: `src/App.tsx`, `src/db/database.ts`, `src/store/{appStore,compareStore}.ts`,
`src/lib/revision/`, `src/lib/ai/`, `server/ai-server.mjs`, `server/ai-accounting.mjs`,
`src/hooks/useWorkspaceLayout.tsx`, `src/lib/workspaceCapabilities.ts` and
`src/components/StartScreen.tsx`.

Existing documentation is feature-level implementation history: [AI integration](AI-INTEGRATION.md),
[multi-plan AI](MULTI-PLAN-AI.md), [opening quantities](OPENINGS-PHASE-3.md),
[opening service integration](OPENINGS-AI-A4-2.md) and [analytics](ANALYTICS.md).
Historical branches, database versions and limitations in those notes describe their
original checkpoints; the current code is authoritative. IndexedDB is currently version 7.

## Recommended next milestone: accounts and optional cloud backup

Deliver one small end-to-end foundation: a user can optionally sign in, explicitly
back up a project, and restore it in another browser. Anonymous local manual takeoff
must continue unchanged. Do not build payments, subscriptions or full background sync
inside this milestone.

Implementation sequence:

1. Select one authentication/backend/storage stack and document the ownership model,
   storage region, retention and backup boundaries before changing the app. Reuse the
   existing application and transport boundaries rather than refactoring the viewers.
2. Add account/session endpoints and authenticated owner-scoped access. Keep secrets
   server-side; test cross-account denial, expired sessions and private blob access.
3. Define versioned cloud project snapshots and private PDF storage using existing IDs
   and document schemas. Preserve folder/plan/comparison relationships, calibration,
   canonical openings, linked revisions and rollback history. Decide which AI review
   records belong in a backup; local spending logs and credentials never do.
4. Add explicit Backup/Restore actions over the existing IndexedDB repositories.
   Persist local edits first; use version checks and retain a recoverable local copy
   on conflict. Interrupted transfer, logout or cloud failure must not discard local work.
5. Verify the milestone with focused ownership, round-trip restore, interruption,
   conflict and migration checks, plus a small manual cross-browser acceptance flow.
   Integrate account identity with the existing analytics privacy rules only when needed.

Exit criteria: two accounts cannot read each other's data; a backed-up project restores
with editable geometry and matching quantities; local data remains accessible offline
and after logout; an interrupted/conflicting backup cannot silently overwrite either copy;
manual takeoff remains available without login or payment.

## Subsequent milestones

1. **Authenticated AI and credits:** reuse existing preparation/review contracts; persist
   jobs and usage centrally; reserve/settle credits exactly once by request identity;
   show balances and usage; document failed-job charging and explicit retry behavior.
2. **Subscriptions/payments:** define a small free/paid offering and connect verified
   payment events to the credit/entitlement ledger. Keep provider cost accounting distinct
   from customer pricing. Manual takeoff stays free.
3. **Pilot readiness:** finish the public website/positioning and focused phone/tablet
   acceptance. Validate production AI recovery, privacy, account deletion, backup recovery
   and support readiness without redesigning completed UX.
4. **Limited contractor pilot:** use an invited cohort with controlled AI allowances,
   assisted onboarding and a short feedback loop. Measure first successful export,
   repeat usage, backup recovery and review/quantity trust; fix observed blockers.
5. **Commercial launch:** launch only after pilot exit criteria, billing/credit integrity,
   recovery, support and clear product claims are satisfied.

## Development checkpoint

Application commits:

- `b731a68`: readable automatic dismissal of application notices.
- `d55d348`: completed AI Revision Compare, shared geometry workflows and supporting tests.

The production build and 86 focused Compare/AI persistence, cache and recovery tests
passed for this checkpoint. The build reports large bundles; assess loading on target
pilot devices before deciding whether a focused performance change is necessary.
No browser QA, paid AI request, push or deployment was performed for this checkpoint.
Secrets/env files, `.ai-local/` and generated output remain excluded from Git.
