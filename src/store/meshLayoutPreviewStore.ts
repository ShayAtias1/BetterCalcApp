import { create } from 'zustand';
import type { RebarLevel } from '../types/structural';

/** Viewing preferences only. Never persisted, written to a Mesh, or included in undo history. */
export interface MeshLayoutView {
  enabled: boolean;
  level: RebarLevel;
}
const DEFAULT_VIEW: MeshLayoutView = { enabled: false, level: 'bottom' };
const keyFor = (planId: string, meshId: string) => JSON.stringify([planId, meshId]);
interface MeshLayoutPreviewState {
  views: Record<string, MeshLayoutView>;
  setEnabled: (planId: string, meshId: string, enabled: boolean) => void;
  setLevel: (planId: string, meshId: string, level: RebarLevel) => void;
}
export const useMeshLayoutPreviewStore = create<MeshLayoutPreviewState>((set) => ({
  views: {},
  setEnabled: (planId, meshId, enabled) => set((state) => {
    const key = keyFor(planId, meshId);
    return { views: { ...state.views, [key]: { ...(state.views[key] ?? DEFAULT_VIEW), enabled } } };
  }),
  setLevel: (planId, meshId, level) => set((state) => {
    const key = keyFor(planId, meshId);
    return { views: { ...state.views, [key]: { ...(state.views[key] ?? DEFAULT_VIEW), level } } };
  }),
}));
export function useMeshLayoutView(planId: string, meshId: string): MeshLayoutView {
  return useMeshLayoutPreviewStore((state) => state.views[keyFor(planId, meshId)] ?? DEFAULT_VIEW);
}
