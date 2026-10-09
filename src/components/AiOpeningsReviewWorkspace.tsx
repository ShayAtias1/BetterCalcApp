import { useEffect, useState } from 'react';
import AiReviewWindow, { OPEN_OPENINGS_REVIEW } from './AiReviewWindow';
import { useAppStore } from '../store/appStore';
import { useOpeningsAiUi } from '../lib/ai/openingsUi';
import { validatePlanOpening } from '../lib/planOpenings';
import { presetOf } from '../lib/manualOpenings';
import { useT } from '../i18n';
import type { PlanOpening } from '../types';
import OpeningsPanel from './OpeningsPanel';

/** Uses the same independent review window as room AI, with the drawing available for editing. */
export default function AiOpeningsReviewWorkspace() {
  const t = useT();
  const plan = useAppStore(s => s.project), page = useAppStore(s => s.currentPage);
  const selectedId = useAppStore(s => s.selectedOpeningId);
  const scope = useOpeningsAiUi();
  const [error, setError] = useState('');
  const openings = (plan?.openings ?? []).filter(o => o.aiDetection && o.pageNumber === page &&
    scope.planId === plan?.id && scope.pageNumber === page && o.aiDetection.sourceHash === scope.sourceHash);
  const pending = openings.filter(o => o.approval.status === 'draft');
  const selected = openings.find(o => o.id === selectedId);
  const resolved = openings.length - pending.length;
  useEffect(() => { setError(''); }, [selected?.id]);
  if (!plan || !openings.length) return null;
  const actions = () => useAppStore.getState();
  const label = (o: PlanOpening) => o.label || t(`openingTools.${o.kind === 'custom' ? 'custom' : o.kind === 'door' && o.mechanism === 'unknown' ? 'unclassifiedDoor' : presetOf(o)}`);
  const select = (id: string | null) => {
    actions().setDrawTarget('room'); actions().setToolMode('select');
    actions().selectPlanOpening(id); actions().setOverlayVisible('finishes', true);
  };
  const advance = (offset: number) => {
    if (!openings.length) return;
    const index = openings.findIndex(o => o.id === selectedId);
    select(openings[index < 0 ? 0 : (index + offset + openings.length) % openings.length].id);
  };
  const resolve = (approve: boolean) => {
    if (!selected) return;
    try {
      if (approve) actions().approvePlanOpening(selected.id);
      else actions().rejectPlanOpening(selected.id);
      // Existing approval rules remain authoritative, including authoring capability checks.
      const latest = actions();
      if (latest.project?.id !== plan.id || latest.project.openings?.find(o => o.id === selected.id)?.approval.status !== (approve ? 'approved' : 'rejected')) return;
      const index = openings.findIndex(o => o.id === selected.id);
      const next = [...openings.slice(index + 1), ...openings.slice(0, index)].find(o => o.approval.status === 'draft');
      select(next?.id ?? null);
    } catch { setError(t('openingTools.invalid')); }
  };
  return <AiReviewWindow title={t('openingAiReview.title')} progress={t('openingAiReview.progress', { resolved, total: openings.length })} meaning={t('openingAiReview.progressMeaning')}
    scope={`${plan.id}:${page}`} bodyId="ai-openings-review-body" openEvent={OPEN_OPENINGS_REVIEW} selectedId={selectedId}>
      <nav className="ai-review-queue" aria-label={t('openingAiReview.title')}>
        <div className="ai-review-queue-head">
          <strong>{t('aiReviewWorkspace.pending', { count: pending.length })}</strong>
          <button className="btn-secondary small" onClick={() => advance(-1)} aria-label={t('openingAiReview.previous')}>{t('aiReviewWorkspace.previousShort')}</button>
          <button className="btn-secondary small" onClick={() => advance(1)} aria-label={t('openingAiReview.next')}>{t('aiReviewWorkspace.nextShort')}</button>
        </div>
        <ul>{openings.map(o => <li key={o.id}><button className={`ai-review-queue-row${o.id === selectedId ? ' active' : ''}`} aria-current={o.id === selectedId ? 'true' : undefined} onClick={() => select(o.id)}>
          <span className="ai-review-queue-name" dir="auto">{label(o)}</span>
          <small dir="ltr">{o.aiDetection?.provenance?.candidateId ?? o.aiDetection?.deferred?.geometryTile}</small>
          <span className="ai-review-queue-state">{o.approval.status === 'draft' ? !validatePlanOpening(plan, o).canApprove ? t('aiReviewWorkspace.blocked') : t('aiReviewWorkspace.pendingState') : t(`openingTools.${o.approval.status}`)}</span>
        </button></li>)}</ul>
      </nav>
      <div className="ai-review-detail" key={selected?.id ?? 'none'}>
        {selected ? <>
          <header><strong dir="auto">{label(selected)}</strong></header>
          <div className="ai-review-detail-actions">
            <button className="btn-secondary small" onClick={() => actions().beginOpeningEndpointEdit(selected.id)}>{t('openingTools.reposition')}</button>
            <button className="btn-primary small" disabled={selected.approval.status === 'approved' || !validatePlanOpening(plan, selected).canApprove} onClick={() => resolve(true)}>{t('openingTools.approve')}</button>
            <button className="btn-secondary small" disabled={selected.approval.status === 'rejected'} onClick={() => resolve(false)}>{t('openingAiReview.reject')}</button>
            <button className="btn-secondary small" onClick={() => advance(1)}>{t('openingAiReview.skip')}</button>
            {selected.approval.status !== 'draft' && <button className="btn-secondary small" onClick={() => actions().draftPlanOpening(selected.id)}>{t('openingTools.returnDraft')}</button>}
          </div>
          {!validatePlanOpening(plan, selected).canApprove && <p className="ai-review-hard-error" role="status">{t('openingAiReview.blocked')}</p>}
          {error && <p className="ai-review-hard-error" role="alert">{error}</p>}
          <OpeningsPanel editorOnly />
          <div className="ai-review-detail-actions">
            <button className="btn-primary small" disabled={selected.approval.status === 'approved' || !validatePlanOpening(plan, selected).canApprove} onClick={() => resolve(true)}>{t('openingTools.approve')}</button>
          </div>
        </> : <p className="muted">{t(pending.length ? 'openingAiReview.choose' : 'aiReviewWorkspace.complete')}</p>}
      </div>
      <footer className="ai-review-workspace-footer"><span className="muted">{t('openingAiReview.progressMeaning')}</span>
        <button className="btn-secondary small" disabled={!pending.length} onClick={() => { actions().rejectPlanOpenings(pending.map(o => o.id)); select(null); }}>{t('aiReviewWorkspace.rejectAll')}</button>
      </footer>
  </AiReviewWindow>;
}
