import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { useLanguage } from '../i18n';
import { loadAiReview, loadPlan } from '../db/database';
import { useAiWorkflow } from '../lib/ai/workflow';
import { initializeBatches, inspectBatchPlans, prepareBatch, runBatch, stopBatch, useAiBatches } from '../lib/ai/batchWorkflow';
import { batchCost, batchQuantities, CALCULATIONS, type AiBatch, type Calculation } from '../lib/ai/batchModel';
import type { AiReviewRecord } from '../lib/ai/contracts';
import type { Plan } from '../types';
import { subscribePdfBlobChanges } from '../lib/pdfBlobEvents';
import './MultiPlanAi.css';

const labels = {
  en: {title:'Multi-plan AI',new:'New batch',close:'Close',select:'1. Select imported Plans/pages',calculations:'2. Choose calculations',scope:'3. Review scope and cost',selected:'selected pages',all:'All pages',page:'Page',reviewScope:'Review selection',confirm:'Confirm paid requests and start',resume:'Review scope to resume',stop:'Stop scheduling queued pages',stopping:'Stopping after the current request',stopNote:'A running paid request continues. Stopping prevents additional queued requests.',open:'Open page for review / configuration',back:'Back to selection',overview:'Batch overview',loading:'Loading local PDFs…',area:'Floor area',perimeter:'Room perimeter',flooring:'Flooring',cladding:'Wall cladding',skirting:'Skirting',instructions:'AI drafts geometry. Review and approve Spaces on each page. Calibrate the page, then configure work items on accepted Rooms using the existing room controls. Wall cladding requires an explicit item height; verify waste and opening deductions. No finish items are assigned automatically.',newRequests:'pages requiring new paid inference',cached:'pages with usable existing AI results',estimate:'Indicative USD cost range (not guaranteed)',historical:'Based on local recorded costs; without local observations, uses the checkpoint’s observed $0.076/page average. Actual cost and admission reservations can be higher.',running:'Processing',queued:'Queued',failed:'Failed',completed:'Completed',paused:'Paused — explicit resume required',awaitingReview:'Awaiting review',partial:'Partially reviewed',reviewed:'Reviewed',approved:'approved Rooms',calibration:'Awaiting calibration',configuration:'Awaiting quantity configuration',ready:'Ready for selected quantities',empty:'No accepted Rooms',quantities:'Selected-page quantities',projectReport:'Open existing project summaries (all Plans)',rooms:'Select Room, then open its details',pending:'Pending',none:'No saved batches in this project.',changed:'Source PDF changed or Plan removed',detect:'Detect Spaces on selected pages',progress:'Page status',retry:'Failed pages are not retried. Inspect the error; create a new explicitly confirmed batch only if a new request is intended.'},
  he: {title:'AI למספר תוכניות',new:'אצווה חדשה',close:'סגירה',select:'1. בחירת תוכניות ועמודי PDF',calculations:'2. בחירת חישובים',scope:'3. בדיקת היקף ועלות',selected:'עמודים שנבחרו',all:'כל העמודים',page:'עמוד',reviewScope:'בדיקת הבחירה',confirm:'אישור בקשות בתשלום והתחלה',resume:'בדיקת היקף להמשך',stop:'עצירת תזמון עמודים ממתינים',stopping:'עצירה לאחר הבקשה הנוכחית',stopNote:'בקשה בתשלום שכבר פועלת תמשיך. העצירה מונעת בקשות נוספות בתור.',open:'פתיחת עמוד לבדיקה ולהגדרה',back:'חזרה לבחירה',overview:'סקירת האצווה',loading:'טעינת מסמכי PDF מקומיים…',area:'שטח רצפה',perimeter:'היקף חדר',flooring:'כמות ריצוף',cladding:'כמות חיפוי קירות',skirting:'כמות פנלים',instructions:'AI מציע גאומטריה. יש לבדוק ולאשר חללים בכל עמוד, לכייל את העמוד ולהגדיר עבודות בחדרים שאושרו דרך בקרות החדר הקיימות. חיפוי מחייב גובה מפורש בפריט העבודה; יש לבדוק פחת וניכוי פתחים. עבודות גמר אינן משויכות אוטומטית.',newRequests:'עמודים המחייבים בקשת AI חדשה בתשלום',cached:'עמודים עם תוצאות AI קיימות ושמישות',estimate:'טווח עלות משוער בדולר (ללא התחייבות)',historical:'מבוסס על עלויות שנשמרו מקומית; בהיעדר נתונים, על ממוצע מתועד של $0.076 לעמוד בנקודת הבסיס. העלות בפועל ושריון התקציב עשויים להיות גבוהים יותר.',running:'בעיבוד',queued:'בתור',failed:'נכשל',completed:'הושלם',paused:'מושהה — נדרש המשך מפורש',awaitingReview:'ממתין לבדיקה',partial:'נבדק חלקית',reviewed:'נבדק',approved:'חדרים מאושרים',calibration:'ממתין לכיול',configuration:'ממתין להגדרת כמויות',ready:'מוכן לכמויות שנבחרו',empty:'אין חדרים מאושרים',quantities:'כמויות בעמודים שנבחרו',projectReport:'פתיחת סיכומי הפרויקט (כל התוכניות)',rooms:'בחירת חדר, ואז פתיחת הפרטים',pending:'ממתין',none:'אין אצוות שמורות בפרויקט זה.',changed:'קובץ המקור השתנה או שהתוכנית הוסרה',detect:'זיהוי חללים בעמודים שנבחרו',progress:'מצב עמודים',retry:'עמודים שנכשלו לא נשלחים שוב. יש לבדוק את השגיאה; צרו אצווה חדשה ואשרו במפורש רק אם רצויה בקשה חדשה.'}
};
type Inventory = Awaited<ReturnType<typeof inspectBatchPlans>>;
export default function MultiPlanAi(){
  const language=useLanguage(),l=labels[language];
  const folder=useAppStore(s=>s.currentProject),projectPlans=useAppStore(s=>s.projectPlans),activePlan=useAppStore(s=>s.project);
  const batches=useAiBatches(s=>s.batches),batchError=useAiBatches(s=>s.error),batchReady=useAiBatches(s=>s.ready);
  const jobs=useAiWorkflow(s=>s.jobs);
  const [open,setOpen]=useState(false),[stage,setStage]=useState<'select'|'scope'|'batch'>('batch');
  const [inventory,setInventory]=useState<Inventory>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [selected,setSelected]=useState<string[]>([]),[calculations,setCalculations]=useState<Calculation[]>(['area','perimeter']);
  const [draft,setDraft]=useState<AiBatch|null>(null),[batchId,setBatchId]=useState<string|null>(null);
  const [plans,setPlans]=useState<Plan[]>([]),[reviews,setReviews]=useState<Record<string,AiReviewRecord|undefined>>({});
  const [stopping,setStopping]=useState(false),[sourceRevision,setSourceRevision]=useState(0);
  useEffect(()=>subscribePdfBlobChanges(()=>setSourceRevision(v=>v+1)),[]);
  const batch=batches.find(b=>b.id===batchId&&b.projectId===folder?.id);
  useEffect(()=>{void initializeBatches().catch(e=>setError(String(e)));},[]);
  useEffect(()=>{setOpen(false);setDraft(null);setBatchId(null);setInventory([]);setSelected([]);},[folder?.id]);
  useEffect(()=>{
    if(!open||!folder)return;
    let alive=true;setBusy(true);
    void inspectBatchPlans(projectPlans.map(p=>p.id===activePlan?.id?activePlan:p)).then(v=>{if(alive)setInventory(v);}).catch(e=>{if(alive)setError(String(e));}).finally(()=>{if(alive)setBusy(false);});
    return()=>{alive=false;};
  },[open,folder?.id,projectPlans,sourceRevision]);
  useEffect(()=>{
    if(!open||!batch)return;
    let alive=true;
    const refresh=async()=>{
      try{
        const loaded=await Promise.all([...new Set(batch.pages.map(p=>p.planId))].map(loadPlan));
        const records=await Promise.all(batch.pages.map(async p=>[p.reviewKey,await loadAiReview(p.reviewKey)] as const));
        if(alive){setPlans(loaded.filter((p):p is Plan=>!!p));setReviews(Object.fromEntries(records));}
      }catch(e){if(alive)setError(String(e));}
    };
    void refresh();const timer=setInterval(()=>void refresh(),2500);
    return()=>{alive=false;clearInterval(timer);};
  },[open,batch,jobs]);
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
  return <>
    <button className="btn-secondary multi-plan-launch" onClick={()=>{setOpen(true);setStopping(false);}}>{l.title}{batch?.state==='running'?` · ${l.running}`:''}</button>
    {open&&<div className="multi-plan-backdrop"><section className="multi-plan-dialog" role="dialog" aria-modal="true" aria-label={l.title} dir={language==='he'?'rtl':'ltr'}>
      <header><strong>{l.title} · {folder.name}</strong><button className="btn-secondary" onClick={()=>setOpen(false)}>{l.close}</button></header>
      <nav><button className="btn-secondary" disabled={busy||!batchReady||batches.some(b=>b.state==='running')} onClick={()=>{setSelected([]);setDraft(null);setStage('select');}}>{l.new}</button><button className="btn-ghost" onClick={()=>setStage('batch')}>{l.overview}</button></nav>
      {(error||batchError)&&<p role="alert" className="multi-plan-error" dir="auto">{error||batchError}</p>}
      {busy&&<p role="status">{l.loading}</p>}
      {stage==='select'&&<>
        <h3>{l.select}</h3>
        {inventory.map(({plan,count})=><fieldset key={plan.id}><legend dir="auto">{plan.name} · {plan.pdfFileName}</legend>
          <label><input type="checkbox" checked={Array.from({length:count},(_,i)=>key(plan.id,i+1)).every(k=>selected.includes(k))} onChange={e=>toggle(Array.from({length:count},(_,i)=>key(plan.id,i+1)),e.target.checked)}/>{l.all} ({count})</label>
          <div className="multi-plan-pages">{Array.from({length:count},(_,i)=><label key={i}><input type="checkbox" checked={selected.includes(key(plan.id,i+1))} onChange={e=>toggle([key(plan.id,i+1)],e.target.checked)}/>{l.page} {i+1}</label>)}</div>
        </fieldset>)}
        <p>{selected.length} {l.selected}</p><h3>{l.calculations}</h3><p>{l.detect}</p>
        <div className="multi-plan-pages">{CALCULATIONS.map(c=><label key={c}><input type="checkbox" checked={calculations.includes(c)} onChange={e=>setCalculations(old=>e.target.checked?[...old,c]:old.filter(k=>k!==c))}/>{l[c]}</label>)}</div>
        <p className="muted">{l.instructions}</p>
        <button className="btn-primary" disabled={busy||!selected.length||!calculations.length} onClick={()=>void action(async()=>{
          const selection=inventory.flatMap(i=>Array.from({length:i.count},(_,n)=>({plan:i.plan,pageNumber:n+1,sourceHash:i.sourceHash})).filter(p=>selected.includes(key(p.plan.id,p.pageNumber))));
          setDraft(await prepareBatch(folder.id,selection,calculations));setStage('scope');
        })}>{l.reviewScope}</button>
      </>}
      {stage==='scope'&&scope&&<>
        <h3>{l.scope}</h3><p>{scope.pages.length} {l.selected} · {newCount} {l.newRequests} · {scope.pages.filter(p=>pageStatus(p)==='completed').length} {l.cached}</p>
        <ul>{scope.pages.map(p=><li key={p.reviewKey}><bdi>{p.planName}</bdi> · {l.page} {p.pageNumber} · {pageStatus(p)==='completed'?l.cached:pageStatus(p)==='failed'?l.failed:p.requestId?l.running:l.queued}</li>)}</ul>
        <p>{scope.calculations.map(c=>l[c]).join(' · ')}</p><p>{l.estimate}: <bdi>${cost.low.toFixed(3)}–${cost.high.toFixed(3)}</bdi></p><p className="muted">{l.historical}</p><p>{l.instructions}</p>
        <button className="btn-secondary" onClick={()=>setStage(batchId===scope.id?'batch':'select')}>{l.back}</button>{' '}
        <button className="btn-primary" disabled={busy||batches.some(b=>b.state==='running')} onClick={()=>{setBatchId(scope.id);setStage('batch');setStopping(false);void runBatch(scope);}}>{l.confirm} ({newCount})</button>
      </>}
      {stage==='batch'&&<>
        <nav>{projectBatches.map(b=><button key={b.id} className="btn-secondary" aria-pressed={batchId===b.id} onClick={()=>{setBatchId(b.id);setStopping(false);}}>{new Date(b.createdAt).toLocaleString(language==='he'?'he-IL':'en-GB')} · {b.pages.length} {l.selected}</button>)}</nav>
        {!projectBatches.length&&<p>{l.none}</p>}
        {batch&&quantities&&<>
          <h3>{batch.pages.length} {l.selected}</h3>
          <p role="status">{l.completed}: {batch.pages.filter(p=>pageStatus(p)==='completed').length} · {l.running}: {batch.pages.filter(p=>pageStatus(p)==='processing').length} · {l.queued}: {batch.pages.filter(p=>pageStatus(p)==='queued').length} · {l.failed}: {batch.pages.filter(p=>pageStatus(p)==='failed').length}</p>
          <p>{l.awaitingReview}: {batch.pages.filter(p=>pageStatus(p)==='completed'&&(reviews[p.reviewKey]?.candidates.length??0)>0).length} · {l.reviewed}: {batch.pages.filter(p=>pageStatus(p)==='completed'&&reviews[p.reviewKey]&&!reviews[p.reviewKey]?.candidates.length).length}</p>
          <p>{batch.state==='paused'?l.paused:batch.state==='running'?l.running:l.completed}</p>
          {batch.state==='running'?<button className="btn-secondary" disabled={stopping} onClick={()=>{stopBatch(batch.id);setStopping(true);}}>{stopping?l.stopping:l.stop}</button>:batch.pages.some(p=>p.status==='queued'||p.status==='processing')&&<button className="btn-primary" onClick={()=>{setDraft(structuredClone(batch));setStage('scope');}}>{l.resume}</button>}
          <p className="muted">{l.stopNote}</p><p>{l.instructions}</p>
          <div className="multi-plan-table"><table><thead><tr><th>{l.page}</th><th>{l.progress}</th><th>{l.quantities}</th><th>{l.open}</th></tr></thead><tbody>{quantities.pages.map(q=>{
            const p=q.page, review=reviews[p.reviewKey],status=pageStatus(p),pending=review?.candidates.filter(c=>!q.rooms.some(r=>r.id===c.id)).length??0;
            const changed=!inventory.some(i=>i.plan.id===p.planId&&i.sourceHash===p.sourceHash);
            return <tr key={p.reviewKey}><td><bdi>{p.planName}</bdi> · {p.pageNumber}</td><td>{status==='completed'?l.completed:status==='processing'?l.running:status==='failed'?l.failed:l.queued}<br/>{status==='completed'&&(pending?(review?.resolvedIds.length?l.partial:l.awaitingReview):l.reviewed)}<br/>{q.rooms.length} {l.approved}{(p.error||jobs.find(j=>j.requestId===p.requestId)?.error)&&<p className="multi-plan-error" dir="auto">{p.error||jobs.find(j=>j.requestId===p.requestId)?.error}</p>}</td>
              <td>{changed?l.changed:!q.rooms.length?l.empty:!q.calibrated?l.calibration:q.missing.length?`${l.configuration}: ${q.missing.map(c=>l[c]).join(', ')}`:pending?l.awaitingReview:l.ready}
                {batch.calculations.includes('area')&&q.area!==null&&<p>{l.area}: {q.area.toFixed(2)} m²</p>}
                {batch.calculations.includes('perimeter')&&q.perimeter!==null&&<p>{l.perimeter}: {q.perimeter.toFixed(2)} m</p>}
              </td><td><button className="btn-secondary small" disabled={changed} onClick={()=>void action(()=>visit(p.planId,p.pageNumber))}>{l.open}</button>
                {q.rooms.map(r=><button className="btn-ghost small" key={r.id} onClick={()=>void action(()=>visit(p.planId,p.pageNumber,r.id))}>{l.rooms}: <bdi>{r.name}</bdi></button>)}</td></tr>;
          })}</tbody></table></div>
          <h3>{l.quantities}</h3>
          {(['area','perimeter'] as const).filter(c=>batch.calculations.includes(c)).map(c=><p key={c}>{l[c]}: {quantities.pages.some(q=>q.rooms.length&&!q.calibrated)||batch.pages.some(p=>!inventory.some(i=>i.plan.id===p.planId&&i.sourceHash===p.sourceHash))?l.pending:quantities.pages.every(q=>!q.rooms.length)?l.empty:`${quantities.pages.reduce((n,q)=>n+(q[c]??0),0).toFixed(2)} ${c==='area'?'m²':'m'}`}</p>)}
          {batch.calculations.filter(c=>c==='flooring'||c==='cladding'||c==='skirting').filter(c=>!quantities.report.totals.some(t=>c==='flooring'?t.category==='tiling_regular'||t.category==='tiling_as':t.category===(c==='skirting'?'panels':'cladding'))).map(c=><p key={c}>{l[c]}: {l.configuration}</p>)}
          {quantities.report.totals.map(total=>{
            const c:Calculation=total.category==='cladding'?'cladding':total.category==='panels'?'skirting':'flooring';
            const pending=quantities.pages.some(p=>!p.calibrated&&p.rooms.length||p.missing.includes(c))||batch.pages.some(p=>!inventory.some(i=>i.plan.id===p.planId&&i.sourceHash===p.sourceHash));
            return <p key={total.category}>{l[c]} ({total.label}): {pending?l.pending:`${(total.lengthM??total.quantityM2).toFixed(2)} ${total.lengthM===null?'m²':'m'} · ${(total.orderLengthM??total.orderM2).toFixed(2)} ${language==='he'?'להזמנה':'to order'}`}</p>;
          })}
          <p className="muted">{l.retry}</p><button className="btn-secondary" onClick={()=>void action(async()=>{if(await useAppStore.getState().closePlan()){setOpen(false);}})}>{l.projectReport}</button>
        </>}
      </>}
    </section></div>}
  </>;
}
