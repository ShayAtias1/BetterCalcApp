import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { useT } from '../i18n';
import { confirmDialog } from '../lib/appDialogs';
import Icon from './Icon';
import { initializeOpeningsAiUi, activateOpeningsAiPage, requestOpeningDetection, useOpeningsAiUi } from '../lib/ai/openingsUi';
export default function AiOpeningsPanel(){
  const t=useT(),planId=useAppStore(s=>s.project?.id),page=useAppStore(s=>s.currentPage);
  const ui=useOpeningsAiUi();
  useEffect(()=>{void initializeOpeningsAiUi().then(()=>{if(planId)return activateOpeningsAiPage(planId,page);});},[planId,page]);
  const current=ui.jobs.filter(j=>j.planId===planId&&j.pageNumber===page&&j.sourceHash===ui.sourceHash).sort((a,b)=>b.createdAt-a.createdAt)[0];
  const active=ui.jobs.some(j=>['PREPARING','AWAITING_CONSENT','PROCESSING'].includes(j.status));
  const working=ui.busy||active;
  return <div className="opening-ai-controls">
    <button type="button" className="btn-secondary ai-tool-button" disabled={working||!ui.sourceHash||ui.planId!==planId||ui.pageNumber!==page||current?.status==='COMPLETED'}
      onClick={()=>void requestOpeningDetection(job=>confirmDialog(t('openingAi.consent')+(job.previousPaidAttempt?`\n\n${t('openingAi.previousPaid')}`:''),
        {title:t('openingAi.title'),confirmLabel:t('dialogs.aiStart')}))}><Icon name="scan" size={16}/><span>{t('openingAi.title')}</span></button>
    {working&&<div role="status"><progress aria-label={t(current?.status==='PROCESSING'?'openingAi.processing':'openingAi.preparing')}/><span>{t(current?.status==='PROCESSING'?'openingAi.processing':'openingAi.preparing')}</span></div>}
    {current?.status==='COMPLETED'&&<p className="opening-help" role="status">{t('openingAi.completed')}</p>}
    {(ui.error||current?.error)&&<p className="opening-error" role="alert">{ui.error||current?.error}</p>}
  </div>;
}
