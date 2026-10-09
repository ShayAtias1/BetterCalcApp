import { confirmDialog } from '../lib/appDialogs';
import { canAuthorTakeoff, isTouchInput } from '../lib/workspaceCapabilities';
import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { useT } from '../i18n';
import Icon from './Icon';
import AiOpeningsPanel from './AiOpeningsPanel';
import { useMultiPlanAiDialog } from './multiPlanAiEntry';
import { useAiBatches } from '../lib/ai/batchWorkflow';
import './AiSpaceDetectionPanel.css';
import { useAiWorkflow, initializeAiWorkflow, activateAiPage, startAiDetection, armOneClick, cancelOneClick } from '../lib/ai/workflow';

/** Development only until the job transport has production admission/abuse protection. */
export default function AiSpaceDetectionPanel(){
  const t=useT(),planId=useAppStore(s=>s.project?.id),pageNumber=useAppStore(s=>s.currentPage);
  const folder=useAppStore(s=>s.currentProject);
  const batchReady=useAiBatches(s=>s.ready);
  const openMultiPlan=useMultiPlanAiDialog(s=>s.setOpen);
  const candidates=useAppStore(s=>s.detectionCandidates);
  const {jobs,ready,error,sourceHash,oneClickArmed}=useAiWorkflow();
  useEffect(()=>{
    let alive=true;
    void initializeAiWorkflow().then(()=>{if(alive&&planId)return activateAiPage(planId,pageNumber);});
    return ()=>{alive=false;};
  },[planId,pageNumber]);
  const active=jobs.find(job=>job.status==='PREPARING'||job.status==='PROCESSING');
  const current=jobs.filter(job=>job.planId===planId&&job.pageNumber===pageNumber&&job.sourceHash===sourceHash).sort((a,b)=>b.createdAt-a.createdAt)[0];
  const hasDrafts=candidates.some(c=>c.localAi);
  return <section className="ai-tools-section" aria-labelledby="ai-tools-title">
    <h3 id="ai-tools-title">{t('aiTools.title')}</h3>
    <div className="ai-tools-actions">
      <button className="btn-secondary ai-tool-button" disabled={!ready||!!active||hasDrafts} onClick={async()=>{
        if(await confirmDialog(t('aiTools.fullPageConsent'), { title: t('dialogs.aiTitle'), confirmLabel: t('dialogs.aiStart') }))void startAiDetection();
      }}><Icon name="scan" size={16}/><span>{t('aiTools.allSpaces')}</span></button>
      <button className={`btn-secondary ai-tool-button${oneClickArmed?' active':''}`} disabled={!ready||!!active||!canAuthorTakeoff()||isTouchInput()} aria-pressed={oneClickArmed} aria-label={t(oneClickArmed?'aiDetection.cancelOneClick':'aiTools.oneClick')} onClick={async()=>{
        if(oneClickArmed)cancelOneClick();
        else if(await confirmDialog(t('aiTools.oneClickConsent'), { title: t('dialogs.aiTitle'), confirmLabel: t('dialogs.aiArm') }))armOneClick();
      }}><Icon name="target" size={16}/><span>{t('aiTools.oneClick')}</span>{oneClickArmed&&<Icon name="close" size={14}/>}</button>
      <button className="btn-secondary ai-tool-button" disabled={!folder||!batchReady} onClick={()=>{cancelOneClick();openMultiPlan(true);}}><Icon name="layers" size={16}/><span>{t('aiTools.multiPlan')}</span></button>
      <AiOpeningsPanel />
    </div>
    {oneClickArmed&&<p className="auto-detect-hint" role="status">{t('aiDetection.oneClickHint')}</p>}
    {current?.mode==='one-click-v1'&&current.status==='COMPLETED'&&<p className="auto-detect-hint">{current.resultSummary||t('aiDetection.oneClickCompleted')}</p>}
    {hasDrafts&&<p className="auto-detect-hint">{t('aiDetection.reviewFirst')}</p>}
    {active&&<div className="ai-job-status" role="status">
      <progress aria-label={t(active.status==='PREPARING'?'aiDetection.preparing':'aiDetection.processing')} />
      <span>{t(active.status==='PREPARING'?'aiDetection.preparing':'aiDetection.processing')} · {t('aiDetection.page',{page:active.pageNumber})}</span>
    </div>}
    {current?.status==='COMPLETED'&&current.mode!=='one-click-v1'&&<p className="auto-detect-hint" role="status">{t('aiDetection.completed')}</p>}
    {current?.status==='FAILED'&&<p className="cal-missing" role="alert">{current.error}</p>}
    {error&&<p className="cal-missing" role="alert">{error}</p>}
  </section>;
}
