import { useOpeningsAiUi } from '../lib/ai/openingsUi';
import { PLAN_NAVIGATION_CANCEL } from '../lib/interactionTargets';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useAppStore } from '../store/appStore';
import { useT, useLanguageStore } from '../i18n';
import { presetOf, draggedOpeningGeometry } from '../lib/manualOpenings';
import type { PlanOpening, Point } from '../types';
type Geometry = NonNullable<PlanOpening['geometry']>;
type Drag = { id: string; pointerId: number; start: Point; geometry: Geometry; endpoint?: 'endpointA' | 'endpointB'; preview: Geometry };
const colors = { hinged: '#d97706', sliding: '#9333ea', window: '#0891b2', passage: '#16a34a', unknown: '#64748b' };
export default function OpeningsOverlay({ zoom, screenToNative, hoverPoint, editable, isPanGesture }: {
  zoom: number; screenToNative: (x: number, y: number) => Point; hoverPoint: Point | null; editable: boolean; isPanGesture: () => boolean;
}) {
  const t = useT();
  const language = useLanguageStore(s => s.language);
  const project = useAppStore(s=>s.project);
  const page = useAppStore(s=>s.currentPage);
  const aiScope=useOpeningsAiUi();
  const selected = useAppStore(s=>s.selectedOpeningId);
  const placement = useAppStore(s=>s.openingPlacement);
  const drag = useRef<Drag | null>(null);
  const ownsGesture = useRef(false);
  const [preview, setPreview] = useState<{id: string; geometry: Geometry} | null>(null);
  useEffect(()=>{
    const cancel=(e:KeyboardEvent)=>{if(e.key==='Escape'){drag.current=null;setPreview(null);}};
    const cancelNavigation=()=>{drag.current=null;setPreview(null);};
    window.addEventListener('keydown',cancel);
    window.addEventListener(PLAN_NAVIGATION_CANCEL,cancelNavigation);
    return ()=>{window.removeEventListener('keydown',cancel);window.removeEventListener(PLAN_NAVIGATION_CANCEL,cancelNavigation);};
  },[]);
  useEffect(()=>{drag.current=null;setPreview(null);},[project?.id,page,selected,editable,placement]);
  const scale=1/zoom;
  const begin=(e:PointerEvent<SVGElement>,o:PlanOpening,endpoint?:Drag['endpoint'])=>{
    ownsGesture.current = false;
    if (!editable || placement || e.button!==0 || isPanGesture() || !o.geometry) return;
    ownsGesture.current = true;
    e.preventDefault();e.stopPropagation();
    useAppStore.getState().selectPlanOpening(o.id);
    // Selected state effect runs once after first selection; selecting an unselected span only
    // selects it. Drag on the next gesture, keeping selection from cancelling an active drag.
    if (selected!==o.id) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current={id:o.id,pointerId:e.pointerId,start:screenToNative(e.clientX,e.clientY),geometry:structuredClone(o.geometry),preview:structuredClone(o.geometry),endpoint};
  };
  const move=(e:PointerEvent<SVGElement>)=>{
    const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;
    e.stopPropagation();const p=screenToNative(e.clientX,e.clientY);
    const geometry=draggedOpeningGeometry(d.geometry,d.start,p,d.endpoint);
    d.preview=geometry;setPreview({id:d.id,geometry});
  };
  const finish=(e:PointerEvent<SVGElement>)=>{
    const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;
    move(e);e.stopPropagation();drag.current=null;setPreview(null);
    const a=d.preview.endpointA,b=d.preview.endpointB;
    if(Math.hypot(b.x-a.x,b.y-a.y)<0.001)return;
    if(JSON.stringify(d.preview)!==JSON.stringify(d.geometry)) useAppStore.getState().updatePlanOpening(d.id,{geometry:d.preview});
  };
  const stopMouse=(e:React.MouseEvent<SVGElement>)=>{if(ownsGesture.current&&e.button===0)e.stopPropagation();};
  return <g data-opening-overlay="true">
    {(project?.openings??[]).filter(o=>o.pageNumber===page&&(!o.aiDetection||(aiScope.planId===project?.id&&aiScope.sourceHash===o.aiDetection.sourceHash))).map(o=>{
      if(!o.geometry){
        const b=o.aiDetection?.bbox;if(!b)return null;
        return <g key={o.id} data-opening-id={o.id} data-plan-child-interaction="true">
          <rect x={b.x1} y={b.y1} width={b.x2-b.x1} height={b.y2-b.y1} fill="#d9770618" stroke={selected===o.id?'#2563eb':'#d97706'} strokeWidth={2*scale} strokeDasharray={`${4*scale} ${3*scale}`} pointerEvents={placement?'none':'all'}
            onMouseDown={e=>{if(editable&&!placement&&!isPanGesture()){e.preventDefault();e.stopPropagation();}}}
            onMouseUp={e=>{if(editable&&!placement&&!isPanGesture())e.stopPropagation();}}
            onPointerDown={e=>{if(!editable||isPanGesture()||placement||e.button!==0)return;e.preventDefault();e.stopPropagation();useAppStore.getState().selectPlanOpening(o.id);}}
            onClick={e=>{if(!editable||placement)return;e.stopPropagation();useAppStore.getState().selectPlanOpening(o.id);}}/>
          <text x={(b.x1+b.x2)/2} y={(b.y1+b.y2)/2} fill="#d97706" fontSize={16*scale} pointerEvents="none">?</text>
          <title>{t('openingAi.deferred')}</title>
        </g>;
      }
      const g=preview?.id===o.id?preview.geometry:o.geometry!;
      const a=g.endpointA,b=g.endpointB,dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
      const angle=Math.atan2(dy,dx)*180/Math.PI;
      const preset=presetOf(o),color=colors[preset],active=selected===o.id;
      const uncertain=o.kind==='unknown'||o.mechanism==='unknown'||o.walkableAccess==='unknown'||o.approval.status==='rejected';
      const status=t(`openingTools.${o.approval.status}`)+(uncertain?` · ${t('openingTools.uncertain')}`:'');
      const type=o.kind==='door' && o.mechanism==='unknown' ? t('openingTools.unclassifiedDoor') : o.kind==='custom'?t('openingTools.custom'):t(`openingTools.${preset}`);
      const events={onPointerMove:move,onPointerUp:finish,onPointerCancel:()=>{drag.current=null;setPreview(null);},onMouseDown:stopMouse,onMouseUp:stopMouse,
        onClick:(e:React.MouseEvent<SVGElement>)=>{if(ownsGesture.current){ownsGesture.current=false;e.stopPropagation();if(editable&&!placement)useAppStore.getState().selectPlanOpening(o.id);}}};
      return <g key={o.id} data-opening-id={o.id} data-plan-child-interaction="true" {...events} style={{pointerEvents:placement?'none':undefined}}>
        <title>{o.label||type} · {status}</title>
        <g pointerEvents="none" transform={`translate(${a.x} ${a.y}) rotate(${angle})`} fill="none" stroke={color} strokeWidth={1.5*scale}>
          {preset==='window'&&<><line x1={0} y1={-3*scale} x2={length} y2={-3*scale}/><line x1={0} y1={3*scale} x2={length} y2={3*scale}/></>}
          {preset==='hinged'&&<path d={`M 0 0 L 0 ${-Math.min(length,20*scale)} M 0 ${-Math.min(length,20*scale)} Q ${Math.min(length,20*scale)} ${-Math.min(length,20*scale)} ${Math.min(length,20*scale)} 0`}/>}
          {preset==='sliding'&&<path d={`M ${length*.35} ${-7*scale} L ${length*.65} ${-7*scale} l ${-4*scale} ${-3*scale} m ${4*scale} ${3*scale} l ${-4*scale} ${3*scale}`}/>}
          {preset==='passage'&&<path d={`M ${length/2} ${-8*scale} L ${length/2} ${8*scale} m ${-3*scale} ${-4*scale} l ${3*scale} ${4*scale} l ${3*scale} ${-4*scale}`}/>}
          <line x1={0} y1={-5*scale} x2={0} y2={5*scale}/><line x1={length} y1={-5*scale} x2={length} y2={5*scale}/>
        </g>
        {active&&<line pointerEvents="none" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2563eb" strokeWidth={8*scale} opacity={.25}/>}
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={(active?3:2)*scale} strokeDasharray={o.approval.status==='approved'?undefined:`${5*scale} ${3*scale}`} pointerEvents="none"/>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14*scale} style={{cursor:editable?'move':undefined}} onPointerDown={e=>begin(e,o)} />
        <text x={(a.x+b.x)/2} y={(a.y+b.y)/2-12*scale} textAnchor="middle" direction={language==='he'?'rtl':'ltr'} fontSize={11*scale} fill={color} paintOrder="stroke" stroke="white" strokeWidth={3*scale} pointerEvents="none">{o.label||type}{active?` · ${status}`:uncertain?' ?':o.approval.status==='approved'?' ✓':''}</text>
        {active&&editable&&!placement&&(['endpointA','endpointB'] as const).map(endpoint=><circle key={endpoint} cx={g[endpoint].x} cy={g[endpoint].y} r={5*scale} fill="white" stroke="#2563eb" strokeWidth={2*scale} style={{cursor:'crosshair'}} onPointerDown={e=>begin(e,o,endpoint)}/>)}
      </g>;
    })}
    {placement?.start&&<g pointerEvents="none" stroke="#2563eb" strokeWidth={2*scale}>
      <circle cx={placement.start.x} cy={placement.start.y} r={5*scale} fill="white"/>
      {hoverPoint&&<line x1={placement.start.x} y1={placement.start.y} x2={hoverPoint.x} y2={hoverPoint.y} strokeDasharray={`${5*scale} ${3*scale}`}/>}
    </g>}
  </g>;
}
