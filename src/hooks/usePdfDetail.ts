import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { CanvasView } from './useCanvasTransform';
import type { PlanRenderHandle } from '../lib/planSource';
import { isViewerRenderCancelled, type ViewerPageSource } from '../lib/pdfViewerSource';
import { boundedPdfScale, currentPdfDpr, PDF_RENDER_BUDGET } from '../lib/pdfRenderBudget';
import { trackError } from '../lib/analytics';

function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.remove();
  canvas.width = canvas.height = 0;
}

/** One seamless detail region beneath the SVG; never changes native plan geometry. */
export function usePdfDetail(
  source: ViewerPageSource | null,
  pageKey: string,
  ready: boolean,
  containerRef: RefObject<HTMLDivElement | null>,
  baseScaleRef: RefObject<number>,
  view: CanvasView,
  getView: () => CanvasView,
) {
  const detailHostRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Set<number>());
  const generation = useRef(0);
  const request = useRef<(() => void) | null>(null);
  const interrupt = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const host = detailHostRef.current;
    return () => {
      generation.current++;
      interrupt.current?.();
      if (host) for (const child of Array.from(host.children)) releaseCanvas(child as HTMLCanvasElement);
    };
  }, [source, pageKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const stop = () => interrupt.current?.();
    const schedule = () => request.current?.();
    const down = (event: PointerEvent) => { pointers.current.add(event.pointerId); stop(); };
    const move = () => { if (pointers.current.size) stop(); };
    const up = (event: PointerEvent) => { pointers.current.delete(event.pointerId); schedule(); };
    const wheel = () => { stop(); schedule(); };
    const blur = () => { pointers.current.clear(); stop(); schedule(); };
    container.addEventListener('pointerdown', down, true);
    container.addEventListener('pointermove', move, true);
    container.addEventListener('wheel', wheel, { capture: true, passive: true });
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', wheel);
    const observer = new ResizeObserver(wheel);
    observer.observe(container);
    let dprQuery: MediaQueryList | undefined;
    const dprChanged = () => { watchDpr(); wheel(); };
    const watchDpr = () => {
      dprQuery?.removeEventListener('change', dprChanged);
      dprQuery = window.matchMedia(`(resolution: ${currentPdfDpr()}dppx)`);
      dprQuery.addEventListener('change', dprChanged);
    };
    watchDpr();
    return () => {
      container.removeEventListener('pointerdown', down, true);
      container.removeEventListener('pointermove', move, true);
      container.removeEventListener('wheel', wheel, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', wheel);
      dprQuery?.removeEventListener('change', dprChanged);
      observer.disconnect();
      pointers.current.clear();
    };
  }, [containerRef, pageKey]);

  useEffect(() => {
    const host = detailHostRef.current;
    const container = containerRef.current;
    if (!source || !ready || !host || !container) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: PlanRenderHandle | null = null;
    let disposed = false;
    const stop = () => {
      generation.current++;
      clearTimeout(timer);
      pending?.cancel();
      pending = null;
    };
    const schedule = () => {
      stop();
      if (disposed || pointers.current.size) return;
      timer = setTimeout(() => {
        if (disposed || pointers.current.size) return;
        const id = ++generation.current;
        const snapshot = getView();
        const dpr = currentPdfDpr();
        const desired = snapshot.zoom * dpr;
        if (desired <= baseScaleRef.current) {
          for (const child of Array.from(host.children)) releaseCanvas(child as HTMLCanvasElement);
          return;
        }
        const size = source.getNativeSize();
        const bounds = container.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const margin = PDF_RENDER_BUDGET.detailMarginScreenPx / snapshot.zoom;
        const x = Math.max(0, -snapshot.pan.x / snapshot.zoom - margin);
        const y = Math.max(0, -snapshot.pan.y / snapshot.zoom - margin);
        const right = Math.min(size.width, (bounds.width - snapshot.pan.x) / snapshot.zoom + margin);
        const bottom = Math.min(size.height, (bounds.height - snapshot.pan.y) / snapshot.zoom + margin);
        if (right <= x || bottom <= y) return;
        const region = { x, y, width: right - x, height: bottom - y };
        const scale = boundedPdfScale(region.width, region.height, desired);
        if (scale <= baseScaleRef.current) return;
        const candidate = document.createElement('canvas');
        candidate.dir = 'rtl';
        candidate.lang = 'he';
        candidate.style.cssText = 'position:absolute;box-shadow:none;outline:none;pointer-events:none;';
        candidate.style.left = `${x}px`;
        candidate.style.top = `${y}px`;
        const handle = source.renderRegion(candidate, scale, region);
        pending = handle;
        void handle.promise.then(() => {
          const latest = getView();
          const latestBounds = container.getBoundingClientRect();
          const relevant = !disposed && id === generation.current && !pointers.current.size &&
            latest.zoom === snapshot.zoom && latest.pan.x === snapshot.pan.x &&
            latest.pan.y === snapshot.pan.y && currentPdfDpr() === dpr &&
            latestBounds.width === bounds.width && latestBounds.height === bounds.height;
          if (!relevant) { releaseCanvas(candidate); return; }
          // Rounded backing dimensions / density preserve exact native pixel positions.
          candidate.style.width = `${candidate.width / scale}px`;
          candidate.style.height = `${candidate.height / scale}px`;
          const previous = Array.from(host.children);
          host.replaceChildren(candidate);
          for (const child of previous) releaseCanvas(child as HTMLCanvasElement);
        }, (error: unknown) => {
          releaseCanvas(candidate);
          if (!disposed && id === generation.current && !isViewerRenderCancelled(error)) {
            trackError('pdf_load', error);
          }
        }).then(() => { if (pending === handle) pending = null; });
      }, PDF_RENDER_BUDGET.settleDelayMs);
    };
    request.current = schedule;
    interrupt.current = stop;
    schedule();
    return () => {
      disposed = true;
      stop();
      if (request.current === schedule) request.current = null;
      if (interrupt.current === stop) interrupt.current = null;
    };
  }, [source, pageKey, ready, view.zoom, view.pan.x, view.pan.y, containerRef, baseScaleRef, getView]);

  return detailHostRef;
}
