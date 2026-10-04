import { useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { useMeshLayoutView, useMeshLayoutPreviewStore, meshLayoutCanInteract } from '../store/meshLayoutPreviewStore';
import { prepareMeshLayoutPreview, renderMeshLayoutPreview } from '../lib/meshLayoutPreview';
import { applyPlacementOverrides, movePlacement, planToLocal } from '../lib/meshLayoutEditing';
import type { MeshPlacementOverride } from '../lib/meshLayoutEditing';
import type { MeshSheetPlacement } from '../lib/meshSheetPlacement';
import { rebarOf } from '../lib/structuralPlan';
import { canAuthorTakeoff } from '../lib/workspaceCapabilities';
import { nativeHitRadius } from '../lib/interactionTargets';
import { hitStraightBar } from '../lib/straightBarsGeometry';
import type { Point } from '../types';
import type { CanvasTransform } from './useCanvasTransform';
import type { PlanPointerEdit } from './usePlanNavigation';

/** Mesh preview overrides are session-only; exactly one existing manual-layout mutation on release. */
export function useTouchMeshLayout(transform: CanvasTransform) {
  const plan = useAppStore((s) => s.project);
  const selectedId = useAppStore((s) => s.selectedRebarId);
  const page = useAppStore((s) => s.currentPage);
  const mode = useAppStore((s) => s.toolMode);
  const visible = useAppStore((s) => s.overlayVisible.rebar);
  const mesh = plan && rebarOf(plan).find((i) => i.id === selectedId && i.kind === 'mesh' && i.pageNumber === page);
  const view = useMeshLayoutView(plan?.id ?? '', mesh?.id ?? '');
  const automatic = useMemo(() => mesh?.kind === 'mesh' && plan && visible && view.enabled
    ? prepareMeshLayoutPreview(mesh, plan.pages[page]?.calibration ?? null) : null, [mesh, plan, page, visible, view.enabled]);
  const active = canAuthorTakeoff() && mode === 'select' && meshLayoutCanInteract(view, automatic, visible);
  const rendered = useMemo(() => automatic?.status === 'ready' && automatic.sourceKey === view.sourceKey
    ? renderMeshLayoutPreview(automatic.automatic, view.overrides, automatic.placementsByLevel) : automatic,
  [automatic, view.sourceKey, view.overrides]);
  const drag = useRef<{ placement: MeshSheetPlacement; start: Point; rotation: MeshPlacementOverride['rotation']; next: MeshPlacementOverride | null; level: typeof view.level; planId: string; meshId: string } | null>(null);
  const cancel = () => {
    const old = drag.current; drag.current = null;
    if (old) useMeshLayoutPreviewStore.getState().resetLevel(old.planId, old.meshId, old.level);
  };
  useEffect(() => { cancel(); return cancel; }, [mesh?.id, page, active, view.level, automatic?.sourceKey]);
  const hit = (x: number, y: number, pointerType = 'touch') => {
    if (!active || rendered?.status !== 'ready') return null;
    const point = transform.screenToNative(x, y);
    const radius = nativeHitRadius(transform.getView().zoom, pointerType);
    return [...(rendered.sheetsByLevel[view.level] ?? [])].reverse().find((sheet) => {
      const corners = sheet.points.split(' ').map((pair) => { const [x, y] = pair.split(',').map(Number); return { x, y }; });
      let inside = false;
      for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
        const a = corners[i], b = corners[j];
        if (hitStraightBar(point, { start: a, end: b }, radius)) return true;
        if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    }) ?? null;
  };
  const editing: PlanPointerEdit = {
    begin: (x, y, _target, pointerType) => {
      const sheet = hit(x, y, pointerType);
      if (!sheet || sheet.id !== view.selectedPlacementId || !plan || !mesh || automatic?.status !== 'ready') return false;
      const placement = applyPlacementOverrides(automatic.placementsByLevel[view.level] ?? [], view.overrides[view.level] ?? {}).find((p) => p.id === sheet.id);
      if (!placement) return false;
      drag.current = { placement, start: planToLocal(transform.screenToNative(x, y), automatic.automatic.zoneFrame!, automatic.automatic.metersPerPixel!), rotation: view.overrides[view.level]?.[sheet.id]?.rotation ?? 0, next: null, level: view.level, planId: plan.id, meshId: mesh.id };
      return true;
    },
    move: (x, y) => {
      const old = drag.current;
      if (!old || automatic?.status !== 'ready') return;
      old.next = movePlacement(old.placement, old.rotation, old.start, planToLocal(transform.screenToNative(x, y), automatic.automatic.zoneFrame!, automatic.automatic.metersPerPixel!));
      useMeshLayoutPreviewStore.getState().setOverride(old.planId, old.meshId, old.level, old.next);
    },
    end: (x, y) => {
      editing.move(x, y);
      const old = drag.current; drag.current = null;
      if (!old) return;
      if (canAuthorTakeoff() && old.next && (old.next.x !== old.placement.x || old.next.y !== old.placement.y))
        useAppStore.getState().editMeshLayout(old.meshId, old.level, { type: 'move', id: old.placement.id, x: old.next.x, y: old.next.y });
      useMeshLayoutPreviewStore.getState().resetLevel(old.planId, old.meshId, old.level);
    },
    cancel,
  };
  return { active, editing, tap: (x: number, y: number) => {
    if (!active || !plan || !mesh) return false;
    const sheet = hit(x, y);
    if (sheet) useMeshLayoutPreviewStore.getState().select(plan.id, mesh.id, sheet.id);
    return true;
  } };
}
