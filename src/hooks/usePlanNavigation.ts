import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';
import type { CanvasTransform, CanvasView } from './useCanvasTransform';
import { MAX_ZOOM, MIN_ZOOM } from './useCanvasTransform';
import { PLAN_NAVIGATION_CANCEL, TOUCH_TAP_MAX_MS, TOUCH_TAP_SLOP_PX } from '../lib/interactionTargets';
import type { Point } from '../types';

type Contact = { x: number; y: number; startX: number; startY: number; started: number; target: EventTarget; moved: boolean };
type Gesture =
  | { owner: 'navigation'; kind: 'pan'; start: Point; view: CanvasView }
  | { owner: 'navigation'; kind: 'pinch'; distance: number; anchor: Point; view: CanvasView }
  | { owner: 'child' | 'desktop'; pointerId: number }
  | { owner: 'idle' };

/** Touch/pen always browse in Package 1. Desktop authoring keeps its existing handlers.
 * Capture owns navigation before any SVG child can mutate geometry. No document mutation here.
 */
export function usePlanNavigation({ transform, reviewOnly, contextKey, onTap, onDesktopStart, onDesktopCancel }: {
  transform: CanvasTransform; reviewOnly: boolean; contextKey: string;
  onTap: (x: number, y: number, target: EventTarget) => void;
  onDesktopStart?: () => void; onDesktopCancel?: () => void;
}) {
  const contacts = useRef(new Map<number, Contact>());
  const gesture = useRef<Gesture>({ owner: 'idle' });
  const blocked = useRef(false);
  const interruptedDesktop = useRef(false);
  const suppressMouseUntil = useRef(0);
  const latest = useRef({ transform, reviewOnly, onTap, onDesktopStart, onDesktopCancel });
  latest.current = { transform, reviewOnly, onTap, onDesktopStart, onDesktopCancel };
  const isControl = (target: EventTarget) => target instanceof Element && !!target.closest('[data-plan-control], .modal-backdrop');
  const consume = (e: PointerEvent) => { e.preventDefault(); e.stopPropagation(); suppressMouseUntil.current = Date.now() + 800; };
  const release = (id: number) => {
    const host = latest.current.transform.containerRef.current;
    if (host?.hasPointerCapture(id)) host.releasePointerCapture(id);
  };
  const cancel = useCallback(() => {
    const old = gesture.current;
    const ids = [...contacts.current.keys()];
    contacts.current.clear();
    gesture.current = { owner: 'idle' };
    blocked.current = false;
    latest.current.transform.endPanDrag();
    if (old.owner === 'desktop' || old.owner === 'child') { interruptedDesktop.current = true; latest.current.onDesktopCancel?.(); }
    latest.current.transform.containerRef.current?.dispatchEvent(new CustomEvent(PLAN_NAVIGATION_CANCEL, { bubbles: true }));
    const host = latest.current.transform.containerRef.current;
    for (const id of ids) if (host?.hasPointerCapture(id)) host.releasePointerCapture(id);
    suppressMouseUntil.current = Date.now() + 800;
  }, []);
  useEffect(() => {
    cancel();
  }, [contextKey, reviewOnly, cancel]);
  useEffect(() => {
    const host = transform.containerRef.current;
    const blur = () => cancel();
    const visibility = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    let previous = host ? { width: host.clientWidth, height: host.clientHeight } : null;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (previous && (width !== previous.width || height !== previous.height)) cancel();
      previous = { width, height };
    });
    if (host) observer.observe(host);
    return () => {
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
      observer.disconnect(); cancel();
    };
  }, [transform.containerRef, cancel]);
  const pinch = () => {
    const [a, b] = [...contacts.current.values()];
    if (!a || !b) return;
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2;
    gesture.current = { owner: 'navigation', kind: 'pinch', distance: Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1),
      anchor: latest.current.transform.screenToNative(x, y), view: latest.current.transform.getView() };
  };
  const onPointerDownCapture = (e: PointerEvent<HTMLDivElement>) => {
    if (isControl(e.target)) return;
    const browse = e.pointerType !== 'mouse' || latest.current.reviewOnly || contacts.current.size > 0;
    if (!browse) {
      suppressMouseUntil.current = 0;
      interruptedDesktop.current = false;
      gesture.current = { owner: e.target instanceof Element && e.target.closest('[data-plan-child-interaction]') ? 'child' : 'desktop', pointerId: e.pointerId };
      latest.current.onDesktopStart?.();
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    consume(e);
    if (gesture.current.owner === 'desktop' || gesture.current.owner === 'child') {
      interruptedDesktop.current = true;
      latest.current.onDesktopCancel?.();
      e.currentTarget.dispatchEvent(new CustomEvent(PLAN_NAVIGATION_CANCEL, { bubbles: true }));
    }
    contacts.current.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, started: Date.now(), target: e.target, moved: false });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (contacts.current.size > 1) {
      blocked.current = true;
      pinch();
    } else {
      blocked.current = false;
      gesture.current = { owner: 'navigation', kind: 'pan', start: { x: e.clientX, y: e.clientY }, view: latest.current.transform.getView() };
    }
  };
  const onPointerMoveCapture = (e: PointerEvent<HTMLDivElement>) => {
    const contact = contacts.current.get(e.pointerId);
    if (!contact) { if (e.pointerType !== 'mouse' && !isControl(e.target)) consume(e); return; }
    consume(e);
    contact.x = e.clientX; contact.y = e.clientY;
    contact.moved ||= Math.hypot(contact.x - contact.startX, contact.y - contact.startY) > TOUCH_TAP_SLOP_PX;
    const active = gesture.current;
    if (active.owner !== 'navigation') return;
    const engine = latest.current.transform;
    if (active.kind === 'pinch' && contacts.current.size >= 2) {
      const [a, b] = [...contacts.current.values()];
      const rect = engine.containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, active.view.zoom * Math.hypot(b.x - a.x, b.y - a.y) / active.distance));
      engine.setView({ zoom, pan: { x: (a.x + b.x) / 2 - rect.left - active.anchor.x * zoom, y: (a.y + b.y) / 2 - rect.top - active.anchor.y * zoom } });
    } else if (active.kind === 'pan' && contact.moved && !blocked.current) {
      engine.setView({ zoom: active.view.zoom, pan: { x: active.view.pan.x + contact.x - active.start.x, y: active.view.pan.y + contact.y - active.start.y } });
    }
  };
  const onPointerUpCapture = (e: PointerEvent<HTMLDivElement>) => {
    const contact = contacts.current.get(e.pointerId);
    if (!contact) {
      if (e.pointerType !== 'mouse' && !isControl(e.target)) consume(e);
      const active = gesture.current;
      if ((active.owner === 'desktop' || active.owner === 'child') && active.pointerId === e.pointerId) gesture.current = { owner: 'idle' };
      return;
    }
    consume(e);
    const moved = contact.moved || Math.hypot(e.clientX - contact.startX, e.clientY - contact.startY) > TOUCH_TAP_SLOP_PX;
    const tap = !blocked.current && !moved && Date.now() - contact.started <= TOUCH_TAP_MAX_MS;
    contacts.current.delete(e.pointerId);
    // A remaining finger never turns into an edit or a tap; all contacts must lift first.
    if (contacts.current.size < 2) gesture.current = { owner: 'idle' };
    else pinch();
    release(e.pointerId);
    if (tap) latest.current.onTap(e.clientX, e.clientY, contact.target);
    if (!contacts.current.size) blocked.current = false;
  };
  const onPointerCancelCapture = (e: PointerEvent<HTMLDivElement>) => {
    if (contacts.current.has(e.pointerId)) { consume(e); cancel(); }
    else {
      const active = gesture.current;
      if ((active.owner === 'desktop' || active.owner === 'child') && active.pointerId === e.pointerId) cancel();
    }
  };
  const suppressMouse = (e: MouseEvent<HTMLDivElement>) => {
    if (!isControl(e.target) && (interruptedDesktop.current || Date.now() < suppressMouseUntil.current || contacts.current.size > 0)) { e.preventDefault(); e.stopPropagation(); }
  };
  return {
    onPointerDownCapture, onPointerMoveCapture, onPointerUpCapture, onPointerCancelCapture,
    onLostPointerCaptureCapture: onPointerCancelCapture,
    onMouseDownCapture: suppressMouse, onMouseMoveCapture: suppressMouse, onMouseUpCapture: suppressMouse,
    onClickCapture: suppressMouse, onDoubleClickCapture: suppressMouse,
  };
}
