import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { useAiWorkflow } from '../lib/ai/workflow';
import { aiCandidateLabel, aiCandidateTypeKey, aiWarnings, aiReviewProgress } from '../lib/localAiReview';
import { ROOM_PROFILES, roomProfileName } from '../lib/roomProfiles';
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import { useT } from '../i18n';
import Icon from './Icon';

/** A dock in normal layout flow: the drawing is resized, never covered by review details. */
export default function AiReviewWorkspace(){
  const t=useT(),{touchInput,reviewOnly}=useWorkspaceLayout();
  const project=useAppStore(s=>s.project),pageNumber=useAppStore(s=>s.currentPage);
  const candidates=useAppStore(s=>s.detectionCandidates);
  const selectedId=useAppStore(s=>s.selectedDetectionCandidateId);
  const {resolvedIds:storedResolvedIds,sourceHash,reviewScope}=useAiWorkflow();
  const resolvedIds=reviewScope?.planId===project?.id&&reviewScope?.pageNumber===pageNumber?storedResolvedIds:[];
  const [collapsed,setCollapsed]=useState(false);
  const selectedRow=useRef<HTMLButtonElement>(null);
  const previousPending=useRef(0);
  const pending=candidates.filter(c=>c.localAi && c.localAi.planId===project?.id && c.pageNumber===pageNumber && (!sourceHash||c.localAi.sourceHash===sourceHash) && !resolvedIds.includes(c.id) && !project?.rooms.some(room=>room.id===c.id));
  const selected=pending.find(c=>c.id===selectedId);
  const progress=aiReviewProgress(pending.map(c=>c.id),resolvedIds);
  const warnings=selected?.localAi?aiWarnings(selected.localAi,t):[];
  const activeWarnings=warnings.filter(w=>!selected?.reviewedWarningIds?.includes(w.id));
  const reviewedWarnings=warnings.filter(w=>selected?.reviewedWarningIds?.includes(w.id));
  const validCount=pending.filter(c=>!c.validationProblems?.length).length;
  useEffect(()=>{
    if(!pending.length)setCollapsed(true);
    else if(previousPending.current===0)setCollapsed(false);
    previousPending.current=pending.length;
  },[pending.length]);
  useEffect(()=>{if(selectedId){setCollapsed(false);}},[selectedId]);
  useEffect(()=>{if(!collapsed)selectedRow.current?.scrollIntoView({block:'nearest',inline:'nearest'});},[selectedId,collapsed]);
  if(!project||(!pending.length&&!progress.total)||reviewOnly)return null;
  const actions=()=>useAppStore.getState();
  const select=(id:string)=>{actions().setDrawTarget('room');actions().setToolMode('select');actions().selectDetectionCandidate(id);setCollapsed(false);};
  const index=pending.findIndex(c=>c.id===selectedId);
  const advance=(offset:number)=>{if(pending.length)select(pending[(index<0?0:(index+offset+pending.length)%pending.length)].id);};
  const resolve=(approve:boolean)=>{
    if(!selected)return;
    const neighbor=pending[index+1]??pending[index-1];
    if(approve){if(!actions().acceptDetectionCandidate(selected.id))return;}
    else actions().rejectDetectionCandidate(selected.id);
    if(neighbor)select(neighbor.id);
  };
  return <section className={`ai-review-workspace${collapsed?' collapsed':''}`} aria-label={t('aiReviewWorkspace.title')}>
    <header className="ai-review-workspace-head">
      <strong>{t('aiReviewWorkspace.title')}</strong>
      <span title={t('aiReviewWorkspace.progressMeaning')} role="status">{t('aiReviewWorkspace.progress',progress)}</span>
      <button className="btn-secondary small" aria-expanded={!collapsed} aria-controls="ai-review-workspace-body" onClick={()=>setCollapsed(v=>!v)}>{t(collapsed?'aiReviewWorkspace.expand':'aiReviewWorkspace.collapse')}</button>
    </header>
    {!collapsed&&<div className="ai-review-workspace-body" id="ai-review-workspace-body">
      <nav className="ai-review-queue" aria-label={t('aiReviewWorkspace.pending',{count:pending.length})}>
        <div className="ai-review-queue-head">
          <strong>{t('aiReviewWorkspace.pending',{count:pending.length})}</strong>
          <button className="btn-secondary small" disabled={!pending.length} onClick={()=>advance(-1)} aria-label={t('aiReviewWorkspace.previous')}>{t('aiReviewWorkspace.previousShort')}</button>
          <button className="btn-secondary small" disabled={!pending.length} onClick={()=>advance(1)} aria-label={t('aiReviewWorkspace.next')}>{t('aiReviewWorkspace.nextShort')}</button>
        </div>
        <ul>
          {pending.map(c=>{
            const count=aiWarnings(c.localAi!,t).filter(w=>!c.reviewedWarningIds?.includes(w.id)).length;
            return <li key={c.id}><button ref={c.id===selectedId?selectedRow:undefined} className={`ai-review-queue-row${c.id===selectedId?' active':''}`} aria-current={c.id===selectedId?'true':undefined} onClick={()=>select(c.id)}>
              <span className="ai-review-queue-name" dir="auto">{aiCandidateLabel(c,t)}</span>
              <small dir="ltr">{c.localAi!.spaceId}</small>
              <span className="ai-review-queue-state">{c.validationProblems?.length?<span className="ai-review-hard-error"><Icon name="alert" size={12}/>{t('aiReviewWorkspace.blocked')}</span>
                :count?<span className="ai-review-uncertainty"><Icon name="alert" size={12}/>{t('aiReviewWorkspace.warningCount',{count})}</span>:t('aiReviewWorkspace.pendingState')}</span>
            </button></li>;
          })}
        </ul>
      </nav>
      <div className="ai-review-detail" key={selected?.id??'none'}>
        {selected?<>
          <header><strong dir="auto">{aiCandidateLabel(selected,t)}</strong><span className="muted">{t('aiReview.sourceId',{id:selected.localAi!.spaceId})}</span></header>
          <div className="ai-review-detail-actions">
            {!touchInput&&<button className="btn-secondary small" onClick={()=>select(selected.id)}>{t('aiReviewWorkspace.edit')}</button>}
            {!touchInput&&<button className="btn-secondary small" onClick={()=>actions().restoreDetectionCandidate(selected.id)}>{t('aiReviewWorkspace.restore')}</button>}
            <button className="btn-primary small" disabled={!!selected.validationProblems?.length} onClick={()=>resolve(true)}>{t('aiReviewWorkspace.approve')}</button>
            <button className="btn-secondary small" onClick={()=>resolve(false)}>{t('aiReviewWorkspace.reject')}</button>
          </div>
          {!!selected.validationProblems?.length&&<div className="ai-review-hard-error" role="status"><strong>{t('aiReview.blocked')}</strong>{selected.validationProblems.map(problem=><p key={problem} dir="auto">{problem}</p>)}</div>}
          <div className="ai-review-type">
            <label>{t('aiReview.type')}<select value={aiCandidateTypeKey(selected)??''} onChange={event=>actions().setDetectionCandidateType(selected.id,event.target.value||null)}><option value="">{t('aiReview.unknown')}</option>{ROOM_PROFILES.map(profile=><option key={profile.key} value={profile.key}>{roomProfileName(profile,t)}</option>)}</select></label>
            {aiCandidateTypeKey(selected)&&<button className="btn-secondary small" disabled={selected.semanticTypeConfirmed} onClick={()=>actions().confirmDetectionCandidateType(selected.id)}>{t(selected.semanticTypeConfirmed?'aiReview.typeConfirmed':'aiReview.confirmType')}</button>}
          </div>
          <p className="muted">{t('aiReview.typeUnconfirmed')} {t('aiReview.noFinishes')}</p>
          {activeWarnings.length?<section className="ai-review-warning-details"><strong>{t('aiReviewWorkspace.warningCount',{count:activeWarnings.length})}</strong>
            {activeWarnings.map(w=><label className="ai-review-warning" key={w.id}><input type="checkbox" checked={false} aria-label={`${t('aiReview.reviewed')}: ${w.text}`} onChange={()=>actions().setDetectionWarningReviewed(selected.id,w.id,true)}/><span dir="auto">{w.text}</span></label>)}
          </section>:<p className="muted">{t('aiReviewWorkspace.noWarnings')}</p>}
          {!!reviewedWarnings.length&&<details><summary>{t('aiReviewWorkspace.reviewedWarnings')}</summary>{reviewedWarnings.map(w=><label className="ai-review-warning" key={w.id}><input type="checkbox" checked aria-label={`${t('aiReview.reviewed')}: ${w.text}`} onChange={()=>actions().setDetectionWarningReviewed(selected.id,w.id,false)}/><span dir="auto">{w.text}</span></label>)}</details>}
          {!touchInput&&<p className="muted">{t('aiReviewWorkspace.editing')}</p>}
        </>:<p className="muted">{t(pending.length?'aiReviewWorkspace.choose':'aiReviewWorkspace.complete')}</p>}
      </div>
      <footer className="ai-review-workspace-footer">
        <span className="muted">{t('aiReviewWorkspace.progressMeaning')}</span>
        <div className="ai-review-detail-actions">
          <button className="btn-secondary small" disabled={!pending.some(c=>aiWarnings(c.localAi!,t).some(w=>!c.reviewedWarningIds?.includes(w.id)))} onClick={()=>actions().setAllDetectionWarningsReviewed(true)}>{t('aiReview.reviewAll')}</button>
          <button className="btn-secondary small" disabled={!pending.some(c=>c.reviewedWarningIds?.length)} onClick={()=>actions().setAllDetectionWarningsReviewed(false)}>{t('aiReview.restoreWarnings')}</button>
          <button className="btn-primary small" disabled={!validCount} onClick={()=>actions().acceptAllDetectionCandidates()}>{t('aiReviewWorkspace.approveAll',{count:validCount})}</button>
          <button className="btn-secondary small" disabled={!pending.length} onClick={()=>{
            if(pending.length===actions().detectionCandidates.length)actions().clearDetectionCandidates();
            else pending.forEach(c=>actions().rejectDetectionCandidate(c.id));
          }}>{t('aiReviewWorkspace.rejectAll')}</button>
        </div>
      </footer>
    </div>}
  </section>;
}
