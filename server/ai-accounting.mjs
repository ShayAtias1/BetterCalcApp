// Metadata only: never retain prompts, image payloads, credentials or provider output.
const token = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function requestAccounting(request, {requestId, detectionType, mode, startedAt, timeoutSeconds, maxRetries}) {
  return {
    requestId, detectionType, mode, startedAt, finishedAt:null, latencySeconds:null,
    model:request.model, settings:{reasoning:request.reasoning, serviceTier:request.service_tier, timeoutSeconds, maxRetries,
      maxOutputTokens:request.max_output_tokens, store:request.store,
      imageDetails:[...new Set(request.input.flatMap(i=>i.content??[]).filter(c=>c.type==='input_image').map(c=>c.detail))],
      outputFormat:request.text?.format?.type, outputSchema:request.text?.format?.name},
    inputTokens:null, outputTokens:null, cachedTokens:null, reasoningTokens:null,
    estimatedCostUsd:null, usageSource:null,
  };
}
export function reportedAccounting(raw, estimatedCostUsd) {
  const usage=raw?.usage;
  return {
    ...(typeof raw?.id==='string'?{providerRequestId:raw.id}:{}),
    ...(typeof raw?.model==='string'?{model:raw.model}:{}),
    ...(typeof raw?.service_tier==='string'?{serviceTier:raw.service_tier}:{}),
    ...(usage?{usage}:{}), usageSource:usage?'provider':null,
    inputTokens:token(usage?.input_tokens), outputTokens:token(usage?.output_tokens),
    cachedTokens:token(usage?.input_tokens_details?.cached_tokens),
    reasoningTokens:token(usage?.output_tokens_details?.reasoning_tokens), estimatedCostUsd,
  };
}
