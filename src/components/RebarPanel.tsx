import { formatNumber, useT } from '../i18n';
import { useAppStore } from '../store/appStore';
import type { Calibration } from '../types';
import type { BarSpec, MeshReinforcement, RebarBars, RebarItem, RebarLayerDirection, RebarLevel, RebarMesh } from '../types/structural';
import { REBAR_DIAMETERS_MM, calculateRebar, type RebarCalc } from '../lib/rebar';
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
function itemSummary(item: RebarItem, t: T): string {
  if (item.kind === 'mesh') return meshNotation(item, t) || t('rebar.mesh');
  const parts = [item.diameterMm > 0 ? `Ø${item.diameterMm}` : t('rebar.bars')];
  if (item.count > 0 && item.lengthM > 0) parts.push(`${item.count} × ${formatNumber(item.lengthM)}`);
  return parts.join(' · ');
}

export default function RebarPanel() {
  const t = useT();
  const project = useAppStore((s) => s.project);
  const currentPage = useAppStore((s) => s.currentPage);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const toolMode = useAppStore((s) => s.toolMode);
  const setToolMode = useAppStore((s) => s.setToolMode);
  const selectedId = useAppStore((s) => s.selectedRebarId);
  const setSelectedId = useAppStore((s) => s.setSelectedRebarId);
  const addBars = useAppStore((s) => s.addRebarBars);
  const copyRoomsToRebar = useAppStore((s) => s.copyRoomsToRebar);
  const deleteItem = useAppStore((s) => s.deleteRebarItem);

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
            <span className="detail-subtitle">{t(selected.kind === 'mesh' ? 'rebar.meshZone' : 'rebar.manualBars')}</span>
          </span>
          <button
            className="icon-btn danger"
            title={t('rebar.delete')}
            onClick={() => {
              if (confirm(t('rebar.deleteConfirm', { mark: markLabel(selected, t) }))) deleteItem(selected.id);
            }}
          >
            <Icon name="trash" />
          </button>
        </div>
        {selected.kind === 'mesh' ? (
          <MeshDetail key={selected.id} mesh={selected} calibration={project.pages[selected.pageNumber]?.calibration ?? null} />
        ) : (
          <BarsDetail key={selected.id} bars={selected} />
        )}
      </div>
    );
  }

  const toggleTool = (mode: 'draw' | 'draw-rect') => setToolMode(toolMode === mode ? 'select' : mode);
  const select = (item: RebarItem) => {
    if (item.kind === 'mesh') setCurrentPage(item.pageNumber);
    setSelectedId(item.id);
  };

  return (
    <div className="room-panel">
      <div className="room-create-row">
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
      </div>

      <div className="rebar-entry-row">
        <ExistingAreaPicker
          copy={copyRoomsToRebar}
          willCreate={(count) => t('rebar.copy.willCreate', { count })}
          addLabel={t('rebar.copy.add')}
          doneLabel={(count) => t('rebar.copy.done', { count })}
        />
        <button className="btn-ghost small" onClick={() => addBars()} title={t('rebar.addBarsHint')}>
          <Icon name="plus" size={13} />
          {t('rebar.addBars')}
        </button>
      </div>

      <div className="room-list">
        <span className="section-label">{t('rebar.items', { count: items.length })}</span>
        {items.length === 0 && (
          <div className="empty-state">
            <Icon name="polygon" size={28} />
            <p>{t('rebar.empty')}</p>
          </div>
        )}
        <ul>
          {items.map((item) => {
            const calc = calculateRebar(item, project.pages[item.pageNumber]?.calibration ?? null);
            return (
              <li key={item.id} onClick={() => select(item)}>
                <span className="color-dot" style={{ background: REBAR_COLOR }} />
                <span className="room-list-name" dir="auto">
                  {markLabel(item, t)} · <span dir="ltr">{itemSummary(item, t)}</span>
                </span>
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
          <span className="metric-label">{t(showLength ? 'rebar.totalWeight' : 'quantitiesPanel.cols.netWeight')}</span>
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
  const t = useT();
  const updateItem = useAppStore((s) => s.updateRebarItem);
  const plan = useAppStore((s) => s.project);
  const siblings = plan ? rebarOf(plan) : [];
  const calc = calculateRebar(bars, null);

  return (
    <div className="room-detail">
      {calc.status !== 'ok' && <div className="warning-box">{t('rebar.barsInvalid')}</div>}
      <Results calc={calc} showLength />
      <div className="form-grid">
        <div className="form-row">
          <label>{t('concrete.mark')}</label>
          <input dir="auto" value={bars.mark} placeholder={markLabel(bars, t)} onChange={(e) => updateItem(bars.id, markPatch(siblings, bars, e.target.value))} />
        </div>
        <div className="form-row">
          <label>{t('rebar.diameter')}</label>
          <DiameterSelect value={bars.diameterMm} onChange={(mm) => updateItem(bars.id, { diameterMm: mm })} />
        </div>
        <div className="form-row">
          <label>{t('rebar.barCount')}</label>
          <NumberField value={bars.count || undefined} step="1" onChange={(v) => updateItem(bars.id, { count: v ?? 0 })} />
        </div>
        <div className="form-row">
          <label>{t('rebar.barLength')} ({t('units.m')})</label>
          <NumberField value={bars.lengthM || undefined} onChange={(v) => updateItem(bars.id, { lengthM: v ?? 0 })} />
        </div>
        <div className="form-row">
          <label>{t('concrete.waste')}</label>
          <NumberField value={bars.wastePercent} step="1" onChange={(v) => updateItem(bars.id, { wastePercent: v ?? 0 })} />
        </div>
      </div>
      <p className="muted">{t('concrete.page', { page: bars.pageNumber })}</p>
    </div>
  );
}
