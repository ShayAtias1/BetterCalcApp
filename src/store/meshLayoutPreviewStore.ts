import { create } from 'zustand';
import { canAuthorTakeoff } from '../lib/workspaceCapabilities';
import type { RebarLevel } from '../types/structural';
import type { MeshLayoutPreview } from '../lib/meshLayoutPreview';
import type { MeshPlacementOverride, MeshPlacementOverrides } from '../lib/meshLayoutEditing';

/** Session UI only. Never persisted into a Mesh or included in undo history. */
export interface MeshLayoutView {
  enabled: boolean;
  level: RebarLevel;
  editing: boolean;
  selectedPlacementId: string | null;
  sourceKey: string | null;
  overrides: Partial<Record<RebarLevel, MeshPlacementOverrides>>;
}
const DEFAULT_VIEW: MeshLayoutView = { enabled: false, level: 'bottom', editing: false, selectedPlacementId: null, sourceKey: null, overrides: {} };
const keyFor = (planId: string, meshId: string) => JSON.stringify([planId, meshId]);
export function meshLayoutCanInteract(view: MeshLayoutView, preview: MeshLayoutPreview | null, visible: boolean): boolean {
  return visible && view.enabled && view.editing && preview?.status === 'ready' && preview.sourceKey === view.sourceKey;
}
interface MeshLayoutPreviewState {
  views: Record<string, MeshLayoutView>;
  setEnabled: (planId: string, meshId: string, enabled: boolean) => void;
  setLevel: (planId: string, meshId: string, level: RebarLevel) => void;
  setEditing: (planId: string, meshId: string, editing: boolean, preview: MeshLayoutPreview | null, visible: boolean) => void;
  select: (planId: string, meshId: string, placementId: string) => void;
  setOverride: (planId: string, meshId: string, level: RebarLevel, override: MeshPlacementOverride) => void;
  resetLevel: (planId: string, meshId: string, level: RebarLevel) => void;
}
export const useMeshLayoutPreviewStore = create<MeshLayoutPreviewState>((set) => {
  const update = (planId: string, meshId: string, fn: (view: MeshLayoutView) => MeshLayoutView) => set((state) => {
    const key = keyFor(planId, meshId);
    return { views: { ...state.views, [key]: fn(state.views[key] ?? DEFAULT_VIEW) } };
  });
  return {
    views: {},
    setEnabled: (p, m, enabled) => update(p, m, (v) => ({ ...v, enabled, editing: enabled && v.editing, selectedPlacementId: null })),
    setLevel: (p, m, level) => update(p, m, (v) => ({ ...v, level, selectedPlacementId: null })),
    setEditing: (p, m, editing, preview, visible) => update(p, m, (v) => {
      if (editing && !canAuthorTakeoff()) return { ...v, editing: false, selectedPlacementId: null, overrides: {} };
      if (!editing) return { ...v, editing: false, selectedPlacementId: null };
      if (!v.enabled || !visible || preview?.status !== 'ready') return v;
      return { ...v, editing: true, selectedPlacementId: null, sourceKey: preview.sourceKey,
        overrides: v.sourceKey === preview.sourceKey ? v.overrides : {} };
    }),
    select: (p, m, placementId) => update(p, m, (v) => v.enabled && v.editing ? { ...v, selectedPlacementId: placementId } : v),
    setOverride: (p, m, level, override) => update(p, m, (v) => v.enabled && v.editing ? { ...v,
      overrides: { ...v.overrides, [level]: { ...v.overrides[level], [override.placementId]: override } } } : v),
    resetLevel: (p, m, level) => update(p, m, (v) => ({ ...v, overrides: { ...v.overrides, [level]: {} } })),
  };
});
export function useMeshLayoutView(planId: string, meshId: string): MeshLayoutView {
  return useMeshLayoutPreviewStore((state) => state.views[keyFor(planId, meshId)] ?? DEFAULT_VIEW);
}
