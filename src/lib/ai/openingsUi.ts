import { create } from 'zustand';
import { useAppStore } from '../../store/appStore';
import { collectOpeningsAiReview, listOpeningsAiJobs, loadPdfBlob } from '../../db/database';
import { pdfFingerprint } from './preparePage';
import { openingsAiService } from './openingsService';
import { subscribeOpeningsChanged } from './openingsEvents';
import { subscribePdfBlobChanges } from '../pdfBlobEvents';
import type { OpeningsJob } from './openingsContracts';
export const useOpeningsAiUi=create<{jobs:OpeningsJob[];sourceHash:string|null;planId:string|null;pageNumber:number|null;busy:boolean;error:string|null}>(()=>({jobs:[],sourceHash:null,planId:null,pageNumber:null,busy:false,error:null}));
let initialized=false,refreshing=false,refreshAgain=false,starting=false,epoch=0;
export async function activateOpeningsAiPage(planId:string,pageNumber:number){
  const token=++epoch;
  useOpeningsAiUi.setState({sourceHash:null,planId,pageNumber});
  try{
    const blob=await loadPdfBlob(planId);if(!blob)return;
    const hash=await pdfFingerprint(blob),jobs=await listOpeningsAiJobs();
    if(token!==epoch||useAppStore.getState().project?.id!==planId||useAppStore.getState().currentPage!==pageNumber)return;
    useOpeningsAiUi.setState({sourceHash:hash,jobs});
    // A replacement PDF cannot inherit an AI drawing approval or quantity consent.
    for(const opening of useAppStore.getState().project?.openings??[]){
      if(opening.aiDetection&&opening.aiDetection.sourceHash!==hash){
        if(opening.approval.status==='approved')useAppStore.getState().draftPlanOpening(opening.id);
        if(opening.quantityReview?.associationsConfirmed)useAppStore.getState().updatePlanOpening(opening.id,{quantityReview:{associationsConfirmed:false,distinctLegacyRoomIds:[]}});
      }
    }
    for(const job of jobs.filter(j=>j.planId===planId&&j.pageNumber===pageNumber&&j.sourceHash===hash&&j.status==='COMPLETED'&&j.reviewKey)){
      const plan=useAppStore.getState().project;
      if(!plan||plan.id!==planId||token!==epoch)return;
      const review=await collectOpeningsAiReview(plan,job.reviewKey!,()=>useAppStore.getState().project);
      if(review&&useAppStore.getState().project?.id===planId){
        useAppStore.getState().importAiOpeningReview(review);
        useAppStore.getState().setOverlayVisible('finishes',true);
      }
    }
  }catch(e){useOpeningsAiUi.setState({error:e instanceof Error?e.message:'Openings recovery failed.'});}
}
async function refresh(){
  if(refreshing){refreshAgain=true;return;}
  refreshing=true;
  try{do{
    refreshAgain=false;useOpeningsAiUi.setState({jobs:await listOpeningsAiJobs()});
    const state=useAppStore.getState();if(state.project)await activateOpeningsAiPage(state.project.id,state.currentPage);
  }while(refreshAgain);}catch(e){useOpeningsAiUi.setState({error:String(e)});}finally{refreshing=false;}
}
export async function initializeOpeningsAiUi(){
  if(initialized)return;
  initialized=true;
  subscribeOpeningsChanged(()=>{void refresh();});
  subscribePdfBlobChanges(id=>{const s=useAppStore.getState();if(id===`plan:${s.project?.id}`&&s.project)void activateOpeningsAiPage(s.project.id,s.currentPage);});
  await openingsAiService.resume();await refresh();
}
/** Confirmation callback is the existing app modal; it is called only after cost preparation. */
export async function requestOpeningDetection(confirm:(job:OpeningsJob)=>Promise<boolean>){
  if(starting)return;
  const state=useAppStore.getState(),ui=useOpeningsAiUi.getState();
  if(!state.project||!ui.sourceHash||ui.planId!==state.project.id||ui.pageNumber!==state.currentPage)return;
  if(ui.jobs.some(j=>['PREPARING','AWAITING_CONSENT','PROCESSING'].includes(j.status))||ui.jobs.some(j=>j.planId===state.project!.id&&j.pageNumber===state.currentPage&&j.sourceHash===ui.sourceHash&&j.status==='COMPLETED'))return;
  const planId=state.project.id,page=state.currentPage;
  starting=true;useOpeningsAiUi.setState({busy:true,error:null});
  try{
    const job=await openingsAiService.prepare(planId,page);
    const accepted=await confirm(job),latest=useAppStore.getState();
    if(!accepted||latest.project?.id!==planId||latest.currentPage!==page){
      await openingsAiService.discard(job.requestId);
      return;
    }
    await openingsAiService.submit(job.requestId,{approved:true,approvedAt:Date.now(),previewId:job.preview!.previewId,requestDigest:job.preview!.requestDigest});
  }catch(e){useOpeningsAiUi.setState({error:e instanceof Error?e.message:String(e)});}
  finally{starting=false;useOpeningsAiUi.setState({busy:false});await refresh();}
}
