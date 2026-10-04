/** Local invalidation for main-viewer document lifetimes; no persisted schema changes. */
const listeners=new Set<(planId:string)=>void>();
export function notifyPdfBlobChanged(planId:string){
  for(const listener of listeners){
    try{listener(planId);}catch(error){console.warn('PDF viewer invalidation failed',error);}
  }
}
export function subscribePdfBlobChanges(listener:(planId:string)=>void){
  listeners.add(listener);
  return ()=>{listeners.delete(listener);};
}
