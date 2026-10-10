import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseOpeningResponse, validateOpeningManifest } from '../src/lib/ai/openings.ts';
import { validateSubmission } from './ai-pipeline.mjs';

// Isolated assets: loading this module never changes the room pipeline or submits a request.
const asset = name => readFileSync(new URL(`./openings-ai-assets/${name}`, import.meta.url));
export const openingsProvenance = JSON.parse(asset('provenance.json'));
for (const [name, hash] of Object.entries(openingsProvenance.copiedAssetsSha256)) {
  if (createHash('sha256').update(asset(name)).digest('hex') !== hash) throw new Error(`Frozen openings asset changed: ${name}`);
}
export const openingsConfig = JSON.parse(asset('config-used.json'));
export const openingsPrompt = asset('product-prompt.txt').toString('utf8');
export const openingsSchema = JSON.parse(asset('output-schema.json'));
export const parseOpeningsModelResponse = parseOpeningResponse;
if(openingsConfig.model!=='gpt-6.1-sol'||openingsConfig.imageDetail!=='original'||openingsConfig.reasoningEffort!=='low'||openingsConfig.serviceTier!=='default'||openingsConfig.maxOutputTokens!==24000||openingsConfig.maxImageDimension!==5500||openingsConfig.maxRetries!==0||openingsConfig.timeoutSeconds!==420)throw new Error('Frozen openings configuration changed.');
export const OPENINGS_RESERVATION_USD=(1_050_000*Math.max(openingsConfig.pricing.input,openingsConfig.pricing.cacheWrite)*openingsConfig.pricing.longInputMultiplier+openingsConfig.maxOutputTokens*openingsConfig.pricing.output*openingsConfig.pricing.longOutputMultiplier)/1e6;
export function validateOpeningsSubmission(body){
  if(body?.task!=='openings-v1'||!/^openings-[a-f0-9-]{36}$/.test(body.requestId??''))throw Object.assign(new Error('Invalid openings task/request identity.'),{statusCode:400});
  validateSubmission(body); // Reuse unchanged five-image byte/layout limits.
  try{validateOpeningManifest(body.manifest);}catch{throw Object.assign(new Error('Invalid openings preparation manifest.'),{statusCode:400});}
}
export function openingsModelRequest(images){
  const content=[{type:'input_text',text:openingsPrompt}];
  for(const image of images)content.push(
    {type:'input_text',text:`IMAGE ${image.name}: ${image.width} x ${image.height} pixels. `+(image.name==='PAGE'?'Global context only; not a final coordinate frame.':'Opening coordinates use this named tile-local frame.')},
    {type:'input_image',detail:openingsConfig.imageDetail,image_url:'data:image/png;base64,'+image.base64});
  return {model:openingsConfig.model,store:false,service_tier:openingsConfig.serviceTier,max_output_tokens:openingsConfig.maxOutputTokens,
    reasoning:{effort:openingsConfig.reasoningEffort},input:[{role:'user',content}],
    text:{format:{type:'json_schema',name:'tile_local_architectural_openings',strict:true,schema:openingsSchema}}};
}
/** Stable binding to task, identity, source, exact imagery and frozen payload. */
export function openingsRequestDigest(body){
  return createHash('sha256').update(JSON.stringify({task:'openings-v1',requestId:body.requestId,manifest:body.manifest,request:openingsModelRequest(body.images)})).digest('hex');
}
export function openingsCostPreview(body){
  const pixels=body.images.reduce((sum,i)=>sum+i.width*i.height,0);
  // Historical ORIGINAL density from Vision-002. Includes text overhead in observed usage.
  const input=Math.ceil(pixels*72226/(5500*4953+4*3022*2722));
  const p=openingsConfig.pricing;
  return {estimatedCostUsd:(input*Math.max(p.input,p.cacheWrite)+2382*p.output)/1e6,
    reservationUsd:OPENINGS_RESERVATION_USD,currency:'USD',pricingVerifiedDate:p.verifiedDate,
    basis:'Historical Vision-002 ORIGINAL image-pixel density and observed output usage; not a token quote or invoice guarantee. Reservation uses full context and output cap at frozen highest rates.'};
}
export function estimateOpeningsCost(raw){
  const u=raw.usage,p=openingsConfig.pricing;
  if(!u||!['default','standard',undefined,null].includes(raw.service_tier))return null;
  const i=u.input_tokens,o=u.output_tokens,c=u.input_tokens_details?.cached_tokens??0,w=u.input_tokens_details?.cache_write_tokens??0;
  if(![i,o,c,w].every(v=>Number.isFinite(v)&&v>=0)||c+w>i)return null;
  const long=i>p.longContextThreshold,im=long?p.longInputMultiplier:1,om=long?p.longOutputMultiplier:1;
  return ((i-c-w)*p.input*im+c*p.cachedInput*im+w*p.cacheWrite*im+o*p.output*om)/1e6;
}
