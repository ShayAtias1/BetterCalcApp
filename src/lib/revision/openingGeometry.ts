import type { Point } from '../../types';
import type { RevisionChange } from '../../types/revisionAnalysis';
import { polygonAreaPx } from '../geometry';
import { openingFootprint } from './changeEdit';
import { isOpeningDifference } from './openingImpact';

/** Clip against an observed rectangle edge; intersections introduce no assumed dimensions. */
function split(points: Point[], a: Point, b: Point, sign: number, inside: boolean): Point[] {
  const side = (p: Point) => ((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x))*sign;
  const result: Point[] = [];
  for (let i=0;i<points.length;i++) {
    const p=points[i], q=points[(i+1)%points.length], sp=side(p), sq=side(q);
    const keepP=inside ? sp>=-1e-8 : sp<=1e-8, keepQ=inside ? sq>=-1e-8 : sq<=1e-8;
    if (keepP) result.push(p);
    if (keepP!==keepQ) {
      const t=sp/(sp-sq);
      result.push({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t});
    }
  }
  return result.filter((p,i)=>!i || Math.hypot(p.x-result[i-1].x,p.y-result[i-1].y)>1e-8);
}
function subtract(subject: Point[], rectangle: Point[]): Point[][] {
  const signed = rectangle.reduce((sum,a,i)=>{const b=rectangle[(i+1)%rectangle.length];return sum+a.x*b.y-b.x*a.y;},0);
  const sign=signed>=0?1:-1;
  let remaining=subject;
  const pieces:Point[][]=[];
  for(let i=0;i<rectangle.length && remaining.length>=3;i++) {
    const a=rectangle[i],b=rectangle[(i+1)%rectangle.length];
    const outside=split(remaining,a,b,sign,false);
    if(outside.length>=3 && polygonAreaPx(outside)>1e-6)pieces.push(outside);
    remaining=split(remaining,a,b,sign,true);
  }
  return pieces;
}
/** Plan-only wall differences from observed footprints. Heights are neither needed nor guessed;
 * quantities still use openingImpact and its existing verification gates.
 */
export function openingWallFootprints(c: RevisionChange) {
  const shapes=c.doors.map((d,index)=>({d,index,points:openingFootprint(d)}));
  if (isOpeningDifference(c) && (!shapes.some(s => s.d.side === 'removed' && s.points)
    || !shapes.some(s => s.d.side === 'added' && s.points))) return [];
  return shapes.flatMap(({d,index,points})=>{
    if(!points)return [];
    let pieces=[points];
    for(const other of shapes) {
      if(!other.points || other.index===index || (other.d.side===d.side && other.index>index))continue;
      pieces=pieces.flatMap(piece=>subtract(piece,other.points!));
    }
    return pieces.map((points,part)=>({points,index,part,areaKind:d.side==='removed'?'construction' as const:'demolition' as const,
      verified:d.geometryVerified===true || (d.geometryVerified==null && c.edited===true)}));
  });
}
