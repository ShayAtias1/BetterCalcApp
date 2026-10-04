import type { PlanRenderHandle } from '../planSource';
import type { PdfiumRasterRequest, PdfiumReply, PdfiumRequest, PdfiumResult } from './protocol';

export function viewerRenderCancelled(): Error {
  const error=new Error('PDF viewer render superseded');
  error.name='RenderingCancelledException';
  return error;
}
export function isViewerRenderCancelled(error:unknown): boolean {
  return error instanceof Error && error.name==='RenderingCancelledException';
}
type Pending={resolve:(value:PdfiumResult)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
export type PdfiumRaster=Extract<PdfiumResult,{kind:'render'}>;

/** One worker/WASM document per open main-viewer PDF. Cancel kills active WASM work,
 * not just its eventual result. Bytes are retained only while the viewer session is open.
 */
export class PdfiumDocument {
  private bytes: ArrayBuffer | null;
  private worker: Worker | null=null;
  private initialization: Promise<Worker> | null=null;
  private pending=new Map<number,Pending>();
  private nextId=0;
  private disposed=false;
  private numPages:number;
  constructor(bytes:ArrayBuffer,numPages:number){this.bytes=bytes;this.numPages=numPages;}

  private terminate(error:Error){
    this.worker?.terminate();this.worker=null;this.initialization=null;
    for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}
    this.pending.clear();
  }
  private request(worker:Worker,data:PdfiumRequest):Promise<PdfiumResult>{
    if(this.disposed || worker!==this.worker)return Promise.reject(viewerRenderCancelled());
    const id=++this.nextId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.terminate(new Error('PDFium worker request timed out')),60_000);
      this.pending.set(id,{resolve,reject,timer});
      try {
        worker.postMessage({...data,id},data.kind==='open'?[data.bytes]:[]);
      } catch(error){
        this.terminate(error instanceof Error?error:new Error(String(error)));
      }
    });
  }
  private ensureWorker():Promise<Worker>{
    if(this.disposed || !this.bytes)return Promise.reject(viewerRenderCancelled());
    if(this.initialization)return this.initialization;
    try {
      const worker=new Worker(new URL('./pdfium.worker.ts',import.meta.url),{type:'module'});
      this.worker=worker;
      worker.onmessage=({data}:MessageEvent<PdfiumReply>)=>{
        if(worker!==this.worker)return;
        const pending=this.pending.get(data.id);
        if(!pending)return;
        this.pending.delete(data.id);clearTimeout(pending.timer);
        if('error' in data)pending.reject(new Error(data.error));else pending.resolve(data.result);
      };
      worker.onerror=(event)=>{event.preventDefault();if(worker===this.worker)this.terminate(new Error('PDFium worker failed'));};
      worker.onmessageerror=()=>{if(worker===this.worker)this.terminate(new Error('PDFium worker message failed'));};
      const initialization=this.request(worker,{kind:'open',bytes:this.bytes.slice(0)}).then(result=>{
        if(this.disposed || this.worker!==worker)throw viewerRenderCancelled();
        if(result.kind!=='open' || result.numPages!==this.numPages)throw new Error('PDF engine page count mismatch');
        return worker;
      });
      this.initialization=initialization;
      return initialization;
    } catch(error){return Promise.reject(error);}
  }
  render(data:PdfiumRasterRequest): Omit<PlanRenderHandle,'promise'> & {promise:Promise<PdfiumRaster>}{
    let cancelled=false,finished=false,posted=false;
    const promise=(async()=>{
      const worker=await this.ensureWorker();
      if(cancelled || this.disposed)throw viewerRenderCancelled();
      posted=true;
      const result=await this.request(worker,data);
      if(cancelled || this.disposed)throw viewerRenderCancelled();
      if(result.kind!=='render')throw new Error('Unexpected PDFium raster response');
      return result;
    })().finally(()=>{finished=true;});
    return {promise,cancel:()=>{
      if(finished || cancelled)return;
      cancelled=true;
      // Pending initialization or posted synchronous renders cannot be interrupted by a message.
      if(posted || this.pending.size)this.terminate(viewerRenderCancelled());
    }};
  }
  releasePage(pageNumber:number){
    const worker=this.worker;
    if(!worker || !this.initialization || this.disposed)return;
    void this.initialization.then(()=>this.request(worker,{kind:'release',pageNumber})).catch(error=>{
      if(!isViewerRenderCancelled(error))console.warn('PDFium page release failed',error);
    });
  }
  dispose(){
    if(this.disposed)return;
    this.bytes=null;
    const worker=this.worker;
    // An idle worker can close page/document/file handles explicitly before exiting.
    // Termination reclaims the complete WASM heap when work is still in flight.
    if(worker && this.pending.size===0){
      const close=this.request(worker,{kind:'close'});
      this.disposed=true;
      const timeout=setTimeout(()=>this.terminate(viewerRenderCancelled()),1000);
      void close.catch(()=>undefined).finally(()=>{
        clearTimeout(timeout);if(this.worker===worker)this.terminate(viewerRenderCancelled());
      });
    }else{this.disposed=true;this.terminate(viewerRenderCancelled());}
  }
}
