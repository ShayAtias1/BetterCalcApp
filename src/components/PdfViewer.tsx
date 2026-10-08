import { useAiWorkflow, cancelOneClick, startAiDetection } from '../lib/ai/workflow';
import { aiCandidateLabel } from '../lib/localAiReview';
import { FIELD_OPERATION_CANCEL } from '../lib/fieldLifecycle';
import { useTouchMeshLayout } from '../hooks/useTouchMeshLayout';
import { useTouchTakeoff } from '../hooks/useTouchTakeoff';
import { useFieldWorkflowStore } from '../store/fieldWorkflowStore';
import FieldTools from './FieldTools';
import { usePlanFocusStore } from '../store/planFocusStore';
import type { StirrupLinePlacement } from '../types/structural';
import { usePlanNavigation } from '../hooks/usePlanNavigation';
import { nativeHitRadius } from '../lib/interactionTargets';
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { v4 as uuid } from 'uuid';
import { isViewerRenderCancelled } from '../lib/pdfViewerSource';
import { initialPdfScale } from '../lib/pdfRenderBudget';
import { useMainPdfSource } from '../hooks/useMainPdfSource';
import { usePdfDetail } from '../hooks/usePdfDetail';
import { useAppStore } from '../store/appStore';
import { notePlanRendered, trackError } from '../lib/analytics';
import type { ExportRegion, Markup, Point } from '../types';
import { DEFAULT_AREA_KIND_COLORS } from '../types';
import { MEASUREMENT_DEFAULTS } from '../config/measurementDefaults';
import {
  arrowHeadPoints,
  cloudPath,
  distancePx,
  longestEdgePx,
  nearestPointIndex,
  polygonAreaM2,
  polygonAreaPx,
  polygonCentroid,
  polygonPerimeterM,
  projectOntoLine,
  pxToMeters,
  round,
  snapOrtho,
  tickMarkEndpoints,
} from '../lib/geometry';
import { numberAreaMeasurements } from '../lib/areaMeasurements';
import { measurementLabel } from '../lib/measurementValues';
import { dimensionLabels, dimensionNormal, reshapeDimension } from '../lib/dimensionChain';
import { orderMarkups } from '../lib/drawMarkup';
import DimensionShape from './DimensionShape';
import TextNoteShape from './TextNoteShape';
import TextNoteDialog from './TextNoteDialog';
import { useCanvasTransform } from '../hooks/useCanvasTransform';
import { useLanguage, useT } from '../i18n';
import { labelDirection } from '../lib/textDirection';
import { computeGrid } from '../lib/grid';
import { useGridStore } from '../store/gridStore';
import GridLayer from './GridLayer';
import ConcreteZones from './ConcreteZones';
import RebarZones from './RebarZones';
import { MeshLayoutOverlay } from './MeshLayoutPreview';
import { markLabel } from '../lib/structuralMarks';
import { concreteOf, rebarOf } from '../lib/structuralPlan';
import { updateConcreteElement, updateRebarItem } from '../lib/structuralMutations';
import type { DrawnStraightBar } from '../types/structural';
import { hitStraightBar, translateBar } from '../lib/straightBarsGeometry';
import { reshapeArea, translateArea, type AreaGeometryKind } from '../lib/areaGeometryEditing';
import AreaGeometryHandles from './AreaGeometryHandles';
import StirrupOverlay from './StirrupOverlay';
import { CONCRETE_COLOR, REBAR_COLOR } from '../lib/structuralOverlay';
import { useMeshLayoutView } from '../store/meshLayoutPreviewStore';

const VERTEX_HIT_RADIUS_SCREEN = 9;
/** New masks start opaque white, the colour of the paper they hide. */
const MASK_COLOR = '#ffffff';
/** Detection suggestions are drawn in one neutral colour — they are not rooms and have no room colour yet. */
const CANDIDATE_COLOR = '#0ea5e9';

function pointInPolygon(pt: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Renders one finished markup. When `draggable` (select tool active), its body accepts pointer
 * events so it can be grabbed and moved — the actual drag is handled by the canvas's mouse handlers,
 * which look up the markup via the `data-markup-id` attribute set here.
 */
function MarkupShape({ markup, strokeW, draggable }: { markup: Markup; strokeW: number; draggable: boolean }) {
  const [a, b] = markup.points;
  const hitProps = draggable ? { 'data-markup-id': markup.id, style: { pointerEvents: 'auto' as const, cursor: 'move' } } : {};
  const fontScale = markup.fontScale ?? 1;
  switch (markup.tool) {
    case 'arrow':
      return (
        <g>
          {draggable && (
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={strokeW * 8} {...hitProps} />
          )}
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={markup.color} strokeWidth={strokeW * 1.3} />
          <polygon points={arrowHeadPoints(a, b, strokeW * 8)} fill={markup.color} {...hitProps} />
        </g>
      );
    case 'rectangle':
      return (
        <rect
          x={Math.min(a.x, b.x)}
          y={Math.min(a.y, b.y)}
          width={Math.abs(b.x - a.x)}
          height={Math.abs(b.y - a.y)}
          fill={markup.color}
          fillOpacity={0.1}
          stroke={markup.color}
          strokeWidth={strokeW * 1.3}
          {...hitProps}
        />
      );
    // An opaque block that hides whatever it covers on the plan. Its outline only shows while the
    // select tool is active, so it can be found and grabbed without printing a border.
    case 'mask':
      return (
        <rect
          x={Math.min(a.x, b.x)}
          y={Math.min(a.y, b.y)}
          width={Math.abs(b.x - a.x)}
          height={Math.abs(b.y - a.y)}
          fill={markup.color}
          stroke={draggable ? '#94a3b8' : 'none'}
          strokeWidth={strokeW}
          strokeDasharray={draggable ? `${strokeW * 3} ${strokeW * 3}` : undefined}
          {...hitProps}
        />
      );
    case 'dimension':
      return (
        <DimensionShape
          points={markup.points}
          color={markup.color}
          text={markup.text}
          segmentTexts={markup.segmentTexts}
          fontScale={fontScale}
          offset={markup.offset}
          flipped={markup.flipped}
          strokeW={strokeW}
          hitProps={hitProps}
          draggable={draggable}
        />
      );
    case 'cloud':
      return (
        <path
          d={cloudPath(markup.points, 14 * strokeW)}
          fill={markup.color}
          fillOpacity={0.08}
          stroke={markup.color}
          strokeWidth={strokeW * 1.3}
          strokeLinejoin="round"
          {...hitProps}
        />
      );
    case 'text':
      return (
        <TextNoteShape
          point={a}
          text={markup.text}
          color={markup.color}
          fontScale={fontScale}
          rotationDeg={markup.rotationDeg}
          strokeW={strokeW}
          hitProps={hitProps}
        />
      );
    default:
      return null;
  }
}

export default function PdfViewer() {
  const { reviewOnly, touchInput, layout } = useWorkspaceLayout();
  const fieldDraft = useFieldWorkflowStore((s) => s.draft);
  const geometryAction = useFieldWorkflowStore((s) => s.geometryAction);
  const t = useT();
  const language = useLanguage();
  const project = useAppStore((s) => s.project);
  const currentPage = useAppStore((s) => s.currentPage);
  const setNumPages = useAppStore((s) => s.setNumPages);
  const toolMode = useAppStore((s) => s.toolMode);
  const overlayVisible = useAppStore((s) => s.overlayVisible);
  const drawTarget = useAppStore((s) => s.drawTarget);
  const barsDrawing = useAppStore((s) => s.barsDrawing);
  const stirrupDrawing = useAppStore((s) => s.stirrupDrawing);
  const selectedStirrupPlacementId = useAppStore((s) => s.selectedStirrupPlacementId);
  const finishStirrupLine = useAppStore((s) => s.finishStirrupLine);
  const selectStirrupPlacement = useAppStore((s) => s.selectStirrupPlacement);
  const editStirrupPlacement = useAppStore((s) => s.editStirrupPlacement);
  const finishDrawnBar = useAppStore((s) => s.finishDrawnBar);
  const selectedDrawnBarId = useAppStore((s) => s.selectedDrawnBarId);
  const setSelectedDrawnBarId = useAppStore((s) => s.setSelectedDrawnBarId);
  const editDrawnBar = useAppStore((s) => s.editDrawnBar);
  const selectedConcreteId = useAppStore((s) => s.selectedConcreteId);
  const setSelectedConcreteId = useAppStore((s) => s.setSelectedConcreteId);
  const selectedRebarId = useAppStore((s) => s.selectedRebarId);
  const setSelectedRebarId = useAppStore((s) => s.setSelectedRebarId);
  const moveStructuralZone = useAppStore((s) => s.moveStructuralZone);
  const editAreaGeometry = useAppStore((s) => s.editAreaGeometry);
  const meshLayoutView = useMeshLayoutView(project?.id ?? '', selectedRebarId ?? '');
  const gridEnabled = useGridStore((s) => s.enabled);
  const gridSpacingM = useGridStore((s) => s.spacingM);
  const gridOpacity = useGridStore((s) => s.opacity);
  const measurementsVisible = overlayVisible.measurements;
  const markupFontScale = useAppStore((s) => s.markupFontScale);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const selectedRoomId = useAppStore((s) => s.selectedRoomId);
  const setSelectedRoomId = useAppStore((s) => s.setSelectedRoomId);
  const calibrationPoints = useAppStore((s) => s.calibrationPoints);
  const addCalibrationPoint = useAppStore((s) => s.addCalibrationPoint);
  const drawingPoints = useAppStore((s) => s.drawingPoints);
  const addDrawingPoint = useAppStore((s) => s.addDrawingPoint);
  const finishDrawing = useAppStore((s) => s.finishDrawing);
  const finishRectangle = useAppStore((s) => s.finishRectangle);
  const clearDrawingPoints = useAppStore((s) => s.clearDrawingPoints);
  const deleteRoomPoint = useAppStore((s) => s.deleteRoomPoint);
  const measureTool = useAppStore((s) => s.measureTool);
  const measurePoints = useAppStore((s) => s.measurePoints);
  const areaShape = useAppStore((s) => s.areaShape);
  const areaCalcMode = useAppStore((s) => s.areaCalcMode);
  const pendingAreaKind = useAppStore((s) => s.pendingAreaKind);
  const orthoSnap = useAppStore((s) => s.orthoSnap);
  const addMeasurePoint = useAppStore((s) => s.addMeasurePoint);
  const clearMeasurePoints = useAppStore((s) => s.clearMeasurePoints);
  const finishMeasurement = useAppStore((s) => s.finishMeasurement);
  const exportRegions = useAppStore((s) => s.exportRegions);
  const setExportRegion = useAppStore((s) => s.setExportRegion);
  const setToolMode = useAppStore((s) => s.setToolMode);
  const markupTool = useAppStore((s) => s.markupTool);
  const markupPoints = useAppStore((s) => s.markupPoints);
  const markupColor = useAppStore((s) => s.markupColor);
  const markupOrtho = useAppStore((s) => s.markupOrtho);
  const addMarkupPoint = useAppStore((s) => s.addMarkupPoint);
  const clearMarkupPoints = useAppStore((s) => s.clearMarkupPoints);
  const finishMarkup = useAppStore((s) => s.finishMarkup);
  const updateMarkup = useAppStore((s) => s.updateMarkup);
  const updateMarkupQuiet = useAppStore((s) => s.updateMarkupQuiet);
  const selectedMarkupId = useAppStore((s) => s.selectedMarkupId);
  const setSelectedMarkupId = useAppStore((s) => s.setSelectedMarkupId);
  const duplicateMarkup = useAppStore((s) => s.duplicateMarkup);
  const oneClickArmed=useAiWorkflow(s=>s.oneClickArmed);
  const oneClickPanGesture=useRef(false);
  const detectionCandidates = useAppStore((s) => s.detectionCandidates);
  const selectedDetectionCandidateId = useAppStore(s => s.selectedDetectionCandidateId);
  const selectDetectionCandidate = useAppStore(s => s.selectDetectionCandidate);
  const editDetectionCandidate = useAppStore(s => s.editDetectionCandidate);
  const clearDetectionCandidates = useAppStore((s) => s.clearDetectionCandidates);
  const deleteMarkup = useAppStore((s) => s.deleteMarkup);
  const deleteRoom = useAppStore((s) => s.deleteRoom);

  const transform = useCanvasTransform();
  const { containerRef, zoom, pan, screenToNative, handleWheel, fitToContainer, beginPanDrag, updatePanDrag, endPanDrag } = transform;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const { planSource, sourceKey, loadError, setLoadError } = useMainPdfSource(
    project?.id, project?.pdfFileName, currentPage, setNumPages, t('viewer.pdfLoadError'),
  );
  const baseRasterScaleRef = useRef(0);
  const [renderedKey, setRenderedKey] = useState('');
  const focusRequest = usePlanFocusStore((s) => s.request);

  const structuralDrag = useRef<{
    kind: AreaGeometryKind | 'suggestion'; id: string; placementId?: string; start: Point; points: Point[]; offset: Point; drawnBars?: DrawnStraightBar[]; handleIndex?: number; previewPoints?: Point[];
  } | null>(null);
  const [structuralPreview, setStructuralPreview] = useState<{
    kind: AreaGeometryKind | 'suggestion'; id: string; placementId?: string; points: Point[]; drawnBars?: DrawnStraightBar[];
  } | null>(null);
  const barDrag = useRef<{ itemId: string; bar: DrawnStraightBar; start: Point; endpoint: 'start' | 'end' | null; preview: DrawnStraightBar | null; stirrup?: boolean } | null>(null);
  const [barPreview, setBarPreview] = useState<{ itemId: string; bar: DrawnStraightBar; stirrup?: boolean } | null>(null);
  const suppressStructuralClick = useRef(false);
  const structuralPlan = useMemo(() => {
    if (!project) return project;
    if (barPreview) {
      const item = rebarOf(project).find((i) => i.id === barPreview.itemId);
      if (item?.kind === 'stirrup' && barPreview.stirrup) return updateRebarItem(project, item.id, { placements: item.placements.map((p) => p.id === barPreview.bar.id && p.kind === 'line' ? { ...p, start: barPreview.bar.start, end: barPreview.bar.end } : p) });
      if (item?.kind === 'bars' && item.drawnBars) return updateRebarItem(project, item.id, {
        drawnBars: item.drawnBars.map((bar) => bar.id === barPreview.bar.id ? barPreview.bar : bar),
      });
    }
    if (!structuralPreview || structuralPreview.kind === 'suggestion') return project;
    if (structuralPreview.kind === 'room') return { ...project, rooms: project.rooms.map((room) =>
      room.id === structuralPreview.id ? { ...room, points: structuralPreview.points } : room) };
    return structuralPreview.kind === 'concrete'
      ? updateConcreteElement(project, structuralPreview.id, { points: structuralPreview.points })
      : (() => {
        const item = rebarOf(project).find((i) => i.id === structuralPreview.id);
        if (item?.kind === 'stirrup') return updateRebarItem(project, item.id, { placements: item.placements.map((p) => p.id === structuralPreview.placementId && p.kind === 'area' ? { ...p, points: structuralPreview.points } : p) });
        if (item?.kind === 'bars' && structuralPreview.drawnBars) return updateRebarItem(project, item.id, { drawnBars: structuralPreview.drawnBars });
        return item?.kind === 'bars' && item.barsZone
          ? updateRebarItem(project, item.id, { barsZone: { ...item.barsZone, points: structuralPreview.points } })
          : updateRebarItem(project, structuralPreview.id, { points: structuralPreview.points });
      })();
  }, [project, structuralPreview, barPreview]);

  // Changing selection, page or editing context cancels an uncommitted whole-zone drag.
  useEffect(() => {
    structuralDrag.current = null;
    barDrag.current = null;
    setBarPreview(null);
    setStructuralPreview(null);
  }, [project, currentPage, toolMode, drawTarget, selectedRoomId, selectedConcreteId, selectedRebarId, selectedDrawnBarId, selectedStirrupPlacementId,
    selectedDetectionCandidateId, detectionCandidates, overlayVisible.finishes, overlayVisible.concrete, overlayVisible.rebar, meshLayoutView.editing]);

  const spaceHeld = useRef(false);
  const isPanning = useRef(false);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const regionDragStart = useRef<Point | null>(null);
  const [regionDraft, setRegionDraft] = useState<ExportRegion | null>(null);
  /** Open text-note editor: a new note at `point`, or an existing one when `markupId` is set. */
  const [textDraft, setTextDraft] = useState<{ point: Point; markupId?: string; text: string; rotationDeg: number } | null>(null);
  useEffect(() => {
    const cancel = () => { setTextDraft(null); setRegionDraft(null); };
    window.addEventListener(FIELD_OPERATION_CANCEL, cancel);
    return () => window.removeEventListener(FIELD_OPERATION_CANCEL, cancel);
  }, []);
  const markupDrag = useRef<{ id: string; startClientX: number; startClientY: number; startPoints: Point[]; startOffset: number } | null>(
    null,
  );
  const handleDrag = useRef<{ id: string; index: number } | null>(null);

  // Density affects only the raster; SVG and saved coordinates remain native scale 1.
  useEffect(() => {
    setRenderedKey('');
    baseRasterScaleRef.current = 0;
    if (!planSource || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const { width, height } = planSource.getNativeSize();
    setPageSize({ width, height });
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const scale = initialPdfScale(width, height);
    const handle = planSource.render(canvas, scale);
    let cancelled = false;
    void handle.promise.then(() => {
      if (cancelled) return;
      baseRasterScaleRef.current = scale;
      setRenderedKey(sourceKey);
      const { project, numPages } = useAppStore.getState();
      if (project) notePlanRendered(project, numPages);
    }, (error: unknown) => {
      if (cancelled || isViewerRenderCancelled(error)) return;
      setLoadError(error instanceof Error ? error.message : t('viewer.pdfLoadError'));
      trackError('pdf_load', error);
    });
    return () => { cancelled = true; handle.cancel(); };
    // UI language does not change PDF pixels or its native coordinate system.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planSource, sourceKey, setLoadError]);

  const detailHostRef = usePdfDetail(
    planSource, sourceKey, renderedKey === sourceKey, containerRef, baseRasterScaleRef,
    { zoom, pan }, transform.getView,
  );
  useEffect(() => {
    const canvas = canvasRef.current;
    return () => { if (canvas) canvas.width = canvas.height = 0; };
  }, [planSource]);

  // Fit to container on first load / page size change
  useEffect(() => {
    if (!pageSize.width) return;
    fitToContainer(pageSize.width, pageSize.height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize]);

  // Focus only after the requested PDF page renders. Closing the inspector is a separate UI
  // action; wait for its layout/ResizeObserver before centering in the remaining canvas space.
  useEffect(() => {
    if (!focusRequest || project?.id !== focusRequest.planId || currentPage !== focusRequest.pageNumber ||
      renderedKey !== `${focusRequest.planId}:${focusRequest.pageNumber}`) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect || usePlanFocusStore.getState().request !== focusRequest) return;
        const points = focusRequest.points;
        if (points.length) {
          const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
          const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
          const usableTop = 120, usableBottom = Math.max(usableTop + 1, rect.height - 64);
          const fit = Math.min((rect.width - 48) / Math.max(right - left, 1), (usableBottom - usableTop - 40) / Math.max(bottom - top, 1));
          const zoom = Math.max(0.1, Math.min(transform.getView().zoom, fit));
          transform.setView({ zoom, pan: { x: rect.width / 2 - (left + right) / 2 * zoom, y: (usableTop + usableBottom) / 2 - (top + bottom) / 2 * zoom } });
        }
        usePlanFocusStore.getState().clear();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, project?.id, currentPage, renderedKey, containerRef, transform.getView, transform.setView]);

  const room = project?.rooms.find((r) => r.id === selectedRoomId) ?? null;
  const areaPlan = structuralPlan ?? project;
  const selectedArea = (() => {
    if (!areaPlan || toolMode !== 'select') return null;
    if (drawTarget === 'room' && overlayVisible.finishes) {
      if (!touchInput && !reviewOnly) {
        const candidate = detectionCandidates.find(c => c.id === selectedDetectionCandidateId && c.pageNumber === currentPage && c.localAi?.planId === project?.id);
        if (candidate) return { kind: 'suggestion' as const, id: candidate.id,
          points: structuralPreview?.kind === 'suggestion' && structuralPreview.id === candidate.id ? structuralPreview.points : candidate.points, color: CANDIDATE_COLOR };
      }
      const item = areaPlan.rooms.find((r) => r.id === selectedRoomId && r.pageNumber === currentPage);
      return item ? { kind: 'room' as const, id: item.id, points: item.points, color: item.color } : null;
    }
    if (drawTarget === 'concrete' && overlayVisible.concrete) {
      const item = concreteOf(areaPlan).find((el) => el.id === selectedConcreteId && el.pageNumber === currentPage);
      return item ? { kind: 'concrete' as const, id: item.id, points: item.points, color: CONCRETE_COLOR } : null;
    }
    if (drawTarget === 'rebar' && overlayVisible.rebar) {
      const item = rebarOf(areaPlan).find((i) => i.id === selectedRebarId);
      if (item?.kind === 'stirrup') {
        const placement = item.placements.find((p) => p.id === selectedStirrupPlacementId && p.pageNumber === currentPage);
        if (placement?.kind === 'area') return { kind: 'stirrup' as const, id: item.id, placementId: placement.id, points: placement.points, color: REBAR_COLOR };
        return null;
      }
      if (item?.pageNumber !== currentPage) return null;
      if (item?.kind === 'mesh' && !(meshLayoutView.enabled && meshLayoutView.editing))
        return { kind: 'mesh' as const, id: item.id, points: item.points, color: REBAR_COLOR };
      if (item?.kind === 'bars' && item.barsZone && item.drawnBars === undefined)
        return { kind: 'bars' as const, id: item.id, points: item.barsZone.points, color: REBAR_COLOR };
    }
    return null;
  })();
  const metersPerPixel = project?.pages[currentPage]?.calibration?.metersPerPixel ?? 0;
  // A tool that yields real-world numbers is active on a page with no scale.
  const grid = computeGrid(metersPerPixel, gridSpacingM, zoom);
  const needsCalibrationHint =
    metersPerPixel === 0 && (toolMode === 'measure' || (toolMode === 'markup' && markupTool === 'dimension'));
  // Numbered per page (not project-wide) so the on-canvas wall number always matches its row in that page's own exported table.
  const areaNumbers = useMemo(
    () => numberAreaMeasurements((project?.measurements ?? []).filter((m) => m.pageNumber === currentPage)),
    [project, currentPage]
  );

  useEffect(() => {
    if (drawingPoints.length === 0) setHoverPoint(null);
  }, [drawingPoints.length]);

  const finishOpenMeasurement = (pointsOverride?: Point[]) => {
    const points = pointsOverride ?? measurePoints;
    if (!measureTool || points.length < 2 || !metersPerPixel) {
      clearMeasurePoints();
      return;
    }
    let lengthM: number | undefined;
    let areaM2: number | undefined;
    let wallLengthM: number | undefined;
    let wallHeightM: number | undefined;
    if (measureTool === 'distance') {
      lengthM = round(pxToMeters(distancePx(points[0], points[1]), metersPerPixel), 2);
    } else if (measureTool === 'area' && areaCalcMode === 'wall') {
      wallLengthM = round(pxToMeters(longestEdgePx(points), metersPerPixel), 2);
      wallHeightM = project?.wallHeightDefaultM ?? MEASUREMENT_DEFAULTS.wallHeightM;
      areaM2 = round(wallLengthM * wallHeightM, 2);
    } else if (measureTool === 'area') {
      areaM2 = round(polygonAreaM2(points, metersPerPixel), 2);
    } else {
      lengthM = round(polygonPerimeterM(points, true, metersPerPixel), 2);
    }
    finishMeasurement({
      id: uuid(),
      pageNumber: currentPage,
      tool: measureTool,
      points,
      lengthM,
      areaKind: measureTool === 'area' && pendingAreaKind ? pendingAreaKind : undefined,
      areaM2,
      calcMode: measureTool === 'area' ? areaCalcMode : undefined,
      wallLengthM,
      wallHeightM,
    });
  };

  /**
   * Where the next dimension stop lands: the second point may snap to 90°, and every stop after it
   * is projected onto the line the first segment defined, so a continued run stays on one line.
   */
  const nextDimensionPoint = (pts: Point[], native: Point): Point => {
    if (pts.length === 0) return native;
    if (pts.length === 1) return markupOrtho ? snapOrtho(pts[0], native) : native;
    return projectOntoLine(pts[0], pts[1], native);
  };

  const finishOpenMarkup = () => {
    if (!markupTool) return;
    if (markupTool === 'cloud') {
      if (markupPoints.length < 3) {
        clearMarkupPoints();
        return;
      }
      finishMarkup({ id: uuid(), pageNumber: currentPage, tool: 'cloud', points: markupPoints, color: markupColor, createdAt: Date.now() });
      return;
    }
    if (markupPoints.length < 2) {
      clearMarkupPoints();
      return;
    }
    // Non-dimension 2-point tools ignore any extra points a stray click may have added.
    const points = markupTool === 'dimension' ? markupPoints : markupPoints.slice(0, 2);
    let text: string | undefined;
    let segmentTexts: string[] | undefined;
    if (markupTool === 'dimension' && metersPerPixel) {
      ({ text, segmentTexts } = dimensionLabels(points, metersPerPixel));
    }
    finishMarkup({
      id: uuid(),
      pageNumber: currentPage,
      tool: markupTool,
      points,
      // A mask starts opaque white — it's there to hide the plan under it; recolour it afterwards
      // (grey or black) from the markup colour picker.
      color: markupTool === 'mask' ? MASK_COLOR : markupColor,
      text,
      segmentTexts,
      fontScale: markupFontScale,
      createdAt: Date.now(),
    });
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (reviewOnly || fieldDraft) return;
      // Anything typed into a field (including the text-note dialog and the contenteditable case)
      // must never reach the shortcuts below that delete or undo.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditingField =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        !!target?.isContentEditable ||
        !!target?.closest?.('input, textarea, select, [contenteditable="true"]');

      if (e.code === 'Space') spaceHeld.current = true;
      if (e.key === 'Escape' && useAiWorkflow.getState().oneClickArmed) { cancelOneClick();return; }
      if (e.key === 'Escape') {
        structuralDrag.current = null;
        barDrag.current = null;
        setStructuralPreview(null);
        setBarPreview(null);
        clearDrawingPoints();
        clearMeasurePoints();
        clearMarkupPoints();
        // Nothing has been created yet, so this leaves no history entry behind.
        if (useAppStore.getState().selectedDetectionCandidateId) selectDetectionCandidate(null);
        else clearDetectionCandidates();
      }
      if (e.key === 'Enter' && drawingPoints.length >= 3) {
        finishDrawing();
      }
      if (e.key === 'Enter' && measureTool && measureTool !== 'distance' && measurePoints.length >= 3) {
        finishOpenMeasurement();
      }
      if (e.key === 'Enter' && markupTool === 'cloud' && markupPoints.length >= 3) {
        finishOpenMarkup();
      }
      // A dimension chain keeps accepting stops until the user ends it explicitly.
      if (e.key === 'Enter' && markupTool === 'dimension' && markupPoints.length >= 2) {
        finishOpenMarkup();
      }
      if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey) && selectedMarkupId) {
        e.preventDefault();
        duplicateMarkup(selectedMarkupId);
      }
      if (!isEditingField && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      // Delete/Backspace removes what is selected, through the very same mutations (and the same
      // room confirmation) as the sidebar's ✕ buttons — so it lands in undo history identically.
      // A selected markup wins over a selected room: it is the more recent selection on the plan.
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditingField && !textDraft) {
        if (drawTarget === 'rebar' && overlayVisible.rebar && selectedRebarId && selectedStirrupPlacementId) {
          e.preventDefault();
          useAppStore.getState().deleteStirrupPlacement(selectedRebarId, selectedStirrupPlacementId);
        } else if (drawTarget === 'rebar' && overlayVisible.rebar && selectedRebarId && selectedDrawnBarId) {
          e.preventDefault();
          useAppStore.getState().deleteDrawnBar(selectedRebarId, selectedDrawnBarId);
        } else if (drawTarget === 'rebar' && overlayVisible.rebar && selectedRebarId && project) {
          const selected = rebarOf(project).find((item) => item.id === selectedRebarId);
          if (selected?.kind === 'stirrup') {
            e.preventDefault();
            if (confirm(t('rebar.deleteConfirm', { mark: markLabel(selected, t) }))) useAppStore.getState().deleteRebarItem(selected.id);
          }
        } else if (selectedMarkupId) {
          e.preventDefault();
          deleteMarkup(selectedMarkupId);
        } else if (selectedRoomId) {
          const room = project?.rooms.find((r) => r.id === selectedRoomId);
          if (room) {
            e.preventDefault();
            if (confirm(t('viewer.deleteRoomConfirm', { name: room.name }))) deleteRoom(selectedRoomId);
          }
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeld.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    reviewOnly,
    fieldDraft,
    clearDrawingPoints,
    drawingPoints.length,
    finishDrawing,
    measureTool,
    measurePoints,
    markupTool,
    markupPoints,
    selectedMarkupId,
    selectedRoomId,
    selectedRebarId,
    selectedDrawnBarId,
    selectedStirrupPlacementId,
    drawTarget,
    overlayVisible.rebar,
    clearDetectionCandidates, selectDetectionCandidate,
    project,
    textDraft,
    deleteMarkup,
    deleteRoom,
    t,
    undo,
    redo,
  ]);

  // Auto-finish distance measurement once 2 points are placed.
  useEffect(() => {
    if (!fieldDraft && measureTool === 'distance' && measurePoints.length === 2) {
      finishOpenMeasurement();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measurePoints, measureTool, fieldDraft]);

  // Auto-finish 2-point markup tools once both points are placed. Dimensions are excluded — they
  // stay open so more stops can be continued along the same line (AutoCAD DIMCONTINUE style).
  useEffect(() => {
    if (!fieldDraft && markupTool && markupTool !== 'cloud' && markupTool !== 'text' && markupTool !== 'dimension' && markupPoints.length === 2) {
      finishOpenMarkup();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markupPoints, markupTool, fieldDraft]);

  const handleMouseDown = (e: MouseEvent) => {
    if (reviewOnly) return;
    const isPanGesture = toolMode === 'pan' || e.button === 1 || spaceHeld.current;
    oneClickPanGesture.current=isPanGesture;
    if (isPanGesture) {
      isPanning.current = true;
      beginPanDrag(e.clientX, e.clientY);
      return;
    }
    suppressStructuralClick.current = false;
    if(useAiWorkflow.getState().oneClickArmed)return;
    const addEdge = !touchInput && toolMode === 'select' && drawTarget === 'room'
      ? (e.target as Element).closest?.('[data-suggestion-edge]') : null;
    if (e.button === 0 && selectedArea?.kind === 'suggestion' && addEdge) {
      const index = Number(addEdge.getAttribute('data-suggestion-edge'));
      const a = selectedArea.points[index], b = selectedArea.points[(index + 1) % selectedArea.points.length];
      if (a && b) {
        const points = selectedArea.points.map(p => ({ ...p }));
        points.splice(index + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        editDetectionCandidate(selectedArea.id, points);
        suppressStructuralClick.current = true;
      }
      return;
    }
    if (e.button === 0 && selectedArea) {
      const native = screenToNative(e.clientX, e.clientY);
      const handleIndex = nearestPointIndex(selectedArea.points, native, VERTEX_HIT_RADIUS_SCREEN / zoom);
      const markupTarget = drawTarget === 'room' && (e.target as Element).closest?.('[data-markup-id], [data-handle-markup-id]');
      if (handleIndex >= 0 || (!markupTarget && pointInPolygon(native, selectedArea.points))) {
        structuralDrag.current = { kind: selectedArea.kind, id: selectedArea.id, start: native,
          placementId: 'placementId' in selectedArea ? selectedArea.placementId : undefined, points: selectedArea.points, offset: { x: 0, y: 0 }, ...(handleIndex >= 0 ? { handleIndex } : {}) };
        return;
      }
    }
    if (toolMode === 'select' && e.button === 0 && project && (drawTarget === 'concrete' || drawTarget === 'rebar')) {
      // Physical-sheet editing owns Mesh gestures while Edit Layout is active.
      if (drawTarget === 'rebar' && meshLayoutView.enabled && meshLayoutView.editing) return;
      const native = screenToNative(e.clientX, e.clientY);
      const selected = drawTarget === 'concrete'
        ? overlayVisible.concrete && concreteOf(project).find((item) => item.id === selectedConcreteId)
        : overlayVisible.rebar && rebarOf(project).find((item) => item.id === selectedRebarId);
      if (selected && selected.kind === 'stirrup' && overlayVisible.rebar) {
        const placement = selected.placements.find((p) => p.id === selectedStirrupPlacementId && p.pageNumber === currentPage);
        if (placement?.kind === 'line') {
          const endpoint = nearestPointIndex([placement.start, placement.end], native, VERTEX_HIT_RADIUS_SCREEN / zoom);
          if (endpoint >= 0 || hitStraightBar(native, placement, 6 / zoom)) barDrag.current = {
            itemId: selected.id, bar: placement, start: native, endpoint: endpoint === 0 ? 'start' : endpoint === 1 ? 'end' : null, preview: null, stirrup: true,
          };
        }
        return;
      }
      if (selected && selected.kind === 'bars'  && selected.drawnBars && overlayVisible.rebar) {
        const bar = selected.drawnBars.find((b) => b.id === selectedDrawnBarId && b.pageNumber === currentPage);
        if (bar) {
          const endpointIndex = nearestPointIndex([bar.start, bar.end], native, VERTEX_HIT_RADIUS_SCREEN / zoom);
          if (endpointIndex >= 0 || hitStraightBar(native, bar, 6 / zoom)) {
            barDrag.current = { itemId: selected.id, bar, start: native,
              endpoint: endpointIndex === 0 ? 'start' : endpointIndex === 1 ? 'end' : null, preview: null };
          }
        } else if (!selectedDrawnBarId && selected.drawnBars.some((b) => b.pageNumber === currentPage && hitStraightBar(native, b, 6 / zoom))) {
          structuralDrag.current = { kind: 'bars', id: selected.id, start: native, points: [], offset: { x: 0, y: 0 }, drawnBars: selected.drawnBars };
        }
        return;
      }
      return;
    }
    if (toolMode === 'select') {
      const handleTarget = (e.target as Element).closest?.('[data-handle-markup-id]');
      if (handleTarget) {
        const id = handleTarget.getAttribute('data-handle-markup-id')!;
        const index = Number(handleTarget.getAttribute('data-handle-index'));
        handleDrag.current = { id, index };
        return;
      }
      const bodyTarget = (e.target as Element).closest?.('[data-markup-id]');
      const id = bodyTarget?.getAttribute('data-markup-id');
      const markup = id ? (project?.markups ?? []).find((m) => m.id === id) : undefined;
      if (markup) {
        setSelectedMarkupId(markup.id);
        markupDrag.current = {
          id: markup.id,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startPoints: markup.points,
          startOffset: markup.offset ?? 0,
        };
        return;
      }
      if (selectedMarkupId) setSelectedMarkupId(null);
    }
    if (toolMode === 'export-region') {
      const native = screenToNative(e.clientX, e.clientY);
      regionDragStart.current = native;
      setRegionDraft({ x: native.x, y: native.y, width: 0, height: 0 });
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (reviewOnly) return;
    if (isPanning.current && updatePanDrag(e.clientX, e.clientY)) {
      return;
    }
    if (barDrag.current) {
      const drag = barDrag.current;
      const native = screenToNative(e.clientX, e.clientY);
      const offset = { x: native.x - drag.start.x, y: native.y - drag.start.y };
      if (!suppressStructuralClick.current && Math.hypot(offset.x, offset.y) * zoom < 3) return;
      suppressStructuralClick.current = true;
      drag.preview = drag.endpoint ? { ...drag.bar, [drag.endpoint]: native } : translateBar(drag.bar, offset);
      setBarPreview({ itemId: drag.itemId, bar: drag.preview, stirrup: drag.stirrup });
      return;
    }
    if (structuralDrag.current) {
      const drag = structuralDrag.current;
      const native = screenToNative(e.clientX, e.clientY);
      const offset = { x: native.x - drag.start.x, y: native.y - drag.start.y };
      if (!suppressStructuralClick.current && Math.hypot(offset.x, offset.y) * zoom < 3) return;
      suppressStructuralClick.current = true;
      drag.offset = offset;
      const points = drag.handleIndex === undefined ? translateArea(drag.points, offset) : reshapeArea(drag.points, drag.handleIndex, native, drag.kind === 'suggestion' ? { polygon: true, allowInvalid: true } : undefined);
      if (!points) return;
      drag.previewPoints = points;
      setStructuralPreview({
        kind: drag.kind, id: drag.id, placementId: drag.placementId,
        ...(drag.drawnBars ? { drawnBars: drag.drawnBars.map((bar) => translateBar(bar, offset)) } : {}),
        points,
      });
      return;
    }
    if (handleDrag.current) {
      const native = screenToNative(e.clientX, e.clientY);
      const markup = (project?.markups ?? []).find((m) => m.id === handleDrag.current!.id);
      if (markup) {
        const points =
          markup.tool === 'dimension'
            ? reshapeDimension(markup.points, handleDrag.current.index, native)
            : markup.points.map((p, i) => (i === handleDrag.current!.index ? native : p));
        updateMarkupQuiet(handleDrag.current.id, { points });
      }
      return;
    }
    if (markupDrag.current) {
      const dx = (e.clientX - markupDrag.current.startClientX) / zoom;
      const dy = (e.clientY - markupDrag.current.startClientY) / zoom;
      const markup = (project?.markups ?? []).find((m) => m.id === markupDrag.current!.id);
      if (markup?.tool === 'dimension') {
        // A dimension only slides along its own normal, so it stays parallel to what it measures.
        const up = dimensionNormal(markupDrag.current.startPoints);
        updateMarkupQuiet(markupDrag.current.id, { offset: markupDrag.current.startOffset + dx * up.x + dy * up.y });
        return;
      }
      const points = markupDrag.current.startPoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      updateMarkupQuiet(markupDrag.current.id, { points });
      return;
    }
    if (regionDragStart.current) {
      const native = screenToNative(e.clientX, e.clientY);
      const start = regionDragStart.current;
      setRegionDraft({
        x: Math.min(start.x, native.x),
        y: Math.min(start.y, native.y),
        width: Math.abs(native.x - start.x),
        height: Math.abs(native.y - start.y),
      });
      return;
    }
    if (toolMode === 'draw-rect' && drawingPoints.length === 1) {
      setHoverPoint(screenToNative(e.clientX, e.clientY));
    }
    if (toolMode === 'markup' && markupTool === 'dimension' && markupPoints.length > 0) {
      setHoverPoint(nextDimensionPoint(markupPoints, screenToNative(e.clientX, e.clientY)));
    }
  };

  const handleMouseUp = () => {
    if (barDrag.current) {
      const drag = barDrag.current;
      barDrag.current = null;
      setBarPreview(null);
      if (drag.preview && drag.stirrup && project) {
        const item = rebarOf(project).find((i) => i.id === drag.itemId);
        const placement = item?.kind === 'stirrup' ? item.placements.find((p) => p.id === drag.bar.id) : undefined;
        if (placement?.kind === 'line') editStirrupPlacement(item!.id, { ...placement, start: drag.preview.start, end: drag.preview.end });
      } else if (drag.preview) editDrawnBar(drag.itemId, drag.preview);
      return;
    }
    if (structuralDrag.current) {
      const drag = structuralDrag.current;
      structuralDrag.current = null;
      setStructuralPreview(null);
      // A click on a selected handle must keep its area selected, even without a drag.
      if (drag.handleIndex !== undefined) suppressStructuralClick.current = true;
      if (drag.kind === 'suggestion') {
        if (drag.previewPoints) editDetectionCandidate(drag.id, drag.previewPoints);
      } else if (drag.drawnBars && drag.kind === 'bars') moveStructuralZone('bars', drag.id, drag.offset);
      else if (drag.previewPoints) editAreaGeometry(drag.kind, drag.id, drag.previewPoints, drag.placementId);
      return;
    }
    if (isPanning.current) {
      isPanning.current = false;
      endPanDrag();
    }
    if (handleDrag.current) {
      // Reshaping a dimension changes what it measures, so its labels are recomputed.
      const markup = (project?.markups ?? []).find((m) => m.id === handleDrag.current!.id);
      const patch =
        markup && markup.tool === 'dimension' && metersPerPixel ? dimensionLabels(markup.points, metersPerPixel) : {};
      updateMarkup(handleDrag.current.id, patch);
      handleDrag.current = null;
    }
    if (markupDrag.current) {
      updateMarkup(markupDrag.current.id, {});
      markupDrag.current = null;
    }
    if (regionDragStart.current) {
      regionDragStart.current = null;
      if (regionDraft && regionDraft.width > 4 / zoom && regionDraft.height > 4 / zoom) {
        setExportRegion(currentPage, regionDraft);
      }
      setRegionDraft(null);
      setToolMode('select');
    }
  };

  const handleDoubleClick = (e: MouseEvent) => {
    if (reviewOnly) return;
    if (useAiWorkflow.getState().oneClickArmed) return;
    if (toolMode !== 'select' || drawTarget !== 'room' || !overlayVisible.finishes || spaceHeld.current) return;
    if (!touchInput && selectedArea?.kind === 'suggestion') {
      const index = nearestPointIndex(selectedArea.points, screenToNative(e.clientX, e.clientY), VERTEX_HIT_RADIUS_SCREEN / zoom);
      if (index >= 0 && selectedArea.points.length > 3) {
        e.stopPropagation();
        editDetectionCandidate(selectedArea.id, selectedArea.points.filter((_, i) => i !== index));
      }
      return;
    }
    if (room?.pageNumber !== currentPage) return;
    // Double-clicking a text note reopens it for editing.
    const bodyTarget = (e.target as Element).closest?.('[data-markup-id]');
    const noteId = bodyTarget?.getAttribute('data-markup-id');
    const note = noteId ? (project?.markups ?? []).find((m) => m.id === noteId && m.tool === 'text') : undefined;
    if (note) {
      e.stopPropagation();
      setTextDraft({ point: note.points[0], markupId: note.id, text: note.text ?? '', rotationDeg: note.rotationDeg ?? 0 });
      return;
    }
    if (!room) return;
    const native = screenToNative(e.clientX, e.clientY);
    const idx = nearestPointIndex(room.points, native, VERTEX_HIT_RADIUS_SCREEN / zoom);
    if (idx >= 0) {
      e.stopPropagation();
      deleteRoomPoint(room.id, idx);
    }
  };

  const selectAt = (native: Point, hitRadius = 6 / zoom) => {
    if (!project) return;
      // In the Concrete tab a click picks a concrete zone and never a room; everywhere else this
      // is the original room hit-test, untouched.
      if (drawTarget === 'concrete') {
        // Hidden zones are not hit-tested: an invisible zone must not catch clicks.
        const zone = !overlayVisible.concrete ? undefined : [...concreteOf(project)].reverse().find((z) => z.pageNumber === currentPage && polygonAreaPx(z.points) > 0 && pointInPolygon(native, z.points));
        setSelectedConcreteId(zone ? zone.id : null);
        return;
      }
      // Same for the Rebar tab: only mesh zones (manual bars have no shape) and only while visible.
      if (drawTarget === 'rebar') {
        if (overlayVisible.rebar) {
          for (const item of [...rebarOf(project)].reverse()) {
            if (item.kind === 'stirrup') {
              const hit = [...item.placements].reverse().find((p) => p.pageNumber === currentPage && (p.kind === 'line' ? hitStraightBar(native, p, hitRadius) : pointInPolygon(native, p.points)));
              if (hit) { selectStirrupPlacement(item.id, hit.id); return; }
              continue;
            }
            if (item.kind !== 'bars' || !item.drawnBars) continue;
            const bar = [...item.drawnBars].reverse().find((b) => b.pageNumber === currentPage && hitStraightBar(native, b, hitRadius));
            if (bar) {
              setSelectedRebarId(item.id);
              setSelectedDrawnBarId(bar.id);
              return;
            }
          }
        }
        const mesh = !overlayVisible.rebar
          ? undefined
          : [...rebarOf(project)].reverse().find((m) => {
            const points = m.kind === 'mesh' ? m.points : m.kind === 'bars' ? m.barsZone?.points : undefined;
            return m.pageNumber === currentPage && points && polygonAreaPx(points) > 0 && pointInPolygon(native, points);
          });
        setSelectedRebarId(mesh ? mesh.id : null);
        return;
      }
      // Suggestions share native hit-testing with rooms, but never enter the plan while editing.
      const candidate = !touchInput && !reviewOnly && overlayVisible.finishes
        ? [...detectionCandidates].reverse().find(c => c.localAi?.planId === project.id && c.pageNumber === currentPage &&
          (pointInPolygon(native, c.points) || nearestPointIndex(c.points, native, hitRadius) >= 0)) : undefined;
      selectDetectionCandidate(candidate?.id ?? null);
      if (candidate) return;
      // A hidden Finishes overlay is not hit-tested either.
      const hit = !overlayVisible.finishes ? undefined : [...project.rooms].reverse().find((r) => r.pageNumber === currentPage && polygonAreaPx(r.points) > 0 && pointInPolygon(native, r.points));
      setSelectedRoomId(hit ? hit.id : null);
  };

  const handleClick = (e: MouseEvent) => {
    if (reviewOnly) return;
    if (suppressStructuralClick.current) {
      suppressStructuralClick.current = false;
      return;
    }
    if (isPanning.current || structuralDrag.current) return;
    const native = screenToNative(e.clientX, e.clientY);
    if(useAiWorkflow.getState().oneClickArmed){
      if(e.button!==0||spaceHeld.current||oneClickPanGesture.current){oneClickPanGesture.current=false;return;}
      void startAiDetection(native);return;
    }

    if (toolMode === 'calibrate') {
      if (calibrationPoints.length < 2) addCalibrationPoint(native);
      return;
    }

    if (toolMode === 'draw' && stirrupDrawing === 'line') {
      if (drawingPoints.length === 0) addDrawingPoint(native);
      else finishStirrupLine(drawingPoints[0], orthoSnap ? snapOrtho(drawingPoints[0], native) : native);
      return;
    }
    if (toolMode === 'draw' && barsDrawing === 'line') {
      if (drawingPoints.length === 0) addDrawingPoint(native);
      else finishDrawnBar(drawingPoints[0], orthoSnap ? snapOrtho(drawingPoints[0], native) : native);
      return;
    }

    if (toolMode === 'draw') {
      if (drawingPoints.length >= 3) {
        const first = drawingPoints[0];
        const distScreen = Math.hypot(native.x - first.x, native.y - first.y) * zoom;
        if (distScreen < 10) {
          finishDrawing();
          return;
        }
      }
      addDrawingPoint(native);
      return;
    }

    if (toolMode === 'draw-rect') {
      if (drawingPoints.length === 0) {
        addDrawingPoint(native);
      } else {
        finishRectangle(drawingPoints[0], native);
        setHoverPoint(null);
      }
      return;
    }

    if (toolMode === 'measure' && measureTool) {
      if (measureTool === 'distance') {
        const point = orthoSnap && measurePoints.length > 0 ? snapOrtho(measurePoints[0], native) : native;
        addMeasurePoint(point);
        return;
      }
      if (measureTool === 'area' && areaShape === 'rectangle') {
        if (measurePoints.length === 0) {
          addMeasurePoint(native);
          return;
        }
        const a = measurePoints[0];
        finishOpenMeasurement([
          { x: a.x, y: a.y },
          { x: native.x, y: a.y },
          { x: native.x, y: native.y },
          { x: a.x, y: native.y },
        ]);
        return;
      }
      const point = orthoSnap && measurePoints.length > 0 ? snapOrtho(measurePoints[measurePoints.length - 1], native) : native;
      if (measurePoints.length >= 3) {
        const first = measurePoints[0];
        const distScreen = Math.hypot(point.x - first.x, point.y - first.y) * zoom;
        if (distScreen < 10) {
          finishOpenMeasurement();
          return;
        }
      }
      addMeasurePoint(point);
      return;
    }

    if (toolMode === 'markup' && markupTool) {
      if (markupTool === 'text') {
        setTextDraft({ point: native, text: '', rotationDeg: 0 });
        return;
      }
      if (markupTool === 'cloud') {
        if (markupPoints.length >= 3) {
          const first = markupPoints[0];
          const distScreen = Math.hypot(native.x - first.x, native.y - first.y) * zoom;
          if (distScreen < 10) {
            finishOpenMarkup();
            return;
          }
        }
        addMarkupPoint(markupOrtho && markupPoints.length > 0 ? snapOrtho(markupPoints[markupPoints.length - 1], native) : native);
        return;
      }
      if (markupTool === 'dimension') {
        const point = nextDimensionPoint(markupPoints, native);
        // Clicking the last stop again ends the run (a double-click lands here too).
        if (markupPoints.length >= 2) {
          const last = markupPoints[markupPoints.length - 1];
          if (Math.hypot(point.x - last.x, point.y - last.y) * zoom < 10) {
            finishOpenMarkup();
            return;
          }
        }
        addMarkupPoint(point);
        setHoverPoint(null);
        return;
      }
      addMarkupPoint(markupOrtho && markupTool === 'arrow' && markupPoints.length === 1 ? snapOrtho(markupPoints[0], native) : native);
      return;
    }

    if (toolMode === 'select') selectAt(native);
  };

  const stirrupItem = project && rebarOf(project).find((item) => item.id === selectedRebarId && item.kind === 'stirrup');
  const stirrupLine = stirrupItem?.kind === 'stirrup' ? stirrupItem.placements.find((p): p is StirrupLinePlacement => p.kind === 'line' && p.id === selectedStirrupPlacementId && p.pageNumber === currentPage) : undefined;
  const individual = project && rebarOf(project).find((item) => item.id === selectedRebarId && item.kind === 'bars');
  const selectedTouchBar = individual?.kind === 'bars' ? individual.drawnBars?.find((bar) => bar.id === selectedDrawnBarId && bar.pageNumber === currentPage) : undefined;
  const meshTouch = useTouchMeshLayout(transform);
  const touch = useTouchTakeoff({
    transform, area: selectedArea?.kind === 'suggestion' ? null : selectedArea, bar: selectedTouchBar && individual ? { itemId: individual.id, bar: selectedTouchBar } : null, line: stirrupLine && stirrupItem ? { itemId: stirrupItem.id, placement: stirrupLine } : null,
    contextKey: `${project?.id}:${currentPage}:${toolMode}:${drawTarget}:${selectedRoomId}:${selectedDetectionCandidateId}:${selectedConcreteId}:${selectedRebarId}:${selectedStirrupPlacementId}:${selectedMarkupId}:${selectedDrawnBarId}`,
    onAreaPreview: setStructuralPreview, onLinePreview: setBarPreview, onTextDraft: setTextDraft,
    finishMeasurement: finishOpenMeasurement, finishMarkup: finishOpenMarkup,
  });

  const desktopStart = useRef<Pick<ReturnType<typeof useAppStore.getState>, 'project' | 'history' | 'future' | 'dirty'> | null>(null);
  const navigation = usePlanNavigation({
    transform, reviewOnly, contextKey: `${project?.id}:${currentPage}:${toolMode}:${drawTarget}:${selectedRoomId}:${selectedDetectionCandidateId}:${selectedConcreteId}:${selectedRebarId}:${selectedStirrupPlacementId}:${selectedMarkupId}:${selectedDrawnBarId}:${meshLayoutView.level}:${meshLayoutView.editing}`,
    editing: { begin: (x, y, target, pointerType) => meshTouch.active ? meshTouch.editing.begin(x, y, target, pointerType) : touch.editing.begin(x, y, target, pointerType),
      move: (x, y) => { meshTouch.editing.move(x, y); touch.editing.move(x, y); },
      end: (x, y) => { meshTouch.editing.end(x, y); touch.editing.end(x, y); },
      cancel: () => { meshTouch.editing.cancel(); touch.editing.cancel(); } }, managedMouse: fieldDraft || geometryAction !== 'browse',
    onDesktopStart: () => {
      const { project, history, future, dirty } = useAppStore.getState();
      desktopStart.current = { project, history, future, dirty };
    },
    onDesktopCancel: () => {
      const before = desktopStart.current;
      if (before && before.project?.id === useAppStore.getState().project?.id && (handleDrag.current || markupDrag.current)) {
        useAppStore.setState(before);
        void useAppStore.getState().persist();
      }
      desktopStart.current = null;
      structuralDrag.current = null; barDrag.current = null; handleDrag.current = null; markupDrag.current = null;
      isPanning.current = false; endPanDrag(); regionDragStart.current = null;
      setStructuralPreview(null); setBarPreview(null); setRegionDraft(null);
    },
    onTap: (x, y, target) => {
      if (meshTouch.tap(x, y) || touch.tap(x, y)) return;
      const markupId = target instanceof Element ? target.closest('[data-markup-id]')?.getAttribute('data-markup-id') : null;
      if (overlayVisible.markups && markupId) { setSelectedMarkupId(markupId); return; }
      setSelectedMarkupId(null);
      selectAt(screenToNative(x, y), nativeHitRadius(transform.getView().zoom, 'touch', 6));
    },
  });

  if (!project) return null;

  const strokeW = 2 / zoom;
  const vertexR = 5 / zoom;

  return (
    <div
      ref={containerRef}
      className={`pdf-viewport tool-${toolMode}${oneClickArmed?' one-click-ai-armed':''}`}
      {...navigation}
      onPointerCancelCapture={(event) => {
        if (navigation.onPointerCancelCapture(event) && event.pointerType !== 'mouse') { touch.cancel(); meshTouch.editing.cancel(); }
      }}
      onLostPointerCaptureCapture={(event) => {
        if (navigation.onPointerCancelCapture(event) && event.pointerType !== 'mouse') { touch.cancel(); meshTouch.editing.cancel(); }
      }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      onClick={handleClick}
    >
      {(reviewOnly || touchInput || fieldDraft || layout === 'compact' || geometryAction !== 'browse') && <FieldTools controls={touch} />}
      {selectedArea?.kind === 'suggestion' && <div className="ai-suggestion-edit-help" role="status">
        AI draft · Drag vertices · Edge + adds a vertex · Double-click vertex deletes · Esc deselects
      </div>}
      {loadError && <div className="viewer-error">{loadError}</div>}
      <div
        className="pdf-content"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, width: pageSize.width, height: pageSize.height }}
      >
        {/* Retain the Hebrew canvas context for the internal PDF.js fallback. */}
        <canvas ref={canvasRef} dir="rtl" lang="he"
          style={{ visibility: planSource && renderedKey === sourceKey ? 'visible' : 'hidden' }} />
        <div ref={detailHostRef} aria-hidden="true" dir="rtl" lang="he"
          style={{ position: 'absolute', left: 0, top: 0, width: pageSize.width, height: pageSize.height,
            overflow: 'hidden', pointerEvents: 'none' }} />
        {pageSize.width > 0 && (
          // Pinned to RTL rather than inherited from the page: the plan's labels keep the layout they
          // were drawn with (and that the export rasterizers reproduce) whatever the UI direction.
          <svg
            className="overlay-svg"
            width={pageSize.width}
            height={pageSize.height}
            viewBox={`0 0 ${pageSize.width} ${pageSize.height}`}
            direction="rtl"
          >
            {/* Measurement grid: first child, so everything else draws over it. Native pixels like the
                rest of the overlay, so it pans and zooms with the plan; the spacing is the real-world
                one over the page's own scale and does not depend on zoom or UI direction. */}
            {gridEnabled && grid && <GridLayer grid={grid} width={pageSize.width} height={pageSize.height} zoom={zoom} opacity={gridOpacity} />}
            {overlayVisible.finishes &&
              (structuralPlan ?? project).rooms
                .filter((r) => r.pageNumber === currentPage)
                .map((r) => {
                const isSelected = r.id === selectedRoomId;
                const pts = r.points.map((p) => `${p.x},${p.y}`).join(' ');
                return (
                  <g key={r.id}>
                    <polygon
                      points={pts}
                      fill={r.color}
                      fillOpacity={isSelected ? 0.28 : 0.15}
                      stroke={r.color}
                      strokeWidth={isSelected ? strokeW * 1.5 : strokeW}
                    />
                    {isSelected &&
                      (() => {
                        const c = polygonCentroid(r.points);
                        return (
                          <text x={c.x} y={c.y} fontSize={10.5 / zoom} fill={r.color} fontWeight={600} textAnchor="middle" dominantBaseline="middle" direction={labelDirection(r.name, language)}>
                            {r.name}
                          </text>
                        );
                      })()}
                  </g>
                );
              })}

            {overlayVisible.rebar && <StirrupOverlay plan={structuralPlan ?? project} pageNumber={currentPage} selectedItemId={selectedRebarId} selectedPlacementId={selectedStirrupPlacementId} zoom={zoom} />}

            {/* Concrete and rebar zones each follow their own View switch: hidden means not drawn here and
                not selectable (see handleClick). */}
            {overlayVisible.concrete && (
              <ConcreteZones
                elements={concreteOf(structuralPlan ?? project).filter((z) => z.pageNumber === currentPage)}
                selectedId={selectedConcreteId}
                strokeW={strokeW}
                zoom={zoom}
              />
            )}
            <MeshLayoutOverlay plan={structuralPlan ?? project} pageNumber={currentPage} selectedId={selectedRebarId} zoom={zoom} visible={overlayVisible.rebar} screenToNative={screenToNative} interactionAllowed={!reviewOnly && toolMode === 'select'} />
            {overlayVisible.rebar && (
              <RebarZones pageNumber={currentPage} pages={project.pages} selectedBarId={selectedDrawnBarId} calibration={project.pages[currentPage]?.calibration ?? null} items={rebarOf(structuralPlan ?? project).filter((m) => m.kind === 'mesh' ? m.pageNumber === currentPage : m.kind === 'bars' ? (m.drawnBars?.some((b) => b.pageNumber === currentPage) ?? (m.barsZone?.pageNumber ?? m.pageNumber) === currentPage) : false)} selectedId={selectedRebarId} strokeW={strokeW} zoom={zoom} />
            )}

            {/* Draft suggestions share editing helpers, but are never part of Plan.rooms. */}
            {detectionCandidates
              .filter((c) => c.pageNumber === currentPage && (!c.localAi || c.localAi.planId === project.id) && overlayVisible.finishes)
              .map((c) => {
                const selected = selectedArea?.kind === 'suggestion' && selectedArea.id === c.id;
                const points = selected ? selectedArea.points : c.points;
                const pts = points.map((p) => `${p.x},${p.y}`).join(' ');
                const label = c.localAi ? aiCandidateLabel(c, t) : c.suggestedName || t('viewer.notDetected');
                const centre = polygonCentroid(points);
                return (
                  <g key={c.id} data-ai-suggestion-id={c.id} pointerEvents="none">
                    <polygon
                      points={pts}
                      fill={CANDIDATE_COLOR}
                      fillOpacity={selected ? 0.18 : 0.08}
                      stroke={c.validationProblems?.length ? "#dc2626" : CANDIDATE_COLOR}
                      strokeWidth={selected ? 3 / zoom : strokeW}
                      strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                    />
                    <text
                      x={centre.x}
                      y={centre.y}
                      fontSize={9.5 / zoom}
                      fill={CANDIDATE_COLOR}
                      fontWeight={600}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      direction={labelDirection(label, language)}
                    >
                      {label}
                    </text>
                  </g>
                );
              })}

            {toolMode === 'draw' && (barsDrawing === 'line' || stirrupDrawing === 'line') && drawingPoints.length === 1 && hoverPoint && <line
              x1={drawingPoints[0].x} y1={drawingPoints[0].y} x2={hoverPoint.x} y2={hoverPoint.y}
              stroke="#c2410c" strokeWidth={strokeW} strokeDasharray={`${4 / zoom} ${4 / zoom}`} />}
            {selectedArea && selectedArea.points.length >= 3 && <g>
              <polygon points={selectedArea.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="transparent"
                pointerEvents={selectedArea.kind === 'suggestion' ? "none" : "all"} style={{ cursor: structuralDrag.current ? 'grabbing' : 'grab' }} />
              <AreaGeometryHandles points={selectedArea.points} color={selectedArea.color} zoom={zoom} touch={touchInput} polygon={selectedArea.kind === 'suggestion'} />
              {selectedArea.kind === 'suggestion' && selectedArea.points.map((a, index) => {
                const b = selectedArea.points[(index + 1) % selectedArea.points.length];
                const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
                return <g key={`edge-${index}`}>
                  <circle cx={x} cy={y} r={5 / zoom} fill="#fff" stroke={CANDIDATE_COLOR} strokeWidth={1.5 / zoom}
                    pointerEvents="all" data-suggestion-edge={index} style={{ cursor: 'copy' }}><title>Add vertex on edge</title></circle>
                  <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={10 / zoom} fill={CANDIDATE_COLOR} pointerEvents="none">+</text>
                </g>;
              })}
            </g>}
            {/* In-progress polygon drawing */}
            {toolMode === 'draw' && drawingPoints.length > 0 && (
              <g>
                <polyline
                  points={drawingPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth={strokeW}
                  strokeDasharray={`${4 / zoom} ${4 / zoom}`}
                />
                {drawingPoints.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={vertexR} fill="#ef4444" />
                ))}
              </g>
            )}

            {/* In-progress rectangle drawing */}
            {toolMode === 'draw-rect' && drawingPoints.length > 0 && (
              <g>
                {hoverPoint && (
                  <rect
                    x={Math.min(drawingPoints[0].x, hoverPoint.x)}
                    y={Math.min(drawingPoints[0].y, hoverPoint.y)}
                    width={Math.abs(hoverPoint.x - drawingPoints[0].x)}
                    height={Math.abs(hoverPoint.y - drawingPoints[0].y)}
                    fill="#ef4444"
                    fillOpacity={0.12}
                    stroke="#ef4444"
                    strokeWidth={strokeW}
                    strokeDasharray={`${4 / zoom} ${4 / zoom}`}
                  />
                )}
                <circle cx={drawingPoints[0].x} cy={drawingPoints[0].y} r={vertexR} fill="#ef4444" />
              </g>
            )}

            {touch.rectangleDraft && <polygon points={touch.rectangleDraft.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#0ea5e9" strokeWidth={strokeW} strokeDasharray={`${4 / zoom} ${4 / zoom}`} />}
            {touch.precision && <g pointerEvents="none" transform={`translate(${touch.precision.x} ${touch.precision.y})`} stroke="#0ea5e9" strokeWidth={1.5 / zoom}>
              <path d={`M ${-8 / zoom} 0 H ${8 / zoom} M 0 ${-8 / zoom} V ${8 / zoom}`} />
              <line x1={0} y1={-8 / zoom} x2={0} y2={-32 / zoom} strokeDasharray={`${2 / zoom} ${2 / zoom}`} />
              <circle cx={0} cy={-40 / zoom} r={8 / zoom} fill="#fff" />
              <path d={`M ${-5 / zoom} ${-40 / zoom} H ${5 / zoom} M 0 ${-45 / zoom} V ${-35 / zoom}`} />
            </g>}

            {/* Calibration line */}
            {calibrationPoints.length > 0 && (
              <g>
                {calibrationPoints.length === 2 && (
                  <line
                    x1={calibrationPoints[0].x}
                    y1={calibrationPoints[0].y}
                    x2={calibrationPoints[1].x}
                    y2={calibrationPoints[1].y}
                    stroke="#f59e0b"
                    strokeWidth={strokeW * 1.5}
                  />
                )}
                {calibrationPoints.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={vertexR * 1.2} fill="#f59e0b" />
                ))}
              </g>
            )}

            {/* Measurement in progress */}
            {measurePoints.length > 0 && (
              <g>
                <polyline
                  points={measurePoints.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="#0ea5e9"
                  strokeWidth={strokeW}
                  strokeDasharray={`${4 / zoom} ${4 / zoom}`}
                />
                {measurePoints.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={vertexR} fill="#0ea5e9" />
                ))}
              </g>
            )}

            {/* Finished measurements on this page — AutoCAD-style: distance line has its value rotated to follow the line and sits above it; perimeter/area vertices get a small dot. */}
            {measurementsVisible &&
              (project.measurements ?? [])
                .filter((m) => m.pageNumber === currentPage)
                .map((m) => {
                  const color = m.areaKind ? (project.areaKindColors ?? DEFAULT_AREA_KIND_COLORS)[m.areaKind] : '#0ea5e9';
                  const vertexDotR = 3 / zoom;
                  const tickLen = 14 / zoom;
                  const isDistance = m.tool === 'distance';
                  const isWall = m.tool === 'area' && m.calcMode === 'wall';
                  let labelX: number;
                  let labelY: number;
                  let angleDeg = 0;
                  if (isDistance) {
                    const midX = (m.points[0].x + m.points[1].x) / 2;
                    const midY = (m.points[0].y + m.points[1].y) / 2;
                    const segDx = m.points[1].x - m.points[0].x;
                    const segDy = m.points[1].y - m.points[0].y;
                    const segLen = Math.hypot(segDx, segDy) || 1;
                    let perpX = -segDy / segLen;
                    let perpY = segDx / segLen;
                    if (perpY > 0) {
                      perpX = -perpX;
                      perpY = -perpY;
                    }
                    const offset = 12 / zoom;
                    labelX = midX + perpX * offset;
                    labelY = midY + perpY * offset;
                    angleDeg = (Math.atan2(segDy, segDx) * 180) / Math.PI;
                    if (angleDeg > 90) angleDeg -= 180;
                    if (angleDeg < -90) angleDeg += 180;
                  } else {
                    const c = polygonCentroid(m.points);
                    labelX = c.x;
                    labelY = c.y;
                  }
                  return (
                    <g key={m.id}>
                      {isDistance ? (
                        <>
                          <line x1={m.points[0].x} y1={m.points[0].y} x2={m.points[1].x} y2={m.points[1].y} stroke={color} strokeWidth={strokeW} />
                          {(() => {
                            const [a1, b1] = tickMarkEndpoints(m.points[0], m.points[1], tickLen);
                            const [a2, b2] = tickMarkEndpoints(m.points[1], m.points[0], tickLen);
                            return (
                              <>
                                <line x1={a1.x} y1={a1.y} x2={b1.x} y2={b1.y} stroke={color} strokeWidth={strokeW} />
                                <line x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y} stroke={color} strokeWidth={strokeW} />
                              </>
                            );
                          })()}
                        </>
                      ) : (
                        <>
                          <polygon
                            points={m.points.map((p) => `${p.x},${p.y}`).join(' ')}
                            fill={color}
                            fillOpacity={m.areaKind ? 0.28 : 0.12}
                            stroke={color}
                            strokeWidth={strokeW}
                          />
                          {m.tool !== 'area' &&
                            m.points.map((p, i) => (
                              <circle key={i} cx={p.x} cy={p.y} r={vertexDotR} fill={color} />
                            ))}
                        </>
                      )}
                      {(m.tool !== 'area' || !m.areaKind || isWall) && (
                        <>
                          {isWall && <circle cx={labelX} cy={labelY} r={9 / zoom} fill="#ffffff" fillOpacity={0.9} />}
                          <text
                            x={labelX}
                            y={labelY}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize={12 / zoom}
                            fill={color}
                            fontWeight={600}
                            direction={labelDirection(isWall ? '' : measurementLabel(m), language)}
                            transform={isDistance ? `rotate(${angleDeg} ${labelX} ${labelY})` : undefined}
                          >
                            {isWall ? (areaNumbers.get(m.id) ?? '') : measurementLabel(m)}
                          </text>
                        </>
                      )}
                    </g>
                  );
                })}

            {/* Dimension run in progress — live preview of the chain, including the segment under the cursor */}
            {markupPoints.length > 0 && markupTool === 'dimension' && (() => {
              const preview = hoverPoint ? [...markupPoints, hoverPoint] : markupPoints;
              const labels = metersPerPixel && preview.length >= 2 ? dimensionLabels(preview, metersPerPixel) : undefined;
              return (
                <g>
                  <DimensionShape
                    points={preview}
                    color={markupColor}
                    text={labels?.text}
                    segmentTexts={labels?.segmentTexts}
                    fontScale={markupFontScale}
                    strokeW={strokeW}
                    dashed
                  />
                  {markupPoints.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={vertexR} fill={markupColor} />
                  ))}
                </g>
              );
            })()}

            {/* Markup in progress (cloud multi-point) */}
            {markupPoints.length > 0 && markupTool !== 'dimension' && (
              <g>
                <polyline
                  points={markupPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={markupColor}
                  strokeWidth={strokeW}
                  strokeDasharray={`${4 / zoom} ${4 / zoom}`}
                />
                {markupPoints.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={vertexR} fill={markupColor} />
                ))}
              </g>
            )}

            {/* Finished markups on this page */}
            {overlayVisible.markups &&
              orderMarkups((project.markups ?? []).filter((m) => m.pageNumber === currentPage)).map((m) => (
                <MarkupShape key={m.id} markup={m} strokeW={strokeW} draggable={toolMode === 'select'} />
              ))}

            {/* Resize/reshape handles for the selected markup (select tool only) */}
            {toolMode === 'select' &&
              selectedMarkupId &&
              (() => {
                const selected = (project.markups ?? []).find((m) => m.id === selectedMarkupId && m.pageNumber === currentPage);
                if (!selected) return null;
                return (
                  <g>
                    {selected.points.map((p, i) => (
                      <circle
                        key={i}
                        cx={p.x}
                        cy={p.y}
                        r={vertexR * 1.4}
                        fill="#fff"
                        stroke="#2563eb"
                        strokeWidth={strokeW * 1.2}
                        data-handle-markup-id={selected.id}
                        data-handle-index={i}
                        style={{ pointerEvents: 'auto', cursor: 'grab' }}
                      />
                    ))}
                  </g>
                );
              })()}
          </svg>
        )}

        {/* Export region selection — kept in a separate svg so it's never rasterized into the exported PDF preview. */}
        {pageSize.width > 0 && (exportRegions[currentPage] || regionDraft) && (
          <svg className="overlay-svg region-select-svg" width={pageSize.width} height={pageSize.height} viewBox={`0 0 ${pageSize.width} ${pageSize.height}`}>
            {exportRegions[currentPage] && !regionDraft && (
              <rect
                x={exportRegions[currentPage].x}
                y={exportRegions[currentPage].y}
                width={exportRegions[currentPage].width}
                height={exportRegions[currentPage].height}
                fill="none"
                stroke="#0f172a"
                strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                strokeWidth={strokeW}
              />
            )}
            {regionDraft && (
              <rect
                x={regionDraft.x}
                y={regionDraft.y}
                width={regionDraft.width}
                height={regionDraft.height}
                fill="#0f172a"
                fillOpacity={0.08}
                stroke="#0f172a"
                strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                strokeWidth={strokeW}
              />
            )}
          </svg>
        )}
      </div>

      {textDraft && (
        <TextNoteDialog
          initialText={textDraft.text}
          initialRotation={textDraft.rotationDeg}
          onCancel={() => { setTextDraft(null); if (fieldDraft) touch.cancel(); }}
          onSubmit={(text, rotationDeg) => {
            if (textDraft.markupId) {
              updateMarkup(textDraft.markupId, { text, rotationDeg });
            } else {
              finishMarkup({
                id: uuid(),
                pageNumber: currentPage,
                tool: 'text',
                points: [textDraft.point],
                color: markupColor,
                text,
                rotationDeg,
                fontScale: markupFontScale,
                createdAt: Date.now(),
              });
            }
            setTextDraft(null);
            if (fieldDraft) { useAppStore.getState().setToolMode('select'); useFieldWorkflowStore.getState().setDraft(false); }
          }}
        />
      )}

      {toolMode === 'export-region' && !regionDraft && (
        <div className="export-region-hint">{t('viewer.exportRegionHint')}</div>
      )}

      {/* Scale-dependent tools only: measuring and dimension markups produce real-world numbers, so
          on an unscaled page they would silently read 0. Drawing a room is never blocked or warned
          about — geometry is fine without a scale, only the quantity needs one. */}
      {needsCalibrationHint && (
        <div className="export-region-hint cal-hint-warning">
          {t('viewer.notCalibrated')}
        </div>
      )}

      {pageSize.width > 0 && (
        <button
          data-plan-control="fit"
          className="btn-secondary small reset-view-btn"
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            fitToContainer(pageSize.width, pageSize.height);
          }}
          title={t('viewer.resetViewHint')}
        >
          ⤢ {t('viewer.resetView')}
        </button>
      )}
    </div>
  );
}
