import { useEffect, useMemo, useRef, useState } from 'react';
import type { Plan } from '../types';
import type { ViewerPageSource } from '../lib/pdfViewerSource';
import { AlignedViewerPage, drawingChoice, hasRevisionDrawing, loadRevisionDrawing, setDrawingChoice, type DrawingChoice, type RevisionDrawing } from '../lib/revision/backdrop';

/**
 * Which drawing the Takeoff viewer shows for a plan page: the revision applied from Revision Compare
 * (by default) or the plan's own PDF. The original source always stays the coordinate reference; a
 * revision whose file is missing falls back to it.
 */
export function useRevisionDrawing(plan: Plan | null | undefined, pageNumber: number, base: ViewerPageSource | null) {
  const planId = plan?.id;
  const available = hasRevisionDrawing(plan, pageNumber);
  const loadKey = planId && available && plan?.revisionBackdrop ? `${planId}:${plan.revisionBackdrop.applicationId}:${pageNumber}` : '';
  const latest = useRef(plan);
  latest.current = plan;
  const [choice, setChoice] = useState<DrawingChoice>(() => (planId ? drawingChoice(planId) : 'revised'));
  const [loaded, setLoaded] = useState<{ key: string; drawing: RevisionDrawing } | null>(null);

  useEffect(() => { if (planId) setChoice(drawingChoice(planId)); }, [planId]);
  useEffect(() => {
    const current = latest.current;
    if (!loadKey || !current) return;
    let cancelled = false;
    void loadRevisionDrawing(current, pageNumber).then((drawing) => { if (!cancelled) setLoaded({ key: loadKey, drawing }); });
    return () => { cancelled = true; };
  }, [loadKey, pageNumber]);

  const drawing = loaded?.key === loadKey ? loaded.drawing : null;
  const aligned = useMemo(
    () => (base && drawing?.status === 'ok' ? new AlignedViewerPage(drawing.page, drawing.alignment, base) : null),
    [base, drawing],
  );
  const status: 'none' | 'loading' | 'ok' | 'missing' = !available || !loadKey ? 'none'
    : !drawing ? 'loading' : drawing.status === 'ok' ? 'ok' : drawing.status === 'missing' ? 'missing' : 'none';
  const wantRevised = status !== 'none' && choice === 'revised';
  // While the revision loads nothing is shown rather than a flash of the wrong drawing.
  const displaySource = !base ? null : wantRevised ? (status === 'ok' ? aligned : status === 'loading' ? null : base) : base;
  return {
    displaySource,
    status,
    choice,
    shown: (displaySource && displaySource === aligned ? 'revised' : 'original') as DrawingChoice,
    select: (next: DrawingChoice) => { if (planId) setDrawingChoice(planId, next); setChoice(next); },
  };
}
