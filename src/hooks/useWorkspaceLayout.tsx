import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type WorkspaceLayout = 'expanded' | 'compact' | 'narrow';
const band = (width: number): WorkspaceLayout => width >= 1200 ? 'expanded' : width >= 768 ? 'compact' : 'narrow';
const WorkspaceContext = createContext({ layout: 'expanded' as WorkspaceLayout, reviewOnly: false });

/** Width is measured on the app host, independently of the input device. No saved document state. */
export function WorkspaceLayoutProvider({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(() => band(window.innerWidth));
  const [coarse, setCoarse] = useState(() => window.matchMedia('(pointer: coarse)').matches);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => setLayout(band(entry.contentRect.width)));
    observer.observe(host);
    const input = window.matchMedia('(pointer: coarse)');
    const change = () => setCoarse(input.matches);
    input.addEventListener('change', change);
    return () => { observer.disconnect(); input.removeEventListener('change', change); };
  }, []);
  const reviewOnly = layout === 'narrow' || coarse;
  return <WorkspaceContext.Provider value={{ layout, reviewOnly }}>
    <div ref={ref} className="adaptive-workspace-root" data-layout={layout} data-review-only={reviewOnly}>{children}</div>
  </WorkspaceContext.Provider>;
}

export const useWorkspaceLayout = () => useContext(WorkspaceContext);
