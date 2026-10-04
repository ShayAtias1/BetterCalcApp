import { setWorkspaceWidth, setWorkspacePointer } from '../lib/workspaceCapabilities';
import { useFieldWorkflowStore } from '../store/fieldWorkflowStore';
import { useAppStore } from '../store/appStore';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type WorkspaceLayout = 'expanded' | 'compact' | 'narrow';
const band = (width: number): WorkspaceLayout => width >= 1200 ? 'expanded' : width >= 768 ? 'compact' : 'narrow';
const WorkspaceContext = createContext({ layout: 'expanded' as WorkspaceLayout, reviewOnly: false, touchInput: false });

/** Width is measured on the app host, independently of the input device. No saved document state. */
export function WorkspaceLayoutProvider({ children }: { children: ReactNode }) {
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
        if (!supported) state.setToolMode('select');
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
  const reviewOnly = layout === 'narrow';
  return <WorkspaceContext.Provider value={{ layout, reviewOnly, touchInput }}>
    <div ref={ref} className="adaptive-workspace-root" data-layout={layout} data-review-only={reviewOnly} data-touch-input={touchInput}
      onPointerDownCapture={(e) => { setWorkspacePointer(e.pointerType); useFieldWorkflowStore.getState().setPointer(e.pointerType); }}>{children}</div>
  </WorkspaceContext.Provider>;
}

export const useWorkspaceLayout = () => useContext(WorkspaceContext);
