import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { roomProfileLabel, ROOM_PROFILES, roomProfileName } from '../lib/roomProfiles';
import { aiWarnings, aiCandidateLabel, aiCandidateTypeKey } from '../lib/localAiReview';
import Icon from './Icon';
import { useT } from '../i18n';

/**
 * Auto detection is a *suggestion* workflow: detect → review → accept/reject.
 * Nothing here writes to the project until the user accepts a candidate, so a detection run alone
 * never touches quantities, autosave or the undo history.
 *
 * Split in two so the room list can place them differently: the launcher is a secondary action at
 * the bottom of the tab, while `DetectionReviewPanel` takes the top of the tab — and only while
 * there is something to review.
 */
export default function AutoDetectPanel() {
  const t = useT();
  const project = useAppStore((s) => s.project);
  const currentPage = useAppStore((s) => s.currentPage);
  const detecting = useAppStore((s) => s.detecting);
  const detectionProgress = useAppStore((s) => s.detectionProgress);
  const detectionLabel = useAppStore((s) => s.detectionLabel);
  const detectionSummary = useAppStore((s) => s.detectionSummary);
  const detectRooms = useAppStore((s) => s.detectRooms);
  const clearDetectionSummary = useAppStore((s) => s.clearDetectionSummary);
  const candidates = useAppStore((s) => s.detectionCandidates);
  const autoCalculateQuantities = useAppStore((s) => s.autoCalculateQuantities);
  const [message, setMessage] = useState<string | null>(null);

  if (!project) return null;

  const pageCandidates = candidates.filter((c) => c.pageNumber === currentPage);
  // Detected rooms that still have no work items. Accepting a classified candidate now fills them
  // in straight away, so this is mainly for rooms accepted without a type and for projects saved
  // before the review flow existed.
  const pendingCalc = project.rooms.filter(
    (r) => r.pageNumber === currentPage && r.detectedType && r.workItems.length === 0
  ).length;
  const flash = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 4000);
  };

  return (
    <div className="auto-detect-panel">
      <span className="section-label">{t('autoDetect.title')}</span>
      <p className="auto-detect-hint">{t('autoDetect.intro')}</p>

      <div className="auto-detect-actions">
        <button className="btn-primary full-width" onClick={() => void detectRooms()} disabled={detecting}>
          <Icon name="scan" />
          {detecting ? t('autoDetect.detecting') : pageCandidates.length > 0 ? t('autoDetect.redetect') : t('autoDetect.detect')}
        </button>
        {/* Only shown while detected rooms are actually waiting for their work items. */}
        {pendingCalc > 0 && (
          <button
            className="btn-secondary full-width"
            onClick={() => {
              const n = autoCalculateQuantities();
              flash(n > 0 ? t('autoDetect.calculated', { count: n }) : t('autoDetect.nothingToCalculate'));
            }}
            disabled={detecting}
            title={t('autoDetect.pendingHint', { count: pendingCalc })}
          >
            <Icon name="table" />
            {t('autoDetect.autoCalculate', { count: pendingCalc })}
          </button>
        )}
      </div>

      {detecting && (
        <div className="detect-progress">
          <div className="detect-progress-bar">
            <div className="detect-progress-fill" style={{ width: `${Math.round(detectionProgress * 100)}%` }} />
          </div>
          <span className="detect-progress-label">{detectionLabel}</span>
        </div>
      )}

      {!detecting && detectionSummary && detectionSummary.total === 0 && (
        <div className="detect-summary">
          <button className="detect-summary-close icon-btn" onClick={clearDetectionSummary} title={t('autoDetect.close')}>
            <Icon name="close" size={13} />
          </button>
          <div className="detect-summary-headline">{t('autoDetect.noneFound')}</div>
          <p className="auto-detect-hint">{t('autoDetect.noneFoundHint')}</p>
        </div>
      )}

      {message && <div className="detect-toast">{message}</div>}
    </div>
  );
}

/**
 * The review step: shown at the top of the rooms tab whenever a detection run left suggestions on
 * the current page, and gone as soon as they are all accepted or rejected.
 */
export function DetectionReviewPanel() {
  const { touchInput, reviewOnly } = useWorkspaceLayout();
  const t = useT();
  const currentPage = useAppStore((s) => s.currentPage);
  const candidates = useAppStore((s) => s.detectionCandidates);
  const acceptCandidate = useAppStore((s) => s.acceptDetectionCandidate);
  const acceptAll = useAppStore((s) => s.acceptAllDetectionCandidates);
  const rejectCandidate = useAppStore((s) => s.rejectDetectionCandidate);
  const clearCandidates = useAppStore((s) => s.clearDetectionCandidates);
  const activeApartmentNumber = useAppStore((s) => s.activeApartmentNumber);
  const selectedCandidateId = useAppStore(s => s.selectedDetectionCandidateId);
  const selectCandidate = useAppStore(s => s.selectDetectionCandidate);
  const restoreCandidate = useAppStore(s => s.restoreDetectionCandidate);
  const setWarningReviewed = useAppStore(s => s.setDetectionWarningReviewed);
  const setAllWarningsReviewed = useAppStore(s => s.setAllDetectionWarningsReviewed);
  const setCandidateType = useAppStore(s => s.setDetectionCandidateType);
  const confirmCandidateType = useAppStore(s => s.confirmDetectionCandidateType);
  const [message, setMessage] = useState<string | null>(null);

  const pageCandidates = candidates.filter((c) => c.pageNumber === currentPage && !c.localAi);
  const validCount = pageCandidates.filter(c => !c.validationProblems?.length).length;
  if (pageCandidates.length === 0) return null;

  const flash = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 4000);
  };

  return (
    <div className="detect-review-panel">
      <div className="detect-review">
        <div className="detect-review-head">
          <strong>{t('autoDetect.suggestions', { count: pageCandidates.length })}</strong>
          <div className="detect-review-bulk">
            <button
              className="btn-primary small"
              disabled={validCount === 0}
              onClick={() => {
                const n = acceptAll();
                if (n > 0) flash(t('autoDetect.added', { count: n }));
              }}
            >
              {pageCandidates.some(c => c.localAi) ? `Accept all valid (${validCount})` : t('autoDetect.acceptAll')}
            </button>
            <button
              className="btn-secondary small"
              onClick={() => {
                clearCandidates();
                flash(t('autoDetect.rejected'));
              }}
            >
              {t('autoDetect.rejectAll')}
            </button>
          </div>
        </div>
        <p className="muted">
          {activeApartmentNumber
            ? t('autoDetect.assignToApartment', { apartment: activeApartmentNumber })
            : t('autoDetect.assignToNone')}
        </p>
        {pageCandidates.some(c => c.localAi && aiWarnings(c.localAi).length > 0) && <div className="ai-review-warning-actions">
          <button className="btn-secondary small" disabled={!pageCandidates.some(c => c.localAi && aiWarnings(c.localAi).some(w => !c.reviewedWarningIds?.includes(w.id)))} onClick={() => setAllWarningsReviewed(true)}>{t('aiReview.reviewAll')}</button>
          <button className="btn-secondary small" disabled={!pageCandidates.some(c => c.reviewedWarningIds?.length)} onClick={() => setAllWarningsReviewed(false)}>{t('aiReview.restoreWarnings')}</button>
        </div>}
        {pageCandidates.some(c => c.localAi) && <p className="auto-detect-hint">{t('aiReview.typeUnconfirmed')} {t('aiReview.noFinishes')}</p>}
        <ul className="detect-candidate-list">
          {pageCandidates.map((c) => (
            <li key={c.id} className={[c.localAi ? "ai-review-candidate" : "", selectedCandidateId === c.id ? "selected-ai-suggestion" : ""].join(" ")}>
              <div className="detect-candidate-label">
                {c.localAi ? <>
                  <strong>{aiCandidateLabel(c, t)}</strong>
                  <div className="muted">{t('aiReview.sourceId', { id: c.localAi.spaceId })}</div>
                  <div className="ai-review-type">
                  <label>
                    {t('aiReview.type')}
                    <select value={aiCandidateTypeKey(c) ?? ''} disabled={reviewOnly} onChange={event => setCandidateType(c.id, event.target.value || null)}>
                      <option value="">{t('aiReview.unknown')}</option>
                      {ROOM_PROFILES.map(profile => <option key={profile.key} value={profile.key}>{roomProfileName(profile, t)}</option>)}
                    </select>
                  </label>
                  {aiCandidateTypeKey(c) && <button className="btn-secondary small" disabled={reviewOnly || c.semanticTypeConfirmed} onClick={() => confirmCandidateType(c.id)}>
                    {t(c.semanticTypeConfirmed ? 'aiReview.typeConfirmed' : 'aiReview.confirmType')}
                  </button>}
                  </div>
                  {aiWarnings(c.localAi, t).length > 0 && <details className="ai-review-warnings">
                    <summary>
                      {aiWarnings(c.localAi, t).some(w => !c.reviewedWarningIds?.includes(w.id)) && <Icon name="alert" size={12} />}
                      {t('aiReview.warnings', { count: aiWarnings(c.localAi, t).filter(w => !c.reviewedWarningIds?.includes(w.id)).length })}
                    </summary>
                    {aiWarnings(c.localAi, t).filter(w => !c.reviewedWarningIds?.includes(w.id)).map(w => <label key={w.id} className="ai-review-warning">
                      <input type="checkbox" checked={false} onChange={() => setWarningReviewed(c.id, w.id, true)} aria-label={`${t('aiReview.reviewed')}: ${w.text}`} />
                      <span dir="auto">{w.text}</span>
                    </label>)}
                    {c.reviewedWarningIds?.length ? <details>
                      <summary>{t('aiReview.reviewed')}</summary>
                      {aiWarnings(c.localAi, t).filter(w => c.reviewedWarningIds?.includes(w.id)).map(w => <label key={w.id} className="ai-review-warning muted">
                        <input type="checkbox" checked onChange={() => setWarningReviewed(c.id, w.id, false)} aria-label={`${t('aiReview.reviewed')}: ${w.text}`} />
                        <span dir="auto">{w.text}</span>
                      </label>)}
                    </details> : null}
                  </details>}
                </> : <>
                  {c.roomTypeKey ? <span className="cal-ok"><Icon name="check" size={12} /> {t('autoDetect.detectedType', { type: roomProfileLabel(c.roomTypeKey) ?? '' })}</span>
                    : <span className="muted">{t('autoDetect.typeUnknown')}</span>}
                  {c.suggestedName && <span className="muted"> · {c.suggestedName}</span>}
                </>}
                {!!c.validationProblems?.length && <div className="ai-review-errors" role="status">
                  <strong>{t('aiReview.blocked')}</strong>
                  {c.validationProblems.map(problem => <div key={problem} dir="auto">{problem}</div>)}
                </div>}
              </div>
              <span className="list-item-actions">
                {c.localAi && !touchInput && !reviewOnly && <button className="btn-secondary small" aria-pressed={selectedCandidateId === c.id} onClick={() => {
                  useAppStore.getState().setToolMode('select'); selectCandidate(c.id);
                }}>Edit</button>}
                {c.localAi && !touchInput && !reviewOnly && selectedCandidateId === c.id && <button className="btn-secondary small" onClick={() => restoreCandidate(c.id)}>Restore original</button>}
                <button className="btn-secondary small" disabled={!!c.validationProblems?.length} onClick={() => acceptCandidate(c.id)} title={t('autoDetect.acceptHint')}>
                  {t('autoDetect.accept')}
                </button>
                <button className="icon-btn danger" onClick={() => rejectCandidate(c.id)} title={t('autoDetect.rejectHint')}>
                  <Icon name="close" />
                </button>
              </span>
            </li>
          ))}
        </ul>
        <p className="auto-detect-hint">{pageCandidates.some(c => c.localAi)
          ? 'Use Select to click an AI polygon. Drag a white vertex; click an edge + to add one; double-click a vertex to delete it (minimum three). Restore original discards draft edits. Approval uses the current geometry.'
          : t('autoDetect.editHint')}</p>
      </div>
      {message && <div className="detect-toast">{message}</div>}
    </div>
  );
}
