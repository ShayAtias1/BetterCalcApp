import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { useT } from '../i18n';
import { useAiWorkflow, initializeAiWorkflow, activateAiPage, startAiDetection } from '../lib/ai/workflow';

/** Development only until the job transport has production admission/abuse protection. */
export default function AiSpaceDetectionPanel(){
  const t=useT(),planId=useAppStore(s=>s.project?.id),pageNumber=useAppStore(s=>s.currentPage);
  const candidates=useAppStore(s=>s.detectionCandidates);
  const {jobs,ready,error,sourceHash}=useAiWorkflow();
  useEffect(()=>{
    let alive=true;
    void initializeAiWorkflow().then(()=>{if(alive&&planId)return activateAiPage(planId,pageNumber);});
    return ()=>{alive=false;};
  },[planId,pageNumber]);
  const active=jobs.find(job=>job.status==='PREPARING'||job.status==='PROCESSING');
  const current=jobs.filter(job=>job.planId===planId&&job.pageNumber===pageNumber&&job.sourceHash===sourceHash).sort((a,b)=>b.createdAt-a.createdAt)[0];
  const hasDrafts=candidates.some(c=>c.localAi);
  return <div className="auto-detect-panel">
    <span className="section-label">{t('aiDetection.title')}</span>
    <p className="auto-detect-hint">{t('aiDetection.disclosure')}</p>
    <button className="btn-primary full-width" disabled={!ready||!!active||hasDrafts} onClick={()=>void startAiDetection()}>{t(current?.status==='FAILED'?'aiDetection.retry':'aiDetection.title')}</button>
    {hasDrafts&&<p className="auto-detect-hint">{t('aiDetection.reviewFirst')}</p>}
    {active&&<div className="ai-job-status" role="status">
      <progress aria-label={t(active.status==='PREPARING'?'aiDetection.preparing':'aiDetection.processing')} />
      <span>{t(active.status==='PREPARING'?'aiDetection.preparing':'aiDetection.processing')} · {t('aiDetection.page',{page:active.pageNumber})}</span>
    </div>}
    {current?.status==='COMPLETED'&&<p className="auto-detect-hint" role="status">{t('aiDetection.completed')}</p>}
    {current?.status==='FAILED'&&<p className="cal-missing" role="alert">{current.error}</p>}
    {error&&<p className="cal-missing" role="alert">{error}</p>}
  </div>;
}
