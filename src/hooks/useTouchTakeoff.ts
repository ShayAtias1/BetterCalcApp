import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { useFieldWorkflowStore } from '../store/fieldWorkflowStore';
import { canAuthorTakeoff, canUseMarkupTool, canUseMeasureTool } from '../lib/workspaceCapabilities';
import { nativeHitRadius } from '../lib/interactionTargets';
import { reshapeArea, translateArea, type AreaGeometryKind } from '../lib/areaGeometryEditing';
import { distancePx, nearestPointIndex, pxToMeters, round, snapOrtho } from '../lib/geometry';
import { hitStraightBar } from '../lib/straightBarsGeometry';
import type { Point } from '../types';
import type { StirrupLinePlacement } from '../types/structural';
import type { CanvasTransform } from './useCanvasTransform';
import type { PlanPointerEdit } from './usePlanNavigation';
import { formatNumber, useT } from '../i18n';

export interface TouchArea { kind: AreaGeometryKind; id: string; placementId?: string; points: Point[]; color: string }
export interface TextDraft { point: Point; markupId?: string; text: string; rotationDeg: number }
type PointKey = 'calibrationPoints' | 'drawingPoints' | 'measurePoints' | 'markupPoints';
type Drag =
  | { kind: 'point'; key: PointKey; points: Point[]; index: number; start: Point }
  | { kind: 'area'; area: TouchArea; index: number; start: Point; next: Point[] }
  | { kind: 'line'; itemId: string; line: StirrupLinePlacement; index: number; start: Point; next: StirrupLinePlacement };

/** Drafts use existing native point arrays; saved changes use existing takeoff mutations only. */
export function useTouchTakeoff({ transform, area, line, contextKey, onAreaPreview, onLinePreview, onTextDraft, finishMeasurement, finishMarkup }: {
  transform: CanvasTransform; area: TouchArea | null;
  line: { itemId: string; placement: StirrupLinePlacement } | null; contextKey: string;
  onAreaPreview: (preview: Omit<TouchArea, 'color'> | null) => void;
  onLinePreview: (preview: { itemId: string; bar: StirrupLinePlacement; stirrup: boolean } | null) => void;
  onTextDraft: (draft: TextDraft) => void;
  finishMeasurement: (points?: Point[]) => void; finishMarkup: () => void;
}) {
  const state = useAppStore();
  const action = useFieldWorkflowStore((s) => s.geometryAction);
  const draft = useFieldWorkflowStore((s) => s.draft);
  const t = useT();
  const drag = useRef<Drag | null>(null);
  const [precision, setPrecision] = useState<Point | null>(null);
  const key: PointKey | null = state.toolMode === 'calibrate' ? 'calibrationPoints'
    : state.toolMode === 'draw' || state.toolMode === 'draw-rect' ? 'drawingPoints'
    : state.toolMode === 'measure' ? 'measurePoints' : state.toolMode === 'markup' ? 'markupPoints' : null;
  const points = key ? state[key] : [];
  const supported = state.toolMode === 'calibrate' || state.toolMode === 'draw' || state.toolMode === 'draw-rect'
    ? canAuthorTakeoff() && state.barsDrawing !== 'line'
    : state.toolMode === 'measure' ? !!state.measureTool && canUseMeasureTool(state.measureTool)
    : state.toolMode === 'markup' ? !!state.markupTool && canUseMarkupTool(state.markupTool) : false;
  const activeDraft = draft && supported && !!key;
  const cancelDrag = () => {
    const active = drag.current; drag.current = null;
    if (active?.kind === 'point') useAppStore.setState({ [active.key]: active.points });
    onAreaPreview(null); onLinePreview(null); setPrecision(null);
  };
  useEffect(() => {
    cancelDrag();
    useFieldWorkflowStore.getState().setGeometryAction('browse');
    useFieldWorkflowStore.getState().setCalibrationDialog(false);
    // Selection/tool/sheet changes invalidate a preview; panel visibility is deliberately absent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey]);
  const editing: PlanPointerEdit = {
    begin: (x, y, _target, pointerType) => {
      const native = transform.screenToNative(x, y);
      const radius = nativeHitRadius(transform.getView().zoom, pointerType);
      if (activeDraft && points.length) {
        const index = nearestPointIndex(points, native, radius);
        if (index >= 0) {
          drag.current = { kind: 'point', key: key!, points: structuredClone(points), index, start: native };
          setPrecision(points[index]); return true;
        }
      }
      if (!canAuthorTakeoff() || state.toolMode !== 'select' || action === 'browse') return false;
      if (area) {
        const index = action === 'reshape' ? nearestPointIndex(area.points, native, radius) : -1;
        // Moves must start on the selected object; background drags remain navigation.
        const inside = insidePolygon(native, area.points);
        if ((action === 'reshape' && index >= 0) || (action === 'move' && inside)) {
          drag.current = { kind: 'area', area: { ...area, points: structuredClone(area.points) }, index, start: native, next: area.points };
          if (index >= 0) setPrecision(area.points[index]); return true;
        }
      }
      if (line) {
        const index = action === 'reshape' ? nearestPointIndex([line.placement.start, line.placement.end], native, radius) : -1;
        if ((action === 'reshape' && index >= 0) || (action === 'move' && hitStraightBar(native, line.placement, radius))) {
          drag.current = { kind: 'line', itemId: line.itemId, line: structuredClone(line.placement), index, start: native, next: line.placement };
          if (index >= 0) setPrecision(index === 0 ? line.placement.start : line.placement.end); return true;
        }
      }
      return false;
    },
    move: (x, y) => {
      const active = drag.current;
      if (!active) return;
      const current = transform.screenToNative(x, y);
      const offset = { x: current.x - active.start.x, y: current.y - active.start.y };
      if (active.kind === 'point') {
        const point = { x: active.points[active.index].x + offset.x, y: active.points[active.index].y + offset.y };
        useAppStore.setState({ [active.key]: active.points.map((p, i) => i === active.index ? point : p) });
        setPrecision(point);
      } else if (active.kind === 'area') {
        const point = active.index < 0 ? current : { x: active.area.points[active.index].x + offset.x, y: active.area.points[active.index].y + offset.y };
        const next = active.index < 0 ? translateArea(active.area.points, offset) : reshapeArea(active.area.points, active.index, point);
        if (next) { active.next = next; onAreaPreview({ ...active.area, points: next }); }
        if (active.index >= 0) setPrecision(point);
      } else {
        const start = active.line.start; const end = active.line.end;
        active.next = { ...active.line,
          start: active.index === 1 ? start : { x: start.x + offset.x, y: start.y + offset.y },
          end: active.index === 0 ? end : { x: end.x + offset.x, y: end.y + offset.y } };
        onLinePreview({ itemId: active.itemId, bar: active.next, stirrup: true });
        if (active.index >= 0) setPrecision(active.index === 0 ? active.next.start : active.next.end);
      }
    },
    end: (x, y) => {
      editing.move(x, y);
      const active = drag.current; drag.current = null;
      onAreaPreview(null); onLinePreview(null); setPrecision(null);
      if (active?.kind === 'area' && canAuthorTakeoff()) useAppStore.getState().editAreaGeometry(active.area.kind, active.area.id, active.next, active.area.placementId);
      if (active?.kind === 'line' && canAuthorTakeoff() && distancePx(active.next.start, active.next.end) > 0.1
        && (distancePx(active.next.start, active.line.start) > 0 || distancePx(active.next.end, active.line.end) > 0)) useAppStore.getState().editStirrupPlacement(active.itemId, active.next);
      if (active?.kind !== 'point') useFieldWorkflowStore.getState().setGeometryAction('browse');
    },
    cancel: () => { cancelDrag(); useFieldWorkflowStore.getState().setGeometryAction('browse'); },
  };
  const tap = (x: number, y: number): boolean => {
    if (!supported || !key) return false;
    const store = useAppStore.getState();
    useFieldWorkflowStore.getState().setDraft(true);
    const native = transform.screenToNative(x, y);
    if (key === 'calibrationPoints') {
      if (store.calibrationPoints.length < 2) store.addCalibrationPoint(native);
    } else if (key === 'drawingPoints') {
      const twoPoint = store.toolMode === 'draw-rect' || store.stirrupDrawing === 'line';
      if (!twoPoint || store.drawingPoints.length < 2) store.addDrawingPoint(store.orthoSnap && store.stirrupDrawing === 'line' && store.drawingPoints.length ? snapOrtho(store.drawingPoints[0], native) : native);
    } else if (key === 'measurePoints') {
      if (!store.project?.pages[store.currentPage]?.calibration) return true;
      const twoPoint = store.measureTool === 'distance' || (store.measureTool === 'area' && store.areaShape === 'rectangle');
      if (!twoPoint || store.measurePoints.length < 2) store.addMeasurePoint(store.orthoSnap && store.measurePoints.length ? snapOrtho(store.measurePoints[store.measurePoints.length - 1], native) : native);
    } else if (store.markupTool === 'text') {
      onTextDraft({ point: native, text: '', rotationDeg: 0 });
    } else {
      const multiPoint = store.markupTool === 'cloud' || store.markupTool === 'dimension';
      if (multiPoint || store.markupPoints.length < 2) store.addMarkupPoint(store.markupOrtho && store.markupPoints.length && store.markupTool === 'arrow' ? snapOrtho(store.markupPoints[0], native) : native);
    }
    return true;
  };
  const twoPoint = state.toolMode === 'calibrate' || state.toolMode === 'draw-rect' || state.stirrupDrawing === 'line'
    || (state.toolMode === 'measure' && (state.measureTool === 'distance' || (state.measureTool === 'area' && state.areaShape === 'rectangle')))
    || (state.toolMode === 'markup' && state.markupTool !== 'cloud' && state.markupTool !== 'dimension');
  const minPoints = twoPoint || (state.toolMode === 'markup' && state.markupTool === 'dimension') ? 2 : 3;
  const mpp = state.project?.pages[state.currentPage]?.calibration?.metersPerPixel ?? 0;
  const distanceResult = state.toolMode === 'measure' && state.measureTool === 'distance' && points.length === 2 && mpp
    ? `${formatNumber(round(pxToMeters(distancePx(points[0], points[1]), mpp), 2))} ${t('units.m')}` : undefined;
  const finish = () => {
    if (!activeDraft || points.length < minPoints) return;
    const store = useAppStore.getState();
    if (state.toolMode === 'calibrate') { useFieldWorkflowStore.getState().setCalibrationDialog(true); return; }
    if (state.toolMode === 'draw-rect') {
      if (Math.abs(points[0].x - points[1].x) < 0.1 || Math.abs(points[0].y - points[1].y) < 0.1) return;
      store.finishRectangle(points[0], points[1]);
    } else if (state.toolMode === 'draw' && state.stirrupDrawing === 'line') store.finishStirrupLine(points[0], points[1]);
    else if (state.toolMode === 'draw') store.finishDrawing();
    else if (state.toolMode === 'measure') {
      if (state.measureTool === 'area' && state.areaShape === 'rectangle') finishMeasurement(rectanglePoints(points));
      else finishMeasurement();
    } else if (state.toolMode === 'markup') finishMarkup();
    store.setToolMode('select');
    useFieldWorkflowStore.getState().setDraft(false);
  };
  const cancel = () => { cancelDrag(); useAppStore.getState().setToolMode('select'); useFieldWorkflowStore.getState().setDraft(false); useFieldWorkflowStore.getState().setCalibrationDialog(false); };
  const back = () => { if (key) useAppStore.setState({ [key]: points.slice(0, -1) }); };
  const editNote = () => {
    const note = state.project?.markups?.find((m) => m.id === state.selectedMarkupId && m.tool === 'text');
    if (note) onTextDraft({ point: note.points[0], markupId: note.id, text: note.text ?? '', rotationDeg: note.rotationDeg ?? 0 });
  };
  return { editing, tap, precision, activeDraft, points, key, action, minPoints, distanceResult, finish, cancel, back, editNote,
    canEditNote: !!state.project?.markups?.some((m) => m.id === state.selectedMarkupId && m.tool === 'text'),
    canEditGeometry: canAuthorTakeoff() && !state.selectedMarkupId && !!(area || line) && state.toolMode === 'select',
    rectangleDraft: activeDraft && points.length === 2 && (state.toolMode === 'draw-rect' || (state.toolMode === 'measure' && state.measureTool === 'area' && state.areaShape === 'rectangle')) ? rectanglePoints(points) : null,
  };
}
function rectanglePoints(points: Point[]): Point[] {
  const [a, b] = points;
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
}
function insidePolygon(point: Point, points: Point[]) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
