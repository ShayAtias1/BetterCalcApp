import type { AiBatch, BatchPage } from './batchModel';

/** Sequential orchestration only. The page adapter owns existing job admission and polling. */
export async function scheduleBatchPages(
  batch:AiBatch,
  processPage:(page:BatchPage)=>Promise<void>,
  shouldStop:()=>boolean,
  persist:()=>Promise<void>,
){
  for(const page of batch.pages){
    if(page.status==='completed'||page.status==='failed')continue;
    if(shouldStop())break;
    await processPage(page);
    await persist();
    if(isFailed(page))break;
  }
  batch.state=batch.pages.every(p=>p.status==='completed'||p.status==='failed')?'completed':'paused';
  await persist();
}

function isFailed(page:BatchPage){return page.status==='failed';}
