import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { v4 as uuid } from 'uuid';
import { loadPdfPlanSource, type PdfPlanSource } from '../lib/planSource';
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
import { loadPdfBlob } from '../db/database';
import { useLanguage, useT } from '../i18n';
import { labelDirection } from '../lib/textDirection';
import { computeGrid } from '../lib/grid';
import { useGridStore } from '../store/gridStore';
import GridLayer from './GridLayer';
import ConcreteZones from './ConcreteZones';
import RebarZones from './RebarZones';
import { MeshLayoutOverlay } from './MeshLayoutPreview';
import { concreteOf, rebarOf } from '../lib/structuralPlan';
import { updateConcreteElement, updateRebarItem } from '../lib/structuralMutations';
import type { DrawnStraightBar } from '../types/structural';
import { hitStraightBar, translateBar } from '../lib/straightBarsGeometry';
import { useMeshLayoutView } from '../store/meshLayoutPreviewStore';

const VERTEX_HIT_RADIUS_SCREEN = 9;
/** New masks start opaque white, the colour of the paper they hide. */
const MASK_COLOR = '#ffffff';
/** Detection suggestions are drawn in one neutral colour — they are not rooms and have no room colour yet. */
const CANDIDATE_COLOR = '#0ea5e9';
const RENDER_SCALE = Math.min(4, Math.max(2, (window.devicePixelRatio || 1) * 2));

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
  const t = useT();
  const language = useLanguage();
  const project = useAppStore((s) => s.project);
  const currentPage = useAppStore((s) => s.currentPage);
  const setNumPages = useAppStore((s) => s.setNumPages);
  const toolMode = useAppStore((s) => s.toolMode);
  const overlayVisible = useAppStore((s) => s.overlayVisible);
  const drawTarget = useAppStore((s) => s.drawTarget);
  const barsDrawing = useAppStore((s) => s.barsDrawing);
  const finishDrawnBar = useAppStore((s) => s.finishDrawnBar);
  const selectedDrawnBarId = useAppStore((s) => s.selectedDrawnBarId);
  const setSelectedDrawnBarId = useAppStore((s) => s.setSelectedDrawnBarId);
  const editDrawnBar = useAppStore((s) => s.editDrawnBar);
  const selectedConcreteId = useAppStore((s) => s.selectedConcreteId);
  const setSelectedConcreteId = useAppStore((s) => s.setSelectedConcreteId);
  const selectedRebarId = useAppStore((s) => s.selectedRebarId);
  const setSelectedRebarId = useAppStore((s) => s.setSelectedRebarId);
  const moveStructuralZone = useAppStore((s) => s.moveStructuralZone);
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
  const moveRoomPoint = useAppStore((s) => s.moveRoomPoint);
  const deleteRoomPoint = useAppStore((s) => s.deleteRoomPoint);
  const persist = useAppStore((s) => s.persist);
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
  const detectionCandidates = useAppStore((s) => s.detectionCandidates);
  const clearDetectionCandidates = useAppStore((s) => s.clearDetectionCandidates);
  const deleteMarkup = useAppStore((s) => s.deleteMarkup);
  const deleteRoom = useAppStore((s) => s.deleteRoom);

  const { containerRef, zoom, pan, screenToNative, handleWheel, fitToContainer, beginPanDrag, updatePanDrag, endPanDrag } =
    useCanvasTransform();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [planSource, setPlanSource] = useState<PdfPlanSource | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const vertexDrag = useRef<{ pointIndex: number } | null>(null);
  const structuralDrag = useRef<{
    kind: 'concrete' | 'mesh' | 'bars'; id: string; start: Point; points: Point[]; offset: Point; drawnBars?: DrawnStraightBar[];
  } | null>(null);
  const [structuralPreview, setStructuralPreview] = useState<{
    kind: 'concrete' | 'mesh' | 'bars'; id: string; points: Point[]; drawnBars?: DrawnStraightBar[];
  } | null>(null);
  const barDrag = useRef<{ itemId: string; bar: DrawnStraightBar; start: Point; endpoint: 'start' | 'end' | null; preview: DrawnStraightBar | null } | null>(null);
  const [barPreview, setBarPreview] = useState<{ itemId: string; bar: DrawnStraightBar } | null>(null);
  const suppressStructuralClick = useRef(false);
  const structuralPlan = useMemo(() => {
    if (!project) return project;
    if (barPreview) {
      const item = rebarOf(project).find((i) => i.id === barPreview.itemId);
      if (item?.kind === 'bars' && item.drawnBars) return updateRebarItem(project, item.id, {
        drawnBars: item.drawnBars.map((bar) => bar.id === barPreview.bar.id ? barPreview.bar : bar),
      });
    }
    if (!structuralPreview) return project;
    return structuralPreview.kind === 'concrete'
      ? updateConcreteElement(project, structuralPreview.id, { points: structuralPreview.points })
      : (() => {
        const item = rebarOf(project).find((i) => i.id === structuralPreview.id);
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
  }, [project, currentPage, toolMode, drawTarget, selectedConcreteId, selectedRebarId, selectedDrawnBarId,
    overlayVisible.concrete, overlayVisible.rebar, meshLayoutView.editing]);

  const spaceHeld = useRef(false);
  const isPanning = useRef(false);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const regionDragStart = useRef<Point | null>(null);
  const [regionDraft, setRegionDraft] = useState<ExportRegion | null>(null);
  /** Open text-note editor: a new note at `point`, or an existing one when `markupId` is set. */
  const [textDraft, setTextDraft] = useState<{ point: Point; markupId?: string; text: string; rotationDeg: number } | null>(null);
  const markupDrag = useRef<{ id: string; startClientX: number; startClientY: number; startPoints: Point[]; startOffset: number } | null>(
    null,
  );
  const handleDrag = useRef<{ id: string; index: number } | null>(null);

  // Load PDF page
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    setLoadError(null);
    loadPdfPlanSource(project.id, () => loadPdfBlob(project.id), currentPage)
      .then(({ source, numPages }) => {
        if (cancelled) return;
        setNumPages(numPages);
        setPlanSource(source);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err.message || t('viewer.pdfLoadError'));
        trackError('pdf_load', err);
      });
    return () => {
      cancelled = true;
    };
    // Depend on project.id (not the whole project object, which gets a new reference on every
    // edit — rooms, measurements, markups) so this doesn't reload the page and reset the zoom/pan
    // on every unrelated change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, currentPage, setNumPages]);

  // Render page to canvas whenever the plan source changes
  useEffect(() => {
    if (!planSource || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const { width, height } = planSource.getNativeSize();
    setPageSize({ width, height });
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const handle = planSource.render(canvas, RENDER_SCALE);
    let cancelled = false;
    // The plan counts as opened once a page has actually been drawn (the render promise settles
    // on cancel too, hence the flag). The analytics side fires only once per load of the plan.
    void handle.promise.then(() => {
      const { project, numPages } = useAppStore.getState();
      if (!cancelled && project) notePlanRendered(project, numPages);
    });
    return () => {
      cancelled = true;
      handle.cancel();
    };
  }, [planSource]);

  // Fit to container on first load / page size change
  useEffect(() => {
    if (!pageSize.width) return;
    fitToContainer(pageSize.width, pageSize.height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize]);

  const room = project?.rooms.find((r) => r.id === selectedRoomId) ?? null;
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
      if (e.key === 'Escape') {
        structuralDrag.current = null;
        barDrag.current = null;
        setStructuralPreview(null);
        setBarPreview(null);
        clearDrawingPoints();
        clearMeasurePoints();
        clearMarkupPoints();
        // Nothing has been created yet, so this leaves no history entry behind.
        clearDetectionCandidates();
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
        if (drawTarget === 'rebar' && overlayVisible.rebar && selectedRebarId && selectedDrawnBarId) {
          e.preventDefault();
          useAppStore.getState().deleteDrawnBar(selectedRebarId, selectedDrawnBarId);
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
    drawTarget,
    overlayVisible.rebar,
    clearDetectionCandidates,
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
    if (measureTool === 'distance' && measurePoints.length === 2) {
      finishOpenMeasurement();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measurePoints, measureTool]);

  // Auto-finish 2-point markup tools once both points are placed. Dimensions are excluded — they
  // stay open so more stops can be continued along the same line (AutoCAD DIMCONTINUE style).
  useEffect(() => {
    if (markupTool && markupTool !== 'cloud' && markupTool !== 'text' && markupTool !== 'dimension' && markupPoints.length === 2) {
      finishOpenMarkup();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markupPoints, markupTool]);

  const handleMouseDown = (e: MouseEvent) => {
    const isPanGesture = toolMode === 'pan' || e.button === 1 || spaceHeld.current;
    if (isPanGesture) {
      isPanning.current = true;
      beginPanDrag(e.clientX, e.clientY);
      return;
    }
    suppressStructuralClick.current = false;
    if (toolMode === 'select' && e.button === 0 && project && (drawTarget === 'concrete' || drawTarget === 'rebar')) {
      // Physical-sheet editing owns Mesh gestures while Edit Layout is active.
      if (drawTarget === 'rebar' && meshLayoutView.enabled && meshLayoutView.editing) return;
      const native = screenToNative(e.clientX, e.clientY);
      const selected = drawTarget === 'concrete'
        ? overlayVisible.concrete && concreteOf(project).find((item) => item.id === selectedConcreteId)
        : overlayVisible.rebar && rebarOf(project).find((item) => item.id === selectedRebarId);
      if (selected && selected.kind === 'bars' && selected.drawnBars && overlayVisible.rebar) {
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
      const points = selected && ('points' in selected ? selected.points : selected.kind === 'bars' ? selected.barsZone?.points : undefined);
      if (selected && points && selected.pageNumber === currentPage && pointInPolygon(native, points)) {
        structuralDrag.current = {
          kind: drawTarget === 'concrete' ? 'concrete' : selected.kind === 'bars' ? 'bars' : 'mesh', id: selected.id,
          start: native, points, offset: { x: 0, y: 0 },
        };
      }
      return;
    }
    if (toolMode === 'select' && room) {
      const native = screenToNative(e.clientX, e.clientY);
      const idx = nearestPointIndex(room.points, native, VERTEX_HIT_RADIUS_SCREEN / zoom);
      if (idx >= 0) {
        vertexDrag.current = { pointIndex: idx };
        return;
      }
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
      setBarPreview({ itemId: drag.itemId, bar: drag.preview });
      return;
    }
    if (structuralDrag.current) {
      const drag = structuralDrag.current;
      const native = screenToNative(e.clientX, e.clientY);
      const offset = { x: native.x - drag.start.x, y: native.y - drag.start.y };
      if (!suppressStructuralClick.current && Math.hypot(offset.x, offset.y) * zoom < 3) return;
      suppressStructuralClick.current = true;
      drag.offset = offset;
      setStructuralPreview({
        kind: drag.kind, id: drag.id,
        ...(drag.drawnBars ? { drawnBars: drag.drawnBars.map((bar) => translateBar(bar, offset)) } : {}),
        points: drag.points.map((point) => ({ ...point, x: point.x + offset.x, y: point.y + offset.y })),
      });
      return;
    }
    if (vertexDrag.current && room) {
      const native = screenToNative(e.clientX, e.clientY);
      moveRoomPoint(room.id, vertexDrag.current.pointIndex, native);
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
      if (drag.preview) editDrawnBar(drag.itemId, drag.preview);
      return;
    }
    if (structuralDrag.current) {
      const drag = structuralDrag.current;
      structuralDrag.current = null;
      setStructuralPreview(null);
      moveStructuralZone(drag.kind, drag.id, drag.offset);
      return;
    }
    if (isPanning.current) {
      isPanning.current = false;
      endPanDrag();
    }
    if (vertexDrag.current) {
      vertexDrag.current = null;
      void persist();
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
    if (toolMode !== 'select' || drawTarget === 'rebar' || drawTarget === 'concrete') return;
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

  const handleClick = (e: MouseEvent) => {
    if (suppressStructuralClick.current) {
      suppressStructuralClick.current = false;
      return;
    }
    if (isPanning.current || vertexDrag.current) return;
    const native = screenToNative(e.clientX, e.clientY);

    if (toolMode === 'calibrate') {
      if (calibrationPoints.length < 2) addCalibrationPoint(native);
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

    if (toolMode === 'select' && project) {
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
            if (item.kind !== 'bars' || !item.drawnBars) continue;
            const bar = [...item.drawnBars].reverse().find((b) => b.pageNumber === currentPage && hitStraightBar(native, b, 6 / zoom));
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
            const points = m.kind === 'mesh' ? m.points : m.barsZone?.points;
            return m.pageNumber === currentPage && points && polygonAreaPx(points) > 0 && pointInPolygon(native, points);
          });
        setSelectedRebarId(mesh ? mesh.id : null);
        return;
      }
      // A hidden Finishes overlay is not hit-tested either.
      const hit = !overlayVisible.finishes ? undefined : [...project.rooms].reverse().find((r) => r.pageNumber === currentPage && polygonAreaPx(r.points) > 0 && pointInPolygon(native, r.points));
      setSelectedRoomId(hit ? hit.id : null);
    }
  };

  if (!project) return null;

  const strokeW = 2 / zoom;
  const vertexR = 5 / zoom;

  return (
    <div
      ref={containerRef}
      className={`pdf-viewport tool-${toolMode}`}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      onClick={handleClick}
    >
      {loadError && <div className="viewer-error">{loadError}</div>}
      <div
        className="pdf-content"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, width: pageSize.width, height: pageSize.height }}
      >
        {/* Pinned to the Hebrew RTL context: pdf.js lays the plan's text out with the canvas's direction and language, and the plan must look the same in every UI language. */}
        <canvas ref={canvasRef} dir="rtl" lang="he" />
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
              project.rooms
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
                      r.points.map((p, i) => (
                        <circle key={i} cx={p.x} cy={p.y} r={vertexR} fill="#fff" stroke={r.color} strokeWidth={strokeW} />
                      ))}
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
            <MeshLayoutOverlay plan={structuralPlan ?? project} pageNumber={currentPage} selectedId={selectedRebarId} zoom={zoom} visible={overlayVisible.rebar} screenToNative={screenToNative} interactionAllowed={toolMode === 'select'} />
            {overlayVisible.rebar && (
              <RebarZones pageNumber={currentPage} pages={project.pages} selectedBarId={selectedDrawnBarId} calibration={project.pages[currentPage]?.calibration ?? null} items={rebarOf(structuralPlan ?? project).filter((m) => m.pageNumber === currentPage)} selectedId={selectedRebarId} strokeW={strokeW} zoom={zoom} />
            )}

            {/* Detection suggestions: dashed, faint and unselectable, so they never read as rooms
                that are already part of the project. They live in session state only. */}
            {detectionCandidates
              .filter((c) => c.pageNumber === currentPage)
              .map((c) => {
                const pts = c.points.map((p) => `${p.x},${p.y}`).join(' ');
                const label = c.suggestedName || t('viewer.notDetected');
                const centre = polygonCentroid(c.points);
                return (
                  <g key={c.id} pointerEvents="none">
                    <polygon
                      points={pts}
                      fill={CANDIDATE_COLOR}
                      fillOpacity={0.08}
                      stroke={CANDIDATE_COLOR}
                      strokeWidth={strokeW}
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

            {toolMode === 'draw' && barsDrawing === 'line' && drawingPoints.length === 1 && hoverPoint && <line
              x1={drawingPoints[0].x} y1={drawingPoints[0].y} x2={hoverPoint.x} y2={hoverPoint.y}
              stroke="#c2410c" strokeWidth={strokeW} strokeDasharray={`${4 / zoom} ${4 / zoom}`} />}
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
          onCancel={() => setTextDraft(null)}
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
