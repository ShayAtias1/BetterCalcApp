import { useId, useMemo } from 'react';
import type { Calibration, Plan } from '../types';
import type { RebarLevel, RebarMesh } from '../types/structural';
import { useT } from '../i18n';
import { meshLevels } from '../lib/rebarMesh';
import { rebarOf } from '../lib/structuralPlan';
import { REBAR_COLOR } from '../lib/structuralOverlay';
import { prepareMeshLayoutPreview, meshLayoutViewLevel, meshPreviewLabelsVisible, type MeshLayoutPreview } from '../lib/meshLayoutPreview';
import { useMeshLayoutPreviewStore, useMeshLayoutView } from '../store/meshLayoutPreviewStore';

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
  const setEnabled = useMeshLayoutPreviewStore((s) => s.setEnabled);
  const setLevel = useMeshLayoutPreviewStore((s) => s.setLevel);
  const preview = useMemo(() => view.enabled ? prepareMeshLayoutPreview(mesh, calibration) : null, [mesh, calibration, view.enabled]);
  const levels = meshLevels(mesh).map((l) => l.level);
  const level = meshLayoutViewLevel(levels, view.level);
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
      {message && <p className="muted" id={messageId} role="status">{message}</p>}
    </div>
  );
}

/** Presentation only: full physical outlines with translucent overlap, never hit targets. */
export function MeshSheetPreviewLayer({ preview, level, zoom, visible }: { preview: MeshLayoutPreview | null; level: RebarLevel; zoom: number; visible: boolean }) {
  if (!visible || !preview || preview.status !== 'ready' || !Number.isFinite(zoom) || zoom <= 0) return null;
  const shownLevel = meshLayoutViewLevel(preview.levels, level);
  if (!shownLevel) return null;
  const labels = meshPreviewLabelsVisible(preview, shownLevel, zoom);
  return (
    <g className="mesh-layout-preview" data-level={shownLevel} pointerEvents="none" aria-hidden="true">
      {preview.sheetsByLevel[shownLevel]!.map((sheet) => (
        <g key={sheet.id} data-placement-id={sheet.id}>
          <polygon points={sheet.points} fill={REBAR_COLOR} fillOpacity={0.055} stroke={REBAR_COLOR} strokeOpacity={0.6} strokeWidth={1 / zoom} />
          {labels && <text x={sheet.labelPosition.x} y={sheet.labelPosition.y} fontSize={9 / zoom} fill={REBAR_COLOR} textAnchor="middle" dominantBaseline="middle" direction="ltr" paintOrder="stroke" stroke="#fff" strokeWidth={2 / zoom}>{sheet.number}</text>}
        </g>
      ))}
    </g>
  );
}

/** Only the selected Mesh on the visible page is previewed. View/Rebar remains the master switch. */
export function MeshLayoutOverlay({ plan, pageNumber, selectedId, zoom, visible }: { plan: Plan; pageNumber: number; selectedId: string | null; zoom: number; visible: boolean }) {
  const mesh = rebarOf(plan).find((item): item is RebarMesh => item.id === selectedId && item.kind === 'mesh' && item.pageNumber === pageNumber);
  const view = useMeshLayoutView(plan.id, mesh?.id ?? '');
  const calibration = mesh ? plan.pages[mesh.pageNumber]?.calibration ?? null : null;
  const preview = useMemo(() => visible && mesh && view.enabled ? prepareMeshLayoutPreview(mesh, calibration) : null, [visible, mesh, calibration, view.enabled]);
  return <MeshSheetPreviewLayer preview={preview} level={view.level} zoom={zoom} visible={visible && view.enabled} />;
}
