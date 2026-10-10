import { useT } from '../i18n';
import { canAuthorTakeoff } from '../lib/workspaceCapabilities';
import { useBulkTakeoffDialog } from './bulkTakeoffEntry';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useAppStore } from '../store/appStore';
import { useLanguage } from '../i18n';
import { loadAiReview, loadPlan } from '../db/database';
import { useAiWorkflow } from '../lib/ai/workflow';
import { initializeBatches, inspectBatchPlans, prepareBatch, runBatch, stopBatch, useAiBatches } from '../lib/ai/batchWorkflow';
import { batchCost, batchQuantities, CALCULATIONS, type AiBatch, type Calculation } from '../lib/ai/batchModel';
import type { AiReviewRecord } from '../lib/ai/contracts';
import type { Plan } from '../types';
import { subscribePdfBlobChanges } from '../lib/pdfBlobEvents';
import Icon from './Icon';
import { multiPlanAiCopy } from './multiPlanAiCopy';
import { useMultiPlanAiDialog } from './multiPlanAiEntry';
import './MultiPlanAi.css';

type Inventory = Awaited<ReturnType<typeof inspectBatchPlans>>;
export default function MultiPlanAi(){
  const t=useT();
  const language=useLanguage(),l=multiPlanAiCopy[language];
  const folder=useAppStore(s=>s.currentProject),projectPlans=useAppStore(s=>s.projectPlans),activePlan=useAppStore(s=>s.project);
  const batches=useAiBatches(s=>s.batches),batchError=useAiBatches(s=>s.error),batchReady=useAiBatches(s=>s.ready);
  const jobs=useAiWorkflow(s=>s.jobs);
  const {open,setOpen}=useMultiPlanAiDialog();
  const [stage,setStage]=useState<'plans'|'calculations'|'scope'|'results'>('results');
  const [expandedPlans,setExpandedPlans]=useState<string[]>([]);
  const dialogRef=useRef<HTMLElement>(null), headingRef=useRef<HTMLHeadingElement>(null);
  const contentRef=useRef<HTMLDivElement>(null);
  const [inventory,setInventory]=useState<Inventory>([]),[busy,setBusy]=useState(false),[loadingInventory,setLoadingInventory]=useState(false),[error,setError]=useState('');
  const [selected,setSelected]=useState<string[]>([]),[calculations,setCalculations]=useState<Calculation[]>(['area','perimeter']);
  const [draft,setDraft]=useState<AiBatch|null>(null),[batchId,setBatchId]=useState<string|null>(null);
  const [loadedBatchId,setLoadedBatchId]=useState<string|null>(null);
  const [plans,setPlans]=useState<Plan[]>([]),[reviews,setReviews]=useState<Record<string,AiReviewRecord|undefined>>({});
  const [stopping,setStopping]=useState(false),[sourceRevision,setSourceRevision]=useState(0);
  useEffect(()=>subscribePdfBlobChanges(()=>setSourceRevision(v=>v+1)),[]);
  const batch=batches.find(b=>b.id===batchId&&b.projectId===folder?.id);
  useEffect(()=>{void initializeBatches().catch(e=>setError(String(e)));},[]);
  useEffect(()=>{setOpen(false);setDraft(null);setBatchId(null);setInventory([]);setSelected([]);setExpandedPlans([]);setStage('results');},[folder?.id]);
  useEffect(()=>{
    if(!open||!folder||stage!=='results')return;
    const saved=batches.filter(b=>b.projectId===folder.id).sort((a,b)=>b.createdAt-a.createdAt);
    const target=saved.find(b=>b.id===batchId)??saved.find(b=>b.state==='running')??saved[0];
    if(target)setBatchId(target.id);else setStage('plans');
    // Opening the dialog changes presentation only; ongoing batch jobs remain untouched.
  },[open,folder?.id]);
  useEffect(()=>{
    if(!open||!folder)return;
    let alive=true;setLoadingInventory(true);
    void inspectBatchPlans(projectPlans.map(p=>p.id===activePlan?.id?activePlan:p)).then(v=>{if(alive)setInventory(v);}).catch(e=>{if(alive)setError(String(e));}).finally(()=>{if(alive)setLoadingInventory(false);});
    return()=>{alive=false;};
  },[open,folder?.id,projectPlans,sourceRevision]);
  useEffect(()=>{
    if(!open||!batch)return;
    let alive=true;
    const refresh=async()=>{
      try{
        const loaded=await Promise.all([...new Set(batch.pages.map(p=>p.planId))].map(loadPlan));
        const records=await Promise.all(batch.pages.map(async p=>[p.reviewKey,await loadAiReview(p.reviewKey)] as const));
        if(alive){setPlans(loaded.filter((p):p is Plan=>!!p));setReviews(Object.fromEntries(records));setLoadedBatchId(batch.id);}
      }catch(e){if(alive)setError(String(e));}
    };
    void refresh();const timer=setInterval(()=>void refresh(),2500);
    return()=>{alive=false;clearInterval(timer);};
  },[open,batch,jobs]);
  useEffect(()=>{
    if(!open)return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    dialogRef.current?.focus();
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();setOpen(false);return;}
      if(event.key!=='Tab')return;
      const elements=Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')??[]).filter(el=>el.getClientRects().length);
      const first=elements[0],last=elements.at(-1);
      if(!first){event.preventDefault();dialogRef.current?.focus();}
      else if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialogRef.current)){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===dialogRef.current)){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',onKeyDown);
    return()=>{document.removeEventListener('keydown',onKeyDown);if(previous?.isConnected)previous.focus();};
  },[open]);
  useEffect(()=>{if(open){contentRef.current?.scrollTo({top:0});headingRef.current?.focus();}},[stage,open,batchId]);
  if(!folder)return null;
  const projectBatches=batches.filter(b=>b.projectId===folder.id).sort((a,b)=>b.createdAt-a.createdAt);
  const key=(id:string,page:number)=>`${id}:${page}`;
  const toggle=(keys:string[],value:boolean)=>setSelected(old=>value?[...new Set([...old,...keys])]:old.filter(k=>!keys.includes(k)));
  const action=async(fn:()=>Promise<void>)=>{setError('');setBusy(true);try{await fn();}catch(e){setError(String(e));}finally{setBusy(false);}};
  const scope=draft, newCount=scope?.pages.filter(p=>p.status==='queued'&&!p.requestId).length??0;
  const cost=batchCost(jobs,newCount);
  const effectivePlans=plans.map(p=>p.id===activePlan?.id?activePlan:p).filter(p=>inventory.some(i=>i.plan.id===p.id&&batch?.pages.some(b=>b.planId===p.id&&b.sourceHash===i.sourceHash)));
  const quantities=batch?batchQuantities(batch,effectivePlans):null;
  const pageStatus=(p:AiBatch['pages'][number])=>{
    const job=jobs.find(j=>j.requestId===p.requestId);
    return job?.status==='COMPLETED'?'completed':job?.status==='FAILED'||job?.status==='CANCELLED'?'failed':job?.status==='PROCESSING'||job?.status==='PREPARING'?'processing':p.status;
  };
  const visit=async(planId:string,pageNumber:number,roomId?:string)=>{
    if(await useAppStore.getState().openPlan(planId)){
      useAppStore.getState().setCurrentPage(pageNumber);useAppStore.getState().setDrawTarget('room');useAppStore.getState().setToolMode('select');
      if(roomId)useAppStore.getState().setSelectedRoomId(roomId);setOpen(false);
    }
  };
  const globalRunning=batches.some(b=>b.state==='running');
  const activeProjectBatch=projectBatches.find(b=>b.state==='running');
  const totalSelected=inventory.reduce((n,i)=>n+Array.from({length:i.count},(_,p)=>key(i.plan.id,p+1)).filter(k=>selected.includes(k)).length,0);
  const selectedDocuments=inventory.filter(i=>selected.some(k=>k.startsWith(`${i.plan.id}:`))).length;
  const stageNumber={plans:0,calculations:1,scope:2,results:3}[stage];
  const resuming=!!scope&&projectBatches.some(b=>b.id===scope.id);
  const newBatch=()=>{setSelected([]);setExpandedPlans([]);setDraft(null);setError('');setStage('plans');};
  const prepareScope=()=>void action(async()=>{
    const selection=inventory.flatMap(i=>Array.from({length:i.count},(_,n)=>({plan:i.plan,pageNumber:n+1,sourceHash:i.sourceHash})).filter(p=>selected.includes(key(p.plan.id,p.pageNumber))));
    setDraft(await prepareBatch(folder.id,selection,calculations));setStage('scope');
  });
  const groupPages=(pages:AiBatch['pages'])=>{
    const groups=new Map<string,{name:string;pages:AiBatch['pages']}>();
    for(const p of pages){if(!groups.has(p.planId))groups.set(p.planId,{name:p.planName,pages:[]});groups.get(p.planId)!.pages.push(p);}
    return [...groups.entries()];
  };
  const reviewCount=batch?.pages.filter(p=>pageStatus(p)==='completed'&&(reviews[p.reviewKey]?.candidates.length??0)>0).length??0;
  const currentPage=batch?.pages.find(p=>pageStatus(p)==='processing');
  const pageGroups=batch?groupPages(batch.pages):[];
  const resultsLoaded=loadedBatchId===batch?.id;
  const sourceChanged=(p:AiBatch['pages'][number])=>!inventory.some(i=>i.plan.id===p.planId&&i.sourceHash===p.sourceHash);
  const quantityLines: {label:string;value:string}[]=[];
  if(batch&&quantities){
    for(const c of ['area','perimeter'] as const){
      if(!batch.calculations.includes(c))continue;
      const value=quantities.pages.some(q=>q.rooms.length&&!q.calibrated)||batch.pages.some(sourceChanged)?l.pending:quantities.pages.every(q=>!q.rooms.length)?l.empty:`${quantities.pages.reduce((n,q)=>n+(q[c]??0),0).toFixed(2)} ${c==='area'?'m²':'m'}`;
      quantityLines.push({label:l[c],value});
    }
    for(const c of batch.calculations.filter(c=>c==='flooring'||c==='cladding'||c==='skirting')){
      const totals=quantities.report.totals.filter(t=>c==='flooring'?t.category==='tiling_regular'||t.category==='tiling_as':t.category===(c==='skirting'?'panels':'cladding'));
      if(!totals.length)quantityLines.push({label:l[c],value:l.configuration});
      for(const total of totals){
        const pending=quantities.pages.some(p=>!p.calibrated&&p.rooms.length||p.missing.includes(c))||batch.pages.some(sourceChanged);
        quantityLines.push({label:`${l[c]} (${total.label})`,value:pending?l.pending:`${(total.lengthM??total.quantityM2).toFixed(2)} ${total.lengthM===null?'m²':'m'} · ${(total.orderLengthM??total.orderM2).toFixed(2)} ${l.order}`});
      }
    }
  }
  return <>
    {open&&<div className="modal-backdrop multi-plan-backdrop"><section ref={dialogRef} tabIndex={-1} className="multi-plan-dialog" role="dialog" aria-modal="true" aria-labelledby="mp-title" dir={language==='he'?'rtl':'ltr'}>
      <header className="mp-header">
        <div className="mp-identity"><span className="mp-eyebrow">{l.project} · <bdi>{folder.name}</bdi></span><h2 id="mp-title">{l.title}</h2></div>
        <div className="mp-header-actions">
          {stage!=='results'&&projectBatches.length>0&&<button className="btn-ghost" onClick={()=>{setBatchId(batch?.id??activeProjectBatch?.id??projectBatches[0].id);setStage('results');}}>{l.batches}</button>}
          {stage==='results'&&projectBatches.length>0&&<button className="btn-secondary" disabled={busy||!batchReady||globalRunning} onClick={newBatch}><Icon name="plus" size={16}/>{l.newBatch}</button>}
          <button className="icon-btn" aria-label={l.close} title={l.close} onClick={()=>setOpen(false)}><Icon name="close" size={20}/></button>
        </div>
      </header>
      <nav className="mp-stepper" aria-label={l.title}><ol>{l.steps.map((step,i)=><li key={step} className={i===stageNumber?'current':i<stageNumber?'past':''} aria-current={i===stageNumber?'step':undefined}><span className="mp-step-number" aria-hidden="true">{i<stageNumber?<Icon name="check" size={14}/>:i+1}</span><span>{step}</span></li>)}</ol></nav>
      <div className="mp-content" ref={contentRef}>
        {(error||batchError)&&<div role="alert" className="mp-notice mp-error"><Icon name="alert" size={18}/><span dir="auto">{error||batchError}</span></div>}
        {stage==='plans'&&<>
          <StageHeading headingRef={headingRef} title={l.plansTitle} description={l.plansIntro}/>
          <div className="mp-list-toolbar"><span>{inventory.length} {l.documents}</span><div><button className="btn-ghost" disabled={busy||loadingInventory||!inventory.length} onClick={()=>toggle(inventory.flatMap(i=>Array.from({length:i.count},(_,p)=>key(i.plan.id,p+1))),true)}>{l.selectAll}</button><button className="btn-ghost" disabled={busy||!totalSelected} onClick={()=>setSelected([])}>{l.clear}</button></div></div>
          {loadingInventory&&<p className="mp-loading" role="status">{l.loading}</p>}
          {!loadingInventory&&!inventory.length&&<div className="mp-empty"><Icon name="file" size={28}/><h3>{l.noDocuments}</h3><p>{l.noDocumentsHint}</p></div>}
          <div className="mp-plan-list" aria-label={l.selectedPlans}>{inventory.map(({plan,count})=>{
            const keys=Array.from({length:count},(_,i)=>key(plan.id,i+1)),countSelected=keys.filter(k=>selected.includes(k)).length;
            const expanded=expandedPlans.includes(plan.id),state=countSelected===count?'all':countSelected?'some':'none';
            return <section className={`mp-plan ${state}`} key={plan.id}>
              <div className="mp-plan-head">
                <label className="mp-plan-choice"><MixedCheckbox checked={state==='all'} mixed={state==='some'} disabled={busy||loadingInventory} label={`${l.selectDocument} ${plan.name}`} onChange={value=>toggle(keys,value)}/><span className="mp-document-icon"><Icon name="file" size={20}/></span><span className="mp-plan-name"><strong dir="auto">{plan.name}</strong><span className="muted" dir="auto">{plan.pdfFileName} · {count} {l.pages}</span></span></label>
                <span className={`mp-selection-state ${state}`}>{state==='all'?l.allPages:state==='some'?`${countSelected} / ${count} ${l.somePages}`:l.noPages}</span>
                <button className="btn-ghost mp-expand" aria-expanded={expanded} aria-controls={`mp-pages-${plan.id}`} aria-label={`${expanded?l.collapse:l.expand}: ${plan.name}`} onClick={()=>setExpandedPlans(old=>expanded?old.filter(id=>id!==plan.id):[...old,plan.id])}><span>{expanded?l.collapse:l.expand}</span><Icon name={expanded?'chevron-up':'chevron-down'} size={16}/></button>
              </div>
              {expanded&&<div className="mp-page-grid" id={`mp-pages-${plan.id}`} role="group" aria-label={`${plan.name} · ${l.pages}`}>{keys.map((k,i)=><label className={`mp-page-choice${selected.includes(k)?' selected':''}`} key={k}><input type="checkbox" checked={selected.includes(k)} disabled={busy||loadingInventory} onChange={e=>toggle([k],e.target.checked)}/><span>{l.page} <bdi>{i+1}</bdi></span></label>)}</div>}
            </section>;
          })}</div>
        </>}
        {stage==='calculations'&&<>
          <StageHeading headingRef={headingRef} title={l.calculationsTitle} description={l.calculationsIntro}/>
          <div className="mp-calculation-groups">{[{title:l.geometry,options:CALCULATIONS.filter(c=>c==='area'||c==='perimeter')},{title:l.finishes,options:CALCULATIONS.filter(c=>c!=='area'&&c!=='perimeter')}].map(({title,options})=><section key={String(title)}><h3>{title}</h3><div className="mp-option-list">{options.map(c=><label className={`mp-calculation-option${calculations.includes(c)?' selected':''}`} key={c}><input type="checkbox" checked={calculations.includes(c)} onChange={e=>setCalculations(old=>e.target.checked?[...old,c]:old.filter(k=>k!==c))}/><span><strong>{l[c]}</strong><span className="muted">{l[`${c}Description`]}</span></span></label>)}</div></section>)}</div>
          <div className="mp-notice"><Icon name="ruler" size={18}/><p>{l.calibrationNote}</p></div>
        </>}
        {stage==='scope'&&scope&&<>
          <StageHeading headingRef={headingRef} title={l.reviewTitle} description={l.reviewIntro}/>
          <div className="mp-scope-counts"><ScopeCount value={scope.pages.length} label={l.scopePages}/><ScopeCount value={scope.pages.filter(p=>pageStatus(p)==='completed').length} label={l.reusable}/><ScopeCount value={newCount} label={l.newRequests}/></div>
          <div className="mp-review-layout"><div>
            <div className="mp-section-title"><h3>{l.selectedPlans}</h3>{!resuming&&<button className="btn-ghost" onClick={()=>setStage('plans')}>{l.editPlans}</button>}</div>
            <ul className="mp-scope-documents">{groupPages(scope.pages).map(([id,group])=><li key={id}><Icon name="file" size={18}/><div><strong dir="auto">{group.name}</strong><span className="muted">{l.pages}: <bdi>{pageRanges(group.pages.map(p=>p.pageNumber))}</bdi></span>{group.pages.some(p=>pageStatus(p)==='processing')&&<span className="mp-accent-text">{l.inProgress}</span>}{group.pages.some(p=>pageStatus(p)==='failed')&&<span className="mp-danger-text">{group.pages.filter(p=>pageStatus(p)==='failed').length} {l.failed}</span>}</div><span className="mp-document-count">{group.pages.length} {l.pages}</span></li>)}</ul>
            <div className="mp-section-title"><h3>{l.measurements}</h3>{!resuming&&<button className="btn-ghost" onClick={()=>setStage('calculations')}>{l.editCalculations}</button>}</div><ul className="mp-measurements">{scope.calculations.map(c=><li key={c}><Icon name="check" size={16}/>{l[c]}</li>)}</ul>
          </div><aside className="mp-cost"><span className="mp-eyebrow">{l.estimate}</span><strong className="mp-cost-value"><bdi dir="ltr">${cost.low.toFixed(3)}–${cost.high.toFixed(3)}</bdi></strong><p className="muted">{l.notGuaranteed}</p><p>{l.confirmation}</p><details><summary>{l.costDetails}</summary><p className="muted">{l.historical}</p></details></aside></div>
          <div className="mp-notice"><Icon name="scan" size={18}/><p>{l.afterStart}</p></div>
        </>}
        {stage==='results'&&<>
          <StageHeading headingRef={headingRef} title={l.resultsTitle} description={l.resultsIntro}/>
          {projectBatches.length>0&&<div className="mp-batch-picker"><label htmlFor="mp-batch-picker">{l.batches}</label><select id="mp-batch-picker" value={batch?.id??''} onChange={e=>{setBatchId(e.target.value);setStopping(false);setPlans([]);setReviews({});}}><option value="" disabled>{l.openBatch}</option>{projectBatches.map(b=><option key={b.id} value={b.id}>{new Date(b.createdAt).toLocaleString(language==='he'?'he-IL':'en-GB')} · {b.pages.length} {l.pages} · {b.state==='running'?l.processing:b.state==='paused'?l.paused:l.finished}</option>)}</select></div>}
          {!projectBatches.length&&<div className="mp-empty"><Icon name="layers" size={28}/><h3>{l.noBatches}</h3><p>{l.noBatchesHint}</p><button className="btn-primary" disabled={busy||!batchReady||globalRunning} onClick={newBatch}>{l.newBatch}</button></div>}
          {batch&&quantities&&<>
            <div className="mp-progress-counts" role="status"><ScopeCount value={batch.pages.length} label={l.scopePages}/><ScopeCount value={batch.pages.filter(p=>pageStatus(p)==='completed').length} label={l.completed}/><ScopeCount value={batch.pages.filter(p=>pageStatus(p)==='queued').length} label={l.queued}/><ScopeCount value={reviewCount} label={l.awaitingReview}/><ScopeCount value={batch.pages.filter(p=>pageStatus(p)==='failed').length} label={l.failed}/></div>
            <div className={`mp-run-state ${currentPage?'processing':''}`}>
              <div>{currentPage?<><strong>{l.activePage}: <bdi>{currentPage.planName}</bdi> · {l.page} {currentPage.pageNumber}</strong><p>{stopping?l.stopping:l.stopNote}</p></>:<><strong>{batch.state==='paused'?l.paused:batch.state==='running'?l.processing:l.finished}</strong>{batch.state==='paused'&&<p>{l.pausedNote}</p>}</>}</div>
              {batch.state==='running'?<button className="btn-secondary" disabled={stopping} onClick={()=>{stopBatch(batch.id);setStopping(true);}}>{stopping?l.stopping:l.stop}</button>:batch.pages.some(p=>p.status==='queued'||p.status==='processing')&&<button className="btn-secondary" disabled={busy||globalRunning} onClick={()=>{setDraft(structuredClone(batch));setStage('scope');}}>{l.resume}</button>}
            </div>
            {loadingInventory&&<p className="mp-loading" role="status">{l.loading}</p>}
            <div className="mp-result-groups">{pageGroups.map(([id,group])=><section className="mp-result-document" key={id}><div className="mp-result-document-head"><Icon name="file" size={18}/><h3 dir="auto">{group.name}</h3><span className="muted">{group.pages.length} {l.pages}</span></div>
              {group.pages.map(p=>{
                const q=quantities.pages.find(q=>q.page.reviewKey===p.reviewKey)!;
                const review=reviews[p.reviewKey],status=pageStatus(p),pending=review?.candidates.filter(c=>!q.rooms.some(r=>r.id===c.id)).length??0;
                const changed=!loadingInventory&&sourceChanged(p);
                const needsConfiguration=q.rooms.length>0&&(!q.calibrated||q.missing.length>0);
                const primaryState=status==='processing'?l.processing:status==='failed'?l.failed:status==='queued'?l.queued:!review?l.completed:pending?(review.resolvedIds.length?l.partial:l.awaitingReview):review.resolvedIds.length||q.rooms.length?l.reviewed:l.completed;
                const readiness=changed?l.changed:status==='queued'||status==='processing'?l.detectionPending:status==='failed'?null:!resultsLoaded?l.loadingResults:!q.rooms.length?l.empty:!q.calibrated?l.calibration:q.missing.length?`${l.configuration}: ${q.missing.map(c=>l[c]).join(', ')}`:pending?l.awaitingReview:l.ready;
                const pageError=p.error||jobs.find(j=>j.requestId===p.requestId)?.error;
                return <article className={`mp-result-page ${status}`} key={p.reviewKey}><div className="mp-result-row"><strong className="mp-page-number">{l.page} <bdi>{p.pageNumber}</bdi></strong><div className="mp-page-state"><span className={`mp-status ${status==='failed'?'failed':status==='processing'?'processing':pending?'review':status==='completed'?'completed':'queued'}`}>{primaryState}</span>{status==='completed'&&review&&resultsLoaded&&<span className="muted">{q.rooms.length} {l.approved}</span>}</div><div className="mp-page-readiness">{readiness}</div><div className="bulk-result-actions"><button className="btn-secondary" disabled={busy||loadingInventory||changed||status!=='completed'} onClick={()=>void action(()=>visit(p.planId,p.pageNumber))}>{pending?l.review:needsConfiguration?l.configure:l.openPage}</button>{q.rooms.length>0&&canAuthorTakeoff()&&<button className="btn-secondary" disabled={busy||loadingInventory||changed} onClick={()=>void action(async()=>{await visit(p.planId,p.pageNumber);if(useAppStore.getState().project?.id===p.planId)useBulkTakeoffDialog.getState().openFor(p.planId,p.pageNumber);})}>{t('bulkTakeoff.open')}</button>}</div></div>
                  {pageError&&<p className="mp-page-error" dir="auto">{pageError}</p>}
                  {status==='completed'&&(q.rooms.length>0||!review)&&(!review?<p className="mp-page-meta muted">{l.reviewLoading}</p>:<details className="mp-page-details"><summary>{l.pageDetails} · {q.rooms.length} {l.approved}</summary><div className="mp-page-detail-content"><div className="mp-page-metrics">{batch.calculations.includes('area')&&q.area!==null&&<span>{l.area}: <bdi>{q.area.toFixed(2)} m²</bdi></span>}{batch.calculations.includes('perimeter')&&q.perimeter!==null&&<span>{l.perimeter}: <bdi>{q.perimeter.toFixed(2)} m</bdi></span>}</div><p className="muted">{l.roomHint}</p><div className="mp-room-actions">{q.rooms.map(r=><button className="btn-secondary" disabled={busy||changed} key={r.id} onClick={()=>void action(()=>visit(p.planId,p.pageNumber,r.id))}>{l.selectRoom}: <bdi>{r.name}</bdi></button>)}</div></div></details>)}
                </article>;
              })}
            </section>)}</div>
            <details className="mp-quantity-summary"><summary>{l.quantities}</summary>{!resultsLoaded?<p role="status">{l.loadingResults}</p>:<><p className="muted">{l.acceptedOnly}</p><dl>{quantityLines.map((line,i)=><div key={i}><dt>{line.label}</dt><dd><bdi>{line.value}</bdi></dd></div>)}</dl></>}</details>
            {batch.pages.some(p=>pageStatus(p)==='failed')&&<div className="mp-notice"><Icon name="alert" size={18}/><p>{l.failureNote}</p></div>}
          </>}
        </>}
      </div>
      <footer className="mp-footer">
        <div className="mp-footer-context">{stage==='plans'||stage==='calculations'?<><strong>{totalSelected} {l.selectedPages}</strong><span className="muted">{selectedDocuments} {l.documents}{stage==='calculations'?` · ${calculations.length} ${l.measurements}`:''}</span></>:stage==='scope'&&scope?<><strong>{scope.pages.length} {l.scopePages}</strong><span className="muted">{newCount} {l.newRequests}</span></>:<span className="muted">{l.projectReportHint}</span>}
          {busy&&<span role="status">{l.working}</span>}
        </div>
        <div className="mp-footer-actions">
          {stage==='plans'&&<><span className="mp-footer-hint muted">{!totalSelected?l.selectAtLeast:''}</span><button className="btn-primary" disabled={busy||loadingInventory||!totalSelected||!batchReady} onClick={()=>setStage('calculations')}>{l.next}</button></>}
          {stage==='calculations'&&<><span className="mp-footer-hint muted">{!calculations.length?l.chooseAtLeast:''}</span><button className="btn-secondary" disabled={busy} onClick={()=>setStage('plans')}>{l.back}</button><button className="btn-primary" disabled={busy||loadingInventory||!totalSelected||!calculations.length||!batchReady} onClick={prepareScope}>{l.steps[2]}</button></>}
          {stage==='scope'&&scope&&<><button className="btn-secondary" disabled={busy} onClick={()=>setStage(resuming?'results':'calculations')}>{l.back}</button><button className="btn-primary" disabled={busy||globalRunning||!batchReady} onClick={()=>{setBatchId(scope.id);setStage('results');setStopping(false);void runBatch(scope);}}>{newCount?(resuming?l.confirmResume:l.confirm):l.useResults}{newCount>0&&` (${newCount})`}</button></>}
          {stage==='results'&&<><button className="btn-ghost" disabled={busy} onClick={()=>void action(async()=>{if(await useAppStore.getState().closePlan())setOpen(false);})}>{l.projectReport}</button><button className="btn-secondary" onClick={()=>setOpen(false)}>{l.close}</button></>}
        </div>
      </footer>
    </section></div>}
  </>;
}

function MixedCheckbox({checked,mixed,disabled,label,onChange}:{checked:boolean;mixed:boolean;disabled:boolean;label:string;onChange:(value:boolean)=>void}){
  const ref=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(ref.current)ref.current.indeterminate=mixed;},[mixed]);
  return <input ref={ref} type="checkbox" checked={checked} aria-checked={mixed?'mixed':checked} disabled={disabled} aria-label={label} onChange={e=>onChange(e.target.checked)}/>;
}
function StageHeading({headingRef,title,description}:{headingRef:RefObject<HTMLHeadingElement|null>;title:string;description:string}){
  return <div className="mp-stage-heading"><h3 ref={headingRef} tabIndex={-1}>{title}</h3><p>{description}</p></div>;
}
function ScopeCount({value,label}:{value:number;label:string}){
  return <div className="mp-count"><strong className="tnum">{value}</strong><span>{label}</span></div>;
}
function pageRanges(numbers:number[]){
  const pages=[...new Set(numbers)].sort((a,b)=>a-b),ranges:string[]=[];
  for(let i=0;i<pages.length;i++){
    const start=pages[i];let end=start;
    while(pages[i+1]===end+1)end=pages[++i];
    ranges.push(start===end?String(start):`${start}–${end}`);
  }
  return ranges.join(', ');
}
