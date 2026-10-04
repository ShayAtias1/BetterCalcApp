import { init } from '@embedpdf/pdfium';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import { PDF_RENDER_BUDGET } from '../pdfRenderBudget';
import { apply, compose, inverse, pdfiumDisplayMatrix } from './coordinates';
import type { PdfiumMessage, PdfiumRasterRequest, PdfiumResult, PdfMatrix, PdfiumReply } from './protocol';

const scope=self as unknown as {
  onmessage:((event:MessageEvent<PdfiumMessage>)=>void)|null;
  postMessage(message:PdfiumReply,transfer:Transferable[]):void;
};
let engine: Awaited<ReturnType<typeof init>> | undefined;
let file=0, document=0, page=0, currentPage=0;
let displayMatrix: PdfMatrix | undefined;
// The pinned Emscripten module exposes HEAPU8, omitted from the wrapper's public types.
// Read it afresh after allocations: memory growth replaces this view.
function heapBytes(): Uint8Array {
  if (!engine) throw new Error('PDFium not initialized');
  return (engine.pdfium as typeof engine.pdfium & { HEAPU8: Uint8Array }).HEAPU8;
}
function closePage() {
  if (page && engine) engine.FPDF_ClosePage(page);
  page=0; currentPage=0; displayMatrix=undefined;
}
function closeDocument() {
  closePage();
  if (document && engine) engine.FPDF_CloseDocument(document);
  if (file && engine) engine.pdfium.wasmExports.free(file);
  document=0; file=0;
}
function selectPage(pageNumber: number, rotation: number) {
  if (!engine || !document) throw new Error('PDFium document unavailable');
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > engine.FPDF_GetPageCount(document)) {
    throw new Error('PDFium page index out of range');
  }
  if (page && currentPage === pageNumber) return;
  closePage();
  page=engine.FPDF_LoadPage(document,pageNumber-1);
  if (!page) throw new Error(`PDFium page load failed (${engine.FPDF_GetLastError()})`);
  currentPage=pageNumber;
  if (engine.FPDFPage_GetRotation(page)*90 !== rotation) throw new Error('PDF engine rotation mismatch');
  const ptr=engine.pdfium.wasmExports.malloc(16);
  if (!ptr) throw new Error('PDFium page-box allocation failed');
  try {
    if (!engine.FPDF_GetPageBoundingBox(page,ptr)) throw new Error('PDFium page box unavailable');
    const read=(offset:number)=>engine!.pdfium.getValue(ptr+offset,'float') as number;
    const box: [number,number,number,number]=[read(0),read(12),read(8),read(4)];
    if (!box.every(Number.isFinite) || box[2]<=box[0] || box[3]<=box[1]) throw new Error('Invalid PDFium page box');
    displayMatrix=pdfiumDisplayMatrix(box,rotation);
    // Check the actual pinned binary's mapping before allowing a visual-layer swap.
    const width=engine.FPDF_GetPageWidthF(page),height=engine.FPDF_GetPageHeightF(page);
    const sizeX=4096,sizeY=Math.max(1,Math.round(4096*height/width));
    if (![width,height,sizeY].every(v=>Number.isFinite(v)&&v>0) || sizeY>1_000_000) throw new Error('Invalid PDFium native size');
    for (const [x,y] of [[box[0],box[1]],[box[2],box[3]],[(box[0]+box[2])/2,(box[1]+box[3])/2]]) {
      if (!engine.FPDF_PageToDevice(page,0,0,sizeX,sizeY,0,x,y,ptr,ptr+4)) throw new Error('PDFium coordinate check failed');
      const expected=apply(displayMatrix,x,y);
      const actual=[engine.pdfium.getValue(ptr,'i32'),engine.pdfium.getValue(ptr+4,'i32')];
      if (Math.abs(actual[0]-expected[0]*sizeX/width)>0.51 || Math.abs(actual[1]-expected[1]*sizeY/height)>0.51) {
        throw new Error('PDFium coordinate mapping differs from canonical adapter');
      }
    }
  } finally { engine.pdfium.wasmExports.free(ptr); }
}
function render(data: PdfiumRasterRequest): Extract<PdfiumResult,{kind:'render'}> {
  if (!engine) throw new Error('PDFium not initialized');
  const {width,height,scale,region}=data;
  if (![width,height].every(Number.isInteger) || width<1 || height<1 ||
    width>PDF_RENDER_BUDGET.maxDimension || height>PDF_RENDER_BUDGET.maxDimension ||
    width*height>PDF_RENDER_BUDGET.maxPixels || !Number.isFinite(scale) || scale<=0 ||
    !data.nativeTransform.every(Number.isFinite) || ![region.x,region.y].every(Number.isFinite)) {
    throw new Error('PDFium raster exceeds viewer budget or has invalid coordinates');
  }
  selectPage(data.pageNumber,data.rotation);
  if (!displayMatrix) throw new Error('PDFium display mapping unavailable');
  const crop: PdfMatrix=[scale,0,0,scale,-region.x*scale,-region.y*scale];
  const transform=compose(crop,compose(data.nativeTransform,inverse(displayMatrix)));
  const bitmap=engine.FPDFBitmap_Create(width,height,1);
  if (!bitmap) throw new Error('PDFium bitmap allocation failed');
  let matrix=0,clip=0;
  try {
    matrix=engine.pdfium.wasmExports.malloc(24); clip=engine.pdfium.wasmExports.malloc(16);
    if (!matrix || !clip) throw new Error('PDFium render allocation failed');
    transform.forEach((value,i)=>engine!.pdfium.setValue(matrix+i*4,value,'float'));
    [0,0,width,height].forEach((value,i)=>engine!.pdfium.setValue(clip+i*4,value,'float'));
    engine.FPDFBitmap_FillRect(bitmap,0,0,width,height,0xffffffff);
    engine.FPDF_RenderPageBitmapWithMatrix(bitmap,page,matrix,clip,17);
    const ptr=engine.FPDFBitmap_GetBuffer(bitmap),stride=engine.FPDFBitmap_GetStride(bitmap);
    if (!ptr || stride<width*4) throw new Error('PDFium render buffer unavailable');
    const pixels=new Uint8ClampedArray(width*height*4);
    for(let row=0;row<height;row++)pixels.set(heapBytes().subarray(ptr+row*stride,ptr+row*stride+width*4),row*width*4);
    return {kind:'render',width,height,pixels:pixels.buffer};
  } finally {
    engine.FPDFBitmap_Destroy(bitmap);
    if (matrix) engine.pdfium.wasmExports.free(matrix);
    if (clip) engine.pdfium.wasmExports.free(clip);
  }
}
scope.onmessage=async({data}:MessageEvent<PdfiumMessage>)=>{
  try {
    let result: PdfiumResult;
    switch(data.kind){
      case 'open': {
        closeDocument();
        if (!engine) {
          const response=await fetch(wasmUrl);
          if (!response.ok) throw new Error(`PDFium WASM fetch failed (${response.status})`);
          engine=await init({wasmBinary:await response.arrayBuffer()});
          engine.PDFiumExt_Init();
        }
        const bytes=new Uint8Array(data.bytes);
        file=engine.pdfium.wasmExports.malloc(bytes.length);
        if (!file) throw new Error('PDFium document allocation failed');
        heapBytes().set(bytes,file);
        document=engine.FPDF_LoadMemDocument(file,bytes.length,'');
        if (!document) throw new Error(`PDFium document load failed (${engine.FPDF_GetLastError()})`);
        result={kind:'open',numPages:engine.FPDF_GetPageCount(document)};
        break;
      }
      case 'render': result=render(data); break;
      case 'release': if(currentPage===data.pageNumber)closePage(); result={kind:'release'}; break;
      case 'close': closeDocument(); result={kind:'close'}; break;
    }
    const transfer=result.kind==='render'?[result.pixels]:[];
    scope.postMessage({id:data.id,result},transfer);
  } catch(error) {
    closePage();
    scope.postMessage({id:data.id,error:error instanceof Error?error.message:String(error)},[]);
  }
};
