import type { Plan, PlanOpening } from '../../types';
import type { AiOpeningReview } from '../../types/aiOpenings';
import { validatePlanOpening } from '../planOpenings';

/** Deterministic IDs plus persistent review tombstones prevent replay after deletion/undo. */
export function importOpeningReview(plan:Plan,review:AiOpeningReview,now:number):Plan {
  if(review.task!=='openings-v1'||review.planId!==plan.id||!plan.pages[review.pageNumber])throw new Error('Opening review does not belong to this plan/page.');
  if(plan.aiOpeningImportKeys?.includes(review.key))return plan;
  const common={planId:plan.id,pageNumber:review.pageNumber,entryMethod:'plan' as const,source:'import' as const,
    roomIds:[],legacyRefs:[],widthM:null,heightM:null,sillHeightM:null,quantity:null,
    quantityReview:{associationsConfirmed:false,distinctLegacyRoomIds:[]},approval:{status:'draft' as const,reviewedAt:null},createdAt:now,updatedAt:now};
  const added:PlanOpening[]=[...review.candidates.map(c=>({...common,id:c.id,geometry:structuredClone(c.geometry),...c.classification,
    aiDetection:{reviewKey:review.key,sourceHash:review.sourceHash,bbox:structuredClone(c.bbox),provenance:structuredClone(c.provenance)}})),
    ...review.deferred.map(c=>({...common,id:c.id,geometry:null,kind:'unknown' as const,mechanism:'unknown' as const,walkableAccess:'unknown' as const,
      aiDetection:{reviewKey:review.key,sourceHash:review.sourceHash,bbox:structuredClone(c.bbox),deferred:structuredClone(c.original)}}))];
  const ids=new Set((plan.openings??[]).map(o=>o.id));
  for(const o of added)if(validatePlanOpening(plan,o).errors.length)throw new Error('Invalid imported opening.');
  return {...plan,openings:[...(plan.openings??[]),...added.filter(o=>!ids.has(o.id))],
    aiOpeningImportKeys:[...(plan.aiOpeningImportKeys??[]),review.key],updatedAt:now};
}
