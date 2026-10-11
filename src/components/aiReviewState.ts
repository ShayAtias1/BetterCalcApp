import { useEffect } from 'react';
import { create } from 'zustand';
import { useAppStore } from '../store/appStore';
import { useAiWorkflow, initializeAiWorkflow, activateAiPage } from '../lib/ai/workflow';
import { initializeOpeningsAiUi, activateOpeningsAiPage, useOpeningsAiUi } from '../lib/ai/openingsUi';
import { aiReviewProgress, pendingAiReviewCandidates } from '../lib/localAiReview';
import { OPEN_OPENINGS_REVIEW } from './AiReviewWindow';

export type AiReviewMode = 'spaces' | 'openings';

/**
 * Which saved AI results the workspace is reviewing, if any. Session UI only — nothing here is saved
 * with the plan. While a review is open the side panels show its queue and the selected suggestion.
 */
export const useAiReviewMode = create<{ mode: AiReviewMode | null; setMode: (mode: AiReviewMode | null) => void }>((set) => ({
  mode: null,
  setMode: (mode) => set({ mode }),
}));

/** Saved space suggestions on this page: still pending, and progress over the reviewed scope. */
export function useSpaceReviewSummary() {
  const project = useAppStore((s) => s.project);
  const pageNumber = useAppStore((s) => s.currentPage);
  const candidates = useAppStore((s) => s.detectionCandidates);
  const workflow = useAiWorkflow();
  const { resolvedIds: storedResolvedIds, reviewScope } = workflow;
  const resolvedIds = reviewScope?.planId === project?.id && reviewScope?.pageNumber === pageNumber ? storedResolvedIds : [];
  const pending = pendingAiReviewCandidates(candidates, project, pageNumber, workflow);
  const progress = aiReviewProgress(pending.map((c) => c.id), resolvedIds);
  return { pending: pending.length, ...progress, available: !!project && (pending.length > 0 || progress.total > 0) };
}

/** AI openings on this page that belong to the current PDF: drafts still to review, and the rest. */
export function useOpeningReviewSummary() {
  const plan = useAppStore((s) => s.project);
  const page = useAppStore((s) => s.currentPage);
  const scope = useOpeningsAiUi();
  const openings = (plan?.openings ?? []).filter((o) => o.aiDetection && o.pageNumber === page &&
    scope.planId === plan?.id && scope.pageNumber === page && o.aiDetection.sourceHash === scope.sourceHash);
  const pending = openings.filter((o) => o.approval.status === 'draft').length;
  return { pending, resolved: openings.length - pending, total: openings.length, available: openings.length > 0 };
}

/**
 * Desktop: keeps the saved AI results of the open page loaded while the workspace is open (on tablet
 * and phone the review strip and the room tools still do this). Openings AI stays development-only.
 */
export function useAiReviewSync(enabled: boolean) {
  const planId = useAppStore((s) => s.project?.id);
  const pageNumber = useAppStore((s) => s.currentPage);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void initializeAiWorkflow().then(() => { if (alive && planId) return activateAiPage(planId, pageNumber); });
    return () => { alive = false; };
  }, [enabled, planId, pageNumber]);
  useEffect(() => {
    if (!enabled || !import.meta.env.DEV) return;
    void initializeOpeningsAiUi().then(() => { if (planId) return activateOpeningsAiPage(planId, pageNumber); });
  }, [enabled, planId, pageNumber]);
  // Opening an AI opening from the openings list opens its review.
  useEffect(() => {
    if (!enabled) return;
    const open = () => useAiReviewMode.getState().setMode('openings');
    window.addEventListener(OPEN_OPENINGS_REVIEW, open);
    return () => window.removeEventListener(OPEN_OPENINGS_REVIEW, open);
  }, [enabled]);
  useEffect(() => { useAiReviewMode.getState().setMode(null); }, [planId]);
}
