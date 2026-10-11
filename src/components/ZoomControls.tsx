import { MAX_ZOOM, MIN_ZOOM, type CanvasTransform } from '../hooks/useCanvasTransform';
import Icon from './Icon';
import { useT } from '../i18n';

/** One press of the zoom buttons. */
const ZOOM_STEP = 1.25;

/**
 * Zoom out · current zoom · zoom in · fit, on the plan's bottom end corner. Shared by the takeoff
 * and compare canvases; always laid out left-to-right, like the numbers.
 */
export default function ZoomControls({ transform, pageWidth, pageHeight }: { transform: CanvasTransform; pageWidth: number; pageHeight: number }) {
  const t = useT();
  const { containerRef, zoom, fitToContainer } = transform;
  // The buttons scale around the centre of the canvas, the same way the wheel scales around the pointer.
  const zoomBy = (factor: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const view = transform.getView();
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
    const cx = rect.width / 2, cy = rect.height / 2;
    transform.setView({ zoom: next, pan: { x: cx - (cx - view.pan.x) / view.zoom * next, y: cy - (cy - view.pan.y) / view.zoom * next } });
  };
  return (
    <div
      className="zoom-controls reset-view-btn"
      dir="ltr"
      data-plan-control="zoom"
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button className="icon-btn" onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} title={t('viewer.zoomOut')} aria-label={t('viewer.zoomOut')}>
        <Icon name="minus" size={14} />
      </button>
      <span className="zoom-value tnum" aria-live="polite">{Math.round(zoom * 100)}%</span>
      <button className="icon-btn" onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} title={t('viewer.zoomIn')} aria-label={t('viewer.zoomIn')}>
        <Icon name="plus" size={14} />
      </button>
      <button
        data-plan-control="fit"
        className="icon-btn"
        onClick={() => fitToContainer(pageWidth, pageHeight)}
        title={t('viewer.resetViewHint')}
        aria-label={t('viewer.resetView')}
      >
        <Icon name="fit" size={14} />
      </button>
    </div>
  );
}
