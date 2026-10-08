import { readFileSync } from 'node:fs';
import { ONE_CLICK_VERSION, targetCrop } from '../src/lib/ai/oneClick.ts';
import { MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES, matches } from './ai-pipeline.mjs';
export const oneClickConfig=JSON.parse(readFileSync(new URL('./one-click-assets/v1/config.json',import.meta.url),'utf8'));
const prompt=readFileSync(new URL('./one-click-assets/v1/prompt.txt',import.meta.url),'utf8');
const schema=JSON.parse(readFileSync(new URL('./one-click-assets/v1/schema.json',import.meta.url),'utf8'));
if(oneClickConfig.model!=='gpt-6.1-sol'||oneClickConfig.reasoningEffort!=='low'||oneClickConfig.serviceTier!=='default'||oneClickConfig.imageDetail!=='high'||oneClickConfig.maxOutputTokens!==24000||oneClickConfig.timeoutSeconds!==420||oneClickConfig.maxRetries!==0)throw new Error('One-Click v1 configuration changed; refusing inference.');
const requireValue=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{statusCode:400});};
export function validateOneClickSubmission(body){
  const m=body?.manifest;
  requireValue(typeof body?.requestId==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId),'Invalid request identity.');
  requireValue(m&&m.preparationVersion===ONE_CLICK_VERSION&&m.renderer==='embedpdf-pdfium'&&typeof m.planId==='string'&&m.planId.length>0&&m.planId.length<=200&&/^[a-f0-9]{64}$/.test(m.sourceHash),'Invalid One-Click source binding.');
  requireValue(Number.isInteger(m.pageNumber)&&m.pageNumber>0&&[0,90,180,270].includes(m.rotation)&&m.userUnit===1&&Array.isArray(m.view)&&m.view.length===4&&m.view.every(Number.isFinite)&&m.view[0]===0&&m.view[1]===0,'Unsupported PDF metadata.');
  requireValue([m.nativeWidth,m.nativeHeight,m.renderScale].every(v=>Number.isFinite(v)&&v>0),'Invalid native dimensions.');
  requireValue(Array.isArray(m.pageDimensions)&&m.pageDimensions.length===2&&m.pageDimensions.every(v=>Number.isInteger(v)&&v>0&&v<=5500)&&Math.max(...m.pageDimensions)===5500,'Expected 5500px PDFium raster.');
  const [w,h]=m.pageDimensions,p=m.targetPoint;
  requireValue(Math.abs(m.renderScale-5500/Math.max(m.nativeWidth,m.nativeHeight))<1e-8&&Math.abs(w-m.nativeWidth*m.renderScale)<=1.01&&Math.abs(h-m.nativeHeight*m.renderScale)<=1.01,'Raster scale mismatch.');
  requireValue(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.y>=0&&p.x<=m.nativeWidth&&p.y<=m.nativeHeight,'Invalid selected point.');
  const crop=targetCrop(w,h,p,m.renderScale);
  requireValue(m.crop&&Object.entries(crop).every(([k,v])=>m.crop[k]===v)&&Array.isArray(m.tiles)&&m.tiles.length===0,'Invalid targeted crop layout.');
  requireValue(Array.isArray(body.images)&&body.images.length===2,'Exactly two One-Click PNG images required.');
  let bytes=0;
  body.images.forEach((image,i)=>{
    const dims=i?[crop.tileWidth,crop.tileHeight]:[w,h];
    requireValue(image?.name===(i?'TARGET_CROP':'PAGE')&&image.width===dims[0]&&image.height===dims[1],'Image frame mismatch.');
    requireValue(typeof image.base64==='string'&&image.base64.length<=Math.ceil(MAX_IMAGE_BYTES/3)*4&&/^[A-Za-z0-9+/]*={0,2}$/.test(image.base64),'Invalid PNG encoding.');
    const png=Buffer.from(image.base64,'base64');bytes+=png.length;
    requireValue(png.length>=33&&png.length<=MAX_IMAGE_BYTES&&bytes<=MAX_TOTAL_IMAGE_BYTES&&png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&png.toString('ascii',12,16)==='IHDR'&&png.readUInt32BE(16)===image.width&&png.readUInt32BE(20)===image.height,'Invalid PNG header or byte limit.');
  });
}
export function oneClickModelRequest(images,m){
  const p=m.targetPoint,c=m.crop,px=p.x*m.renderScale,py=p.y*m.renderScale;
  const coordinates={coordinateFrame:'PAGE top-left; x right; y down; intrinsic rotation included',pagePixels:m.pageDimensions,nativeDimensions:[m.nativeWidth,m.nativeHeight],targetNative:p,targetPagePixels:[px,py],targetPageNormalized:[px/m.pageDimensions[0],py/m.pageDimensions[1]],cropOriginPagePixels:[c.pageX,c.pageY],cropSizePixels:[c.pageWidth,c.pageHeight],targetCropPixels:[px-c.pageX,py-c.pageY],outputFrame:'PAGE normalized [0,1]'};
  const content=[{type:'input_text',text:prompt},{type:'input_text',text:'TARGET_POINT AND FRAMES: '+JSON.stringify(coordinates)}];
  for(const image of images)content.push({type:'input_text',text:`IMAGE ${image.name}: ${image.width} x ${image.height}`},{type:'input_image',detail:'high',image_url:'data:image/png;base64,'+image.base64});
  return {model:oneClickConfig.model,store:false,service_tier:oneClickConfig.serviceTier,max_output_tokens:oneClickConfig.maxOutputTokens,reasoning:{effort:oneClickConfig.reasoningEffort},input:[{role:'user',content}],text:{format:{type:'json_schema',name:'one_click_target_space_v1',strict:true,schema}}};
}
export function parseOneClickResponse(raw){
  if(raw?.status!=='completed')throw new Error('Provider response was incomplete.');
  const texts=(raw.output??[]).filter(i=>i.type==='message').flatMap(i=>i.content??[]).filter(c=>c.type==='output_text').map(c=>c.text);
  if(texts.length!==1)throw new Error('Expected one One-Click structured response.');
  const result=JSON.parse(texts[0]);
  if(!matches(result,schema)||(result.status==='FOUND'?!result.space:result.space!==null))throw new Error('Provider returned invalid One-Click output.');
  return result;
}
