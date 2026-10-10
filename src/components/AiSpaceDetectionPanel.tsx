import { pendingAiReviewCandidates } from '../lib/localAiReview';
import { confirmDialog } from '../lib/appDialogs';
import { canAuthorTakeoff, isTouchInput } from '../lib/workspaceCapabilities';
import { useAppStore } from '../store/appStore';
import { useT } from '../i18n';
import Icon from './Icon';
import AiOpeningsPanel from './AiOpeningsPanel';
import { useMultiPlanAiDialog } from './multiPlanAiEntry';
import { useAiBatches } from '../lib/ai/batchWorkflow';
import './AiSpaceDetectionPanel.css';
import { useAiWorkflow, startAiDetection, armOneClick, cancelOneClick } from '../lib/ai/workflow';

/** Development only until the job transport has production admission/abuse protection. */
export default function AiSpaceDetectionPanel(){
  const t=useT(),project=useAppStore(s=>s.project),pageNumber=useAppStore(s=>s.currentPage);
  const planId=project?.id;
  const folder=useAppStore(s=>s.currentProject);
  const batchReady=useAiBatches(s=>s.ready);
  const openMultiPlan=useMultiPlanAiDialog(s=>s.setOpen);
  const candidates=useAppStore(s=>s.detectionCandidates);
  const workflow=useAiWorkflow();
  const {jobs,ready,error,sourceHash,oneClickArmed}=workflow;
  const pending=pendingAiReviewCandidates(candidates,project,pageNumber,workflow);
  const active=jobs.find(job=>job.status==='PREPARING'||job.status==='PROCESSING');
  const recovering=jobs.some(job=>job.recoveryPending);
  const current=jobs.filter(job=>job.planId===planId&&job.pageNumber===pageNumber&&job.sourceHash===sourceHash).sort((a,b)=>b.createdAt-a.createdAt)[0];
  const hasDrafts=pending.length>0;
  return <section className="ai-tools-section" aria-labelledby="ai-tools-title">
    <h3 id="ai-tools-title">{t('aiTools.title')}</h3>
    <div className="ai-tools-actions">
      <button className="btn-secondary ai-tool-button" disabled={!ready||!!active||recovering||hasDrafts} onClick={async()=>{
        if(await confirmDialog(t('aiTools.fullPageConsent'), { title: t('dialogs.aiTitle'), confirmLabel: t('dialogs.aiStart') }))void startAiDetection();
      }}><Icon name="scan" size={16}/><span>{t('aiTools.allSpaces')}</span></button>
      <button className={`btn-secondary ai-tool-button${oneClickArmed?' active':''}`} disabled={!ready||!!active||recovering||!canAuthorTakeoff()||isTouchInput()} aria-pressed={oneClickArmed} aria-label={t(oneClickArmed?'aiDetection.cancelOneClick':'aiTools.oneClick')} onClick={async()=>{
        if(oneClickArmed)cancelOneClick();
        else if(await confirmDialog(t('aiTools.oneClickConsent'), { title: t('dialogs.aiTitle'), confirmLabel: t('dialogs.aiArm') }))armOneClick();
      }}><Icon name="target" size={16}/><span>{t('aiTools.oneClick')}</span>{oneClickArmed&&<Icon name="close" size={14}/>}</button>
      <button className="btn-secondary ai-tool-button" disabled={!folder||!batchReady} onClick={()=>{cancelOneClick();openMultiPlan(true);}}><Icon name="layers" size={16}/><span>{t('aiTools.multiPlan')}</span></button>
      <AiOpeningsPanel />
    </div>
    {oneClickArmed&&<p className="auto-detect-hint" role="status">{t('aiDetection.oneClickHint')}</p>}
    {current?.mode==='one-click-v1'&&current.status==='COMPLETED'&&current.resultSummary&&<p className="auto-detect-hint">{t('autoDetect.noneFound')}</p>}
    {active&&<div className="ai-job-status" role="status">
      <progress aria-label={t(active.status==='PREPARING'?'aiDetection.preparing':'aiDetection.processing')} />
      <span>{t(active.status==='PREPARING'?'aiDetection.preparing':'aiDetection.processing')} · {t('aiDetection.page',{page:active.pageNumber})}</span>
    </div>}
    {current?.status==='COMPLETED'&&current.mode!=='one-click-v1'&&<p className="auto-detect-hint" role="status">{t('aiDetection.completed')}</p>}
    {current?.status==='FAILED'&&<p className="cal-missing" role="alert">{current.error}</p>}
    {error&&<p className="cal-missing" role="alert">{error}</p>}
  </section>;
}
