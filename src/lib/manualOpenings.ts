import type { Plan, PlanOpening, PlanOpeningPatch, Point } from '../types';
function pointInPolygon(p: Point, points: Point[]): boolean {
  let inside = false;
  for (let i=0,j=points.length-1;i<points.length;j=i++) {
    const a=points[i],b=points[j];
    if ((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}

export type OpeningPreset = 'hinged' | 'sliding' | 'window' | 'passage' | 'unknown';
export const openingPresets: OpeningPreset[] = ['hinged', 'sliding', 'window', 'passage', 'unknown'];
export function openingClassification(preset: OpeningPreset): Pick<PlanOpening, 'kind' | 'mechanism' | 'walkableAccess'> {
  if (preset === 'hinged' || preset === 'sliding') return { kind: 'door', mechanism: preset, walkableAccess: 'supported' };
  if (preset === 'window') return { kind: 'window', mechanism: 'unknown', walkableAccess: 'unsupported' };
  if (preset === 'passage') return { kind: 'open-passage', mechanism: 'open', walkableAccess: 'supported' };
  return { kind: 'unknown', mechanism: 'unknown', walkableAccess: 'unknown' };
}
export function presetOf(o: PlanOpening): OpeningPreset {
  return o.kind === 'door' ? o.mechanism === 'sliding' ? 'sliding' : o.mechanism === 'hinged' ? 'hinged' : 'unknown' : o.kind === 'window' ? 'window' : o.kind === 'open-passage' ? 'passage' : 'unknown';
}
export function measuredOpeningWidth(plan: Plan, page: number, geometry: PlanOpening['geometry']): number | null {
  const scale = plan.pages[page]?.calibration?.metersPerPixel;
  if (!geometry || !scale || !Number.isFinite(scale) || scale <= 0) return null;
  const width = Math.hypot(geometry.endpointB.x - geometry.endpointA.x, geometry.endpointB.y - geometry.endpointA.y) * scale;
  return Number.isFinite(width) && width > 0 ? width : null;
}
export function openingGeometryPatch(plan: Plan, o: PlanOpening, geometry: NonNullable<PlanOpening['geometry']>): PlanOpeningPatch {
  return { geometry, ...(o.widthSource === 'calibration' ? { widthM: measuredOpeningWidth(plan, o.pageNumber, geometry) } : {}) };
}
/** Conservative, display-only suggestion: both sides consistently lie in one room each,
 * and the opening samples lie within 3 native units of that room's polygon boundary.
 * No room association is ever written by this helper. No wall inference or snapping. */
export function suggestOpeningRooms(plan: Plan, o: PlanOpening): string[] {
  if (!o.geometry) return [];
  const { endpointA: a, endpointB: b } = o.geometry;
  const length = Math.hypot(b.x-a.x, b.y-a.y);
  if (length < 12) return [];
  const normal = { x: -(b.y-a.y)/length, y: (b.x-a.x)/length };
  const distanceToEdge = (p: Point, u: Point, v: Point) => {
    const dx=v.x-u.x, dy=v.y-u.y, d=dx*dx+dy*dy;
    const t=d ? Math.max(0,Math.min(1,((p.x-u.x)*dx+(p.y-u.y)*dy)/d)) : 0;
    return Math.hypot(p.x-u.x-t*dx,p.y-u.y-t*dy);
  };
  const rooms=plan.rooms.filter(r=>r.pageNumber===o.pageNumber && r.points.length>=3 && r.closed);
  const found:string[]=[];
  for (const side of [-1,1]) {
    const candidates=rooms.filter(r=>[0.25,0.5,0.75].every(t=>{
      const p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
      const q={x:p.x+normal.x*side*5,y:p.y+normal.y*side*5};
      return pointInPolygon(q,r.points) && r.points.some((u,i)=>distanceToEdge(p,u,r.points[(i+1)%r.points.length])<=3);
    }));
    if (candidates.length>1) return [];
    if (candidates.length===1) found.push(candidates[0].id);
  }
  return [...new Set(found)];
}

/** Only explicitly measured manual widths follow recalibration; typed/imported widths stay intact. */
export function recalibrateOpeningWidths(plan: Plan, page: number, now: number): Plan {
  if (!plan.openings) return plan;
  return { ...plan, openings: plan.openings.map(o => {
    if (o.pageNumber !== page || o.widthSource !== 'calibration') return o;
    const widthM = measuredOpeningWidth(plan,page,o.geometry);
    return widthM === o.widthM ? o : { ...o, widthM, approval: { status: 'draft', reviewedAt: null }, updatedAt: now };
  }) };
}

/** Preserve the endpoint grab offset: an off-center handle click is not a geometry edit. */
export function draggedOpeningGeometry(geometry: NonNullable<PlanOpening['geometry']>, start: Point, pointer: Point, endpoint?: 'endpointA' | 'endpointB') {
  const moved = structuredClone(geometry);
  const points = endpoint ? [moved[endpoint]] : [moved.endpointA, moved.endpointB];
  for (const point of points) {
    point.x += pointer.x - start.x;
    point.y += pointer.y - start.y;
  }
  return moved;
}

/** Quantity-only drafts use the canonical actions and calculator, with no fabricated coordinates. */
export function quantityOpeningInput(plan: Plan, roomId: string, kind: 'door' | 'window' | 'custom', dimensions: Pick<PlanOpening, 'widthM' | 'heightM' | 'sillHeightM' | 'quantity'>): import('../types').NewPlanOpening {
  const room = plan.rooms.find(item => item.id === roomId);
  if (!room) throw new Error('Unknown room');
  return {pageNumber: room.pageNumber, entryMethod: 'takeoff', geometry: null, kind,
    mechanism: 'unknown', walkableAccess: 'unknown', roomIds: [room.id], roomSides: [{roomId:room.id},null],
    apartmentNumber: room.apartmentNumber, source: 'manual', legacyRefs: [], widthSource: 'manual',
    quantityReview: {associationsConfirmed:false,distinctLegacyRoomIds:[]}, ...dimensions};
}
