import { formatNumber, useT } from '../i18n';
import { useAppStore } from '../store/appStore';
import type { Calibration } from '../types';
import type { RebarBars, RebarItem, RebarLayer, RebarMesh } from '../types/structural';
import { REBAR_DIAMETERS_MM, calculateRebar, rebarNotation, type RebarCalc, type RebarLayerCalc } from '../lib/rebar';
import { oppositeDirection } from '../lib/structuralMutations';
import { rebarOf } from '../lib/structuralPlan';
import { markLabel, markPatch } from '../lib/structuralMarks';
import { zoneGeometry } from '../lib/zoneGeometry';
import { round } from '../lib/geometry';
import { REBAR_COLOR } from './RebarZones';
import ExistingAreaPicker from './ExistingAreaPicker';
import RebarSummary from './RebarSummary';
import NumberField from './NumberField';
import Icon from './Icon';

type T = ReturnType<typeof useT>;

const metres = (v: number, t: T) => `${formatNumber(round(v, 2))} ${t('units.m')}`;
const kg = (v: number, t: T) => `${formatNumber(round(v, 1))} ${t('units.kg')}`;

/** What a list row says about an item: its notation (mesh) or its bars (manual). Notation is never translated. */
function itemSummary(item: RebarItem, t: T): string {
  if (item.kind === 'mesh') return rebarNotation(item.layers) || t('rebar.mesh');
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
        {/* Under the form, so an edit can be seen landing in the totals as it is typed. */}
        <RebarSummary plan={project} />
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
                <span className="room-list-apt">{calc.weightKg === null ? '—' : `${calc.estimated ? '≈ ' : ''}${kg(calc.weightKg, t)}`}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <RebarSummary plan={project} />
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

function Results({ calc }: { calc: RebarCalc }) {
  const t = useT();
  const ok = calc.status === 'ok';
  const na = t('concrete.notCalculable');
  return (
    <>
      <div className="metrics-row concrete-results">
        <div>
          <span className="metric-label">{t('rebar.totalLength')}</span>
          <span className={`metric-value ${ok ? '' : 'cal-missing'}`}>{ok ? `${calc.estimated ? '≈ ' : ''}${metres(calc.totalLengthM!, t)}` : na}</span>
        </div>
        <div>
          <span className="metric-label">{t('rebar.totalWeight')}</span>
          <span className={`metric-value ${ok ? '' : 'cal-missing'}`}>{ok ? `${calc.estimated ? '≈ ' : ''}${kg(calc.weightKg!, t)}` : na}</span>
        </div>
        <div>
          <span className="metric-label">{t('rebar.order')}</span>
          <span className={`metric-value ${ok ? '' : 'cal-missing'}`}>{ok ? `${calc.estimated ? '≈ ' : ''}${kg(calc.orderWeightKg!, t)}` : na}</span>
        </div>
      </div>
      {ok && (
        <p className="muted rebar-order-length">
          {t('rebar.orderLength', { length: `${calc.estimated ? '≈ ' : ''}${metres(calc.orderLengthM!, t)}` })}
          {calc.estimated && <span className="rebar-estimate">{t('rebar.estimate')}</span>}
        </p>
      )}
      {ok && calc.estimated && <p className="muted">{t('rebar.estimateHint')}</p>}
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

/** The product-language line(s) under a layer: which side the bars run along, and how many of what length. */
function LayerResult({ layer, result }: { layer: RebarLayer; result: RebarLayerCalc | undefined }) {
  const t = useT();
  if (!result || result.totalLengthM === null) return null;
  if (result.estimated) {
    return <p className="muted rebar-layer-result">{t('rebar.layerEstimate', { total: metres(result.totalLengthM, t) })}</p>;
  }
  const side = metres(result.cutLengthM!, t);
  return (
    <p className="muted rebar-layer-result">
      {t(layer.direction === 'short' ? 'rebar.runsAlongShort' : 'rebar.runsAlongLong', { length: side })}
      <br />
      {t('rebar.countTimes', { count: result.barCount!, length: side, total: metres(result.totalLengthM, t) })}
    </p>
  );
}

// ---------- mesh zone ----------

function MeshDetail({ mesh, calibration }: { mesh: RebarMesh; calibration: Calibration | null }) {
  const t = useT();
  const updateItem = useAppStore((s) => s.updateRebarItem);
  const plan = useAppStore((s) => s.project);
  const siblings = plan ? rebarOf(plan) : [];
  const addLayer = useAppStore((s) => s.addRebarLayer);
  const updateLayer = useAppStore((s) => s.updateRebarLayer);
  const removeLayer = useAppStore((s) => s.removeRebarLayer);
  const calc = calculateRebar(mesh, calibration);
  const message = statusMessage(calc, t);
  const manual = !!mesh.sizeOverride;

  const toggleManual = (on: boolean) => {
    if (!on) return updateItem(mesh.id, { sizeOverride: undefined });
    const sides = zoneGeometry(mesh.points, calibration?.metersPerPixel ?? 0)?.sides;
    updateItem(mesh.id, { sizeOverride: { lengthM: sides ? round(sides.longM, 2) : 0, widthM: sides ? round(sides.shortM, 2) : 0 } });
  };

  // "Two directions": a second layer with the first one's bars, running the other way.
  const first = mesh.layers[0];
  const twoDirections = () => addLayer(mesh.id, { diameterMm: first.diameterMm, spacingM: first.spacingM, direction: oppositeDirection(first.direction) });

  return (
    <div className="room-detail">
      {message && <div className="warning-box">{message}</div>}
      <Results calc={calc} />

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

      <span className="section-label">{t('rebar.layers')}</span>
      {mesh.layers.map((layer, i) => (
        <div key={layer.id} className="rebar-layer">
          <div className="rebar-layer-head">
            <span>{t('rebar.layer', { n: i + 1 })}</span>
            <button className="icon-btn danger" title={t('rebar.removeLayer')} aria-label={t('rebar.removeLayer')} onClick={() => removeLayer(mesh.id, layer.id)}>
              <Icon name="trash" size={14} />
            </button>
          </div>
          <div className="form-grid">
            <div className="form-row">
              <label>{t('rebar.diameter')}</label>
              <DiameterSelect value={layer.diameterMm} onChange={(mm) => updateLayer(mesh.id, layer.id, { diameterMm: mm })} />
            </div>
            <div className="form-row">
              <label>{t('rebar.spacing')}</label>
              <NumberField
                value={layer.spacingM > 0 ? round(layer.spacingM * 1000, 1) : undefined}
                step="10"
                onChange={(v) => updateLayer(mesh.id, layer.id, { spacingM: v ? v / 1000 : 0 })}
              />
            </div>
          </div>
          <div className="form-row">
            <label>{t('rebar.direction')}</label>
            <select value={layer.direction} onChange={(e) => updateLayer(mesh.id, layer.id, { direction: e.target.value as RebarLayer['direction'] })}>
              <option value="long">{t('rebar.alongLong')}</option>
              <option value="short">{t('rebar.alongShort')}</option>
            </select>
          </div>
          <LayerResult layer={layer} result={calc.layers[i]} />
        </div>
      ))}
      <div className="rebar-layer-actions">
        <button className="btn-ghost small" onClick={() => addLayer(mesh.id)}>
          <Icon name="plus" size={13} />
          {t('rebar.addLayer')}
        </button>
        {mesh.layers.length === 1 && (
          <button className="btn-ghost small" onClick={twoDirections} title={t('rebar.twoDirectionsHint')}>
            {t('rebar.twoDirections')}
          </button>
        )}
      </div>

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
      <Results calc={calc} />
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
