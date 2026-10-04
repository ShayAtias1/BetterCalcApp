import { useId, useMemo, useRef, useEffect, type PointerEvent } from 'react';
import type { Calibration, Plan, Point } from '../types';
import type { RebarLevel, RebarMesh } from '../types/structural';
import { useT } from '../i18n';
import { meshLevels } from '../lib/rebarMesh';
import { rebarOf } from '../lib/structuralPlan';
import { REBAR_COLOR } from '../lib/structuralOverlay';
import { MAX_MESH_PREVIEW_SHEETS, prepareMeshLayoutPreview, renderMeshLayoutPreview, meshLayoutViewLevel, meshPreviewLabelsVisible, type MeshLayoutPreview } from '../lib/meshLayoutPreview';
import { useMeshLayoutPreviewStore, useMeshLayoutView, meshLayoutCanInteract } from '../store/meshLayoutPreviewStore';

import { applyPlacementOverrides, planToLocal, movePlacement, type MeshPlacementOverride } from '../lib/meshLayoutEditing';
import { resolveMeshProcurement } from '../lib/meshSheets';
import type { MeshSheetPlacement } from '../lib/meshSheetPlacement';
import { useAppStore } from '../store/appStore';

const MESSAGE_KEY = {
  'not-rectangular': 'rebar.layout.rectangularOnly',
  'no-plan-geometry': 'rebar.layout.noGeometry',
  'too-large': 'rebar.layout.tooLarge',
  unavailable: 'rebar.layout.unavailable',
} as const;

export function MeshLayoutControl({ planId, mesh, calibration }: { planId: string; mesh: RebarMesh; calibration: Calibration | null }) {
  const t = useT();
  const messageId = useId();
  const view = useMeshLayoutView(planId, mesh.id);
  const visible = useAppStore((s) => s.overlayVisible.rebar);
  const actions = useMeshLayoutPreviewStore.getState();
  const setEnabled = useMeshLayoutPreviewStore((s) => s.setEnabled);
  const setLevel = useMeshLayoutPreviewStore((s) => s.setLevel);
  const preview = useMemo(() => view.enabled ? prepareMeshLayoutPreview(mesh, calibration) : null, [mesh, calibration, view.enabled]);
  const levels = meshLevels(mesh).map((l) => l.level);
  const level = meshLayoutViewLevel(levels, view.level);
  const editing = meshLayoutCanInteract(view, preview, visible);
  const overrides = preview?.status === 'ready' && view.sourceKey === preview.sourceKey ? view.overrides : {};
  const placements = preview?.status === 'ready' && level ? preview.placementsByLevel[level] ?? [] : [];
  const selectedIndex = placements.findIndex((p) => p.id === view.selectedPlacementId);
  const selected = applyPlacementOverrides(placements, level ? overrides[level] ?? {} : {})[selectedIndex];
  const procurement = resolveMeshProcurement(mesh, calibration);
  const levelProcurement = procurement.levels.find((entry) => entry.level === level);
  const manual = levelProcurement?.source === 'manual';
  const editLayout = useAppStore((s) => s.editMeshLayout);
  useEffect(() => {
    if (view.selectedPlacementId && selectedIndex < 0 && level) actions.setLevel(planId, mesh.id, level);
  }, [view.selectedPlacementId, selectedIndex, level, planId, mesh.id, actions]);
  const message = preview && preview.status !== 'ready' ? t(MESSAGE_KEY[preview.status]) : null;
  return (
    <div className="rebar-layout-control">
      <label className="wi-check">
        <input type="checkbox" checked={view.enabled} onChange={(e) => setEnabled(planId, mesh.id, e.target.checked)} aria-describedby={message ? messageId : undefined} />
        {t('rebar.layout.show')}
      </label>
      {view.enabled && levels.length > 1 && (
        <div className="concrete-kinds" role="group" aria-label={t('rebar.layout.viewLevel')}>
          {levels.map((l) => (
            <button key={l} className={`btn-ghost small ${level === l ? 'active' : ''}`} aria-pressed={level === l} onClick={() => setLevel(planId, mesh.id, l)}>
              {t(l === 'bottom' ? 'rebar.levelBottom' : 'rebar.levelTop')}
            </button>
          ))}
        </div>
      )}
      {view.enabled && visible && preview?.status === 'ready' && level && (
        <>
          <button className="btn-ghost small" aria-pressed={editing} onClick={() => {
            if (!editing) useAppStore.getState().setToolMode('select');
            actions.setEditing(planId, mesh.id, !editing, preview, visible);
          }}>{t(editing ? 'rebar.layout.exitEdit' : 'rebar.layout.edit')}</button>
          {editing && <>
            <button className="btn-ghost small" disabled={(levelProcurement?.sheets ?? 0) >= MAX_MESH_PREVIEW_SHEETS} onClick={() => editLayout(mesh.id, level, { type: 'add' })}>{t('rebar.layout.add')}</button>
            {selected && <>
              <p>{t('rebar.layout.selectedSheet', { number: selectedIndex + 1, count: levelProcurement?.sheets ?? 0 })}</p>
              <button className="btn-ghost small" onClick={() => editLayout(mesh.id, level, { type: 'rotate', id: selected.id })}>{t('rebar.layout.rotate')}</button>
              <button className="btn-ghost small" onClick={() => { editLayout(mesh.id, level, { type: 'remove', id: selected.id }); actions.setLevel(planId, mesh.id, level); }}>{t('rebar.layout.remove')}</button>
            </>}
            <button className="btn-ghost small" disabled={!mesh.manualLayouts?.[level]} onClick={() => { actions.resetLevel(planId, mesh.id, level); editLayout(mesh.id, level, { type: 'reset' }); }}>{t('rebar.layout.reset')}</button>
          </>}
        </>
      )}
      {manual && <>
        <p role="status">{t('rebar.layout.manual')} · {t('rebar.layout.sheetCount', { count: levelProcurement!.sheets })}</p>
        <p className="muted">{t('rebar.layout.coverageNotice')}</p>
      </>}
      <p className="muted">{t('rebar.layout.settingsNotice')}</p>
      {message && <p className="muted" id={messageId} role="status">{message}</p>}
    </div>
  );
}

/** Full physical outlines. Hit targets exist only while explicitly editing a supported layout. */
export function MeshSheetPreviewLayer({ preview, level, zoom, visible, interaction }: { preview: MeshLayoutPreview | null; level: RebarLevel; zoom: number; visible: boolean; interaction?: {
  selectedId: string | null;
  start: (id: string, event: PointerEvent<SVGPolygonElement>) => void;
  move: (event: PointerEvent<SVGPolygonElement>) => void;
  end: (event: PointerEvent<SVGPolygonElement>) => void;
} }) {
  if (!visible || !preview || preview.status !== 'ready' || !Number.isFinite(zoom) || zoom <= 0) return null;
  const shownLevel = meshLayoutViewLevel(preview.levels, level);
  if (!shownLevel) return null;
  const labels = meshPreviewLabelsVisible(preview, shownLevel, zoom);
  return (
    <g className="mesh-layout-preview" data-level={shownLevel} pointerEvents={interaction ? 'auto' : 'none'} aria-hidden="true"
      onMouseDown={interaction ? (e) => { if (e.button === 0) e.stopPropagation(); } : undefined}
      onClick={interaction ? (e) => e.stopPropagation() : undefined}
      onDoubleClick={interaction ? (e) => e.stopPropagation() : undefined}>
      {preview.sheetsByLevel[shownLevel]!.map((sheet) => (
        <g key={sheet.id} data-placement-id={sheet.id}>
          <polygon points={sheet.points} fill={REBAR_COLOR} fillOpacity={interaction?.selectedId === sheet.id ? 0.14 : 0.055} stroke={REBAR_COLOR} strokeOpacity={interaction?.selectedId === sheet.id ? 1 : 0.6} strokeWidth={(interaction?.selectedId === sheet.id ? 2 : 1) / zoom}
            style={interaction ? { cursor: 'move', touchAction: 'none' } : undefined}
            onPointerDown={interaction ? (e) => interaction.start(sheet.id, e) : undefined}
            onPointerMove={interaction?.move} onPointerUp={interaction?.end} onPointerCancel={interaction?.end} onLostPointerCapture={interaction?.end} />
          {labels && <text pointerEvents="none" x={sheet.labelPosition.x} y={sheet.labelPosition.y} fontSize={9 / zoom} fill={REBAR_COLOR} textAnchor="middle" dominantBaseline="middle" direction="ltr" paintOrder="stroke" stroke="#fff" strokeWidth={2 / zoom}>{sheet.number}</text>}
        </g>
      ))}
    </g>
  );
}

/** Only the selected Mesh on the visible page is previewed. View/Rebar remains the master switch. */
export function MeshLayoutOverlay({ plan, pageNumber, selectedId, zoom, visible, screenToNative, interactionAllowed = true }: { plan: Plan; pageNumber: number; selectedId: string | null; zoom: number; visible: boolean; screenToNative?: (x: number, y: number) => Point; interactionAllowed?: boolean }) {
  const mesh = rebarOf(plan).find((item): item is RebarMesh => item.id === selectedId && item.kind === 'mesh' && item.pageNumber === pageNumber);
  const view = useMeshLayoutView(plan.id, mesh?.id ?? '');
  const calibration = mesh ? plan.pages[mesh.pageNumber]?.calibration ?? null : null;
  const automatic = useMemo(() => visible && mesh && view.enabled ? prepareMeshLayoutPreview(mesh, calibration) : null, [visible, mesh, calibration, view.enabled]);
  const preview = useMemo(() => automatic?.status === 'ready' && automatic.sourceKey === view.sourceKey ? renderMeshLayoutPreview(automatic.automatic, view.overrides, automatic.placementsByLevel) : automatic, [automatic, view.sourceKey, view.overrides]);
  const level = automatic?.status === 'ready' ? meshLayoutViewLevel(automatic.levels, view.level) : null;
  const editable = meshLayoutCanInteract(view, automatic, visible) && interactionAllowed && !!screenToNative;
  const drag = useRef<{ pointerId: number; placement: MeshSheetPlacement; rotation: MeshPlacementOverride['rotation']; start: Point } | null>(null);
  useEffect(() => () => {
    if (drag.current) {
      drag.current = null;
      if (mesh && level) useMeshLayoutPreviewStore.getState().resetLevel(plan.id, mesh.id, level);
    }
  }, [editable, level, mesh, plan.id, automatic]);
  const actions = useMeshLayoutPreviewStore.getState();
  const interaction = editable && mesh && level && automatic?.status === 'ready' && screenToNative ? {
    selectedId: view.selectedPlacementId,
    start: (id: string, e: PointerEvent<SVGPolygonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const placement = applyPlacementOverrides(automatic.placementsByLevel[level]!, view.overrides[level] ?? {}).find((p) => p.id === id)!;
      actions.select(plan.id, mesh.id, id);
      drag.current = { pointerId: e.pointerId, placement, rotation: view.overrides[level]?.[id]?.rotation ?? 0,
        start: planToLocal(screenToNative(e.clientX, e.clientY), automatic.automatic.zoneFrame!, automatic.automatic.metersPerPixel!) };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    move: (e: PointerEvent<SVGPolygonElement>) => {
      const active = drag.current;
      if (!active || active.pointerId !== e.pointerId) return;
      e.preventDefault(); e.stopPropagation();
      const current = planToLocal(screenToNative(e.clientX, e.clientY), automatic.automatic.zoneFrame!, automatic.automatic.metersPerPixel!);
      actions.setOverride(plan.id, mesh.id, level, movePlacement(active.placement, active.rotation, active.start, current));
    },
    end: (e: PointerEvent<SVGPolygonElement>) => {
      if (drag.current?.pointerId !== e.pointerId) return;
      e.stopPropagation();
      const active = drag.current;
      const override = useMeshLayoutPreviewStore.getState().views[JSON.stringify([plan.id, mesh.id])]?.overrides[level]?.[active.placement.id];
      drag.current = null;
      if (override && e.type === 'pointerup') useAppStore.getState().editMeshLayout(mesh.id, level, { type: 'move', id: active.placement.id, x: override.x, y: override.y });
      actions.resetLevel(plan.id, mesh.id, level);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    },
  } : undefined;
  return <MeshSheetPreviewLayer preview={preview} level={view.level} zoom={zoom} visible={visible && view.enabled} interaction={interaction} />;
}
