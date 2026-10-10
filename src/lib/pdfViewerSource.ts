import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { pdfjsLib } from './pdfjsSetup';
import { PdfPlanSource, type PlanPageSource, type PlanRenderHandle } from './planSource';
import { boundedPdfScale } from './pdfRenderBudget';
import { PdfiumDocument, isViewerRenderCancelled, viewerRenderCancelled } from './pdfium/document';
import type { PdfMatrix, ViewerRegion } from './pdfium/protocol';
import { trackError } from './analytics';

export { isViewerRenderCancelled } from './pdfium/document';
export interface ViewerRenderOptions { transparent?:boolean; tint?:string }
export interface ViewerPageSource extends Pick<PlanPageSource,'getNativeSize'|'getTextItems'> {
  render(canvas:HTMLCanvasElement,scale:number,options?:ViewerRenderOptions):PlanRenderHandle;
  readonly pageNumber:number;
  readonly rotation:number;
  readonly numPages:number;
  renderRegion(canvas:HTMLCanvasElement,scale:number,region:ViewerRegion,options?:ViewerRenderOptions):PlanRenderHandle;
  prepareAiRaster():Promise<{png:Blob;width:number;height:number;scale:number;nativeWidth:number;nativeHeight:number;rotation:number;userUnit:number;view:number[]}>;
  release():void;
}
function canvasContext(canvas:HTMLCanvasElement,width:number,height:number){
  canvas.width=width;canvas.height=height;
  if(canvas.width!==width || canvas.height!==height)throw new Error('PDF viewer canvas allocation failed');
  const ctx=canvas.getContext('2d');
  if(!ctx || ctx.isContextLost?.())throw new Error('PDF viewer canvas context unavailable');
  return ctx;
}

/** Metadata/text remain on PDF.js. Main and Compare viewer pixels share PDFium. */
export class ViewerPdfDocument {
  readonly numPages:number;
  private primary:PdfiumDocument | null;
  private sources=new Set<ViewerPdfPage>();
  private disposed=false;
  private fallbackReason:string | null=null;
  private metadata:PDFDocumentProxy;
  private constructor(metadata:PDFDocumentProxy,bytes:ArrayBuffer){
    this.metadata=metadata;
    this.numPages=metadata.numPages;
    this.primary=new PdfiumDocument(bytes,this.numPages);
  }
  static async open(loadBlob:()=>Promise<Blob|undefined>,signal:AbortSignal):Promise<ViewerPdfDocument>{
    const blob=await loadBlob();
    if(signal.aborted)throw viewerRenderCancelled();
    if(!blob)throw new Error('PDF file not found in local storage');
    const bytes=await blob.arrayBuffer();
    if(signal.aborted)throw viewerRenderCancelled();
    const task=pdfjsLib.getDocument({data:bytes.slice(0)});
    const abort=()=>{void task.destroy().catch(()=>undefined);};
    signal.addEventListener('abort',abort,{once:true});
    try {
      const metadata=await task.promise;
      if(signal.aborted){await metadata.loadingTask.destroy();throw viewerRenderCancelled();}
      return new ViewerPdfDocument(metadata,bytes);
    }catch(error){
      await task.destroy().catch(()=>undefined);
      if(signal.aborted)throw viewerRenderCancelled();
      throw error;
    }finally{signal.removeEventListener('abort',abort);}
  }
  async getPage(pageNumber:number):Promise<ViewerPageSource>{
    if(this.disposed)throw viewerRenderCancelled();
    const page=await this.metadata.getPage(pageNumber);
    if(this.disposed)throw viewerRenderCancelled();
    const source=new ViewerPdfPage(this,page);
    this.sources.add(source);
    return source;
  }
  getPrimary(){return this.primary;}
  getFallbackReason(){return this.fallbackReason;}
  useFallback(error:unknown){
    if(!this.primary)return;
    this.fallbackReason=error instanceof Error?error.message:String(error);
    console.warn('PDF viewer switching to PDF.js fallback',error);
    trackError('pdf_load',error);
    this.primary.dispose();this.primary=null;
  }
  release(source:ViewerPdfPage){
    this.sources.delete(source);
    this.primary?.releasePage(source.pageNumber);
  }
  dispose(){
    if(this.disposed)return;
    this.disposed=true;
    for(const source of Array.from(this.sources))source.release();
    this.primary?.dispose();this.primary=null;
    void this.metadata.loadingTask.destroy().catch(error=>console.warn('PDF viewer metadata cleanup failed',error));
  }
}

class ViewerPdfPage implements ViewerPageSource {
  readonly pageNumber:number;
  readonly rotation:number;
  readonly numPages:number;
  private released=false;
  private active=new Set<{promise:Promise<unknown>;cancel:()=>void}>();
  private viewport: ReturnType<PDFPageProxy['getViewport']>;
  private textSource:PdfPlanSource;
  private document:ViewerPdfDocument;
  private page:PDFPageProxy;
  constructor(document:ViewerPdfDocument,page:PDFPageProxy){
    this.document=document;this.page=page;
    this.pageNumber=page.pageNumber;
    this.rotation=page.rotate;
    this.numPages=document.numPages;
    this.viewport=page.getViewport({scale:1});
    this.textSource=new PdfPlanSource(page);
  }
  getNativeSize(){return {width:this.viewport.width,height:this.viewport.height};}
  getTextItems(){
    if(this.released)return Promise.reject(viewerRenderCancelled());
    return this.textSource.getTextItems();
  }
  render(canvas:HTMLCanvasElement,scale:number,options:ViewerRenderOptions={}):PlanRenderHandle{
    return this.draw(canvas,scale,{x:0,y:0,...this.getNativeSize()},true,options);
  }
  renderRegion(canvas:HTMLCanvasElement,scale:number,region:ViewerRegion,options:ViewerRenderOptions={}):PlanRenderHandle{
    return this.draw(canvas,scale,region,false,options);
  }
  /** Independent full-resolution PDFium image, no viewer surface/budget/fallback. */
  async prepareAiRaster(){
    if(this.released)throw viewerRenderCancelled();
    const native=this.getNativeSize(), scale=5500/Math.max(native.width,native.height);
    if(![0,90,180,270].includes(this.rotation) || this.page.userUnit!==1 || this.page.view[0]!==0 || this.page.view[1]!==0)
      throw new Error('AI preparation currently requires a standard unit, zero-origin PDF page box.');
    const width=Math.min(5500,Math.ceil(native.width*scale)),height=Math.min(5500,Math.ceil(native.height*scale));
    const primary=this.document.getPrimary();
    if(!primary)throw new Error('AI detection requires PDFium rendering; PDF.js fallback is not supported.');
    const task=primary.render({kind:'render',purpose:'ai',pageNumber:this.pageNumber,rotation:this.rotation,
      nativeTransform:[...this.viewport.transform] as PdfMatrix,region:{x:0,y:0,...native},scale,width,height});
    this.active.add(task);
    const canvas=document.createElement('canvas');
    try{
      const raster=await task.promise;
      if(this.released)throw viewerRenderCancelled();
      const ctx=canvasContext(canvas,width,height);
      ctx.putImageData(new ImageData(new Uint8ClampedArray(raster.pixels),width,height),0,0);
      const png=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('AI PNG encoding failed.')),'image/png'));
      return {png,width,height,scale,nativeWidth:native.width,nativeHeight:native.height,rotation:this.rotation,userUnit:this.page.userUnit,view:[...this.page.view]};
    }finally{this.active.delete(task);canvas.width=canvas.height=0;}
  }
  private draw(canvas:HTMLCanvasElement,desired:number,region:ViewerRegion,wholePage:boolean,options:ViewerRenderOptions):PlanRenderHandle{
    let cancelled=false,finished=false;
    let primaryTask:ReturnType<PdfiumDocument['render']>|undefined;
    let fallbackTask:RenderTask|undefined;
    const check=()=>{if(cancelled || this.released)throw viewerRenderCancelled();};
    const promise=(async()=>{
      check();
      if(![region.x,region.y].every(Number.isFinite))throw new Error('Invalid viewer region');
      const scale=boundedPdfScale(region.width,region.height,desired);
      const width=Math.max(1,wholePage?Math.floor(region.width*scale):Math.ceil(region.width*scale));
      const height=Math.max(1,wholePage?Math.floor(region.height*scale):Math.ceil(region.height*scale));
      const primary=this.document.getPrimary();
      if(primary){
        try {
          primaryTask=primary.render({kind:'render',pageNumber:this.pageNumber,rotation:this.rotation,
            nativeTransform:[...this.viewport.transform] as PdfMatrix,region,scale,width,height,transparent:options.transparent});
          const raster=await primaryTask.promise;
          check();
          const ctx=canvasContext(canvas,width,height);
          ctx.putImageData(new ImageData(new Uint8ClampedArray(raster.pixels),width,height),0,0);
          if(ctx.isContextLost?.())throw new Error('PDFium canvas context lost');
          this.tint(ctx,width,height,options.tint);
          this.logRendered('pdfium',region,scale,width,height,options);
          return;
        }catch(error){
          check();
          if(isViewerRenderCancelled(error))throw error;
          this.document.useFallback(error);
        }
      }
      // Strict, staged fallback: legacy PlanSource render errors must not become false success.
      const staged=document.createElement('canvas');staged.dir='rtl';staged.lang='he';
      try {
        const ctx=canvasContext(staged,width,height);
        fallbackTask=this.page.render({canvas:staged,canvasContext:ctx,viewport:this.page.getViewport({scale}),
          transform:[1,0,0,1,-region.x*scale,-region.y*scale],
          background:options.transparent?'rgba(0,0,0,0)':'#ffffff'});
        await fallbackTask.promise;
        check();
        if(ctx.isContextLost?.())throw new Error('PDF.js fallback canvas context lost');
        this.tint(ctx,width,height,options.tint);
        canvasContext(canvas,width,height).drawImage(staged,0,0);
        this.logRendered('pdfjs',region,scale,width,height,options);
      }finally{staged.width=staged.height=0;}
    })().catch(error=>{
      if(!isViewerRenderCancelled(error))console.error('PDF viewer render failed',error);
      throw error;
    }).finally(()=>{finished=true;this.active.delete(handle);});
    const handle:PlanRenderHandle={promise,cancel:()=>{
      if(finished || cancelled)return;
      cancelled=true;primaryTask?.cancel();fallbackTask?.cancel();
    }};
    this.active.add(handle);
    return handle;
  }
  private tint(ctx:CanvasRenderingContext2D,width:number,height:number,color?:string){
    if(!color)return;
    ctx.save();
    ctx.globalCompositeOperation='source-in';
    ctx.fillStyle=color;ctx.fillRect(0,0,width,height);
    ctx.restore();
  }
  /** Log completed pixels, not the intended engine: fallback must be explicit in development. */
  private logRendered(renderer:'pdfium'|'pdfjs',region:ViewerRegion,scale:number,width:number,height:number,options:ViewerRenderOptions){
    if(!import.meta.env.DEV)return;
    const fallback=renderer==='pdfjs';
    const reason=fallback?` reason=${this.document.getFallbackReason() ?? 'unknown'}`:'';
    console.info(`[BetterCalc PDF] renderer=${renderer} page=${this.pageNumber} fallback=${fallback}${reason}`,{
      rotation:this.rotation,pageBox:this.page.view,userUnit:this.page.userUnit,
      native:this.getNativeSize(),region,scale,raster:{width,height},
      background:options.transparent?'transparent':'#ffffff',alpha:true,tint:options.tint,
    });
  }
  release(){
    if(this.released)return;
    this.released=true;
    for(const task of this.active)task.cancel();
    const tasks=Array.from(this.active,task=>task.promise);
    this.document.release(this);
    void Promise.allSettled(tasks).then(()=>{this.page.cleanup();})
      .catch(error=>console.warn('PDF viewer page cleanup failed',error));
  }
}
