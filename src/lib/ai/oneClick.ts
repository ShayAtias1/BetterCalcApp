import type { Point, Room } from '../../types';
import type { AiManifest, AiTile } from './contracts';
import { polygonProblems, type ImportedSpace, type LocalAiMetadata } from '../localAiImport';
export const ONE_CLICK_VERSION = 'one-click-v1';
export interface OneClickManifest extends AiManifest { targetPoint:Point; crop:AiTile }
export function targetCrop(width:number,height:number,point:Point,scale:number):AiTile {
  const w=Math.min(width,3000),h=Math.min(height,3000);
  return {tileId:'TARGET_CROP',pageX:Math.max(0,Math.min(width-w,Math.round(point.x*scale-w/2))),
    pageY:Math.max(0,Math.min(height-h,Math.round(point.y*scale-h/2))),pageWidth:w,pageHeight:h,tileWidth:w,tileHeight:h};
}
export function containsTarget(points:Point[],point:Point):boolean {
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[j],b=points[i];
    if(Math.abs((b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x))<1e-8 && point.x>=Math.min(a.x,b.x) && point.x<=Math.max(a.x,b.x) && point.y>=Math.min(a.y,b.y) && point.y<=Math.max(a.y,b.y))return true;
    if((a.y>point.y)!==(b.y>point.y) && point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
export function candidateGeometryProblems(points:Point[],meta:LocalAiMetadata):string[]{
  return [...polygonProblems(points,meta.width,meta.height),...(meta.targetPoint&&!containsTarget(points,meta.targetPoint)?['Polygon does not contain the selected target point.']:[])];
}
/** Conservative overlap warning: flag any interior containment or crossing, including significant overlaps. Shared edges alone are allowed. */
export function overlapNotes(points:Point[],rooms:Room[],pageNumber:number):string[]{
  const cross=(a:Point,b:Point,c:Point)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const interior=(poly:Point[],p:Point)=>containsTarget(poly,p)&&!poly.some((a,i)=>{const b=poly[(i+1)%poly.length];return Math.abs(cross(a,b,p))<1e-8&&p.x>=Math.min(a.x,b.x)&&p.x<=Math.max(a.x,b.x)&&p.y>=Math.min(a.y,b.y)&&p.y<=Math.max(a.y,b.y);});
  return rooms.filter(r=>r.pageNumber===pageNumber&&(
    points.some(p=>interior(r.points,p))||r.points.some(p=>interior(points,p))||
    points.some((a,i)=>r.points.some((c,j)=>{const b=points[(i+1)%points.length],d=r.points[(j+1)%r.points.length];return cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0;}))||
    (points.length>=3&&r.points.length>=3&&points.every(p=>containsTarget(r.points,p))&&r.points.every(p=>containsTarget(points,p)))
  )).map(r=>`Overlap with existing Room “${r.name}”. Review before approval.`);
}
export function parseOneClickResult(result:unknown,m:OneClickManifest,importId:string,rooms:Room[]):ImportedSpace[]{
  const data=result as {status?:string;reason?:string;space?:{polygon:number[][];type:string|null;geometryConfidence:string;ambiguities:string[]}};
  if(data?.status==='UNCERTAIN'&&data.space===null)return [];
  if(data?.status!=='FOUND'||!data.space||!Array.isArray(data.space.polygon)||data.space.polygon.length<3||data.space.polygon.length>256)throw new Error('Invalid One-Click result.');
  const s=data.space;
  const points=s.polygon.map(p=>{if(!Array.isArray(p)||p.length!==2||!p.every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw new Error('Invalid One-Click page coordinates.');return {x:p[0]*m.pageDimensions[0]/m.renderScale,y:p[1]*m.pageDimensions[1]/m.renderScale};});
  const notes=[...(s.ambiguities??[]),...overlapNotes(points,rooms,m.pageNumber)];
  const meta:LocalAiMetadata={planId:m.planId,sourceHash:m.sourceHash,pageNumber:m.pageNumber,width:m.nativeWidth,height:m.nativeHeight,
    spaceId:'target',geometryClass:'CLOSED',reviewNotes:notes,suggestedType:s.type,geometryConfidence:s.geometryConfidence,requiresReview:true,ambiguities:[...(s.ambiguities??[])],overlapWarnings:overlapNotes(points,rooms,m.pageNumber),reason:data.reason||null,targetPoint:{...m.targetPoint},detectionMode:ONE_CLICK_VERSION};
  const problems=candidateGeometryProblems(points,meta);
  return [{id:`local-ai:${m.planId}:${m.sourceHash}:${m.pageNumber}:${importId}:target`,pageNumber:m.pageNumber,points,suggestedName:'One-Click AI Space',roomTypeKey:null,confidence:'low',localAi:meta,validationProblems:problems,originalPoints:points.map(p=>({...p})),originalValidationProblems:[...problems]}];
}
