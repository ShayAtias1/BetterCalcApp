import { useWorkspaceLayout } from '../../hooks/useWorkspaceLayout';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent } from 'react';
import { v4 as uuid } from 'uuid';
import { loadPdfPlanSource, type PdfPlanSource } from '../../lib/planSource';
import { loadComparePdfBlob } from '../../db/database';
import { noteAlignment, trackError } from '../../lib/analytics';
import { useCompareStore } from '../../store/compareStore';
import { useCanvasTransform } from '../../hooks/useCanvasTransform';
import { IDENTITY_TRANSFORM } from '../../types/compare';
import type { Point } from '../../types';
import type { AreaKind, ExportRegion, Markup } from '../../types/compare';
import { applyAlignment, invertAlignment, solveAlignment } from '../../lib/alignment';
import { polygonAreaM2, polygonPerimeterM, longestEdgePx, distancePx, pxToMeters, round, cloudPath, snapOrtho, projectOntoLine, polygonCentroid, tickMarkEndpoints, arrowHeadPoints } from '../../lib/geometry';
import { measurementLabel } from '../../lib/measurementValues';
import { changeNumbering } from '../../lib/changeMeasurements';
import { resolveCompareScale } from '../../lib/compareScale';
import { isEditableTarget, shouldDeleteSelection } from '../../lib/editableTarget';
import Icon from '../Icon';
import { dimensionLabels, dimensionNormal, reshapeDimension } from '../../lib/dimensionChain';
import { orderMarkups } from '../../lib/drawMarkup';
import DimensionShape from '../DimensionShape';
import TextNoteShape from '../TextNoteShape';
import TextNoteDialog from '../TextNoteDialog';
import { useLanguage, useT, type Language } from '../../i18n';
import { exportContext } from '../../lib/exportLanguage';
import { labelDirection } from '../../lib/textDirection';

const RENDER_SCALE = Math.min(4, Math.max(2, (window.devicePixelRatio || 1) * 2));
/** New masks start opaque white, the colour of the paper they hide. */
const MASK_COLOR = '#ffffff';

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

function useLayerRender(
  comparisonId: string | undefined,
  layer: string,
  pageNumber: number,
  tint: string,
  useSourceColors: boolean,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  onSize: (size: { width: number; height: number }) => void,
  onNumPages: (n: number) => void,
  /** Called with `${layer}:${pageNumber}` once this layer's raster has actually been painted. */
  onRendered?: (key: string) => void
): PdfPlanSource | null {
  const [source, setSource] = useState<PdfPlanSource | null>(null);

  useEffect(() => {
    if (!comparisonId || !layer) return;
    let cancelled = false;
    loadPdfPlanSource(`${comparisonId}:${layer}`, () => loadComparePdfBlob(comparisonId, layer), pageNumber)
      .then(({ source: s, numPages }) => {
        if (cancelled) return;
        onNumPages(numPages);
        setSource(s);
      })
      .catch((err) => {
        /* surfaced via layer staying blank; comparison-level error handling can be added later */
        if (!cancelled) trackError('compare_pdf_load', err);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparisonId, layer, pageNumber]);

  useEffect(() => {
    if (!source || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const size = source.getNativeSize();
    onSize(size);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const handle = useSourceColors ? source.render(canvas, RENDER_SCALE) : source.renderTinted(canvas, RENDER_SCALE, tint);
    let cancelled = false;
    handle.promise
      .then(() => {
        if (!cancelled) onRendered?.(`${layer}:${pageNumber}`);
      })
      .catch(() => {
        /* a cancelled/failed render simply never reports ready */
      });
    return () => {
      cancelled = true;
      handle.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, tint, useSourceColors]);

  return source;
}

export interface CompareCanvasHandle {
  /** Rasterize the current view (both layers + overlay, with a title/legend header) to a PNG data URL. */
  exportComposite: (language: Language) => Promise<{ dataUrl: string; width: number; height: number } | null>;
  /**
   * True once both layers have finished painting the given source page for the given revision —
   * what a multi-page/multi-revision export waits for before capturing, so it can never grab the
   * previous page's raster. Reports ready (so the caller can skip it) when the mapped revised page
   * does not exist, since that layer will never paint.
   */
  isReadyFor: (revisionId: string, sourcePageKey: number) => boolean;
  /** Whether the mapped revised page exists in the active revision's PDF. */
  isRevisedPageMissing: () => boolean;
}

const CompareCanvas = forwardRef<CompareCanvasHandle>(function CompareCanvas(_props, ref) {
  const t = useT();
  const language = useLanguage();
  const comparison = useCompareStore((s) => s.comparison);
  const currentPageKey = useCompareStore((s) => s.currentPageKey);
  const toolMode = useCompareStore((s) => s.toolMode);
  const setOriginalNumPages = useCompareStore((s) => s.setOriginalNumPages);
  const setRevisedNumPages = useCompareStore((s) => s.setRevisedNumPages);
  const revisedNumPages = useCompareStore((s) => s.revisedNumPages);
  const persist = useCompareStore((s) => s.persist);
  const pickingAlignmentPoints = useCompareStore((s) => s.pickingAlignmentPoints);
  const alignmentPendingOriginal = useCompareStore((s) => s.alignmentPendingOriginal);
  const alignmentPairs = useCompareStore((s) => s.alignmentPairs);
  const addAlignmentPoint = useCompareStore((s) => s.addAlignmentPoint);
  const setAlignmentTransform = useCompareStore((s) => s.setAlignmentTransform);

  const calibrationPoints = useCompareStore((s) => s.calibrationPoints);
  const addCalibrationPoint = useCompareStore((s) => s.addCalibrationPoint);
  const clearCalibration = useCompareStore((s) => s.clearCalibration);

  const measureTool = useCompareStore((s) => s.measureTool);
  const measurePoints = useCompareStore((s) => s.measurePoints);
  const pendingAreaKind = useCompareStore((s) => s.pendingAreaKind);
  const areaShape = useCompareStore((s) => s.areaShape);
  const areaCalcMode = useCompareStore((s) => s.areaCalcMode);
  const orthoSnap = useCompareStore((s) => s.orthoSnap);
  const addMeasurePoint = useCompareStore((s) => s.addMeasurePoint);
  const clearMeasurePoints = useCompareStore((s) => s.clearMeasurePoints);
  const finishMeasurement = useCompareStore((s) => s.finishMeasurement);
  const updateActiveRevisionPageQuiet = useCompareStore((s) => s.updateActiveRevisionPageQuiet);

  const markupTool = useCompareStore((s) => s.markupTool);
  const markupPoints = useCompareStore((s) => s.markupPoints);
  const markupColor = useCompareStore((s) => s.markupColor);
  const markupOrtho = useCompareStore((s) => s.markupOrtho);
  const addMarkupPoint = useCompareStore((s) => s.addMarkupPoint);
  const clearMarkupPoints = useCompareStore((s) => s.clearMarkupPoints);
  const finishMarkup = useCompareStore((s) => s.finishMarkup);
  const updateMarkup = useCompareStore((s) => s.updateMarkup);
  const updateMarkupQuiet = useCompareStore((s) => s.updateMarkupQuiet);
  const selectedMarkupId = useCompareStore((s) => s.selectedMarkupId);
  const setSelectedMarkupId = useCompareStore((s) => s.setSelectedMarkupId);
  const selectedMeasurementId = useCompareStore((s) => s.selectedMeasurementId);
  const setSelectedMeasurementId = useCompareStore((s) => s.setSelectedMeasurementId);
  const deleteMeasurement = useCompareStore((s) => s.deleteMeasurement);
  const duplicateMarkup = useCompareStore((s) => s.duplicateMarkup);
  const undo = useCompareStore((s) => s.undo);
  const redo = useCompareStore((s) => s.redo);

  const viewMode = useCompareStore((s) => s.viewMode);
  const swipePosition = useCompareStore((s) => s.swipePosition);
  const setSwipePosition = useCompareStore((s) => s.setSwipePosition);
  const blinkShowingRevised = useCompareStore((s) => s.blinkShowingRevised);
  const toggleBlink = useCompareStore((s) => s.toggleBlink);

  const setToolMode = useCompareStore((s) => s.setToolMode);
  const exportRegions = useCompareStore((s) => s.exportRegions);
  const setExportRegion = useCompareStore((s) => s.setExportRegion);
  const annotationsVisible = useCompareStore((s) => s.annotationsVisible);
  const measurementsVisible = useCompareStore((s) => s.measurementsVisible);
  const markupFontScale = useCompareStore((s) => s.markupFontScale);

  const { layout, reviewOnly: inputReviewOnly } = useWorkspaceLayout();
  const reviewOnly = inputReviewOnly || layout !== 'expanded';

  const { containerRef, zoom, pan, screenToNative, handleWheel, fitToContainer, beginPanDrag, updatePanDrag, endPanDrag } =
    useCanvasTransform();

  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const revisedCanvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [revisedPageSize, setRevisedPageSize] = useState({ width: 0, height: 0 });
  const isPanning = useRef(false);
  const alignDrag = useRef<{ startX: number; startY: number; startOffsetX: number; startOffsetY: number } | null>(null);
  const swipeDrag = useRef(false);
  const regionDragStart = useRef<Point | null>(null);
  const [regionDraft, setRegionDraft] = useState<ExportRegion | null>(null);
  const markupDrag = useRef<{ id: string; startClientX: number; startClientY: number; startPoints: Point[]; startOffset: number } | null>(
    null,
  );
  const handleDrag = useRef<{ id: string; index: number } | null>(null);
  /** Cursor position (snapped onto the run) previewing the next stop of a dimension chain. */
  const [dimensionHover, setDimensionHover] = useState<Point | null>(null);
  /** Open text-note editor: a new note at `point`, or an existing one when `markupId` is set. */
  const [textDraft, setTextDraft] = useState<{ point: Point; markupId?: string; text: string; rotationDeg: number } | null>(null);

  // Key of the revision layer whose raster has finished drawing, so an export that switches
  // revisions can wait for the new one instead of capturing the previous page.
  const [renderedLayerKey, setRenderedLayerKey] = useState('');
  // The same for the source layer: a page change re-rasterizes it too, and an export must wait.
  const [renderedOriginalKey, setRenderedOriginalKey] = useState('');
  const activeRevisionId = comparison?.activeRevisionId ?? '';
  const activeRevision = comparison?.revisions.find((r) => r.id === activeRevisionId);
  // Everything drawn on the canvas belongs to a source page: page 2 must never show page 1's work.
  const pageMeasurements = useMemo(
    () => (activeRevision?.measurements ?? []).filter((m) => m.pageNumber === currentPageKey),
    [activeRevision, currentPageKey]
  );
  const pageMarkups = useMemo(
    () => (activeRevision?.markups ?? []).filter((m) => m.pageNumber === currentPageKey),
    [activeRevision, currentPageKey]
  );
  // Numbered across the whole revision (see changeNumbering): the number on the plan matches the
  // one in the Changes panel and in the exported table, and never shifts when the page changes.
  const areaNumbers = useMemo(() => changeNumbering(activeRevision?.measurements ?? []), [activeRevision]);
  const page = comparison?.pages[currentPageKey];
  const revisionPage = page?.revisions[activeRevisionId];
  const originalPageNumber = page?.originalPageNumber ?? currentPageKey;
  const revisedPageNumber = revisionPage?.revisedPageNumber ?? currentPageKey;
  const alignment = revisionPage?.alignment ?? IDENTITY_TRANSFORM;
  // Crop windows are per page — page 2's choice must not follow the user to page 5.
  const exportRegion = exportRegions[currentPageKey] ?? null;
  // The active revision's PDF simply has fewer pages than the page we are on.
  const revisedPageMissing = !!activeRevisionId && revisedPageNumber > revisedNumPages;
  // The revised layer's own transform-origin must be its own center, not the original page's —
  // otherwise, whenever the two PDFs have different page dimensions, rotation/scale pivot around
  // the wrong point and the alignment drifts (this was the reported "not quite accurate" bug).
  const pivot: Point = { x: revisedPageSize.width / 2, y: revisedPageSize.height / 2 };
  // One scale rule for the whole feature — see resolveCompareScale. Zero whenever a quantity
  // cannot be produced safely (uncalibrated, or a legacy revised calibration we can't interpret).
  const scale = resolveCompareScale(page, revisionPage);
  const metersPerPixel = scale.metersPerPixel;

  useLayerRender(
    comparison?.id,
    'original',
    originalPageNumber,
    comparison?.originalColorTint ?? '#9ca3af',
    comparison?.originalUseSourceColors ?? false,
    originalCanvasRef,
    setPageSize,
    setOriginalNumPages,
    setRenderedOriginalKey
  );
  useLayerRender(
    comparison?.id,
    activeRevisionId ? `revision:${activeRevisionId}` : '',
    revisedPageNumber,
    activeRevision?.colorTint ?? '#ef4444',
    activeRevision?.useSourceColors ?? false,
    revisedCanvasRef,
    setRevisedPageSize,
    setRevisedNumPages,
    setRenderedLayerKey
  );

  useEffect(() => {
    if (!pageSize.width) return;
    fitToContainer(pageSize.width, pageSize.height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize]);

  // Once both alignment point pairs are picked, solve for the transform automatically.
  useEffect(() => {
    if (alignmentPairs.length !== 2 || !pageSize.width) return;
    const [p1, p2] = alignmentPairs;
    const computed = solveAlignment(p1.originalPoint, p2.originalPoint, p1.revisedPoint, p2.revisedPoint, pivot);
    setAlignmentTransform(currentPageKey, computed, 'points');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alignmentPairs]);

  // Blink mode: auto-toggle between the two layers on a timer.
  useEffect(() => {
    if (viewMode !== 'blink') return;
    const id = setInterval(() => toggleBlink(), 800);
    return () => clearInterval(id);
  }, [viewMode, toggleBlink]);

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
      wallHeightM = comparison?.wallHeightDefaultM ?? 2.5;
      areaM2 = round(wallLengthM * wallHeightM, 2);
    } else if (measureTool === 'area') {
      areaM2 = round(polygonAreaM2(points, metersPerPixel), 2);
    } else {
      lengthM = round(polygonPerimeterM(points, true, metersPerPixel), 2);
    }
    finishMeasurement({
      id: uuid(),
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
      finishMarkup({ id: uuid(), tool: 'cloud', points: markupPoints, color: markupColor, createdAt: Date.now() });
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
      if (reviewOnly) return;
      if (e.key === 'Escape') {
        clearMeasurePoints();
        clearCalibration();
        clearMarkupPoints();
      }
      if (e.key === 'Enter') {
        if (measureTool && measureTool !== 'distance' && measurePoints.length >= 3) finishOpenMeasurement();
        if (markupTool === 'cloud' && markupPoints.length >= 3) finishOpenMarkup();
        // A dimension chain keeps accepting stops until the user ends it explicitly.
        if (markupTool === 'dimension' && markupPoints.length >= 2) finishOpenMarkup();
      }
      if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey) && selectedMarkupId) {
        e.preventDefault();
        duplicateMarkup(selectedMarkupId);
      }
      const isEditingField = isEditableTarget(e.target);
      if (shouldDeleteSelection(e.key, e.target, !!selectedMeasurementId)) {
        e.preventDefault();
        deleteMeasurement(selectedMeasurementId!);
        return;
      }
      if (!isEditingField && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewOnly, measureTool, measurePoints, markupTool, markupPoints, selectedMarkupId, selectedMeasurementId, deleteMeasurement, undo, redo]);

  const handleMouseDown = (e: MouseEvent) => {
    if (reviewOnly) return;
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
      const markup = id ? pageMarkups.find((m) => m.id === id) : undefined;
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
      const measurementTarget = (e.target as Element).closest?.('[data-measurement-id]');
      const measurementId = measurementTarget?.getAttribute('data-measurement-id');
      if (measurementId) {
        setSelectedMeasurementId(measurementId === selectedMeasurementId ? null : measurementId);
        if (selectedMarkupId) setSelectedMarkupId(null);
        return;
      }
      if (selectedMarkupId) setSelectedMarkupId(null);
      if (selectedMeasurementId) setSelectedMeasurementId(null);
    }
    if (toolMode === 'pan' || e.button === 1) {
      isPanning.current = true;
      beginPanDrag(e.clientX, e.clientY);
      return;
    }
    if (toolMode === 'align' && !pickingAlignmentPoints) {
      alignDrag.current = { startX: e.clientX, startY: e.clientY, startOffsetX: alignment.offsetX, startOffsetY: alignment.offsetY };
      return;
    }
    if (toolMode === 'export-region') {
      const native = screenToNative(e.clientX, e.clientY);
      regionDragStart.current = native;
      setRegionDraft({ x: native.x, y: native.y, width: 0, height: 0 });
    }
  };
  const handleMouseMove = (e: MouseEvent) => {
    if (reviewOnly) return;
    if (isPanning.current) {
      updatePanDrag(e.clientX, e.clientY);
      return;
    }
    if (handleDrag.current) {
      const native = screenToNative(e.clientX, e.clientY);
      const markup = pageMarkups.find((m) => m.id === handleDrag.current!.id);
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
      const markup = pageMarkups.find((m) => m.id === markupDrag.current!.id);
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
    if (alignDrag.current) {
      const dx = (e.clientX - alignDrag.current.startX) / zoom;
      const dy = (e.clientY - alignDrag.current.startY) / zoom;
      updateActiveRevisionPageQuiet(currentPageKey, {
        alignment: { ...alignment, offsetX: alignDrag.current.startOffsetX + dx, offsetY: alignDrag.current.startOffsetY + dy },
      });
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
    if (swipeDrag.current && pageSize.width) {
      const native = screenToNative(e.clientX, e.clientY);
      setSwipePosition(native.x / pageSize.width);
      return;
    }
    if (toolMode === 'markup' && markupTool === 'dimension' && markupPoints.length > 0) {
      setDimensionHover(nextDimensionPoint(markupPoints, screenToNative(e.clientX, e.clientY)));
    }
  };
  const handleMouseUp = () => {
    isPanning.current = false;
    endPanDrag();
    swipeDrag.current = false;
    if (handleDrag.current) {
      // Reshaping a dimension changes what it measures, so its labels are recomputed.
      const markup = pageMarkups.find((m) => m.id === handleDrag.current!.id);
      const patch = markup && markup.tool === 'dimension' && metersPerPixel ? dimensionLabels(markup.points, metersPerPixel) : {};
      updateMarkup(handleDrag.current.id, patch);
      handleDrag.current = null;
    }
    if (markupDrag.current) {
      updateMarkup(markupDrag.current.id, {});
      markupDrag.current = null;
    }
    if (alignDrag.current) {
      const moved = alignment.offsetX !== alignDrag.current.startOffsetX || alignment.offsetY !== alignDrag.current.startOffsetY;
      alignDrag.current = null;
      void persist();
      // Counted once the drag ends (and settles), never per mouse move.
      if (moved && comparison) noteAlignment(comparison, currentPageKey, 'manual');
    }
    if (regionDragStart.current) {
      regionDragStart.current = null;
      if (regionDraft && regionDraft.width > 4 / zoom && regionDraft.height > 4 / zoom) {
        setExportRegion(currentPageKey, regionDraft);
      }
      setRegionDraft(null);
      setToolMode('select');
    }
  };
  const handleDoubleClick = (e: MouseEvent) => {
    if (reviewOnly) return;
    if (toolMode !== 'select') return;
    // Double-clicking a text note reopens it for editing.
    const bodyTarget = (e.target as Element).closest?.('[data-markup-id]');
    const noteId = bodyTarget?.getAttribute('data-markup-id');
    const note = noteId ? pageMarkups.find((m) => m.id === noteId && m.tool === 'text') : undefined;
    if (note) {
      e.stopPropagation();
      setTextDraft({ point: note.points[0], markupId: note.id, text: note.text ?? '', rotationDeg: note.rotationDeg ?? 0 });
    }
  };

  const handleDividerMouseDown = (e: MouseEvent) => {
    e.stopPropagation();
    swipeDrag.current = true;
  };

  const handleClick = (e: MouseEvent) => {
    if (reviewOnly) return;
    if (isPanning.current || alignDrag.current) return;
    const native = screenToNative(e.clientX, e.clientY);

    if (toolMode === 'align' && pickingAlignmentPoints) {
      if (!alignmentPendingOriginal) {
        addAlignmentPoint(native, true);
      } else {
        const revisedLocal = invertAlignment(native, alignment, pivot);
        addAlignmentPoint(revisedLocal, false);
      }
      return;
    }

    if (toolMode === 'calibrate') {
      if (calibrationPoints.length < 2) addCalibrationPoint(native);
      return;
    }

    if (toolMode === 'measure' && measureTool) {
      if (measureTool === 'distance') {
        addMeasurePoint(native);
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
            setDimensionHover(null);
            return;
          }
        }
        addMarkupPoint(point);
        setDimensionHover(null);
        return;
      }
      addMarkupPoint(markupOrtho && markupTool === 'arrow' && markupPoints.length === 1 ? snapOrtho(markupPoints[0], native) : native);
    }
  };

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

  useImperativeHandle(
    ref,
    () => ({
      isReadyFor: (revisionId: string, sourcePageKey: number) => {
        if (currentPageKey !== sourcePageKey) return false;
        if (renderedOriginalKey !== `original:${originalPageNumber}`) return false;
        // No revision at all (source-only comparison): the source raster is the whole picture.
        if (!revisionId) return true;
        if (revisionId !== activeRevisionId) return false;
        if (revisedPageMissing) return true;
        return renderedLayerKey === `revision:${revisionId}:${revisedPageNumber}`;
      },
      isRevisedPageMissing: () => revisedPageMissing,
      exportComposite: async (exportLanguage) => {
        // Everything BetterCalc writes onto the exported plan is in this language — the UI's is irrelevant.
        const x = exportContext(exportLanguage);
        if (!comparison || !pageSize.width || !originalCanvasRef.current || !revisedCanvasRef.current) return null;
        const mult = 2;
        const areaTotals: Record<AreaKind, number> = { demolition: 0, construction: 0 };
        let hasAreaMeasurements = false;
        if (measurementsVisible) {
          for (const m of pageMeasurements) {
            if (m.tool === 'area' && m.areaKind && typeof m.areaM2 === 'number') {
              areaTotals[m.areaKind] += m.areaM2;
              hasAreaMeasurements = true;
            }
          }
        }
        const headerH = (hasAreaMeasurements ? 110 : 70) * mult;
        const fullW = pageSize.width * mult;
        const fullH = pageSize.height * mult;

        // Render the full page (both layers + overlay) at full resolution first, so an export-region
        // crop can just be a sub-rectangle copy of it rather than re-deriving each layer's transform.
        const bodyCanvas = document.createElement('canvas');
        bodyCanvas.width = fullW;
        bodyCanvas.height = fullH;
        const bctx = bodyCanvas.getContext('2d');
        if (!bctx) return null;

        const originalRaster = originalCanvasRef.current;
        const revisedRaster = revisedCanvasRef.current;
        bctx.fillStyle = '#ffffff';
        bctx.fillRect(0, 0, fullW, fullH);
        if (comparison.originalVisible) {
          bctx.globalAlpha = comparison.originalOpacity;
          bctx.drawImage(originalRaster, 0, 0, fullW, fullH);
        }
        if (activeRevision?.visible) {
          bctx.globalAlpha = activeRevision.opacity;
          bctx.save();
          const px = pivot.x * mult;
          const py = pivot.y * mult;
          bctx.translate(px, py);
          bctx.translate(alignment.offsetX * mult, alignment.offsetY * mult);
          bctx.rotate((alignment.rotationDeg * Math.PI) / 180);
          bctx.scale(alignment.scale, alignment.scale);
          bctx.translate(-px, -py);
          bctx.drawImage(revisedRaster, 0, 0, revisedPageSize.width * mult, revisedPageSize.height * mult);
          bctx.restore();
        }
        bctx.globalAlpha = 1;

        if (svgRef.current) {
          // Rasterized as a standalone image, the overlay inherits nothing from the page — its
          // direction="rtl" (and each text note's own) is what lays the text out as on screen, and
          // the copy is given the font the screen renders it in, which the page's stylesheet
          // supplies there (without it the image falls back to the browser's serif default).
          const overlay = svgRef.current.cloneNode(true) as SVGSVGElement;
          // The screen labels measurements in the UI language; the exported plan is in the export language.
          for (const label of overlay.querySelectorAll('text[data-measurement-id]')) {
            const measurement = activeRevision?.measurements.find((m) => m.id === label.getAttribute('data-measurement-id'));
            if (measurement) {
              const text = measurementLabel(measurement, x.t);
              label.textContent = text;
              label.setAttribute('direction', labelDirection(text, exportLanguage));
            }
          }
          overlay.style.fontFamily = getComputedStyle(svgRef.current).fontFamily;
          const svgString = new XMLSerializer().serializeToString(overlay);
          const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
          const img = new Image(fullW, fullH);
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('Failed to rasterize overlay SVG'));
            img.src = svgUrl;
          });
          bctx.drawImage(img, 0, 0, fullW, fullH);
        }

        // Clamp the selected export region to the page bounds; fall back to the full page.
        const region = exportRegion
          ? {
              x: Math.max(0, Math.min(exportRegion.x, pageSize.width)),
              y: Math.max(0, Math.min(exportRegion.y, pageSize.height)),
              width: Math.max(0, Math.min(exportRegion.width, pageSize.width - Math.max(0, exportRegion.x))),
              height: Math.max(0, Math.min(exportRegion.height, pageSize.height - Math.max(0, exportRegion.y))),
            }
          : { x: 0, y: 0, width: pageSize.width, height: pageSize.height };
        if (region.width <= 0 || region.height <= 0) return null;

        const w = region.width * mult;
        const h = region.height * mult;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h + headerH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // The header reads from its start side: right-aligned RTL as it always has, left-aligned LTR.
        ctx.direction = x.direction;
        ctx.textAlign = x.rtl ? 'right' : 'left';
        const edge = (inset: number) => (x.rtl ? w - inset : inset);
        ctx.fillStyle = '#0f172a';
        ctx.font = `${20 * mult}px 'Segoe UI', sans-serif`;
        ctx.fillText(
          comparison.apartmentNumber
            ? x.t('compare.exportHeader.withApartment', { name: comparison.name, apartment: comparison.apartmentNumber })
            : comparison.name,
          edge(16 * mult),
          30 * mult,
          w - 32 * mult
        );
        ctx.fillStyle = '#8b8f99';
        ctx.font = `${12 * mult}px 'Segoe UI', sans-serif`;
        ctx.fillText(x.today(), edge(16 * mult), 50 * mult);

        ctx.font = `${12 * mult}px 'Segoe UI', sans-serif`;
        // Legend items: a colour dot, then its label. The Hebrew header keeps its fixed positions; the
        // English one flows each item after the previous label, so a longer label never meets its neighbour.
        const originalLabel = x.t('compare.exportHeader.original');
        const revisedLabel = activeRevision?.label ?? x.t('compare.exportHeader.revisedFallback');
        const revisedInset = x.rtl ? 250 * mult : 190 * mult + 10 * mult + ctx.measureText(originalLabel).width + 24 * mult;
        const legendItem = (dotInset: number, labelInset: number, color: string, text: string, baseline: number) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(edge(dotInset), baseline - 4 * mult, 4 * mult, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#374151';
          ctx.fillText(text, edge(labelInset), baseline, Math.max(w - labelInset - 16 * mult, 50 * mult));
        };
        legendItem(190 * mult, 200 * mult, comparison.originalColorTint, originalLabel, 50 * mult);
        legendItem(revisedInset, revisedInset + 10 * mult, activeRevision?.colorTint ?? '#ef4444', revisedLabel, 50 * mult);

        if (hasAreaMeasurements) {
          const drawAreaLegend = (kind: AreaKind, y: number) =>
            legendItem(190 * mult, 200 * mult, comparison.areaKindColors[kind], `${x.t(`areaKinds.${kind}`)}: ${round(areaTotals[kind], 2)} ${x.t('units.m2')}`, y);
          drawAreaLegend('demolition', 70 * mult);
          drawAreaLegend('construction', 90 * mult);
        }

        ctx.drawImage(bodyCanvas, region.x * mult, region.y * mult, w, h, 0, headerH, w, h);

        return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
      },
    }),
    [
      comparison,
      pageSize,
      revisedPageSize,
      alignment,
      pivot,
      activeRevision,
      activeRevisionId,
      exportRegion,
      measurementsVisible,
      pageMeasurements,
      revisedPageMissing,
      renderedLayerKey,
      renderedOriginalKey,
      currentPageKey,
      originalPageNumber,
      revisedPageNumber,
    ]
  );

  if (!comparison) return null;

  const strokeW = 2 / zoom;
  const vertexR = 5 / zoom;

  const revisedVisible = activeRevision?.visible ?? false;
  const revisedBaseOpacity = activeRevision?.opacity ?? 0.75;
  let originalOpacity = comparison.originalVisible ? comparison.originalOpacity : 0;
  let revisedOpacity = revisedVisible ? revisedBaseOpacity : 0;
  let originalClip: string | undefined;
  let revisedClip: string | undefined;
  if (viewMode === 'blink') {
    originalOpacity = comparison.originalVisible && !blinkShowingRevised ? 1 : 0;
    revisedOpacity = revisedVisible && blinkShowingRevised ? 1 : 0;
  } else if (viewMode === 'swipe') {
    originalOpacity = comparison.originalVisible ? 1 : 0;
    revisedOpacity = revisedVisible ? 1 : 0;
    originalClip = `inset(0 ${(1 - swipePosition) * 100}% 0 0)`;
    revisedClip = `inset(0 0 0 ${swipePosition * 100}%)`;
  }
  // The mapped revised page does not exist in this revision: its canvas still holds the raster of
  // whatever page was shown last, and leaving that on screen contradicts the warning and invites
  // comparing against the wrong page. Hide the layer — the notice explains why.
  if (revisedPageMissing) {
    revisedOpacity = 0;
    originalOpacity = comparison.originalVisible ? Math.max(originalOpacity, comparison.originalOpacity) : 0;
    originalClip = undefined;
  }
  const dividerScreenX = pan.x + swipePosition * pageSize.width * zoom;

  return (
    <div
      ref={containerRef}
      className={`pdf-viewport tool-${toolMode}`}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <div
        className="pdf-content"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, width: pageSize.width, height: pageSize.height }}
      >
        {/* The plan's own raster must not depend on the UI language: pdf.js lays its text out with the canvas's
            direction and language, so the canvases are pinned to the Hebrew RTL context production has always used. */}
        <canvas
          ref={originalCanvasRef}
          dir="rtl"
          lang="he"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            opacity: originalOpacity,
            clipPath: originalClip,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: revisedPageSize.width,
            height: revisedPageSize.height,
            transformOrigin: '50% 50%',
            transform: `translate(${alignment.offsetX}px, ${alignment.offsetY}px) rotate(${alignment.rotationDeg}deg) scale(${alignment.scale})`,
            clipPath: revisedClip,
          }}
        >
          <canvas
            ref={revisedCanvasRef}
            dir="rtl"
            lang="he"
            className="revised-sheet"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              opacity: revisedOpacity,
            }}
          />
        </div>

        {pageSize.width > 0 && (
          // Pinned to RTL rather than inherited from the page — see the takeoff viewer's overlay.
          <svg ref={svgRef} className="overlay-svg" width={pageSize.width} height={pageSize.height} viewBox={`0 0 ${pageSize.width} ${pageSize.height}`} direction="rtl">
            {/* Alignment point pairs */}
            {alignmentPairs.map((pair, i) => (
              <g key={i}>
                <circle cx={pair.originalPoint.x} cy={pair.originalPoint.y} r={vertexR} fill="#f59e0b" stroke="#fff" strokeWidth={strokeW / 2} />
                {(() => {
                  const shown = applyAlignment(pair.revisedPoint, alignment, pivot);
                  return <circle cx={shown.x} cy={shown.y} r={vertexR} fill="#10b981" stroke="#fff" strokeWidth={strokeW / 2} />;
                })()}
              </g>
            ))}
            {alignmentPendingOriginal && (
              <circle cx={alignmentPendingOriginal.x} cy={alignmentPendingOriginal.y} r={vertexR} fill="#f59e0b" stroke="#fff" strokeWidth={strokeW / 2} />
            )}

            {/* Calibration in progress */}
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

            {/* Finished measurements — AutoCAD-style: distance line has its value rotated to follow the line and sits above it; perimeter/area vertices get a small dot. */}
            {measurementsVisible && pageMeasurements.map((m) => {
              const color = m.areaKind ? comparison.areaKindColors[m.areaKind] : '#0ea5e9';
              const vertexDotR = 3 / zoom;
              const tickLen = 14 / zoom;
              const isDistance = m.tool === 'distance';
              const selected = m.id === selectedMeasurementId;
              // Change items are pickable on the plan with the select tool, the same way markups
              // are — the Changes panel and the drawing select each other.
              const pickProps =
                toolMode === 'select' && m.areaKind
                  ? { 'data-measurement-id': m.id, style: { pointerEvents: 'auto' as const, cursor: 'pointer' as const } }
                  : {};
              let labelX = 0;
              let labelY = 0;
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
                <g key={m.id} className={selected ? 'measurement-selected' : undefined}>
                  {/* The selected change item gets a halo around its own outline, so a row click in
                      the Changes panel points at an unmistakable shape on the plan. */}
                  {selected && !isDistance && (
                    <polygon
                      points={m.points.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="none"
                      stroke="#0f172a"
                      strokeWidth={strokeW * 2.4}
                      strokeOpacity={0.85}
                      strokeDasharray={`${8 / zoom} ${5 / zoom}`}
                    />
                  )}
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
                        fillOpacity={m.areaKind ? (selected ? 0.42 : 0.28) : 0.12}
                        stroke={color}
                        strokeWidth={m.tool === 'area' ? strokeW * 0.4 : strokeW}
                        {...pickProps}
                      />
                      {m.tool !== 'area' &&
                        m.points.map((p, i) => (
                          <circle key={i} cx={p.x} cy={p.y} r={vertexDotR} fill={color} />
                        ))}
                    </>
                  )}
                  {(m.tool !== 'area' || m.areaKind) && (
                    <>
                      {m.areaKind && <circle cx={labelX} cy={labelY} r={9 / zoom} fill="#ffffff" fillOpacity={0.9} />}
                      <text
                        x={labelX}
                        y={labelY}
                        data-measurement-id={m.areaKind ? undefined : m.id}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={12 / zoom}
                        fill={color}
                        fontWeight={600}
                        direction={labelDirection(m.areaKind ? '' : measurementLabel(m), language)}
                        transform={isDistance ? `rotate(${angleDeg} ${labelX} ${labelY})` : undefined}
                      >
                        {m.areaKind ? (areaNumbers.get(m.id) ?? '') : measurementLabel(m)}
                      </text>
                    </>
                  )}
                </g>
              );
            })}

            {/* Dimension run in progress — live preview of the chain, including the segment under the cursor */}
            {markupPoints.length > 0 && markupTool === 'dimension' && (() => {
              const preview = dimensionHover ? [...markupPoints, dimensionHover] : markupPoints;
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

            {/* Finished markups */}
            {annotationsVisible &&
              orderMarkups(pageMarkups).map((m) => (
                <MarkupShape key={m.id} markup={m} strokeW={strokeW} draggable={toolMode === 'select'} />
              ))}

            {/* Resize/reshape handles for the selected markup (select tool only) */}
            {toolMode === 'select' &&
              selectedMarkupId &&
              (() => {
                const selected = pageMarkups.find((m) => m.id === selectedMarkupId);
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

        {/* Export region selection — kept in a separate svg so it's never rasterized into the exported PDF. */}
        {pageSize.width > 0 && (exportRegion || regionDraft) && (
          <svg className="overlay-svg region-select-svg" width={pageSize.width} height={pageSize.height} viewBox={`0 0 ${pageSize.width} ${pageSize.height}`}>
            {exportRegion && !regionDraft && (
              <rect
                x={exportRegion.x}
                y={exportRegion.y}
                width={exportRegion.width}
                height={exportRegion.height}
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

      {revisedPageMissing && (
        <div className="export-region-hint cal-hint-warning">
          <Icon name="alert" size={13} />
          {t('compare.canvas.revisedPageMissing', { page: revisedPageNumber, revision: activeRevision?.label ?? '', count: revisedNumPages })}
        </div>
      )}

      {toolMode === 'export-region' && !regionDraft && (
        <div className="export-region-hint">
          <Icon name="crop" size={13} />
          {t('compare.canvas.exportRegionHint')}
        </div>
      )}

      {viewMode === 'swipe' && pageSize.width > 0 && (
        <div className="swipe-divider" style={{ transform: `translateX(${dividerScreenX}px)` }} onMouseDown={handleDividerMouseDown}>
          <div className="swipe-divider-handle">
            <Icon name="swipe" size={14} />
          </div>
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
          <Icon name="expand" />
          {t('viewer.resetView')}
        </button>
      )}
    </div>
  );
});

export default CompareCanvas;
