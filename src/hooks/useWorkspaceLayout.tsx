import { useFieldLifecycle } from './useFieldLifecycle';
import { cancelFieldOperation } from '../lib/fieldLifecycle';
import { setWorkspaceWidth, setWorkspacePointer } from '../lib/workspaceCapabilities';
import { useFieldWorkflowStore } from '../store/fieldWorkflowStore';
import { useAppStore } from '../store/appStore';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type WorkspaceLayout = 'expanded' | 'compact' | 'narrow';
const band = (width: number): WorkspaceLayout => width >= 1200 ? 'expanded' : width >= 768 ? 'compact' : 'narrow';
const WorkspaceContext = createContext({ layout: 'expanded' as WorkspaceLayout, reviewOnly: false, touchInput: false });

/** Width is measured on the app host, independently of the input device. No saved document state. */
export function WorkspaceLayoutProvider({ children }: { children: ReactNode }) {
  useFieldLifecycle();
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(() => band(window.innerWidth));
  const pointerType = useFieldWorkflowStore((s) => s.pointerType);
  const touchInput = pointerType !== 'mouse';
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      setWorkspaceWidth(entry.contentRect.width);
      const next = band(entry.contentRect.width);
      if (next === 'narrow') {
        const state = useAppStore.getState();
        const supported = state.toolMode === 'select' || state.toolMode === 'pan' ||
          (state.toolMode === 'measure' && state.measureTool === 'distance') ||
          (state.toolMode === 'markup' && ['text', 'arrow', 'rectangle'].includes(state.markupTool ?? ''));
        if (!supported) { cancelFieldOperation(); state.setToolMode('select'); useFieldWorkflowStore.getState().setDraft(false); }
        useFieldWorkflowStore.getState().setGeometryAction('browse');
      }
      setLayout(next);
    });
    observer.observe(host);
    const input = window.matchMedia('(pointer: coarse)');
    const change = () => {
      const type = input.matches ? 'touch' : 'mouse';
      setWorkspacePointer(type); useFieldWorkflowStore.getState().setPointer(type);
    };
    input.addEventListener('change', change);
    return () => { observer.disconnect(); input.removeEventListener('change', change); };
  }, []);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = viewport?.height ?? window.innerHeight;
        host.style.setProperty('--field-viewport-height', `${height}px`);
        host.style.setProperty('--field-viewport-top', `${viewport?.offsetTop ?? 0}px`);
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && focused.matches('input, textarea, select, [contenteditable="true"]')) focused.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    };
    viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update); update();
    return () => { cancelAnimationFrame(frame); viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);
  const reviewOnly = layout === 'narrow';
  return <WorkspaceContext.Provider value={{ layout, reviewOnly, touchInput }}>
    <div ref={ref} className="adaptive-workspace-root" data-layout={layout} data-review-only={reviewOnly} data-touch-input={touchInput}
      onPointerDownCapture={(e) => { setWorkspacePointer(e.pointerType); useFieldWorkflowStore.getState().setPointer(e.pointerType); }}>{children}</div>
  </WorkspaceContext.Provider>;
}

export const useWorkspaceLayout = () => useContext(WorkspaceContext);
