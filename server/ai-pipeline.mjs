import { readFileSync } from 'node:fs';
import { aiTiles, AI_IMAGE_NAMES, AI_PREPARATION_VERSION } from '../src/lib/ai/contracts.ts';
export const config=JSON.parse(readFileSync(new URL('./ai-assets/config-used.json',import.meta.url),'utf8'));
export const schema=JSON.parse(readFileSync(new URL('./ai-assets/output-schema.json',import.meta.url),'utf8'));
export const prompt=readFileSync(new URL('./ai-assets/product-prompt.txt',import.meta.url),'utf8');
if(config.model!=='gpt-6.1-sol'||config.reasoningEffort!=='low'||config.imageDetail!=='high'||config.serviceTier!=='default'||config.maxOutputTokens!==24000||config.maxImageDimension!==5500||config.maxRetries!==0)throw new Error('Frozen AI model configuration changed; refusing inference.');
export const MAX_BODY_BYTES=60_000_000, MAX_IMAGE_BYTES=20_000_000, MAX_TOTAL_IMAGE_BYTES=40_000_000;
// Conservative reservation: full published context at the most expensive frozen long-context
// input rate (including cache writes), plus maximum output. Not the observed per-page average.
export const COST_RESERVATION_USD=(1_050_000*5+config.maxOutputTokens*15)/1e6;
function requireValue(condition,message){if(!condition)throw Object.assign(new Error(message),{statusCode:400});}
export function validateSubmission(body){
  const m=body?.manifest;
  requireValue(typeof body?.requestId==='string' && /^[a-zA-Z0-9-]{16,80}$/.test(body.requestId),'Invalid request identity.');
  requireValue(m && m.preparationVersion===AI_PREPARATION_VERSION && m.renderer==='embedpdf-pdfium' && typeof m.planId==='string' && m.planId.length>0 && m.planId.length<=200 && /^[a-f0-9]{64}$/.test(m.sourceHash),'Invalid source binding or preparation version.');
  requireValue(Number.isInteger(m.pageNumber) && m.pageNumber>0 && [0,90,180,270].includes(m.rotation) && m.userUnit===1 && Array.isArray(m.view) && m.view.length===4 && m.view.every(Number.isFinite) && m.view[0]===0 && m.view[1]===0,'Unsupported PDF page metadata.');
  requireValue([m.nativeWidth,m.nativeHeight,m.renderScale].every(v=>Number.isFinite(v)&&v>0),'Invalid native dimensions.');
  requireValue(Array.isArray(m.pageDimensions) && m.pageDimensions.length===2 && m.pageDimensions.every(v=>Number.isInteger(v)&&v>0&&v<=5500) && Math.max(...m.pageDimensions)===5500,'Expected frozen 5500px page preparation.');
  const [w,h]=m.pageDimensions;
  requireValue(Math.abs(m.renderScale-5500/Math.max(m.nativeWidth,m.nativeHeight))<1e-8 && Math.abs(w-m.nativeWidth*m.renderScale)<=1.01 && Math.abs(h-m.nativeHeight*m.renderScale)<=1.01,'Raster/native scale mismatch.');
  const expected=aiTiles(w,h);
  requireValue(Array.isArray(m.tiles) && m.tiles.length===4 && expected.every((tile,i)=>Object.entries(tile).every(([k,v])=>m.tiles[i]?.[k]===v)),'Tile layout does not match the frozen policy.');
  requireValue(Array.isArray(body.images) && body.images.length===5,'Exactly five PNG images are required.');
  let bytes=0;
  body.images.forEach((image,i)=>{
    const dims=i===0?[w,h]:[expected[i-1].tileWidth,expected[i-1].tileHeight];
    requireValue(image?.name===AI_IMAGE_NAMES[i] && image.width===dims[0] && image.height===dims[1],'Image order or crop dimensions mismatch.');
    requireValue(typeof image.base64==='string' && image.base64.length<=Math.ceil(MAX_IMAGE_BYTES/3)*4 && /^[A-Za-z0-9+/]*={0,2}$/.test(image.base64),'Invalid or oversized PNG encoding.');
    const png=Buffer.from(image.base64,'base64');bytes+=png.length;
    requireValue(png.length>=33 && png.length<=MAX_IMAGE_BYTES && bytes<=MAX_TOTAL_IMAGE_BYTES && png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && png.toString('ascii',12,16)==='IHDR' && png.readUInt32BE(16)===image.width && png.readUInt32BE(20)===image.height,'Invalid PNG header or image byte limit exceeded.');
  });
  return body;
}
export function modelRequest(images){
  const content=[{type:'input_text',text:prompt}];
  for(const image of images) content.push(
    {type:'input_text',text:`IMAGE ${image.name}: ${image.width} x ${image.height} pixels. `+(image.name==='PAGE'?'Global context only; not a final coordinate frame.':'Final geometry may use this named tile-local coordinate frame.')},
    {type:'input_image',detail:'high',image_url:'data:image/png;base64,'+image.base64});
  return {model:config.model,store:false,service_tier:config.serviceTier,max_output_tokens:config.maxOutputTokens,
    reasoning:{effort:config.reasoningEffort},input:[{role:'user',content}],
    text:{format:{type:'json_schema',name:'tile_local_architectural_spaces',strict:true,schema}}};
}
// Validate against the copied schema rather than a reduced response format.
function matches(value,shape){
  if(shape.enum && !shape.enum.includes(value))return false;
  const types=Array.isArray(shape.type)?shape.type:[shape.type];
  const type=value===null?'null':Array.isArray(value)?'array':typeof value;
  if(!types.includes(type) && !(type==='number' && types.includes('integer') && Number.isInteger(value)))return false;
  if(type==='number')return Number.isFinite(value) && (shape.minimum===undefined||value>=shape.minimum) && (shape.maximum===undefined||value<=shape.maximum);
  if(type==='array')return value.length<=2000 && (shape.minItems===undefined||value.length>=shape.minItems) && (shape.maxItems===undefined||value.length<=shape.maxItems) && value.every(v=>matches(v,shape.items));
  if(type==='object')return (shape.required??[]).every(key=>Object.hasOwn(value,key)) && Object.keys(value).every(key=>shape.properties[key] ? matches(value[key],shape.properties[key]) : shape.additionalProperties!==false);
  return type!=='string'||value.length<=10000;
}
export function parseModelResponse(raw){
  if(raw?.status!=='completed')throw new Error('Provider response was incomplete or truncated. No partial result imported.');
  const texts=(raw.output??[]).filter(item=>item.type==='message').flatMap(item=>item.content??[]).filter(c=>c.type==='output_text').map(c=>c.text);
  if(texts.length!==1)throw new Error('Expected one structured output; the model may have refused this request.');
  let result;try{result=JSON.parse(texts[0]);}catch{throw new Error('Provider returned invalid JSON.');}
  if(!matches(result,schema))throw new Error('Provider output does not match the frozen Space schema.');
  const ids=result.spaces.map(space=>space.spaceId);
  if(ids.some(id=>!id)||new Set(ids).size!==ids.length)throw new Error('Missing or duplicate AI Space IDs.');
  return result;
}
export function estimateCost(raw){
  const u=raw.usage,p=config.pricing;
  if(!u || !['default','standard',undefined,null].includes(raw.service_tier))return null;
  const i=u.input_tokens,o=u.output_tokens,cached=u.input_tokens_details?.cached_tokens??0,writes=u.input_tokens_details?.cache_write_tokens??0;
  if(![i,o,cached,writes].every(v=>Number.isFinite(v)&&v>=0)||cached+writes>i)return null;
  const long=i>p.longContextThreshold,im=long?p.longInputMultiplier:1,om=long?p.longOutputMultiplier:1;
  return ((i-cached-writes)*p.input*im+cached*p.cachedInput*im+writes*p.cacheWrite*im+o*p.output*om)/1e6;
}
