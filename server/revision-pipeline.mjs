import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { matches, MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES } from './ai-pipeline.mjs';

// Revision Compare classification: labels for locally detected candidate regions only.
// The model never returns coordinates or measurements; quantities stay deterministic in the browser.
const asset = name => readFileSync(new URL(`./revision-ai-assets/${name}`, import.meta.url));
export const revisionConfig = JSON.parse(asset('config-used.json'));
export const revisionPrompt = asset('product-prompt.txt').toString('utf8');
export const revisionSchema = JSON.parse(asset('output-schema.json'));
if(revisionConfig.model!=='gpt-6.1-sol'||revisionConfig.maxRetries!==0||revisionConfig.maxImages!==12)throw new Error('Revision AI configuration changed.');

const p=revisionConfig.pricing;
const maxImageTokens=Math.ceil(revisionConfig.maxImageWidth*revisionConfig.maxImageHeight/500)+100;
// Conservative upper bound: every image at maximum size plus prompt overhead, at the highest input
// rate, and the full output cap — doubled. A spending safeguard, not an expected price.
export const REVISION_RESERVATION_USD=2*((revisionConfig.maxImages*maxImageTokens+4000)*Math.max(p.input,p.cacheWrite)+revisionConfig.maxOutputTokens*p.output)/1e6;

function requireValue(condition,message){if(!condition)throw Object.assign(new Error(message),{statusCode:400});}
const shortString=(v,max=200)=>typeof v==='string'&&v.length<=max;
export function validateRevisionSubmission(body){
  requireValue(body?.task==='revision-v1'&&/^revision-[a-f0-9-]{36}$/.test(body.requestId??''),'Invalid revision task/request identity.');
  const m=body.manifest;
  requireValue(m&&m.preparationVersion==='revision-crops-v1'&&shortString(m.comparisonId)&&shortString(m.revisionId)&&Number.isInteger(m.pageNumber)&&m.pageNumber>0&&['design','construction'].includes(m.context),'Invalid revision manifest.');
  requireValue(Array.isArray(body.images)&&body.images.length>=1&&body.images.length<=revisionConfig.maxImages,'Between 1 and 12 candidate images are required.');
  requireValue(Array.isArray(m.candidates)&&m.candidates.length===body.images.length,'Candidate notes must match the images.');
  let bytes=0;
  body.images.forEach((image,i)=>{
    const name=`C${i+1}`;
    const note=m.candidates[i];
    requireValue(note&&note.name===name&&shortString(note.note,300),'Invalid candidate note.');
    requireValue(image?.name===name&&Number.isInteger(image.width)&&Number.isInteger(image.height)&&image.width>0&&image.height>0&&image.width<=revisionConfig.maxImageWidth&&image.height<=revisionConfig.maxImageHeight,'Invalid candidate image dimensions.');
    requireValue(typeof image.base64==='string'&&image.base64.length<=Math.ceil(MAX_IMAGE_BYTES/3)*4&&/^[A-Za-z0-9+/]*={0,2}$/.test(image.base64),'Invalid or oversized PNG encoding.');
    const png=Buffer.from(image.base64,'base64');bytes+=png.length;
    requireValue(png.length>=33&&bytes<=MAX_TOTAL_IMAGE_BYTES&&png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&png.toString('ascii',12,16)==='IHDR'&&png.readUInt32BE(16)===image.width&&png.readUInt32BE(20)===image.height,'Invalid PNG header or image byte limit exceeded.');
  });
  return body;
}
export function revisionModelRequest(images,manifest){
  // Cache only the reusable prompt/schema prefix; comparison context and images stay uncached.
  const content=[{type:'input_text',text:revisionPrompt,prompt_cache_breakpoint:{mode:'explicit'}},{type:'input_text',text:`Comparison context: ${manifest.context==='construction'?'during construction (removed elements are physical demolition)':'design revision (nothing built yet)'}.`}];
  images.forEach((image,i)=>content.push(
    {type:'input_text',text:`IMAGE ${image.name}. Local guess: ${manifest.candidates[i].note}`},
    {type:'input_image',detail:revisionConfig.imageDetail,image_url:'data:image/png;base64,'+image.base64}));
  return {model:revisionConfig.model,store:false,service_tier:revisionConfig.serviceTier,max_output_tokens:revisionConfig.maxOutputTokens,
    prompt_cache_options:{mode:'explicit'},
    reasoning:{effort:revisionConfig.reasoningEffort},input:[{role:'user',content}],
    text:{format:{type:'json_schema',name:'revision_change_labels',strict:true,schema:revisionSchema}}};
}
export function revisionRequestDigest(body){
  return createHash('sha256').update(JSON.stringify({task:'revision-v1',requestId:body.requestId,manifest:body.manifest,request:revisionModelRequest(body.images,body.manifest)})).digest('hex');
}
export function revisionCostPreview(body){
  const input=body.images.reduce((sum,i)=>sum+Math.ceil(i.width*i.height/750)+85,0)+2500;
  return {estimatedCostUsd:(input*Math.max(p.input,p.cacheWrite)+150*body.images.length*p.output)/1e6,
    reservationUsd:REVISION_RESERVATION_USD,currency:'USD',pricingVerifiedDate:p.verifiedDate,
    basis:'Estimated from image pixel count and expected short labels; not a token quote or invoice guarantee.'};
}
export function parseRevisionModelResponse(raw){
  if(raw?.status!=='completed')throw new Error('Provider response was incomplete or truncated. No partial result imported.');
  const texts=(raw.output??[]).filter(item=>item.type==='message').flatMap(item=>item.content??[]).filter(c=>c.type==='output_text').map(c=>c.text);
  if(texts.length!==1)throw new Error('Expected one structured output; the model may have refused this request.');
  let result;try{result=JSON.parse(texts[0]);}catch{throw new Error('Provider returned invalid JSON.');}
  if(!matches(result,revisionSchema))throw new Error('Provider output does not match the revision label schema.');
  const names=result.changes.map(c=>c.name);
  if(new Set(names).size!==names.length)throw new Error('Missing or duplicate revision candidate names.');
  return result;
}
export function estimateRevisionCost(raw){
  const u=raw.usage;
  if(!u||!['default','standard',undefined,null].includes(raw.service_tier))return null;
  const i=u.input_tokens,o=u.output_tokens,c=u.input_tokens_details?.cached_tokens??0,w=u.input_tokens_details?.cache_write_tokens??0;
  if(![i,o,c,w].every(v=>Number.isFinite(v)&&v>=0)||c+w>i)return null;
  const long=i>p.longContextThreshold,im=long?p.longInputMultiplier:1,om=long?p.longOutputMultiplier:1;
  return ((i-c-w)*p.input*im+c*p.cachedInput*im+w*p.cacheWrite*im+o*p.output*om)/1e6;
}

// ---------- Full-plan revision analysis (revision-page-v1) ----------
// Both complete revisions, aligned into one pixel frame, at the proven full-page preparation:
// 5500 px longest side, four overlapping tiles with tile-local coordinates (AI Lab finding: the
// tile-local frame maps reliably where full-page coordinates drifted), plus two reduced overviews.
import { aiTiles } from '../src/lib/ai/contracts.ts';
const pageAsset = name => readFileSync(new URL(`./revision-page-ai-assets/${name}`, import.meta.url));
export const revisionPageConfig = JSON.parse(pageAsset('config-used.json'));
export const revisionPagePrompt = pageAsset('product-prompt.txt').toString('utf8');
export const revisionPageSchema = JSON.parse(pageAsset('output-schema.json'));
if(revisionPageConfig.model!=='gpt-6.1-sol'||revisionPageConfig.maxRetries!==0||revisionPageConfig.maxImageDimension!==5500)throw new Error('Revision page AI configuration changed.');
export const REVISION_PAGE_IMAGE_NAMES=['BEFORE_PAGE','AFTER_PAGE','BEFORE_TILE_A','AFTER_TILE_A','BEFORE_TILE_B','AFTER_TILE_B','BEFORE_TILE_C','AFTER_TILE_C','BEFORE_TILE_D','AFTER_TILE_D'];
const pp=revisionPageConfig.pricing;
// Upper bound: full context at the highest long-context input rate plus the output cap (as the openings reservation).
export const REVISION_PAGE_RESERVATION_USD=(1_050_000*Math.max(pp.input,pp.cacheWrite)*pp.longInputMultiplier+revisionPageConfig.maxOutputTokens*pp.output*pp.longOutputMultiplier)/1e6;
export function validateRevisionPageSubmission(body){
  requireValue(body?.task==='revision-page-v1'&&/^revision-[a-f0-9-]{36}$/.test(body.requestId??''),'Invalid revision analysis task/request identity.');
  const m=body.manifest;
  requireValue(m&&m.preparationVersion==='revision-page-v1'&&shortString(m.comparisonId)&&shortString(m.revisionId)&&(m.baseRevisionId===null||shortString(m.baseRevisionId))&&
    Number.isInteger(m.pageNumber)&&m.pageNumber>0&&['design','construction'].includes(m.context)&&/^[a-f0-9]{64}$/.test(m.sourceHash)&&/^[a-f0-9]{64}$/.test(m.revisedHash),'Invalid revision analysis manifest.');
  requireValue([m.nativeWidth,m.nativeHeight,m.renderScale].every(v=>Number.isFinite(v)&&v>0),'Invalid native dimensions.');
  requireValue(Array.isArray(m.pageDimensions)&&m.pageDimensions.length===2&&m.pageDimensions.every(v=>Number.isInteger(v)&&v>0&&v<=5500)&&Math.max(...m.pageDimensions)===5500,'Expected 5500px page preparation.');
  const [w,h]=m.pageDimensions;
  requireValue(Math.abs(m.renderScale-5500/Math.max(m.nativeWidth,m.nativeHeight))<1e-8&&Math.abs(w-m.nativeWidth*m.renderScale)<=1.01&&Math.abs(h-m.nativeHeight*m.renderScale)<=1.01,'Raster/native scale mismatch.');
  requireValue(Array.isArray(m.overviewDimensions)&&m.overviewDimensions.length===2&&m.overviewDimensions.every(v=>Number.isInteger(v)&&v>0&&v<=revisionPageConfig.overviewMaxDimension),'Invalid overview dimensions.');
  const expected=aiTiles(w,h);
  requireValue(Array.isArray(m.tiles)&&m.tiles.length===4&&expected.every((tile,i)=>Object.entries(tile).every(([k,v])=>m.tiles[i]?.[k]===v)),'Tile layout does not match the policy.');
  requireValue(Array.isArray(body.images)&&body.images.length===10,'Exactly ten PNG images are required.');
  let bytes=0;
  body.images.forEach((image,i)=>{
    const tile=i<2?null:expected[Math.floor((i-2)/2)];
    const dims=tile?[tile.tileWidth,tile.tileHeight]:m.overviewDimensions;
    requireValue(image?.name===REVISION_PAGE_IMAGE_NAMES[i]&&image.width===dims[0]&&image.height===dims[1],'Image order or crop dimensions mismatch.');
    requireValue(typeof image.base64==='string'&&image.base64.length<=Math.ceil(MAX_IMAGE_BYTES/3)*4&&/^[A-Za-z0-9+/]*={0,2}$/.test(image.base64),'Invalid or oversized PNG encoding.');
    const png=Buffer.from(image.base64,'base64');bytes+=png.length;
    requireValue(png.length>=33&&bytes<=MAX_TOTAL_IMAGE_BYTES&&png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&png.toString('ascii',12,16)==='IHDR'&&png.readUInt32BE(16)===image.width&&png.readUInt32BE(20)===image.height,'Invalid PNG header or image byte limit exceeded.');
  });
  return body;
}
export function revisionPageModelRequest(images,manifest){
  // No implicit breakpoint after the images: cache writes end at the static detection prompt.
  const content=[{type:'input_text',text:revisionPagePrompt,prompt_cache_breakpoint:{mode:'explicit'}},{type:'input_text',text:`Comparison context: ${manifest.context==='construction'?'during construction (removed elements are physical demolition)':'design revision (nothing built yet)'}.`}];
  for(const image of images)content.push(
    {type:'input_text',text:`IMAGE ${image.name}: ${image.width} x ${image.height} pixels. `+(image.name.endsWith('_PAGE')?'Global context only; not a coordinate frame.':'Change coordinates use this tile-local frame (same frame for the BEFORE and AFTER tile of this letter).')},
    {type:'input_image',detail:revisionPageConfig.imageDetail,image_url:'data:image/png;base64,'+image.base64});
  return {model:revisionPageConfig.model,store:false,service_tier:revisionPageConfig.serviceTier,max_output_tokens:revisionPageConfig.maxOutputTokens,
    prompt_cache_options:{mode:'explicit'},
    reasoning:{effort:revisionPageConfig.reasoningEffort},input:[{role:'user',content}],
    text:{format:{type:'json_schema',name:'tile_local_revision_changes',strict:true,schema:revisionPageSchema}}};
}
export function revisionPageRequestDigest(body){
  return createHash('sha256').update(JSON.stringify({task:'revision-page-v1',requestId:body.requestId,manifest:body.manifest,request:revisionPageModelRequest(body.images,body.manifest)})).digest('hex');
}
export function revisionPageCostPreview(body){
  const pixels=body.images.reduce((sum,i)=>sum+i.width*i.height,0);
  // Same historical ORIGINAL-detail pixel density as the openings preview (Vision-002), plus a larger answer.
  const input=Math.ceil(pixels*72226/(5500*4953+4*3022*2722));
  return {estimatedCostUsd:(input*Math.max(pp.input,pp.cacheWrite)+6000*pp.output)/1e6,
    reservationUsd:REVISION_PAGE_RESERVATION_USD,currency:'USD',pricingVerifiedDate:pp.verifiedDate,
    basis:'Historical ORIGINAL-detail image-pixel density and an estimated answer size; not a token quote or invoice guarantee.'};
}
export function parseRevisionPageModelResponse(raw){
  if(raw?.status!=='completed')throw new Error('Provider response was incomplete or truncated. No partial result imported.');
  const texts=(raw.output??[]).filter(item=>item.type==='message').flatMap(item=>item.content??[]).filter(c=>c.type==='output_text').map(c=>c.text);
  if(texts.length!==1)throw new Error('Expected one structured output; the model may have refused this request.');
  let result;try{result=JSON.parse(texts[0]);}catch{throw new Error('Provider returned invalid JSON.');}
  if(!matches(result,revisionPageSchema))throw new Error('Provider output does not match the revision change schema.');
  const ids=result.changes.map(c=>c.changeId);
  if(ids.some(id=>!id)||new Set(ids).size!==ids.length)throw new Error('Missing or duplicate revision change IDs.');
  return result;
}
