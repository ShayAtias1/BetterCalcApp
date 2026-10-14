import { elementWorkKind, revisionWorkKinds } from '../../lib/revision/workClassification';
import { revisionTypeLabelKey } from './revisionTerminology';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { compareScaleFor, useCompareStore } from '../../store/compareStore';
import { useRevisionUi } from '../../lib/revision/revisionWorkflow';
import { changeNoteKey, elementLine, setElementLine, setWallFootprint, setOpeningFootprint, openingFootprint, openingFromFootprint, familyOf, retypeChange, editTypeOf, sidesOf, wallFromFootprint, type EditElementRef } from '../../lib/revision/changeEdit';
import { LANGUAGES, useLanguage, useT } from '../../i18n';
import { distancePx, polygonCentroid, round, snapOrtho } from '../../lib/geometry';
import AreaGeometryHandles from '../AreaGeometryHandles';
import AreaGeometryEdges from '../AreaGeometryEdges';
import { insertPolygonVertex, removePolygonVertex, reshapeArea, translateArea, rectanglePoints, closesPolygon } from '../../lib/areaGeometryEditing';
import { DEFAULT_AREA_KIND_COLORS, type Point } from '../../types';
import { analysisInputKey } from '../../lib/revision/detect';
import { PLAN_NAVIGATION_CANCEL } from '../../lib/interactionTargets';
import type { RevisionChange } from '../../types/revisionAnalysis';
import { isOpeningDifference, openingImpact, openingImpactReady } from '../../lib/revision/openingImpact';
import type { OpeningPortion } from '../../lib/revision/openingImpact';
import { isAiWallChange, wallHasFootprint, wallGeometryNeedsVerification } from '../../lib/revision/changeEdit';
import { editOpeningImpactFootprint } from '../../lib/revision/openingImpactEditing';
import type { RevisionLayer } from '../../types/compare';
import { openingWallFootprints } from '../../lib/revision/openingGeometry';
import { layoutNotePopup, layoutZoom, NOTE_POPUP, placeRevisionLabel, UNBOUNDED, type LabelBox } from '../../lib/revision/labelLayout';
import { relocationAnnotation } from '../../lib/revision/relocationAnnotation';
import type { AreaKind } from '../../types/compare';

interface AnnotationTarget { work: AreaKind; points: Point[] }

/** A general area note (e.g. "room boundary changed"): an annotation, never construction/demolition geometry. */
export function isRegionalNote(change: RevisionChange): boolean {
  return change.aiProposal?.changeType === 'room-boundary-changed' && !change.userType;
}

/** Scalloped architectural revision-cloud outline around a box, bulging outward. */
export function revisionCloudPath(box: { x: number; y: number; width: number; height: number }, zoom: number): string {
  const corners = [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y }, { x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height }];
  const bump = 12 / zoom;
  let d = `M${corners[0].x} ${corners[0].y}`;
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % 4];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.min(120, Math.max(1, Math.round(length / bump)));
    const r = (length / n) * 0.6;
    for (let k = 1; k <= n; k++) d += `A${r} ${r} 0 0 1 ${a.x + (b.x - a.x) * k / n} ${a.y + (b.y - a.y) * k / n}`;
  });
  return d + 'Z';
}

function annotationTargets(change: RevisionChange, portions: OpeningPortion[]): AnnotationTarget[] {
  if (portions.length) return portions.map(p => ({ work: p.areaKind, points: p.points }));
  if (familyOf(editTypeOf(change)) === 'other' && !change.walls.length && !change.doors.length) return [];
  return (['removed', 'added'] as const).flatMap(side => {
    const geometry = changeGeometry({ ...change, walls: change.walls.filter(w => w.side === side), doors: change.doors.filter(d => d.side === side),
      addedSegments: side === 'added' ? change.addedSegments : [], removedSegments: side === 'removed' ? change.removedSegments : [],
      aiProposal: change.aiProposal ? { ...change.aiProposal, before: side === 'removed' ? change.aiProposal.before : null,
        after: side === 'added' ? change.aiProposal.after : null } : undefined });
    const work = elementWorkKind(familyOf(editTypeOf(change)) === 'opening' ? 'doors' : 'walls', side);
    return geometry.map(points => ({ work, points }));
  });
}

function nearestTargetPoint(points: Point[], from: Point): Point {
  const candidates = points.flatMap((a, index) => {
    const b = points[(index + 1) % points.length];
    const dx = b.x - a.x, dy = b.y - a.y, lengthSq = dx * dx + dy * dy;
    const fraction = lengthSq ? Math.max(0, Math.min(1, ((from.x-a.x)*dx + (from.y-a.y)*dy) / lengthSq)) : 0;
    return [{ x: a.x + dx * fraction, y: a.y + dy * fraction }];
  });
  return candidates.reduce((best, point) => distancePx(from, point) < distancePx(from, best) ? point : best);
}

function annotationLeaders(targets: AnnotationTarget[], box: LabelBox) {
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  return (['demolition', 'construction'] as const).flatMap(work => {
    const points = targets.filter(target => target.work === work).map(target => nearestTargetPoint(target.points, from));
    return points.length ? [{ from, to: points.reduce((best,p)=>distancePx(from,p)<distancePx(from,best)?p:best), work }] : [];
  });
}

function arrowsCross(a: { from: Point; to: Point }, b: { from: Point; to: Point }): boolean {
  const side = (p: Point, q: Point, r: Point) => (q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  return side(a.from,a.to,b.from)*side(a.from,a.to,b.to)<0 && side(b.from,b.to,a.from)*side(b.from,b.to,a.to)<0;
}

function AnnotationLeader({ box, tip, work, zoom, selected, color }: { box: LabelBox; tip: Point; work: AreaKind; zoom: number; selected: boolean; color?: string }) {
  const colors = useRevisionColors();
  const stroke = color ?? colors[work];
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const dx = tip.x - center.x, dy = tip.y - center.y;
  const edge = Math.min(1, box.width / (2 * Math.abs(dx || 1e-9)), box.height / (2 * Math.abs(dy || 1e-9)));
  const start = { x: center.x + dx * edge, y: center.y + dy * edge };
  const length = distancePx(start, tip);
  if (length < 1e-9) return null;
  const ux = (tip.x-start.x)/length, uy = (tip.y-start.y)/length, head = Math.min(5/zoom,length/2);
  const base = { x: tip.x-ux*head, y: tip.y-uy*head };
  return <g className={`revision-annotation-leader ${work}`} pointerEvents="none">
    <line x1={start.x} y1={start.y} x2={base.x} y2={base.y} stroke={stroke} strokeWidth={(selected ? 1.1 : 0.8) / zoom} strokeLinecap="round" />
    <polygon points={[tip,{x:base.x-uy*head/2,y:base.y+ux*head/2},{x:base.x+uy*head/2,y:base.y-ux*head/2}].map(p=>`${p.x},${p.y}`).join(' ')} fill={stroke} />
  </g>;
}

function openingPortions(change: RevisionChange, revision: RevisionLayer | undefined, mpp: number): (OpeningPortion & { preview?: boolean; verified?: boolean })[] {
  const calculated = openingImpact(change, mpp).portions;
  if (calculated.length) return calculated;
  // A persisted approved quantity already carries the exact calculated footprint. Rendering it
  // must not depend on re-running a verification gate or the current page calibration.
  const saved = (revision?.measurements ?? []).flatMap(m => m.revisionChangeId === change.id && m.revisionElement?.list === 'doors'
    && m.revisionElement.part != null && m.areaKind && m.points.length >= 3 && m.centerline?.length === 2
    ? [{ areaKind: m.areaKind, points: m.points, centerline: m.centerline, wallLengthM: m.wallLengthM ?? 0,
      wallHeightM: m.wallHeightM ?? 0, areaM2: m.areaM2 ?? 0,
      element: { list: 'doors' as const, index: m.revisionElement.index, part: m.revisionElement.part } }] : []);
  if (saved.length) return saved;
  return openingWallFootprints(change).map(p => ({ ...p, preview: true,
    centerline: [change.doors[p.index].hinge, change.doors[p.index].jamb],
    wallLengthM: 0, wallHeightM: 0, areaM2: 0, element: { list: 'doors' as const, index: p.index, part: p.part } }));
}

function useRevisionColors() {
  const colors = useCompareStore(s => s.comparison?.areaKindColors) ?? DEFAULT_AREA_KIND_COLORS;
  return { ...colors, neutral: '#64748b' };
}

/**
 * Detected revision changes drawn directly on the plan, in source-page native px (the overlay svg's
 * own space): removed lines in the demolition color, added lines in the construction color, measured wall footprints filled, each region
 * boxed and numbered like its row in the review list. Clicking a region selects it.
 */
export default function RevisionChangeOverlay({ strokeW, zoom, interactive, editable, screenToNative, noteBounds, popupLayer }: {
  /** Topmost SVG group (last child of the plan svg) that expanded descriptions are portalled into. */
  popupLayer?: SVGGElement | null;
  strokeW: number;
  zoom: number;
  interactive: boolean;
  /** Manual correction (edit handles, placing a missed change) is available. */
  editable: boolean;
  screenToNative: (clientX: number, clientY: number) => Point;
  noteBounds: { left: number; top: number; right: number; bottom: number };
}) {
  const comparison = useCompareStore((s) => s.comparison);
  const currentPageKey = useCompareStore((s) => s.currentPageKey);
  const markersVisible = useRevisionUi((s) => s.markersVisible);
  const editingId = useRevisionUi((s) => s.editingChangeId);
  const selectedId = useRevisionUi((s) => s.selectedChangeId);
  const mergePreview = useRevisionUi(s => s.wallMergePreview);
  const placingType = useRevisionUi((s) => s.placingType);
  const placingWall = useRevisionUi((s) => s.placingWall);
  const selectedWalls = useRevisionUi(s => s.selectedWallRegions);
  const workColors = useRevisionColors();
  const revision = comparison?.revisions.find((r) => r.id === comparison.activeRevisionId);
  const previewRef = selectedWalls[0];
  const previewWall = revision?.analysis?.pages[currentPageKey]?.changes.find(c => c.id === previewRef?.changeId)?.walls[previewRef?.index ?? 0];
  const mergeColor = previewWall ? workColors[elementWorkKind('walls', previewWall.side)] : workColors.neutral;
  const [selectedPortion, setSelectedPortion] = useState<{ changeId: string; index: number; part: number } | null>(null);
  useEffect(() => setSelectedPortion(null), [comparison?.id, revision?.id, currentPageKey]);
  useEffect(() => { if (placingType) setSelectedPortion(null); }, [placingType]);
  const analysis = revision?.analysis?.pages[currentPageKey];
  const wallTopology = analysis?.changes.map(c => `${c.id}:${c.walls.length}`).join('|');
  useEffect(() => { useRevisionUi.setState({ selectedWallRegions: [], wallMergePreview: null }); }, [comparison?.id, revision?.id, currentPageKey, wallTopology]);
  const stale = !!analysis && !analysis.manualOnly && !!comparison && analysis.inputKey !== analysisInputKey(comparison, revision!.id, currentPageKey);
  const editing = editable && markersVisible && editingId === selectedId ? analysis?.changes.find((c) => c.id === editingId && c.status !== 'applied' && (!stale || c.manual || c.edited)) : undefined;
  return (
    <>
      {analysis && markersVisible && <ChangeMarkers key={`${comparison?.id}:${revision?.id}:${currentPageKey}`} changes={analysis.changes} strokeW={strokeW} zoom={zoom} interactive={interactive} noteBounds={noteBounds} popupLayer={popupLayer} onSelectPortion={setSelectedPortion} />}
      {editing && !mergePreview && <ChangeEditLayer change={editing} zoom={zoom} screenToNative={screenToNative}
        selectedPortion={selectedPortion?.changeId === editing.id ? selectedPortion : null} />}
      {mergePreview && markersVisible && mergePreview.comparisonId === comparison?.id && mergePreview.revisionId === revision?.id && mergePreview.pageKey === currentPageKey &&
        <g className="revision-wall-merge-preview" pointerEvents="none">
          <polygon points={mergePreview.footprint.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={mergeColor} strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`} />
          {mergePreview.connectors.map((points, i) => <polygon key={i} points={points.map(p => `${p.x},${p.y}`).join(' ')}
            fill={mergeColor} fillOpacity={0.5} stroke={mergeColor} strokeWidth={2 / zoom} />)}
        </g>}
      {editable && placingType && <PlacingLayer key={`${comparison?.id}:${revision?.id}:${currentPageKey}:${placingType}:${placingWall?.changeId}:${placingWall?.side}`}
        pageKey={currentPageKey} zoom={zoom} screenToNative={screenToNative} />}
    </>
  );
}

/**
 * A subtle architectural callout: a short note set off the change's corner with a thin leader and
 * arrowhead pointing at it. Sized in screen px (÷ zoom) inside the native-px overlay, so it follows
 * pan and zoom and never grows over the drawing when zooming in.
 */
function changeGeometry(change: RevisionChange): Point[][] {
  const elements = [
    ...change.walls.filter(w => !w.placeholder).map(w => isAiWallChange(change) && !wallHasFootprint(w) ? (w.centerline ?? []) : (w.footprint ?? [])),
    ...change.doors.filter(d => !d.placeholder).map(d => openingFootprint(d) ?? [d.hinge, d.jamb]),
  ].map(points => points.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))).filter(points => points.length);
  if (elements.length) return elements;
  const segments = [...change.addedSegments, ...change.removedSegments].map(s => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]);
  const proposals = [change.aiProposal?.before, change.aiProposal?.after].filter((points): points is [Point, Point] => !!points);
  return (segments.length ? segments : proposals).map(points => points.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))).filter(points => points.length);
}

function changeAnchor(change: RevisionChange): Point {
  const { x, y, width } = change.bbox;
  // Corrected geometry takes precedence over old detection segments and proposals.
  const points = changeGeometry(change).flat();
  return points.reduce((best, p) => p.x > best.x || (p.x === best.x && p.y < best.y) ? p : best, points[0] ?? { x: x + width, y });
}

let noteMeasureContext: CanvasRenderingContext2D | null | undefined;
function noteTextWidth(text: string, size: number, bold = false): number {
  if (typeof document === 'undefined') return text.length * size * 0.6;
  noteMeasureContext ??= document.createElement('canvas').getContext('2d');
  if (!noteMeasureContext) return text.length * size * 0.6;
  noteMeasureContext.font = `${bold ? '700' : '400'} ${size}px system-ui, sans-serif`;
  return noteMeasureContext.measureText(text).width;
}

function RelocationArrow({ from, to, zoom, color }: { from: Point; to: Point; zoom: number; color: string }) {
  const length = distancePx(from, to);
  const ux = (to.x - from.x) / length, uy = (to.y - from.y) / length;
  const head = Math.min(7 / zoom, length / 3);
  const base = { x: to.x - ux * head, y: to.y - uy * head };
  const arrow = [to, { x: base.x - uy * head / 2, y: base.y + ux * head / 2 },
    { x: base.x + uy * head / 2, y: base.y - ux * head / 2 }];
  return <g className="revision-relocation-arrow" pointerEvents="none">
    <line x1={from.x} y1={from.y} x2={base.x} y2={base.y} stroke="#fff" strokeWidth={3 / zoom} strokeOpacity={0.7} />
    <line x1={from.x} y1={from.y} x2={base.x} y2={base.y} stroke="#475569" strokeWidth={1.2 / zoom} strokeOpacity={0.9} strokeDasharray={`${4 / zoom} ${3 / zoom}`} />
    <polygon points={arrow.map(p => `${p.x},${p.y}`).join(' ')} fill="#475569" fillOpacity={0.9} />
    <circle cx={from.x} cy={from.y} r={2 / zoom} fill={color} />
  </g>;
}

function ChangeNote({ type, at, targets, regionTip, width, height, number, selected, expanded, zoom, onToggle }: {
  type: string; at: Point; targets: AnnotationTarget[]; regionTip?: Point;
  width: number; height: number; number: number; selected: boolean; expanded: boolean; zoom: number;
  onToggle?: () => void;
}) {
  const box = { x: at.x + 5 / zoom, y: at.y - 9 / zoom };
  const ink = '#1e293b';
  return (
    <g className="revision-change-note">
      {annotationLeaders(targets,{...box,width,height}).map(leader =>
        <AnnotationLeader key={leader.work} box={{...box,width,height}} tip={leader.to} work={leader.work} zoom={zoom} selected={selected} />)}
      {regionTip && <AnnotationLeader box={{...box,width,height}} tip={regionTip} work="construction" color="#64748b" zoom={zoom} selected={selected} />}
    <g className="revision-change-balloon" pointerEvents={onToggle ? 'auto' : 'none'}
      role={onToggle ? 'button' : undefined} tabIndex={onToggle ? 0 : undefined} aria-expanded={expanded} aria-label={`#${number} ${type}`}
      onClick={e => { e.stopPropagation(); onToggle?.(); }}
      onKeyDown={e => { if (onToggle && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); onToggle(); } }}
      onMouseDown={onToggle ? e => { e.stopPropagation(); e.preventDefault(); } : undefined}
      style={{ cursor: onToggle ? 'pointer' : undefined, outline: 'none', WebkitTapHighlightColor: 'transparent' }}>
      <title>{type}</title>
      <rect x={at.x + 5 / zoom} y={at.y - 9 / zoom} width={width} height={height}
        rx={10 / zoom} fill="#fff" fillOpacity={0.96} stroke="#64748b" strokeWidth={1 / zoom} />

      <text x={at.x + 5 / zoom + width / 2} y={at.y + 2 / zoom} textAnchor="middle" dominantBaseline="central"
        fontSize={11 / zoom} fontWeight={700} fontFamily="system-ui, sans-serif" fill={ink} direction="ltr">
        #{number}
      </text>
      </g>
    </g>
  );
}

/** Popup sits just below its bubble (above when there is no room); only the popup is clamped, never the bubble. */
export function notePopupPosition(bubble: LabelBox, width: number, height: number, bounds: { left: number; top: number; right: number; bottom: number }, zoom: number): Point {
  const gap = 3 / zoom;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const below = bubble.y + bubble.height + gap;
  return {
    x: clamp(bubble.x, bounds.left, Math.max(bounds.left, bounds.right - width)),
    y: below + height <= bounds.bottom ? below : clamp(bubble.y - gap - height, bounds.top, Math.max(bounds.top, bounds.bottom - height)),
  };
}

/** Floating description anchored to its numbered bubble; only the popup is clamped to the viewport. */
function ChangeNotePopup({ change, titleLines, lines, bubble, popupWidth, popupHeight, bounds, zoom, rtl, onToggle }: {
  change: RevisionChange; titleLines: string[]; lines: string[]; bubble: LabelBox; popupWidth: number; popupHeight: number;
  bounds: { left: number; top: number; right: number; bottom: number }; zoom: number; rtl: boolean; onToggle?: () => void;
}) {
  const colors = useRevisionColors();
  const t = useT();
  const work = revisionWorkKinds(change);
  const { x, y } = notePopupPosition(bubble, popupWidth, popupHeight, bounds, zoom);
  const { padding, titleSize, titleLine, bodySize, bodyLine, sectionGap } = NOTE_POPUP;
  // RTL text is right-aligned to the inner padding edge; LTR to the left one.
  const textX = rtl ? x + popupWidth - padding / zoom : x + padding / zoom;
  // Baselines sit ~80% down each line box so ascenders and descenders stay inside the padding.
  const titleBaseline = y + (padding + titleLine * 0.78) / zoom;
  const bodyTop = padding + titleLines.length * titleLine + sectionGap;
  const workTop = bodyTop + (lines.length ? lines.length * bodyLine + sectionGap : 0);
  const textDirection = { direction: rtl ? 'rtl' as const : 'ltr' as const, unicodeBidi: 'plaintext' as const };
  const ink = '#1e293b';
  return (
    <g className="revision-change-popup" data-revision-popup={change.id} pointerEvents={onToggle ? 'auto' : 'none'}
      onClick={e => { e.stopPropagation(); onToggle?.(); }}
      onMouseDown={onToggle ? e => { e.stopPropagation(); e.preventDefault(); } : undefined}
      style={{ cursor: onToggle ? 'pointer' : undefined }}>
      <rect x={x} y={y} width={popupWidth} height={popupHeight} rx={3 / zoom} fill="#fff" fillOpacity={1} stroke="#64748b" strokeWidth={1 / zoom} />
      <text x={textX} y={titleBaseline} direction={rtl ? 'rtl' : 'ltr'} textAnchor="start" style={textDirection}
        fontSize={titleSize / zoom} fontWeight={700} fontFamily="system-ui, sans-serif" fill={ink} stroke="#fff" strokeWidth={3 / zoom} paintOrder="stroke" strokeLinejoin="round">
        {titleLines.map((line, i) => <tspan key={i} x={textX} dy={i ? titleLine / zoom : 0}>{line}</tspan>)}
      </text>
      {lines.length > 0 && <text x={textX} y={y + (bodyTop + bodyLine * 0.78) / zoom} direction={rtl ? 'rtl' : 'ltr'} textAnchor="start" style={textDirection}
        fontSize={bodySize / zoom} fontFamily="system-ui, sans-serif" fill={ink} stroke="#fff" strokeWidth={3 / zoom} paintOrder="stroke" strokeLinejoin="round">
        {lines.map((line, i) => <tspan key={i} x={textX} dy={i ? bodyLine / zoom : 0}>{line}</tspan>)}
      </text>}
      <text x={textX} y={y + (workTop + bodyLine * 0.78) / zoom} direction={rtl ? 'rtl' : 'ltr'} textAnchor="start" style={textDirection}
        fontSize={bodySize / zoom} fontWeight={700} fontFamily="system-ui, sans-serif" stroke="#fff" strokeWidth={3 / zoom} paintOrder="stroke">
        {work.map((kind, i) => <tspan key={kind} fill={colors[kind]}>{i ? ' · ' : ''}{t(`revisionAi.work.${kind}`)}</tspan>)}
      </text>
    </g>
  );
}

function noteBubbleSize(number: number, zoom: number) {
  return { width: (26 + String(number).length * 6) / zoom, height: 22 / zoom };
}

/** Bubble centres for every change, laid out once per zoom step in change order without hiding any. */
function layoutChangeNotes(changes: RevisionChange[], revision: RevisionLayer | undefined, mpp: number, zoom: number) {
  const occupied: LabelBox[] = [];
  const occupiedArrows: { from: Point; to: Point }[] = changes.flatMap(c => {
    const movement = relocationAnnotation(c);
    return movement ? [{ from: movement.from, to: movement.to }] : [];
  });
  const geometry = changes.flatMap(c => {
    const elements = changeGeometry(c);
    return elements.length ? elements.map(points => {
      const xs = points.map(p => p.x), ys = points.map(p => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }) : [c.bbox];
  });
  return new Map(changes.map((c, i) => {
    const regional = isRegionalNote(c);
    const targets = regional ? [] : annotationTargets(c, openingPortions(c, revision, mpp));
    const { width, height } = noteBubbleSize(i + 1, zoom);
    const centers = targets.map(target => target.points.length >= 3 ? polygonCentroid(target.points)
      : { x: target.points.reduce((sum,p)=>sum+p.x,0)/target.points.length, y:target.points.reduce((sum,p)=>sum+p.y,0)/target.points.length });
    const anchor = new Set(targets.map(target => target.work)).size > 1
      ? { x:centers.reduce((sum,p)=>sum+p.x,0)/centers.length, y:centers.reduce((sum,p)=>sum+p.y,0)/centers.length }
      : changeAnchor(c);
    const position = placeRevisionLabel(anchor, width, height, zoom, occupied, geometry, UNBOUNDED, box =>
      annotationLeaders(targets,box).reduce((score,leader)=>score+occupiedArrows.filter(other=>arrowsCross(leader,other)).length*40,0));
    occupiedArrows.push(...annotationLeaders(targets,{...position,width,height}));
    occupied.push({ ...position, width, height });
    return [c.id, { center: { x: position.x + width / 2, y: position.y + height / 2 }, targets, regional }] as const;
  }));
}

function ChangeMarkers({ changes, strokeW, zoom, interactive, noteBounds, popupLayer, onSelectPortion }: { popupLayer?: SVGGElement | null; changes: RevisionChange[]; strokeW: number; zoom: number; interactive: boolean; noteBounds: { left: number; top: number; right: number; bottom: number }; onSelectPortion: (ref: { changeId: string; index: number; part: number } | null) => void }) {
  const colors = useRevisionColors();
  const t = useT();
  const comparison = useCompareStore(s => s.comparison);
  const currentPageKey = useCompareStore(s => s.currentPageKey);
  const scale = compareScaleFor(comparison, currentPageKey);
  const revision = comparison?.revisions.find(r => r.id === comparison.activeRevisionId);
  const language = useLanguage();
  const rtl = LANGUAGES[language].dir === 'rtl';
  // Note keys are built from the change type (all present in both dictionaries).
  const note = t as unknown as (key: string) => string;
  const selectedId = useRevisionUi((s) => s.selectedChangeId);
  const selectChange = useRevisionUi((s) => s.selectChange);
  const selectedWalls = useRevisionUi(s => s.selectedWallRegions);
  const selectWallRegion = useRevisionUi(s => s.selectWallRegion);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const numbers = new Map(changes.map((c, i) => [c.id, i + 1]));
  // The review-list filter never hides annotations on the drawing.
  const shown = changes;
  const mpp = scale.state === 'calibrated' ? scale.metersPerPixel : 0;
  const zoomStep = layoutZoom(zoom);
  // Bubble layout ignores pan and expansion and reruns only when the changes or the zoom step change.
  const layout = useMemo(() => layoutChangeNotes(changes, revision, mpp, zoomStep), [changes, revision, mpp, zoomStep]);
  const notes = new Map(shown.map(c => {
    const key = changeNoteKey(c);
    const editType = editTypeOf(c);
    const wallLabel = language === 'he' && (editType === 'wall-added' || editType === 'wall-removed');
    const type = wallLabel ? t(revisionTypeLabelKey(editType, comparison?.context, language))
      : key ? note(key) : t(`revisionAi.categories.${c.category}`);
    const number = numbers.get(c.id) ?? 0;
    const expanded = expandedNoteId === c.id;
    const { center, targets, regional } = layout.get(c.id)!;
    // Layout never depends on expansion: the description is a floating popup, so expanding or collapsing
    // cannot move any other label or arrow.
    const { width, height } = noteBubbleSize(number, zoom);
    // Popup size comes from the wrapped, measured content in screen px.
    const popup = expanded ? layoutNotePopup(`#${number} ${type}`, wallLabel ? type : c.ai?.summary || type,
      revisionWorkKinds(c).map(k => t(`revisionAi.work.${k}`)).join(' · '), (noteBounds.right - noteBounds.left) * zoom, noteTextWidth) : null;
    const titleLines = popup?.titleLines ?? [];
    const lines = popup?.lines ?? [];
    const popupWidth = (popup?.width ?? 0) / zoom;
    const popupHeight = (popup?.height ?? 0) / zoom;
    const position = { x: center.x - width / 2, y: center.y - height / 2 };
    const at = { x: position.x - 5 / zoom, y: position.y + 9 / zoom };
    const regionTip = regional ? nearestTargetPoint([{ x: c.bbox.x, y: c.bbox.y }, { x: c.bbox.x + c.bbox.width, y: c.bbox.y },
      { x: c.bbox.x + c.bbox.width, y: c.bbox.y + c.bbox.height }, { x: c.bbox.x, y: c.bbox.y + c.bbox.height }],
      { x: position.x + width / 2, y: position.y + height / 2 }) : undefined;
    return [c.id, { type, titleLines, lines, at, targets, regionTip, width, height, number, expanded, popupWidth, popupHeight }] as const;
  }));

  const pick = (id: string) => (e: MouseEvent) => {
    e.stopPropagation();
    onSelectPortion(null);
    selectChange(id);
  };
  const stop = (e: MouseEvent) => { if (e.button === 0) e.stopPropagation(); };
  const toggleNote = (id: string) => interactive ? () => {
    onSelectPortion(null);
    selectChange(id);
    setExpandedNoteId(current => current === id ? null : id);
  } : undefined;

  return (
    <g className="revision-change-overlay">
      {[...shown.filter(isRegionalNote), ...shown.filter(c => !isRegionalNote(c))].map((c) => {
        const regional = isRegionalNote(c);
        const movement = relocationAnnotation(c);
        const elementColor = (list: 'walls' | 'doors', side: 'removed' | 'added') => colors[elementWorkKind(list, side)];
        const impactColor = (portion: OpeningPortion) => colors[portion.areaKind];
        const work = revisionWorkKinds(c);
        const color = work.length === 1 ? colors[work[0]] : colors.neutral;
        const lineWork = (side: 'added' | 'removed') => elementColor(familyOf(editTypeOf(c)) === 'opening' ? 'doors' : 'walls', side);
        const isSelected = c.id === selectedId;
        const openingDifference = isOpeningDifference(c);
        const impact = openingDifference || c.doors.some(d => d.footprint) ? openingPortions(c, revision, scale.state === 'calibrated' ? scale.metersPerPixel : 0) : [];
        const hit = interactive && !regional ? { onClick: pick(c.id), onMouseDown: stop, style: { pointerEvents: 'auto' as const, cursor: 'pointer' as const } } : {};
        // Exact geometry owns selection; the location box is a fallback only.
        const hasGeometry = c.walls.length || c.doors.length || c.addedSegments.length || c.removedSegments.length || c.aiProposal?.before || c.aiProposal?.after;
        // AI-located lines that were not verified in the drawing are drawn dashed: a location, not a measurement.
        const segDash = wallGeometryNeedsVerification(c) || (openingDifference && !openingImpactReady(c)) || (c.aiProposal && c.aiProposal.verification !== 'verified' && !c.edited) ? `${5 / zoom} ${4 / zoom}` : undefined;
        return (
          <g key={c.id} data-revision-change-id={c.id} pointerEvents={regional ? 'none' : undefined}>
            {(impact.length ? [] : c.walls).map((w, i) => (
              isAiWallChange(c) && !wallHasFootprint(w) ? (Array.isArray(w.centerline) && w.centerline.length === 2 && w.centerline.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y)) ?
                <line key={`w${i}`} x1={w.centerline[0].x} y1={w.centerline[0].y} x2={w.centerline[1].x} y2={w.centerline[1].y}
                  stroke={elementColor('walls', w.side)} strokeWidth={1.6 / zoom}
                  strokeDasharray={`${5 / zoom} ${4 / zoom}`} {...hit} /> : null) :
              <polygon key={`w${i}`} points={w.footprint.map((p) => `${p.x},${p.y}`).join(' ')}
                fill={elementColor('walls', w.side)} fillOpacity={selectedWalls.some(ref => ref.changeId === c.id && ref.index === i) ? 0.25 : isSelected ? 0.12 : 0.06} stroke={elementColor('walls', w.side)} strokeWidth={(isSelected || selectedWalls.some(ref => ref.changeId === c.id && ref.index === i) ? 2.2 : 1.6) / zoom} strokeDasharray={segDash ?? (w.placeholder ? `${5 / zoom} ${4 / zoom}` : undefined)} {...hit}
                onClick={interactive ? e => { e.stopPropagation(); onSelectPortion(null); selectWallRegion(c.id, i, e.shiftKey || e.ctrlKey || e.metaKey); } : undefined} />
            ))}
            {(c.edited || c.walls.some(w => w.side === 'removed') || c.doors.some(d => d.side === 'removed') ? [] : c.removedSegments).map((s, i) => (
              <g key={`r${i}`}>
                <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="transparent" strokeWidth={12 / zoom} strokeLinecap="round" {...hit} />
                <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={lineWork('removed')} strokeWidth={(isSelected ? 2.2 : 1.6) / zoom} strokeLinecap="round" strokeDasharray={segDash} {...hit} />
              </g>
            ))}
            {(c.edited || c.walls.some(w => w.side === 'added') || c.doors.some(d => d.side === 'added') ? [] : c.addedSegments).map((s, i) => (
              <g key={`a${i}`}>
                <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="transparent" strokeWidth={12 / zoom} strokeLinecap="round" {...hit} />
                <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={lineWork('added')} strokeWidth={(isSelected ? 2.2 : 1.6) / zoom} strokeLinecap="round" strokeDasharray={segDash} {...hit} />
              </g>
            ))}
            {c.doors.map((d, i) => openingFootprint(d) ? <polygon key={`opening-${i}`}
              points={openingFootprint(d)!.map(p => `${p.x},${p.y}`).join(' ')}
              fill={openingDifference ? colors.neutral : elementColor('doors', d.side)} fillOpacity={isSelected ? 0.1 : 0.04}
              stroke={openingDifference ? colors.neutral : elementColor('doors', d.side)} strokeWidth={(isSelected ? 2 : 1.4) / zoom}
              strokeDasharray={d.geometryVerified === false || d.placeholder ? `${4 / zoom} ${4 / zoom}` : undefined} {...hit} /> : (
              <g key={`d${i}`}>
              <line x1={d.hinge.x} y1={d.hinge.y} x2={d.jamb.x} y2={d.jamb.y}
                stroke="transparent" strokeWidth={12 / zoom} {...hit} />
              <line x1={d.hinge.x} y1={d.hinge.y} x2={d.jamb.x} y2={d.jamb.y}
                stroke={openingDifference ? colors.neutral : colors[elementWorkKind('doors', d.side)]} strokeWidth={(isSelected ? 2.2 : 1.6) / zoom} strokeDasharray={segDash ?? (d.placeholder ? `${5 / zoom} ${4 / zoom}` : undefined)} strokeLinecap="round" {...hit} />
              {!segDash && !d.placeholder && [d.hinge, d.jamb].map((p, endpoint) => <circle key={endpoint} cx={p.x} cy={p.y} r={2 / zoom}
                fill={openingDifference ? colors.neutral : colors[elementWorkKind('doors', d.side)]} pointerEvents="none" />)}
              </g>
            ))}
            {!c.walls.length && !c.doors.length && c.aiProposal && (['before', 'after'] as const).map((side) => {
              const line = c.aiProposal![side];
              if (!c.edited && (side === 'before' ? c.removedSegments.length : c.addedSegments.length)) return null;
              return line && <g key={side}>
                <line x1={line[0].x} y1={line[0].y} x2={line[1].x} y2={line[1].y} stroke="transparent" strokeWidth={12 / zoom} {...hit} />
                <line x1={line[0].x} y1={line[0].y} x2={line[1].x} y2={line[1].y}
                  stroke={lineWork(side === 'before' ? 'removed' : 'added')} strokeWidth={(isSelected ? 2.2 : 1.6) / zoom} strokeDasharray={segDash} {...hit} />
              </g>;
            })}
            {regional && <g className="revision-cloud" data-revision-cloud={c.id}>
              {/* Only the outline is interactive; the interior never intercepts clicks. */}
              <path d={revisionCloudPath(c.bbox, zoom)} fill="none" stroke={colors.neutral} strokeWidth={(isSelected ? 1.1 : 0.7) / zoom}
                strokeOpacity={isSelected ? 0.85 : 0.5} strokeLinejoin="round" pointerEvents="none" />
              {interactive && <path d={revisionCloudPath(c.bbox, zoom)} fill="none" stroke="transparent" strokeWidth={10 / zoom}
                data-revision-cloud-hit={c.id} onClick={pick(c.id)} onMouseDown={stop} style={{ pointerEvents: 'stroke', cursor: 'pointer' }} />}
            </g>}
            {!regional && <rect x={c.bbox.x} y={c.bbox.y} width={c.bbox.width} height={c.bbox.height} rx={4 / zoom}
              fill="transparent"
              stroke={!c.walls.length && !c.doors.length && !c.aiProposal && !c.addedSegments.length && !c.removedSegments.length ? color : 'none'} strokeWidth={strokeW * 0.8} strokeDasharray={`${4 / zoom} ${4 / zoom}`} data-revision-hit="area" {...(hasGeometry ? { style: { pointerEvents: 'none' as const } } : hit)} />}
            {impact.map((portion, i) => <polygon key={`opening-impact-${i}`} points={portion.points.map(p => `${p.x},${p.y}`).join(' ')}
              fill={impactColor(portion)} fillOpacity={isSelected ? 0.2 : 0.12}
              stroke={impactColor(portion)} strokeWidth={(isSelected ? 2.2 : 1.8) / zoom} {...hit}
              strokeDasharray={portion.preview && !portion.verified ? `${4 / zoom} ${4 / zoom}` : undefined}
              onClick={interactive ? e => {
                e.stopPropagation();
                selectChange(c.id);
                onSelectPortion(portion.preview ? null : { changeId: c.id, index: portion.element.index, part: portion.element.part });
              } : undefined}>
              <title>{portion.preview ? t(`areaKinds.${portion.areaKind}`) : `${t(`areaKinds.${portion.areaKind}`)} · ${portion.wallLengthM} ${t('units.m')} × ${portion.wallHeightM} ${t('units.m')} = ${portion.areaM2} ${t('units.m2')}`}</title>
            </polygon>)}
            {movement && <RelocationArrow from={movement.from} to={movement.to} zoom={zoom} color={elementColor(familyOf(editTypeOf(c)) === 'opening' ? 'doors' : 'walls', 'removed')} />}
            <ChangeNote {...notes.get(c.id)!} selected={isSelected} zoom={zoom} onToggle={toggleNote(c.id)} />
          </g>
        );
      })}
      {/* Descriptions float above the drawing and never take part in label layout. */}
      {(() => {
        const popups = shown.map(c => {
          const n = notes.get(c.id)!;
          if (!n.expanded) return null;
          return <ChangeNotePopup key={`popup-${c.id}`} change={c} titleLines={n.titleLines} lines={n.lines}
            bubble={{ x: n.at.x + 5 / zoom, y: n.at.y - 9 / zoom, width: n.width, height: n.height }}
            popupWidth={n.popupWidth} popupHeight={n.popupHeight} bounds={noteBounds} zoom={zoom} rtl={rtl} onToggle={toggleNote(c.id)} />;
        });
        // SVG paints in document order: the popup layer is the last child of the plan svg, above geometry, arrows and handles.
        return popupLayer ? createPortal(<>{popups}</>, popupLayer) : popups;
      })()}
    </g>
  );
}

const stopMouse = (e: MouseEvent) => e.stopPropagation();

/** Wall footprints use the takeoff polygon editor: independent corners and whole-polygon moves.
 * Openings retain their endpoint editor. Both use native page coordinates and the same edit burst. */
function ChangeEditLayer({ change, zoom, screenToNative, selectedPortion }: { change: RevisionChange; zoom: number; screenToNative: (x: number, y: number) => Point; selectedPortion: { index: number; part: number } | null }) {
  const colors = useRevisionColors();
  const comparison = useCompareStore((s) => s.comparison);
  const orthoSnap = useCompareStore((s) => s.orthoSnap);
  const editRevisionChange = useCompareStore((s) => s.editRevisionChange);
  const finishRevisionChangeEdit = useCompareStore((s) => s.finishRevisionChangeEdit);
  const editSide = useRevisionUi((s) => s.editSide);
  const scale = compareScaleFor(comparison, change.pageNumber);
  const mpp = scale.state === 'calibrated' ? scale.metersPerPixel : 0;

  const draft = !change.aiProposal && !change.walls.length && !change.doors.length ? retypeChange(change, editTypeOf(change), mpp) : change;
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => { dragCleanup.current?.(); }, [change.id]);

  const revision = comparison?.revisions.find(r => r.id === comparison.activeRevisionId);
  const impacts = openingPortions(change, revision, mpp);
  const portion = selectedPortion && impacts.find(p =>
    p.element.index === selectedPortion.index && p.element.part === selectedPortion.part);
  const refs: EditElementRef[] = portion ? [portion.element] : [
    ...draft.walls.flatMap((w, index) => !isAiWallChange(draft) || wallHasFootprint(w) ? [{ list: 'walls' as const, index }] : []),
    ...(editSide === 'both' && isOpeningDifference(draft) && impacts.length && impacts.every(p => !p.preview)
      ? impacts.map(p => p.element)
      : draft.doors.flatMap((d, index) => openingFootprint(d) ? [{ list: 'doors' as const, index }] : [])),
  ];
  const sideOf = (ref: EditElementRef) => (ref.list === 'walls' ? draft.walls[ref.index].side : draft.doors[ref.index].side);
  const shown = refs.filter((ref) => editSide === 'both' || sideOf(ref) === editSide);

  const beginDrag = (ref: EditElementRef, handle: 'a' | 'b' | 'move' | number) => (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (ref.list === 'walls' && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      useRevisionUi.getState().selectWallRegion(change.id, ref.index, true);
      return;
    }
    const line = elementLine(draft, ref);
    if (!line) return;
    dragCleanup.current?.();
    const activePortion = ref.part != null ? impacts.find(p => p.element.index === ref.index && p.element.part === ref.part) : undefined;
    const footprint = activePortion ? activePortion.points : ref.list === 'walls' ? draft.walls[ref.index].footprint : openingFootprint(draft.doors[ref.index]);
    const start = screenToNative(e.clientX, e.clientY);
    const snapTargets = refs.filter((r) => r.list !== ref.list || r.index !== ref.index).flatMap((r) => elementLine(draft, r) ?? []);
    const snapR = 8 / zoom;
    const { pageNumber, id } = change;
    let moved = false;
    const move = (ev: globalThis.MouseEvent) => {
      let p = screenToNative(ev.clientX, ev.clientY);
      if (!moved && distancePx(start, p) * zoom < 2) return;
      moved = true;
      if (footprint) {
        const points = handle === 'move'
          ? translateArea(footprint, { x: p.x - start.x, y: p.y - start.y })
          : typeof handle === 'number' ? reshapeArea(footprint, handle, p, ref.list === 'doors'
            ? { polygon: draft.doors[ref.index].footprintShape === 'polygon' } : { polygon: true }) : null;
        if (points && activePortion && ref.part != null) {
          editRevisionChange(pageNumber, id, c => editOpeningImpactFootprint({ ...c, doors: draft.doors }, activePortion, points, handle === 'move'), true);
          return;
        }
        if (points && ref.list === 'doors') {
          editRevisionChange(pageNumber, id, c => setOpeningFootprint(c, ref.index, points), true);
          return;
        }
        if (points) editRevisionChange(pageNumber, id, (c) => setWallFootprint(
          !c.walls.length && !c.doors.length ? retypeChange(c, editTypeOf(c), mpp) : c, ref.index, points), true);
        return;
      }
      let [a, b] = line;
      if (handle === 'move') {
        const dx = p.x - start.x;
        const dy = p.y - start.y;
        a = { x: a.x + dx, y: a.y + dy };
        b = { x: b.x + dx, y: b.y + dy };
      } else {
        const fixed = handle === 'a' ? line[1] : line[0];
        const near = snapTargets.find((q) => distancePx(q, p) <= snapR);
        if (near) p = near;
        else if (ev.shiftKey || orthoSnap) p = snapOrtho(fixed, p);
        if (handle === 'a') a = p;
        else b = p;
      }
      editRevisionChange(pageNumber, id, (c) => setElementLine(!c.walls.length && !c.doors.length ? retypeChange(c, editTypeOf(c), mpp) : c, ref, a, b), true);
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener(PLAN_NAVIGATION_CANCEL, cleanup);
      dragCleanup.current = null;
    };
    const up = () => {
      cleanup();
      if (moved) finishRevisionChangeEdit();
    };
    dragCleanup.current = up;
    window.addEventListener(PLAN_NAVIGATION_CANCEL, cleanup);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <g className="revision-change-edit" data-plan-child-interaction="revision-edit">
      {shown.map((ref) => {
        const activePortion = ref.part != null ? impacts.find(p => p.element.index === ref.index && p.element.part === ref.part) : undefined;
        const openingShape = ref.list === 'doors' && ref.part == null ? openingFootprint(draft.doors[ref.index]) : null;
        if (openingShape) {
          // A relocated opening's infill/removal can cover its entire source footprint.
          // Match the topmost visible polygon, rather than the opposite source-opening side.
          const visibleImpact = impacts.find(p => p.element.index === ref.index
            && p.points.length === openingShape.length
            && openingShape.every(a => p.points.some(b => distancePx(a, b) < 1e-6)));
          // Handles take the color of the polygon they edit: the visible work portion, else the same
          // element work kind the overlay fills with — never the before/after version alone.
          const color = visibleImpact ? colors[visibleImpact.areaKind]
            : isOpeningDifference(draft) ? colors.neutral : colors[elementWorkKind('doors', sideOf(ref))];
          return <g key={`opening-${ref.index}`} onClick={stopMouse}>
            <polygon points={openingShape.map(p => `${p.x},${p.y}`).join(' ')} fill="transparent" pointerEvents="all"
              style={{ cursor: 'move' }} onMouseDown={beginDrag(ref, 'move')} />
            {draft.doors[ref.index].footprintShape === 'polygon' && <AreaGeometryEdges points={openingShape} color={color} zoom={zoom}
              onInsert={(index, event, midpoint) => {
                if (event.button !== 0) return;
                event.stopPropagation(); event.preventDefault();
                const a = openingShape[index], b = openingShape[(index + 1) % openingShape.length];
                const points = insertPolygonVertex(openingShape, index, midpoint ? { x: (a.x+b.x)/2, y: (a.y+b.y)/2 } : screenToNative(event.clientX, event.clientY));
                if (points) editRevisionChange(change.pageNumber, change.id, c => setOpeningFootprint(c, ref.index, points));
              }} />}
            <AreaGeometryHandles points={openingShape} color={color} zoom={zoom} polygon={draft.doors[ref.index].footprintShape === 'polygon'}
              onHandleMouseDown={(index, event) => {
                if (event.altKey && draft.doors[ref.index].footprintShape === 'polygon') {
                  event.stopPropagation(); event.preventDefault();
                  const points = removePolygonVertex(openingShape, index);
                  if (points) editRevisionChange(change.pageNumber, change.id, c => setOpeningFootprint(c, ref.index, points));
                } else beginDrag(ref, index)(event);
              }} />
          </g>;
        }
        if (activePortion) {
          const color = colors[activePortion.areaKind];
          return <g key={`impact-${ref.index}-${ref.part}`} onClick={stopMouse}>
            <polygon points={activePortion.points.map(p => `${p.x},${p.y}`).join(' ')}
              fill="transparent" pointerEvents="all" style={{ cursor: 'move' }}
              onMouseDown={beginDrag(ref, 'move')} />
            <AreaGeometryHandles points={activePortion.points} color={color} zoom={zoom}
              onHandleMouseDown={(index, event) => beginDrag(ref, index)(event)} />
          </g>;
        }
        const [a, b] = elementLine(draft, ref)!;
        const color = colors[elementWorkKind(ref.list, sideOf(ref))];
        const isWindow = ref.list === 'doors' && draft.doors[ref.index].opening === 'window';
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const key = `${ref.list}${ref.index}`;
        return (
          <g key={key}>
            {ref.list === 'walls' ? <polygon
              points={draft.walls[ref.index].footprint.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="transparent" stroke={draft !== change ? color : 'none'} strokeWidth={1.5 / zoom}
              strokeDasharray={draft !== change || draft.walls[ref.index].placeholder || (change.aiProposal && change.aiProposal.verification !== 'verified' && !change.edited) ? `${4 / zoom} ${4 / zoom}` : undefined}
              style={{ pointerEvents: 'all', cursor: 'move' }} onMouseDown={beginDrag(ref, 'move')} onClick={stopMouse} /> : <>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={draft !== change ? color : 'none'} strokeWidth={1 / zoom} strokeLinecap="round"
                strokeDasharray={draft !== change || isWindow || draft.doors[ref.index].placeholder ? `${5 / zoom} ${4 / zoom}` : undefined} />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={12 / zoom}
                style={{ pointerEvents: 'stroke', cursor: 'move' }} onMouseDown={beginDrag(ref, 'move')} onClick={stopMouse} />
            </>}
            {mpp > 0 && (change.edited || change.walls.length > 0 || change.doors.length > 0) && (
              <text x={mid.x + (sideOf(ref) === 'removed' ? -10 : 10) / zoom} y={mid.y - 8 / zoom} textAnchor={sideOf(ref) === 'removed' ? 'end' : 'start'} fontSize={10 / zoom} fontWeight={700} fill={color}
                stroke="#fff" strokeWidth={3 / zoom} paintOrder="stroke" direction="ltr" style={{ pointerEvents: 'none' }}>
                {round(distancePx(a, b) * mpp, 2)} m
              </text>
            )}
            {ref.list === 'walls' ? <g onClick={stopMouse} data-revision-wall-handles={ref.index}>
              <AreaGeometryEdges points={draft.walls[ref.index].footprint} color={color} zoom={zoom}
                onInsert={(index, event, midpoint) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  event.preventDefault();
                  const footprint = draft.walls[ref.index].footprint;
                  const a = footprint[index], b = footprint[(index + 1) % footprint.length];
                  const points = insertPolygonVertex(footprint, index, midpoint ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : screenToNative(event.clientX, event.clientY));
                  if (points) editRevisionChange(change.pageNumber, change.id, c => setWallFootprint(
                    !c.walls.length && !c.doors.length ? retypeChange(c, editTypeOf(c), mpp) : c, ref.index, points));
                }} />
              <AreaGeometryHandles points={draft.walls[ref.index].footprint} color={color} zoom={zoom} polygon
                onHandleMouseDown={(index, event) => {
                  if (event.button !== 0) return;
                  if (event.altKey) {
                    event.stopPropagation();
                    event.preventDefault();
                    const points = removePolygonVertex(draft.walls[ref.index].footprint, index);
                    if (points) editRevisionChange(change.pageNumber, change.id, c => setWallFootprint(c, ref.index, points));
                  } else beginDrag(ref, index)(event);
                }} />
            </g> : <g onClick={stopMouse}>
              <AreaGeometryHandles points={[a, b]} color={color} zoom={zoom} polygon
                onHandleMouseDown={(index, event) => beginDrag(ref, index === 0 ? 'a' : 'b')(event)} />
            </g>}
          </g>
        );
      })}
    </g>
  );
}

/** Wall and opening drafts share rectangle/polygon tools and stay outside the document until complete. */
function PlacingLayer({ pageKey, zoom, screenToNative }: {
  pageKey: number; zoom: number; screenToNative: (x: number, y: number) => Point;
}) {
  const colors = useRevisionColors();
  const t = useT();
  const type = useRevisionUi((s) => s.placingType)!;
  const target = useRevisionUi((s) => s.placingWall);
  const mode = useRevisionUi((s) => s.openingDrawingMode);
  const addManualRevisionChange = useCompareStore((s) => s.addManualRevisionChange);
  const editRevisionChange = useCompareStore((s) => s.editRevisionChange);
  const orthoSnap = useCompareStore((s) => s.orthoSnap);
  const [points, setPoints] = useState<Point[]>([]);
  const [footprints, setFootprints] = useState<Point[][]>([]);
  const [shapes, setShapes] = useState<('rectangle' | 'polygon')[]>([]);
  const [hover, setHover] = useState<Point | null>(null);
  const [error, setError] = useState(false);
  const wall = type.startsWith('wall');
  const opening = familyOf(type) === 'opening';
  const drawingFootprint = wall || opening;
  const sides = target && !opening ? [target.side] : sidesOf(type);
  const [openingSide, setOpeningSide] = useState(target?.side ?? sides[0]);
  const side = openingSide;
  const color = colors[elementWorkKind(opening ? 'doors' : 'walls', side ?? 'added')];
  const cancel = () => useRevisionUi.setState({ placingType: null, placingWall: null });
  useEffect(() => { setPoints([]); setHover(null); setError(false); }, [mode]);

  const nativePoint = (e: MouseEvent) => {
    const point = screenToNative(e.clientX, e.clientY);
    return points.length && !(drawingFootprint && mode === 'rectangle') && (e.shiftKey || orthoSnap)
      ? snapOrtho(points[points.length - 1], point) : point;
  };
  const finish = (id: string | null) => {
    if (!id) { setError(true); return; }
    useRevisionUi.setState({ placingType: null, placingWall: null, editingChangeId: id, selectedChangeId: id, editSide: 'both' });
  };
  const complete = (outline: Point[]) => {
    const drawnWall = wall ? wallFromFootprint(side, outline) : null;
    const drawnOpening = opening ? openingFromFootprint(side, outline,
      type.startsWith('window') ? 'window' : type.startsWith('door') ? 'door' : undefined, mode) : null;
    if (!drawnWall && !drawnOpening) { setError(true); return; }
    if (target) {
      editRevisionChange(pageKey, target.changeId, c => {
        if (drawnWall) return { ...c, walls: [...c.walls.filter(w => !isAiWallChange(c) || w.side !== side || wallHasFootprint(w)), drawnWall] };
        if (!drawnOpening) return c;
        const index = c.doors.findIndex(d => d.side === side);
        return index >= 0 ? setOpeningFootprint({ ...c, doors: c.doors.map((d,i) => i === index ? { ...d, footprintShape: mode } : d) }, index, outline)
          : { ...c, doors: [...c.doors, drawnOpening] };
      });
      finish(target.changeId);
    } else {
      const completed = [...footprints], completedShapes = [...shapes];
      const index = sides.indexOf(side);
      completed[index] = outline; completedShapes[index] = mode;
      if (sides.every((_, i) => completed[i])) finish(addManualRevisionChange(pageKey, type, outline[0], completed, completedShapes));
      else {
        setFootprints(completed); setShapes(completedShapes); setPoints([]); setHover(null); setError(false);
        setOpeningSide(sides.find((_, i) => !completed[i])!);
      }
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); }
      else if (e.target instanceof Element && e.target.closest('[data-opening-drawing-controls]')) return;
      else if (drawingFootprint && mode === 'polygon' && e.key === 'Enter') {
        e.preventDefault(); e.stopImmediatePropagation(); complete(points);
      } else if (drawingFootprint && (e.key === 'Backspace' || e.key === 'Delete')) {
        e.preventDefault(); e.stopImmediatePropagation();
        setPoints(current => current.slice(0, -1)); setError(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [opening, drawingFootprint, mode, points, footprints, shapes, side, target, pageKey]);

  const preview = drawingFootprint && mode === 'rectangle' && points.length && hover
    ? rectanglePoints(points[0], hover) : [...points, ...(hover ? [hover] : [])];
  useEffect(() => {
    if (!drawingFootprint) return;
    useRevisionUi.setState({ openingDrawing: {
      side, sides, pointCount: points.length, error,
      finish: () => complete(points),
      back: () => { setPoints(current => current.slice(0, -1)); setError(false); },
      selectSide: next => {
        if (next === side || !sides.includes(next)) return;
        setOpeningSide(next); setPoints([]); setHover(null); setError(false);
      },
    } });
    return () => { useRevisionUi.setState({ openingDrawing: null }); };
  }, [drawingFootprint, side, type, target, mode, points, footprints, shapes, error, pageKey]);
  return <g className="revision-change-placing">
    <rect x={-1e5} y={-1e5} width={2e5} height={2e5} fill="transparent" style={{ pointerEvents: 'all', cursor: 'crosshair' }}
      onMouseDown={stopMouse} onMouseMove={e => setHover(nativePoint(e))}
      onDoubleClick={e => { e.stopPropagation(); if (drawingFootprint && mode === 'polygon') complete(points); }}
      onClick={e => {
        e.stopPropagation();
        const point = nativePoint(e);
        if (!drawingFootprint) { finish(addManualRevisionChange(pageKey, type, point)); return; }
        if (drawingFootprint && mode === 'rectangle') {
          if (!points.length) { setPoints([point]); setError(false); }
          else complete(rectanglePoints(points[0], point));
          return;
        }
        if (drawingFootprint && closesPolygon(points, screenToNative(e.clientX, e.clientY), zoom)) { complete(points); return; }
        if (points.some(p => distancePx(p, point) * zoom < 2)) return;
        const next = [...points, point];
        setPoints(next); setError(false);
      }} />
    <g pointerEvents="none">
      {footprints.map((footprint, index) => footprint && <polygon key={index} points={footprint.map(p => `${p.x},${p.y}`).join(' ')}
        fill={colors[elementWorkKind(opening ? 'doors' : 'walls', sides[index])]} fillOpacity={0.06} stroke={colors[elementWorkKind(opening ? 'doors' : 'walls', sides[index])]} strokeWidth={1 / zoom} />)}
      {drawingFootprint && points.length > 0 && <polygon points={preview.map(p => `${p.x},${p.y}`).join(' ')}
        fill={color} fillOpacity={0.08} stroke={color} strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${4 / zoom}`} />}
      {points.map((p, index) => <circle key={index} cx={p.x} cy={p.y} r={5 / zoom} fill="#fff" stroke={color} strokeWidth={2 / zoom} />)}
      {wall && hover && <text x={hover.x + 12 / zoom} y={hover.y - 12 / zoom} fontSize={12 / zoom} fill={color}
        stroke="#fff" strokeWidth={3 / zoom} paintOrder="stroke">
        {t('revisionAi.edit.drawWallStep', { side: `${t(`revisionAi.work.${elementWorkKind('walls', side)}`)} · ${t(side === 'removed' ? 'revisionAi.before' : 'revisionAi.after')}`, corner: points.length + 1 })}
      </text>}
    </g>

  </g>;
}
