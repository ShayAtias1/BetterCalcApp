import { ViewerPdfDocument } from '../pdfViewerSource';
import { aiTiles, AI_IMAGE_NAMES, AI_PREPARATION_VERSION, type AiManifest, type AiImage } from './contracts';
export async function pdfFingerprint(blob:Blob):Promise<string>{
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
}
function base64(blob:Blob):Promise<string>{
  if(blob.size>20_000_000)throw new Error('An AI image exceeds the 20 MB local limit.');
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('AI image encoding failed.'));reader.readAsDataURL(blob);});
}
export async function prepareAiPage(planId:string,pageNumber:number,blob:Blob,sourceHash:string){
  const document=await ViewerPdfDocument.open(()=>Promise.resolve(blob),new AbortController().signal);
  try{
    const page=await document.getPage(pageNumber), raster=await page.prepareAiRaster();
    const tiles=aiTiles(raster.width,raster.height);
    const manifest:AiManifest={preparationVersion:AI_PREPARATION_VERSION,renderer:'embedpdf-pdfium',planId,pageNumber,sourceHash,
      nativeWidth:raster.nativeWidth,nativeHeight:raster.nativeHeight,rotation:raster.rotation,userUnit:raster.userUnit,view:raster.view,
      pageDimensions:[raster.width,raster.height],renderScale:raster.scale,tiles,
      coordinateMapping:'nativePage = (tileOriginPixels + tileLocalNormalized * tileSizePixels) / renderScale; intrinsic rotation already included'};
    const images:AiImage[]=[{name:AI_IMAGE_NAMES[0],width:raster.width,height:raster.height,base64:await base64(raster.png)}];
    const bitmap=await createImageBitmap(raster.png);
    const canvas=window.document.createElement('canvas');
    try{
      for(const tile of tiles){
        canvas.width=tile.tileWidth;canvas.height=tile.tileHeight;
        const ctx=canvas.getContext('2d');if(!ctx)throw new Error('AI tile canvas unavailable.');
        ctx.drawImage(bitmap,tile.pageX,tile.pageY,tile.pageWidth,tile.pageHeight,0,0,tile.tileWidth,tile.tileHeight);
        const png=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('AI tile encoding failed.')),'image/png'));
        images.push({name:tile.tileId,width:tile.tileWidth,height:tile.tileHeight,base64:await base64(png)});
      }
    }finally{bitmap.close();canvas.width=canvas.height=0;}
    return {manifest,images};
  }finally{document.dispose();}
}
