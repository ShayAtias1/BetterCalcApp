import { aiWarningText } from '../lib/aiWarningText';
import { useEffect } from 'react';
import AiReviewWindow from './AiReviewWindow';
import { useAppStore } from '../store/appStore';
import { useAiWorkflow, initializeAiWorkflow, activateAiPage } from '../lib/ai/workflow';
import { aiCandidateLabel, aiCandidateTypeKey, aiReviewProgress, pendingAiReviewCandidates } from '../lib/localAiReview';
import { ROOM_PROFILES, roomProfileName } from '../lib/roomProfiles';
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import { useT } from '../i18n';
import Icon from './Icon';

/** Review content uses an opt-in window above its fixed launcher. */
export default function AiReviewWorkspace(){
  const t=useT(),{touchInput,reviewOnly}=useWorkspaceLayout();
  const project=useAppStore(s=>s.project),pageNumber=useAppStore(s=>s.currentPage);
  const candidates=useAppStore(s=>s.detectionCandidates);
  const selectedId=useAppStore(s=>s.selectedDetectionCandidateId);
  const workflow=useAiWorkflow();
  const {resolvedIds:storedResolvedIds,reviewScope}=workflow;
  const planId=project?.id;
  useEffect(()=>{
    let alive=true;
    void initializeAiWorkflow().then(()=>{if(alive&&planId)return activateAiPage(planId,pageNumber);});
    return ()=>{alive=false;};
  },[planId,pageNumber]);
  const resolvedIds=reviewScope?.planId===project?.id&&reviewScope?.pageNumber===pageNumber?storedResolvedIds:[];
  const pending=pendingAiReviewCandidates(candidates,project,pageNumber,workflow);
  const selected=pending.find(c=>c.id===selectedId)??pending[0];
  const progress=aiReviewProgress(pending.map(c=>c.id),resolvedIds);
  const validCount=pending.filter(c=>!c.validationProblems?.length).length;
  if(!project||(!pending.length&&!progress.total)||reviewOnly)return null;
  const actions=()=>useAppStore.getState();
  const select=(id:string)=>{actions().setDrawTarget('room');actions().setToolMode('select');actions().selectDetectionCandidate(id);};
  const index=pending.findIndex(c=>c.id===selected?.id);
  const advance=(offset:number)=>{if(pending.length)select(pending[(index<0?0:(index+offset+pending.length)%pending.length)].id);};
  const resolve=(approve:boolean)=>{
    if(!selected)return;
    const neighbor=pending[index+1]??pending[index-1];
    if(approve){if(!actions().acceptDetectionCandidate(selected.id))return;}
    else actions().rejectDetectionCandidate(selected.id);
    if(neighbor)select(neighbor.id);
  };
  return <AiReviewWindow title={t('aiReviewWorkspace.title')} progress={t('aiReviewWorkspace.progress',progress)} meaning={t('aiReviewWorkspace.progressMeaning')}
    scope={`${project.id}:${pageNumber}`} bodyId="ai-review-workspace-body" selectedId={selected?.id} onOpen={()=>{if(selected)select(selected.id);}}>
      <nav className="ai-review-queue" aria-label={t('aiReviewWorkspace.pending',{count:pending.length})}>
        <div className="ai-review-queue-head">
          <strong>{t('aiReviewWorkspace.pending',{count:pending.length})}</strong>
          <button className="btn-secondary small" disabled={!pending.length} onClick={()=>advance(-1)} aria-label={t('aiReviewWorkspace.previous')}>{t('aiReviewWorkspace.previousShort')}</button>
          <button className="btn-secondary small" disabled={!pending.length} onClick={()=>advance(1)} aria-label={t('aiReviewWorkspace.next')}>{t('aiReviewWorkspace.nextShort')}</button>
        </div>
        <ul>
          {pending.map(c=><li key={c.id}><button className={`ai-review-queue-row${c.id===selected?.id?' active':''}`} aria-current={c.id===selected?.id?'true':undefined} onClick={()=>select(c.id)}>
              <span className="ai-review-queue-name" dir="auto">{aiCandidateLabel(c,t)}</span>
              <small dir="ltr">{c.localAi!.spaceId}</small>
              <span className="ai-review-queue-state">{c.validationProblems?.length?<span className="ai-review-hard-error"><Icon name="alert" size={12}/>{t('aiReviewWorkspace.blocked')}</span>
                :t('aiReviewWorkspace.pendingState')}</span>
            </button></li>)}
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
          {!!selected.validationProblems?.length&&<div className="ai-review-hard-error" role="status"><strong>{t('aiReview.blocked')}</strong>{selected.validationProblems.map(problem=><p key={problem} dir="auto">{aiWarningText(problem,t)}</p>)}</div>}
          <div className="ai-review-type">
            <label>{t('aiReview.type')}<select value={aiCandidateTypeKey(selected)??''} onChange={event=>actions().setDetectionCandidateType(selected.id,event.target.value||null)}><option value="">{t('aiReview.unknown')}</option>{ROOM_PROFILES.map(profile=><option key={profile.key} value={profile.key}>{roomProfileName(profile,t)}</option>)}</select></label>
            {aiCandidateTypeKey(selected)&&<button className="btn-secondary small" disabled={selected.semanticTypeConfirmed} onClick={()=>actions().confirmDetectionCandidateType(selected.id)}>{t(selected.semanticTypeConfirmed?'aiReview.typeConfirmed':'aiReview.confirmType')}</button>}
          </div>
          <p className="muted">{t('aiReview.typeUnconfirmed')} {t('aiReview.noFinishes')}</p>
          {!touchInput&&<p className="muted">{t('aiReviewWorkspace.editing')}</p>}
        </>:<p className="muted">{t(pending.length?'aiReviewWorkspace.choose':'aiReviewWorkspace.complete')}</p>}
      </div>
      <footer className="ai-review-workspace-footer">
        <span className="muted">{t('aiReviewWorkspace.progressMeaning')}</span>
        <div className="ai-review-detail-actions">
          <button className="btn-primary small" disabled={!validCount} onClick={()=>actions().acceptAllDetectionCandidates()}>{t('aiReviewWorkspace.approveAll',{count:validCount})}</button>
          <button className="btn-secondary small" disabled={!pending.length} onClick={()=>{
            if(pending.length===actions().detectionCandidates.length)actions().clearDetectionCandidates();
            else pending.forEach(c=>actions().rejectDetectionCandidate(c.id));
          }}>{t('aiReviewWorkspace.rejectAll')}</button>
        </div>
      </footer>
  </AiReviewWindow>;
}
