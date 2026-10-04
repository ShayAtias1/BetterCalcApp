/** Local invalidation for viewer document lifetimes; no persisted schema changes. */
const listeners=new Set<(documentId:string)=>void>();
export function notifyPdfBlobChanged(documentId:string){
  for(const listener of listeners){
    try{listener(documentId);}catch(error){console.warn('PDF viewer invalidation failed',error);}
  }
}
export function subscribePdfBlobChanges(listener:(documentId:string)=>void){
  listeners.add(listener);
  return ()=>{listeners.delete(listener);};
}
