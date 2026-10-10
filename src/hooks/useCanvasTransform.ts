import { useCallback, useEffect, useRef, useState, type WheelEvent } from 'react';
import type { Point } from '../types';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export interface CanvasView { zoom: number; pan: Point }
export interface CanvasTransform {
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  pan: Point;
  screenToNative: (clientX: number, clientY: number) => Point;
  handleWheel: (e: WheelEvent) => void;
  fitToContainer: (contentWidth: number, contentHeight: number) => void;
  beginPanDrag: (clientX: number, clientY: number) => void;
  updatePanDrag: (clientX: number, clientY: number) => boolean;
  endPanDrag: () => void;
  getView: () => CanvasView;
  setView: (view: CanvasView) => void;
}

/** One native-coordinate transform for wheel, mouse pan and pointer navigation. */
export function useCanvasTransform(): CanvasTransform {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setViewState] = useState<CanvasView>({ zoom: 1, pan: { x: 0, y: 0 } });
  const current = useRef(view);
  const panDrag = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  // Update synchronously as well as in React: multiple pointer events may arrive in one render.
  const setView = useCallback((next: CanvasView) => {
    if (!Number.isFinite(next.zoom) || !Number.isFinite(next.pan.x) || !Number.isFinite(next.pan.y)) return;
    const value = { zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next.zoom)), pan: next.pan };
    current.current = value;
    setViewState(value);
  }, []);
  const getView = useCallback(() => current.current, []);
  const screenToNative = useCallback((clientX: number, clientY: number): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const { zoom, pan } = current.current;
    return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom };
  }, []);
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    if (e.deltaY === 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { zoom, pan } = current.current;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * Math.exp(-e.deltaY * 0.0015)));
    setView({ zoom: nextZoom, pan: { x: mx - (mx - pan.x) / zoom * nextZoom, y: my - (my - pan.y) / zoom * nextZoom } });
  }, [setView]);
  const fitToContainer = useCallback((width: number, height: number) => {
    if (!width || !height || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const zoom = Math.max(Math.min((rect.width - 40) / width, (rect.height - 40) / height, 2), MIN_ZOOM);
    setView({ zoom, pan: { x: (rect.width - width * zoom) / 2, y: (rect.height - height * zoom) / 2 } });
  }, [setView]);
  const beginPanDrag = useCallback((clientX: number, clientY: number) => {
    const { pan } = current.current;
    panDrag.current = { startX: clientX, startY: clientY, panX: pan.x, panY: pan.y };
  }, []);
  const updatePanDrag = useCallback((clientX: number, clientY: number): boolean => {
    const drag = panDrag.current;
    if (!drag) return false;
    setView({ zoom: current.current.zoom, pan: { x: drag.panX + clientX - drag.startX, y: drag.panY + clientY - drag.startY } });
    return true;
  }, [setView]);
  const endPanDrag = useCallback(() => { panDrag.current = null; }, []);
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    let previous = { width: host.clientWidth, height: host.clientHeight };
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0 && previous.width > 0 && previous.height > 0) {
        const view = current.current;
        setView({ zoom: view.zoom, pan: { x: view.pan.x + (width - previous.width) / 2, y: view.pan.y + (height - previous.height) / 2 } });
      }
      previous = { width, height };
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [setView]);
  return { containerRef, ...view, screenToNative, handleWheel, fitToContainer, beginPanDrag, updatePanDrag, endPanDrag, getView, setView };
}
