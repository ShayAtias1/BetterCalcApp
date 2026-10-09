import { confirmDialog } from '../lib/appDialogs';
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import { useState } from 'react';
import ReviewFields from './ReviewFields';
import { formatNumber, useT } from '../i18n';
import { useAppStore } from '../store/appStore';
import type { Calibration } from '../types';
import type { BarSpec, MeshReinforcement, RebarBars, RebarItem, RebarLayerDirection, RebarLevel, RebarMesh, RebarStirrup } from '../types/structural';
import { REBAR_DIAMETERS_MM, calculateRebar, resolveStraightBars, type RebarCalc } from '../lib/rebar';
import { resolveMeshProcurement, type MeshProcurementResult } from '../lib/meshSheets';
import { levelChoice, meshLevels, specNotation, withDirection, withMode, withoutDirection, withoutExtra, withSpec } from '../lib/rebarMesh';
import type { MeshLevelChoice } from '../lib/structuralMutations';
import { cmToMeters, metersToCm } from '../lib/structuralUnits';
import { rebarOf } from '../lib/structuralPlan';
import { markLabel, markPatch } from '../lib/structuralMarks';
import { zoneGeometry } from '../lib/zoneGeometry';
import { round } from '../lib/geometry';
import { REBAR_COLOR } from './RebarZones';
import ExistingAreaPicker from './ExistingAreaPicker';
import { MeshLayoutControl } from './MeshLayoutPreview';
import NumberField from './NumberField';
import Icon from './Icon';
import StirrupShapeBuilder from './StirrupShapeBuilder';
import StirrupPlacements from './StirrupPlacements';
import { resolveStirrupItem } from '../lib/stirrup';
import { prepareStirrupShape } from '../lib/stirrupShape';
import { drawnBarLength } from '../lib/straightBarsGeometry';

type T = ReturnType<typeof useT>;

const metres = (v: number, t: T) => `${formatNumber(round(v, 2))} ${t('units.m')}`;
const kg = (v: number, t: T) => `${formatNumber(round(v, 1))} ${t('units.kg')}`;

/** Compact, language-neutral notation of a mesh: `B Ø12 @ 20 · T Ø10 @ 15` (one entry per level; directional sides joined with `|`). */
function meshNotation(mesh: RebarMesh, t: T): string {
  return meshLevels(mesh)
    .map(({ level, reinforcement: r }) => {
      const tag = t(level === 'bottom' ? 'rebar.overlay.bottomShort' : 'rebar.overlay.topShort');
      const text = r.mode === 'uniform' ? specNotation(r.spec) : [specNotation(r.long), specNotation(r.short)].filter(Boolean).join(' | ');
      return text ? `${tag} ${text}` : '';
    })
    .filter(Boolean)
    .join(' · ');
}

/** What a list row says about an item: its notation (mesh) or its bars (manual). Notation is never translated. */
function itemSummary(item: RebarItem, t: T, resolved?: ReturnType<typeof resolveStraightBars>): string {
  if (item.kind === 'mesh') return meshNotation(item, t) || t('rebar.mesh');
  if (item.kind === 'stirrup') return `Ø${item.diameterMm} · ${t(`rebar.stirrup.templates.${item.shape.template}`)}`;
  const parts = [item.diameterMm > 0 ? `Ø${item.diameterMm}` : t('rebar.bars')];
  if (resolved?.count !== null && resolved?.count !== undefined) parts.push(t('rebar.spatial.count', { count: resolved.count }));
  if (resolved?.effectiveLengthM != null) parts.push(`${formatNumber(round(resolved.effectiveLengthM, 2))} ${t('units.m')}`);
  return parts.join(' · ');
}

export default function RebarPanel({ readOnly = false }: { readOnly?: boolean }) {
  const [filter, setFilter] = useState<'all' | 'mesh' | 'bars' | 'stirrup'>('all');
  const t = useT();
  const project = useAppStore((s) => s.project);
  const currentPage = useAppStore((s) => s.currentPage);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const toolMode = useAppStore((s) => s.toolMode);
  const setToolMode = useAppStore((s) => s.setToolMode);
  const selectedId = useAppStore((s) => s.selectedRebarId);
  const setSelectedId = useAppStore((s) => s.setSelectedRebarId);
  const addBars = useAppStore((s) => s.addRebarBars);
  const addStirrup = useAppStore((s) => s.addRebarStirrup);
  const copyRoomsToRebar = useAppStore((s) => s.copyRoomsToRebar);
  const deleteItem = useAppStore((s) => s.deleteRebarItem);
  const duplicateMesh = useAppStore((s) => s.duplicateRebarMesh);
  const duplicateBars = useAppStore((s) => s.duplicateStraightBars);
  const duplicateStirrup = useAppStore((s) => s.duplicateStirrupItem);

  if (!project) return null;
  const items = rebarOf(project);
  const selected = items.find((i) => i.id === selectedId);

  if (selected) {
    return (
      <div className="room-panel">
        <div className="detail-nav">
          <button className="btn-ghost small" onClick={() => setSelectedId(null)}>
            <Icon name="back" />
            {t('rebar.back')}
          </button>
        </div>
        <div className="detail-header">
          <span className="color-dot" style={{ background: REBAR_COLOR }} />
          <span className="detail-header-text">
            <span className="detail-title" dir="auto">{markLabel(selected, t)}</span>
            <span className="detail-subtitle">{t(selected.kind === 'mesh' ? 'rebar.meshZone' : selected.kind === 'stirrup' ? 'rebar.stirrupName' : selected.kind === 'bars' && selected.barsZone ? 'rebar.bars' : selected.kind === 'bars' && selected.drawnBars !== undefined ? 'rebar.spatial.individual' : 'rebar.manualBars')}</span>
          </span>
          {!readOnly && <><button className="icon-btn" title={t(selected.kind === 'mesh' ? 'rebar.duplicate' : selected.kind === 'stirrup' ? 'rebar.stirrup.duplicateItem' : 'rebar.spatial.duplicateItem')} aria-label={t(selected.kind === 'mesh' ? 'rebar.duplicate' : selected.kind === 'stirrup' ? 'rebar.stirrup.duplicateItem' : 'rebar.spatial.duplicateItem')} onClick={() => selected.kind === 'mesh' ? duplicateMesh(selected.id) : selected.kind === 'stirrup' ? duplicateStirrup(selected.id) : duplicateBars(selected.id)}>
            <Icon name="copy" />
          </button>
          <button
            className="icon-btn danger"
            title={t('rebar.delete')}
            onClick={async () => {
              if (await confirmDialog(t('rebar.deleteConfirm', { mark: markLabel(selected, t) }), { destructive: true })) deleteItem(selected.id);
            }}
          >
            <Icon name="trash" />
          </button>
        </>}</div>
        <ReviewFields readOnly={readOnly}>{selected.kind === 'mesh' ? (
          <MeshDetail key={selected.id} mesh={selected} calibration={project.pages[selected.pageNumber]?.calibration ?? null} />
        ) : selected.kind === 'stirrup' ? <StirrupDetail key={selected.id} item={selected} /> : (
          <BarsDetail key={selected.id} bars={selected} />
        )}</ReviewFields>
      </div>
    );
  }

  const toggleTool = (mode: 'draw' | 'draw-rect') => setToolMode(toolMode === mode ? 'select' : mode);
  const select = (item: RebarItem) => {
    setCurrentPage(item.pageNumber);
    setSelectedId(item.id);
  };

  return (
    <div className="room-panel">
      <div hidden={readOnly}>
      <div className="room-create-row rebar-create-controls">
        <button className={`btn-primary ${toolMode === 'draw' ? 'active' : ''}`} onClick={() => toggleTool('draw')} title={t('rebar.drawHint')}>
          {t('rebar.draw')}
        </button>
        <div className="segmented room-shape-tools">
          <button className={`tool-btn ${toolMode === 'draw' ? 'active' : ''}`} onClick={() => toggleTool('draw')} title={t('rebar.drawPolygon')} aria-label={t('rebar.drawPolygon')}>
            <Icon name="polygon" />
          </button>
          <button className={`tool-btn ${toolMode === 'draw-rect' ? 'active' : ''}`} onClick={() => toggleTool('draw-rect')} title={t('rebar.drawRect')} aria-label={t('rebar.drawRect')}>
            <Icon name="rectangle" />
          </button>
        </div>
        <ExistingAreaPicker
          copy={copyRoomsToRebar}
          willCreate={(count) => t('rebar.copy.willCreate', { count })}
          addLabel={t('rebar.copy.add')}
          doneLabel={(count) => t('rebar.copy.done', { count })}
        />
        <button className="btn-secondary structural-entry-action" onClick={() => addBars()} title={t('rebar.addBarsHint')}>
          <Icon name="plus" size={13} />
          {t('rebar.addBars')}
        </button>
        <button className="btn-secondary structural-entry-action" onClick={() => addStirrup()}><Icon name="plus" size={13} />{t('rebar.stirrup.addItem')}</button>
      </div>

      </div>
      {readOnly && <label className="adaptive-domain-picker">{t('workspace.tabs.rebar')}<select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
        <option value="all">{t('adaptive.allRebar')}</option><option value="mesh">{t('adaptive.mesh')}</option><option value="bars">{t('adaptive.bars')}</option><option value="stirrup">{t('adaptive.stirrups')}</option>
      </select></label>}
      <div className="room-list">
        <span className="section-label">{t('rebar.items', { count: items.length })}</span>
        {items.length === 0 && (
          <div className="empty-state">
            <Icon name="polygon" size={28} />
            <p>{t('rebar.empty')}</p>
          </div>
        )}
        <ul>
          {items.filter((item) => filter === 'all' || item.kind === filter).map((item) => {
            const calc = calculateRebar(item, project.pages[item.pageNumber]?.calibration ?? null, project.pages);
            return (
              <li key={item.id} onClick={() => select(item)}>
                <span className="color-dot" style={{ background: REBAR_COLOR }} />
                <span className="room-list-name" dir="auto">
                  {markLabel(item, t)} · <span dir="ltr">{itemSummary(item, t, item.kind === 'bars' ? resolveStraightBars(item, project.pages[item.pageNumber]?.calibration ?? null, project.pages) : undefined)}</span>
                </span>
                {item.kind === 'stirrup' && <StirrupShapeThumbnail item={item} />}
                {item.pageNumber !== currentPage && <span className="room-list-page">{t('concrete.page', { page: item.pageNumber })}</span>}
                <span className="room-list-apt">{calc.weightKg === null ? '-' : `${calc.estimated ? '≈ ' : ''}${kg(calc.weightKg, t)}`}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** Fit the shared saved-shape vectors into a centred, proportional list thumbnail. */
function StirrupShapeThumbnail({ item }: { item: RebarStirrup }) {
  const t = useT();
  const model = prepareStirrupShape(item.shape);
  const xs = model.points.map((point) => point.x);
  const ys = model.points.map((point) => point.y);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;
  const side = Math.max(maxX - minX, maxY - minY, 1) + 16;
  const left = (minX + maxX - side) / 2;
  const top = (minY + maxY - side) / 2;
  return <svg width="36" height="36" viewBox={`${left} ${top} ${side} ${side}`}
    preserveAspectRatio="xMidYMid meet" direction="ltr" role="img"
    aria-label={`${markLabel(item, t)} · ${t('rebar.stirrup.shape')}`}
    style={{ flexShrink: 0, display: 'block' }}>
    {model.segments.map((segment) => <line key={segment.index}
      x1={segment.normalizedStart.x} y1={segment.normalizedStart.y}
      x2={segment.normalizedEnd.x} y2={segment.normalizedEnd.y}
      stroke={REBAR_COLOR} strokeWidth="3" strokeLinecap="round" />)}
  </svg>;
}

// ---------- shared pieces ----------

function DiameterSelect({ value, onChange }: { value: number; onChange: (mm: number) => void }) {
  const t = useT();
  const standard = REBAR_DIAMETERS_MM as readonly number[];
  return (
    <select value={value > 0 ? String(value) : ''} onChange={(e) => onChange(Number(e.target.value) || 0)}>
      <option value="">{t('rebar.chooseDiameter')}</option>
      {value > 0 && !standard.includes(value) && <option value={value}>{`Ø${value}`}</option>}
      {standard.map((d) => (
        <option key={d} value={d}>{`Ø${d}`}</option>
      ))}
    </select>
  );
}

function Results({ calc, showLength, purchaseWeight }: { calc: RebarCalc; showLength: boolean; purchaseWeight?: number | null }) {
  const t = useT();
  const ok = calc.status === 'ok';
  const na = t('concrete.notCalculable');
  return (
    <>
      <div className="metrics-row concrete-results">
        {showLength && <div>
          <span className="metric-label">{t('rebar.totalLength')}</span>
          <span className={`metric-value ${ok ? '' : 'cal-missing'}`}>{ok ? `${calc.estimated ? '≈ ' : ''}${metres(calc.totalLengthM!, t)}` : na}</span>
        </div>}
        <div>
          <span className="metric-label">{t(showLength ? 'rebar.totalWeight' : 'rebar.requiredWeight')}</span>
          <span className={`metric-value ${ok ? '' : 'cal-missing'}`}>{ok ? `${calc.estimated ? '≈ ' : ''}${kg(calc.weightKg!, t)}` : na}</span>
        </div>
        <div>
          <span className="metric-label">{t(showLength ? 'rebar.order' : 'rebar.purchaseWeight')}</span>
          <span className={`metric-value ${(showLength ? ok : purchaseWeight !== null && purchaseWeight !== undefined) ? '' : 'cal-missing'}`}>{showLength ? (ok ? kg(calc.orderWeightKg!, t) : na) : purchaseWeight == null ? '-' : kg(purchaseWeight, t)}</span>
        </div>
      </div>
      {ok && showLength && (
        <p className="muted rebar-order-length">
          {t('rebar.orderLength', { length: `${calc.estimated ? '≈ ' : ''}${metres(calc.orderLengthM!, t)}` })}
          {calc.estimated && <span className="rebar-estimate">{t('rebar.estimate')}</span>}
        </p>
      )}
      {ok && calc.estimated && <p className="muted rebar-estimate">{t('rebar.estimate')} · {t('rebar.estimateHint')}</p>}
    </>
  );
}

function statusMessage(calc: RebarCalc, t: T): string | null {
  switch (calc.status) {
    case 'no-scale': return t('concrete.noScale');
    case 'missing-size': return t('concrete.missingSize');
    case 'no-layers': return t('rebar.noLayers');
    case 'invalid-input': return t('rebar.invalidInput');
    default: return null;
  }
}

/** One diameter + one spacing. The spacing is typed in centimetres and stored in metres. */
function SpecFields({ spec, onChange }: { spec: BarSpec; onChange: (patch: Partial<BarSpec>) => void }) {
  const t = useT();
  return (
    <div className="form-grid">
      <div className="form-row">
        <label>{t('rebar.diameter')}</label>
        <DiameterSelect value={spec.diameterMm} onChange={(mm) => onChange({ diameterMm: mm })} />
      </div>
      <div className="form-row">
        <label>{t('rebar.spacing')}</label>
        <NumberField value={spec.spacingM > 0 ? metersToCm(spec.spacingM) : undefined} step="1" onChange={(v) => onChange({ spacingM: v ? cmToMeters(v)! : 0 })} />
      </div>
    </div>
  );
}

/**
 * One reinforcement level of a mesh (Bottom or Top): its mode, its specification(s) and what they
 * add up to. The two directions of a directional level sit in one frame — they are one level, not
 * two layers.
 */
function LevelSection({
  level,
  reinforcement,
  onChange,
  action,
}: {
  level: RebarLevel;
  reinforcement: MeshReinforcement;
  onChange: (next: MeshReinforcement) => void;
  action?: React.ReactNode;
}) {
  const t = useT();
  const directionBlock = (direction: RebarLayerDirection, spec: BarSpec | undefined, canRemove: boolean) => {
    const label = t(direction === 'long' ? 'rebar.longSide' : 'rebar.shortSide');
    if (!spec || reinforcement.mode !== 'directional') {
      return (
        <div className="rebar-direction" key={direction}>
          <div className="rebar-direction-head">
            <span>{label}</span>
            <button className="btn-ghost small" onClick={() => onChange(withDirection(reinforcement, direction))}>
              <Icon name="plus" size={13} />
              {t('rebar.addDirection', { side: label })}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="rebar-direction" key={direction}>
        <div className="rebar-direction-head">
          <span>{label}</span>
          {canRemove && (
            <button className="icon-btn danger" title={t('rebar.removeDirection')} aria-label={t('rebar.removeDirection')} onClick={() => onChange(withoutDirection(reinforcement, direction))}>
              <Icon name="trash" size={14} />
            </button>
          )}
        </div>
        <SpecFields spec={spec} onChange={(patch) => onChange(withSpec(reinforcement, direction, patch))} />
      </div>
    );
  };

  return (
    <section className={`rebar-level rebar-level-${level}`} aria-label={t(level === 'bottom' ? 'rebar.bottomReinforcement' : 'rebar.topReinforcement')}>
      <div className="rebar-level-head">
        <span className="rebar-level-title">{t(level === 'bottom' ? 'rebar.bottomReinforcement' : 'rebar.topReinforcement')}</span>
        {action}
      </div>

      <div className="concrete-kinds" role="group" aria-label={t('rebar.levels')}>
        {(['uniform', 'directional'] as const).map((mode) => (
          <button
            key={mode}
            className={`btn-ghost small ${reinforcement.mode === mode ? 'active' : ''}`}
            aria-pressed={reinforcement.mode === mode}
            onClick={() => onChange(withMode(reinforcement, mode))}
          >
            {t(mode === 'uniform' ? 'rebar.modeUniform' : 'rebar.modeDirectional')}
          </button>
        ))}
      </div>

      {reinforcement.mode === 'uniform' ? (
        <>
          <SpecFields spec={reinforcement.spec} onChange={(patch) => onChange(withSpec(reinforcement, 'uniform', patch))} />
          <p className="muted rebar-layer-result">{t('rebar.uniformHint')}</p>
        </>
      ) : (
        <>
          <p className="muted rebar-layer-result">{t('rebar.sameLevelHint')}</p>
          {directionBlock('long', reinforcement.long, !!reinforcement.short)}
          {directionBlock('short', reinforcement.short, !!reinforcement.long)}
          {(reinforcement.extra ?? []).map((l) => (
            <div className="rebar-direction" key={l.id}>
              <div className="rebar-direction-head">
                <span dir="ltr">
                  {t('rebar.legacyExtra', { dir: t(l.direction === 'short' ? 'rebar.shortSide' : 'rebar.longSide'), spec: specNotation(l) ?? '-' })}
                </span>
                <button className="btn-ghost small danger" onClick={() => onChange(withoutExtra(reinforcement, l.id))}>
                  {t('rebar.removeLegacyExtra')}
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

// ---------- mesh sheets (procurement) ----------

/** Sheet size and overlap, and how many physical sheets the zone needs — secondary to the reinforcement above it. */
function MeshSheets({ mesh, result }: { mesh: RebarMesh; result: MeshProcurementResult }) {
  const t = useT();
  const updateItem = useAppStore((s) => s.updateRebarItem);
  const { settings } = result;
  const set = (patch: NonNullable<RebarMesh['sheets']>) => updateItem(mesh.id, { sheets: { ...mesh.sheets, ...patch } });

  let body: React.ReactNode = null;
  if (result.status === 'ok') {
    body = (
      <>
        {result.levels.length > 1 ? (
          <>
            {result.levels.map((l) => (
              <p className="rebar-sheets-line" key={l.level}>{`${t(l.level === 'bottom' ? 'rebar.levelBottom' : 'rebar.levelTop')}: ${t('quantitiesPanel.sheetsQty', { count: l.sheets! })}`}</p>
            ))}
            <div className="rebar-sheets-count">{`${t('rebar.sheets.total')}: ${t('quantitiesPanel.sheetsQty', { count: result.totalSheets! })}`}</div>
          </>
        ) : (
          <div className="rebar-sheets-count">{t('rebar.sheets.required', { count: result.totalSheets! })}</div>
        )}
      </>
    );
  } else if (result.status === 'invalid-settings') {
    body = <div className="warning-box">{t(result.settingsProblem === 'overlap' ? 'rebar.sheets.invalidOverlap' : 'rebar.sheets.invalidSize')}</div>;
  } else if (result.status === 'not-rectangular') {
    body = <p className="muted">{t('rebar.sheets.needsRectangle')}</p>;
  } else if (result.status === 'no-levels') {
    body = <p className="muted">{t('rebar.sheets.noLevels')}</p>;
  } else {
    body = <p className="muted">{t('rebar.sheets.noSize')}</p>;
  }

  return (
    <section className="rebar-sheets" aria-label={t('rebar.sheets.title')}>
      <span className="section-label">{t('rebar.sheets.title')}</span>
      <div className="form-grid rebar-sheets-fields">
        <div className="form-row">
          <label>{t('rebar.sheets.length')} ({t('units.m')})</label>
          <NumberField value={settings.lengthM} onChange={(v) => set({ lengthM: v ?? 0 })} />
        </div>
        <div className="form-row">
          <label>{t('rebar.sheets.width')} ({t('units.m')})</label>
          <NumberField value={settings.widthM} onChange={(v) => set({ widthM: v ?? 0 })} />
        </div>
        <div className="form-row">
          <label>{t('rebar.sheets.overlap')} ({t('units.cm')})</label>
          <NumberField value={metersToCm(settings.overlapM)} step="1" onChange={(v) => set({ overlapM: cmToMeters(v) ?? 0 })} />
        </div>
      </div>
      {body}
    </section>
  );
}

// ---------- mesh zone ----------

function MeshDetail({ mesh, calibration }: { mesh: RebarMesh; calibration: Calibration | null }) {
  const t = useT();
  const updateItem = useAppStore((s) => s.updateRebarItem);
  const plan = useAppStore((s) => s.project);
  const siblings = plan ? rebarOf(plan) : [];
  const setLevels = useAppStore((s) => s.setRebarMeshLevels);
  const setReinforcement = useAppStore((s) => s.setRebarMeshReinforcement);
  const copyBottomToTop = useAppStore((s) => s.copyRebarBottomToTop);
  const calc = calculateRebar(mesh, calibration);
  const sheets = resolveMeshProcurement(mesh, calibration);
  const message = statusMessage(calc, t);
  const manual = !!mesh.sizeOverride;
  const choice = levelChoice(mesh);

  const toggleManual = (on: boolean) => {
    if (!on) return updateItem(mesh.id, { sizeOverride: undefined });
    const sides = zoneGeometry(mesh.points, calibration?.metersPerPixel ?? 0)?.sides;
    updateItem(mesh.id, { sizeOverride: { lengthM: sides ? round(sides.longM, 2) : 0, widthM: sides ? round(sides.shortM, 2) : 0 } });
  };

  const choices: { id: MeshLevelChoice; label: string }[] = [
    { id: 'bottom', label: t('rebar.levelBottom') },
    { id: 'top', label: t('rebar.levelTop') },
    { id: 'both', label: t('rebar.levelBoth') },
  ];

  return (
    <div className="room-detail">
      {message && <div className="warning-box">{message}</div>}
      <MeshSheets mesh={mesh} result={sheets} />
      <Results calc={calc} showLength={false} purchaseWeight={sheets.procurementWeightKg} />
      {plan && <MeshLayoutControl planId={plan.id} mesh={mesh} calibration={calibration} />}

      <div className="form-grid">
        <div className="form-row">
          <label>{t('concrete.mark')}</label>
          <input dir="auto" value={mesh.mark} placeholder={markLabel(mesh, t)} onChange={(e) => updateItem(mesh.id, markPatch(siblings, mesh, e.target.value))} />
        </div>
        <div className="form-row">
          <label>{t('concrete.waste')}</label>
          <NumberField value={mesh.wastePercent} step="1" onChange={(v) => updateItem(mesh.id, { wastePercent: v ?? 0 })} />
        </div>
      </div>

      {/* Which reinforcement levels this zone has — Top and Bottom are the layers of steel. */}
      <span className="section-label">{t('rebar.levels')}</span>
      <div className="concrete-kinds" role="group" aria-label={t('rebar.levels')}>
        {choices.map((c) => (
          <button key={c.id} className={`btn-ghost small ${choice === c.id ? 'active' : ''}`} aria-pressed={choice === c.id} onClick={() => setLevels(mesh.id, c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      {mesh.bottom && <LevelSection level="bottom" reinforcement={mesh.bottom} onChange={(next) => setReinforcement(mesh.id, 'bottom', next)} />}
      {mesh.top && (
        <LevelSection
          level="top"
          reinforcement={mesh.top}
          onChange={(next) => setReinforcement(mesh.id, 'top', next)}
          action={
            mesh.bottom ? (
              <button className="btn-ghost small" onClick={() => copyBottomToTop(mesh.id)} title={t('rebar.copyBottomToTopHint')}>
                {t('rebar.copyBottomToTop')}
              </button>
            ) : undefined
          }
        />
      )}

      <label className="wi-check concrete-manual-toggle">
        <input type="checkbox" checked={manual} onChange={(e) => toggleManual(e.target.checked)} />
        {t('concrete.manualSize')}
      </label>
      {manual && (
        <>
          <div className="form-grid">
            <div className="form-row">
              <label>{t('concrete.length')} ({t('units.m')})</label>
              <NumberField value={mesh.sizeOverride!.lengthM || undefined} onChange={(v) => updateItem(mesh.id, { sizeOverride: { ...mesh.sizeOverride!, lengthM: v ?? 0 } })} />
            </div>
            <div className="form-row">
              <label>{t('concrete.width')} ({t('units.m')})</label>
              <NumberField value={mesh.sizeOverride!.widthM || undefined} onChange={(v) => updateItem(mesh.id, { sizeOverride: { ...mesh.sizeOverride!, widthM: v ?? 0 } })} />
            </div>
          </div>
          <p className="muted">{t('concrete.manualSizeHint')}</p>
        </>
      )}
    </div>
  );
}

// ---------- manual bars ----------

function BarsDetail({ bars }: { bars: RebarBars }) {
  const { touchInput } = useWorkspaceLayout();
  const t = useT();
  const updateItem = useAppStore((s) => s.updateRebarItem);
  const plan = useAppStore((s) => s.project);
  const siblings = plan ? rebarOf(plan) : [];
  const startZone = useAppStore((s) => s.startBarsZone);
  const removeZone = useAppStore((s) => s.removeBarsZone);
  const startLine = useAppStore((s) => s.startDrawingBar);
  const individualMode = useAppStore((s) => s.setBarsIndividualMode);
  const removeLayout = useAppStore((s) => s.removeDrawnBarsLayout);
  const barsDrawing = useAppStore((s) => s.barsDrawing);
  const toolMode = useAppStore((s) => s.toolMode);
  const setToolMode = useAppStore((s) => s.setToolMode);
  const selectedBarId = useAppStore((s) => s.selectedDrawnBarId);
  const selectBar = useAppStore((s) => s.setSelectedDrawnBarId);
  const resizeBar = useAppStore((s) => s.resizeDrawnBar);
  const duplicateBar = useAppStore((s) => s.duplicateDrawnBar);
  const deleteBar = useAppStore((s) => s.deleteDrawnBar);
  const selectedBar = bars.drawnBars?.find((bar) => bar.id === selectedBarId);
  const calibration = plan?.pages[bars.pageNumber]?.calibration ?? null;
  const selectedCalibration = selectedBar ? plan?.pages[selectedBar.pageNumber]?.calibration ?? null : null;
  const calc = resolveStraightBars(bars, calibration, plan?.pages);
  const zone = bars.barsZone;

  return (
    <div className="room-detail">
      {calc.status !== 'ok' && <div className="warning-box">{statusMessage(calc, t)}</div>}
      <Results calc={calc} showLength />
      <div className="concrete-kinds" role="group" aria-label={t('rebar.spatial.mode')}>
        <button className={`btn-ghost small ${bars.drawnBars === undefined ? 'active' : ''}`} aria-pressed={bars.drawnBars === undefined} disabled={bars.drawnBars !== undefined} onClick={() => startZone(bars.id)}>{t('rebar.spatial.area')}</button>
        <button className={`btn-ghost small ${bars.drawnBars !== undefined ? 'active' : ''}`} disabled={!!zone} onClick={() => individualMode(bars.id)}>{t('rebar.spatial.individual')}</button>
      </div>
      {bars.drawnBars !== undefined ? <ReviewFields readOnly={false}>
        <div className="concrete-kinds">
          <button className={`btn-ghost small ${barsDrawing === 'line' && toolMode === 'draw' ? 'active' : ''}`}
            onClick={() => barsDrawing === 'line' && toolMode === 'draw' ? setToolMode('select') : startLine(bars.id)}>
            {t(barsDrawing === 'line' && toolMode === 'draw' ? 'rebar.spatial.finishDrawing' : 'rebar.spatial.drawBar')}
          </button>
          {!touchInput && bars.drawnBars.length > 0 && <button className="btn-ghost small" onClick={() => { selectBar(null); setToolMode('select'); }}>{t('rebar.spatial.moveGroup')}</button>}
          <button className="btn-ghost small danger" onClick={async () => { if (await confirmDialog(t('rebar.spatial.removeLayoutConfirm'), { destructive: true })) removeLayout(bars.id); }}>{t('rebar.spatial.removeLayout')}</button>
        </div>
        {!selectedBar && bars.drawnBars.length > 0 && <p className="muted">{t('rebar.spatial.groupHint')}</p>}
        <p className="muted">{t('rebar.spatial.count', { count: calc.count ?? '-' })}</p>
        {selectedBar && <section className="rebar-direction">
          <div className="rebar-direction-head">
            <span>{t('rebar.spatial.selectedBar')}</span>
            <button className="icon-btn" title={t('rebar.spatial.duplicateBar')} aria-label={t('rebar.spatial.duplicateBar')}
              onClick={() => duplicateBar(bars.id, selectedBar.id)}><Icon name="copy" /></button>
            <button className="icon-btn danger" title={t('rebar.spatial.deleteBar')} aria-label={t('rebar.spatial.deleteBar')}
              onClick={() => deleteBar(bars.id, selectedBar.id)}><Icon name="trash" /></button>
            <button className="btn-ghost small" onClick={() => { selectBar(null); setToolMode('select'); }}>{t('rebar.spatial.doneEditing')}</button>
          </div>
          {selectedCalibration ? <div className="form-row">
            <label>{t('rebar.barLength')} ({t('units.m')})</label>
            <NumberField value={drawnBarLength(selectedBar, selectedCalibration.metersPerPixel) ?? undefined}
              onChange={(v) => { if (v) resizeBar(bars.id, selectedBar.id, v); }} />
          </div> : <p className="muted">{t('concrete.noScale')}</p>}
        </section>}
      </ReviewFields> : <div className="concrete-kinds">
        <button className="btn-ghost small" onClick={() => startZone(bars.id)}>{t(zone ? 'rebar.spatial.changeZone' : 'rebar.spatial.markArea')}</button>
        {zone && <button className="btn-ghost small danger" onClick={() => removeZone(bars.id)}>{t('rebar.spatial.removeZone')}</button>}
      </div>}
      {zone && <>
        <div className="form-row">
          <label>{t('rebar.spatial.direction')}</label>
          <select value={zone.direction} onChange={(e) => updateItem(bars.id, { barsZone: { ...zone, direction: e.target.value as RebarLayerDirection } })}>
            <option value="long">{t('rebar.spatial.long')}</option>
            <option value="short">{t('rebar.spatial.short')}</option>
          </select>
        </div>
        <label className="wi-check">
          <input type="checkbox" checked={zone.lengthMode === 'manual'} onChange={(e) => updateItem(bars.id, { barsZone: { ...zone,
            lengthMode: e.target.checked ? 'manual' : 'automatic', manualLengthM: e.target.checked ? calc.effectiveLengthM ?? undefined : undefined } })} />
          {t('rebar.spatial.manualLength')}
        </label>
        {zone.lengthMode !== 'manual' && <p className="muted">{t('rebar.spatial.automaticLength')}: {calc.effectiveLengthM === null ? '-' : metres(calc.effectiveLengthM, t)}</p>}
      </>}
      <div className="form-grid">
        <div className="form-row">
          <label>{t('concrete.mark')}</label>
          <input dir="auto" value={bars.mark} placeholder={markLabel(bars, t)} onChange={(e) => updateItem(bars.id, markPatch(siblings, bars, e.target.value))} />
        </div>
        <div className="form-row">
          <label>{t('rebar.diameter')}</label>
          <DiameterSelect value={bars.diameterMm} onChange={(mm) => updateItem(bars.id, { diameterMm: mm })} />
        </div>
        {bars.drawnBars === undefined && <div className="form-row">
          <label>{t('rebar.barCount')}</label>
          <NumberField value={bars.count || undefined} step="1" onChange={(v) => updateItem(bars.id, { count: v ?? 0 })} />
        </div>}
        {bars.drawnBars === undefined && (!zone || zone.lengthMode === 'manual') && <div className="form-row">
          <label>{t('rebar.barLength')} ({t('units.m')})</label>
          <NumberField value={(zone ? zone.manualLengthM : bars.lengthM) || undefined} onChange={(v) => updateItem(bars.id,
            zone ? { barsZone: { ...zone, manualLengthM: v ?? 0 } } : { lengthM: v ?? 0 })} />
        </div>}
        <div className="form-row">
          <label>{t('concrete.waste')}</label>
          <NumberField value={bars.wastePercent} step="1" onChange={(v) => updateItem(bars.id, { wastePercent: v ?? 0 })} />
        </div>
      </div>
      <p className="muted">{t('concrete.page', { page: bars.pageNumber })}</p>
    </div>
  );
}

function StirrupDetail({ item }: { item: RebarStirrup }) {
  const t = useT();
  const plan = useAppStore((s) => s.project);
  const update = useAppStore((s) => s.updateRebarItem);
  if (!plan) return null;
  const resolved = resolveStirrupItem(item, plan.pages);
  return <div className="room-detail">
    <div className="form-grid">
      <div className="form-row"><label>{t('concrete.mark')}</label>
        <input dir="auto" value={item.mark} placeholder={markLabel(item, t)} onChange={(e) => update(item.id, markPatch(rebarOf(plan), item, e.target.value))} /></div>
      <div className="form-row"><label>{t('rebar.diameter')}</label><DiameterSelect value={item.diameterMm} onChange={(mm) => update(item.id, { diameterMm: mm })} /></div>
      <div className="form-row"><label>{t('concrete.waste')}</label><NumberField value={item.wastePercent} step="1" onChange={(v) => update(item.id, { wastePercent: v ?? 0 })} /></div>
    </div>
    <StirrupShapeBuilder item={item} />
    <StirrupPlacements item={item} />
    <p>{t('rebar.stirrup.quantity')}: {resolved.totalCount ?? '-'}</p>
    <Results calc={resolved} showLength />
    {item.placements.length === 0 ? <p className="muted">{t('rebar.stirrup.noPlacements')}</p> : resolved.status !== 'ok' && <p className="cal-missing">{statusMessage(resolved, t)}</p>}
  </div>;
}
