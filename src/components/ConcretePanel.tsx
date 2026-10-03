import { useT, formatNumber } from '../i18n';
import { useAppStore } from '../store/appStore';
import type { Calibration } from '../types';
import type { ConcreteElement, ConcreteKind } from '../types/structural';
import { calculateConcrete, type ConcreteCalc } from '../lib/concrete';
import { CONCRETE_KINDS } from '../lib/structuralMutations';
import { concreteOf } from '../lib/structuralPlan';
import { markLabel, markPatch } from '../lib/structuralMarks';
import { cmToMeters, metersToCm } from '../lib/structuralUnits';
import { zoneGeometry } from '../lib/zoneGeometry';
import { round } from '../lib/geometry';
import { CONCRETE_COLOR } from './ConcreteZones';
import ConcreteSummary from './ConcreteSummary';
import ExistingAreaPicker from './ExistingAreaPicker';
import NumberField from './NumberField';
import Icon from './Icon';

function volumeText(calc: ConcreteCalc, t: ReturnType<typeof useT>, field: 'volumeM3' | 'orderM3'): string {
  const v = calc[field];
  return v === null ? t('concrete.notCalculable') : `${formatNumber(round(v, 2))} ${t('units.m3')}`;
}

export default function ConcretePanel() {
  const t = useT();
  const project = useAppStore((s) => s.project);
  const currentPage = useAppStore((s) => s.currentPage);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const toolMode = useAppStore((s) => s.toolMode);
  const setToolMode = useAppStore((s) => s.setToolMode);
  const concreteKind = useAppStore((s) => s.concreteKind);
  const setConcreteKind = useAppStore((s) => s.setConcreteKind);
  const selectedId = useAppStore((s) => s.selectedConcreteId);
  const setSelectedId = useAppStore((s) => s.setSelectedConcreteId);
  const updateElement = useAppStore((s) => s.updateConcreteElement);
  const deleteElement = useAppStore((s) => s.deleteConcreteElement);
  const changeKind = useAppStore((s) => s.changeConcreteElementKind);
  const copyRoomsToConcrete = useAppStore((s) => s.copyRoomsToConcrete);

  if (!project) return null;
  const elements = concreteOf(project);
  const selected = elements.find((e) => e.id === selectedId);

  if (selected) {
    return (
      <div className="room-panel">
        <div className="detail-nav">
          <button className="btn-ghost small" onClick={() => setSelectedId(null)}>
            <Icon name="back" />
            {t('concrete.back')}
          </button>
        </div>
        <div className="detail-header">
          <span className="color-dot" style={{ background: CONCRETE_COLOR }} />
          <span className="detail-header-text">
            <span className="detail-title" dir="auto">{markLabel(selected, t)}</span>
            <span className="detail-subtitle">{t(`concrete.kinds.${selected.kind}`)}</span>
          </span>
          <button
            className="icon-btn danger"
            title={t('concrete.delete')}
            onClick={() => {
              if (confirm(t('concrete.deleteConfirm', { mark: markLabel(selected, t) }))) deleteElement(selected.id);
            }}
          >
            <Icon name="trash" />
          </button>
        </div>
        <ConcreteDetail
          key={selected.id}
          element={selected}
          siblings={elements}
          calibration={project.pages[selected.pageNumber]?.calibration ?? null}
          onUpdate={(patch) => updateElement(selected.id, patch)}
          onChangeKind={(kind) => changeKind(selected.id, kind)}
        />
        {/* Kept under the form so an edit can be seen landing in the totals as it is typed. */}
        <ConcreteSummary plan={project} />
      </div>
    );
  }

  const toggleTool = (mode: 'draw' | 'draw-rect') => setToolMode(toolMode === mode ? 'select' : mode);
  const select = (el: ConcreteElement) => {
    setCurrentPage(el.pageNumber);
    setSelectedId(el.id);
  };

  return (
    <div className="room-panel">
      <div className="concrete-kinds" role="group" aria-label={t('concrete.kindPicker')}>
        {CONCRETE_KINDS.map((kind) => (
          <button
            key={kind}
            className={`btn-ghost small ${concreteKind === kind ? 'active' : ''}`}
            aria-pressed={concreteKind === kind}
            onClick={() => setConcreteKind(kind)}
          >
            {t(`concrete.kinds.${kind}`)}
          </button>
        ))}
      </div>

      <div className="room-create-row">
        <button className={`btn-primary ${toolMode === 'draw' ? 'active' : ''}`} onClick={() => toggleTool('draw')} title={t('concrete.drawHint')}>
          {t('concrete.draw')}
        </button>
        <div className="segmented room-shape-tools">
          <button
            className={`tool-btn ${toolMode === 'draw' ? 'active' : ''}`}
            onClick={() => toggleTool('draw')}
            title={t('concrete.drawPolygon')}
            aria-label={t('concrete.drawPolygon')}
          >
            <Icon name="polygon" />
          </button>
          <button
            className={`tool-btn ${toolMode === 'draw-rect' ? 'active' : ''}`}
            onClick={() => toggleTool('draw-rect')}
            title={t('concrete.drawRect')}
            aria-label={t('concrete.drawRect')}
          >
            <Icon name="rectangle" />
          </button>
        </div>
      </div>

      <ExistingAreaPicker
        copy={copyRoomsToConcrete}
        willCreate={(count) => t('concrete.copy.willCreate', { count, kind: t(`concrete.kinds.${concreteKind}`) })}
        addLabel={t('concrete.copy.add')}
        doneLabel={(count) => t('concrete.copy.done', { count })}
      />

      <div className="room-list">
        <span className="section-label">{t('concrete.zones', { count: elements.length })}</span>
        {elements.length === 0 && (
          <div className="empty-state">
            <Icon name="polygon" size={28} />
            <p>{t('concrete.empty')}</p>
          </div>
        )}
        <ul>
          {elements.map((el) => {
            const calc = calculateConcrete(el, project.pages[el.pageNumber]?.calibration ?? null);
            return (
              <li key={el.id} onClick={() => select(el)}>
                <span className="color-dot" style={{ background: CONCRETE_COLOR }} />
                <span className="room-list-name" dir="auto">
                  {markLabel(el, t)} · {t(`concrete.kinds.${el.kind}`)}
                </span>
                {el.pageNumber !== currentPage && <span className="room-list-page">{t('concrete.page', { page: el.pageNumber })}</span>}
                <span className="room-list-apt">{calc.volumeM3 === null ? '-' : volumeText(calc, t, 'volumeM3')}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <ConcreteSummary plan={project} />
    </div>
  );
}

function ConcreteDetail({
  element,
  siblings,
  calibration,
  onUpdate,
  onChangeKind,
}: {
  element: ConcreteElement;
  /** Every concrete element of the plan, for numbering an automatic mark. */
  siblings: ConcreteElement[];
  calibration: Calibration | null;
  onUpdate: (patch: Partial<Omit<ConcreteElement, 'id'>>) => void;
  onChangeKind: (kind: ConcreteKind) => void;
}) {
  const t = useT();
  const calc = calculateConcrete(element, calibration);
  const manual = !!element.sizeOverride;
  const depthLabel = element.kind === 'slab' ? t('concrete.thickness') : t('concrete.height');

  const toggleManual = (on: boolean) => {
    if (!on) return onUpdate({ sizeOverride: undefined });
    // Start from the measured rectangle when there is one, so the user only has to adjust it.
    const sides = zoneGeometry(element.points, calibration?.metersPerPixel ?? 0)?.sides;
    onUpdate({ sizeOverride: { lengthM: sides ? round(sides.longM, 2) : 0, widthM: sides ? round(sides.shortM, 2) : 0 } });
  };

  const message =
    calc.status === 'no-scale'
      ? t('concrete.noScale')
      : calc.status === 'missing-size'
        ? t('concrete.missingSize')
        : calc.status === 'missing-depth'
          ? element.kind === 'slab'
            ? t('concrete.missingThickness')
            : t('concrete.missingHeight')
          : null;

  return (
    <div className="room-detail">
      {/* Same zone for every kind, so a wrong pick is fixed here instead of by redrawing. */}
      <div className="concrete-kinds" role="group" aria-label={t('concrete.kindPicker')}>
        {CONCRETE_KINDS.map((kind) => (
          <button
            key={kind}
            className={`btn-ghost small ${element.kind === kind ? 'active' : ''}`}
            aria-pressed={element.kind === kind}
            onClick={() => onChangeKind(kind)}
          >
            {t(`concrete.kinds.${kind}`)}
          </button>
        ))}
      </div>
      {message && <div className="warning-box">{message}</div>}

      <div className="metrics-row concrete-results">
        <div>
          <span className="metric-label">{t('concrete.footprint')}</span>
          <span className={`metric-value ${calc.footprintM2 === null ? 'cal-missing' : ''}`}>
            {calc.footprintM2 === null ? t('concrete.notCalculable') : `${formatNumber(round(calc.footprintM2, 2))} ${t('units.m2')}`}
          </span>
        </div>
        <div>
          <span className="metric-label">{t('concrete.volume')}</span>
          <span className={`metric-value ${calc.volumeM3 === null ? 'cal-missing' : ''}`}>{volumeText(calc, t, 'volumeM3')}</span>
        </div>
        <div>
          <span className="metric-label">{t('concrete.order')}</span>
          <span className={`metric-value ${calc.orderM3 === null ? 'cal-missing' : ''}`}>{volumeText(calc, t, 'orderM3')}</span>
        </div>
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label>{t('concrete.mark')}</label>
          {/* Empty = automatic: the placeholder shows the name it will have in this language. */}
          <input dir="auto" value={element.mark} placeholder={markLabel(element, t)} onChange={(e) => onUpdate(markPatch(siblings, element, e.target.value))} />
        </div>
        <div className="form-row">
          <label>{t('concrete.grade')}</label>
          <input dir="auto" value={element.grade ?? ''} placeholder={t('concrete.gradePlaceholder')} onChange={(e) => onUpdate({ grade: e.target.value })} />
        </div>
        <div className="form-row">
          <label>
            {depthLabel} ({t(element.kind === 'slab' ? 'units.cm' : 'units.m')})
          </label>
          {/* A slab's thickness is typed in centimetres and stored in metres, like every other length. */}
          {element.kind === 'slab' ? (
            <NumberField value={metersToCm(element.depthM)} step="1" onChange={(v) => onUpdate({ depthM: cmToMeters(v) })} />
          ) : (
            <NumberField value={element.depthM} onChange={(v) => onUpdate({ depthM: v })} />
          )}
        </div>
        <div className="form-row">
          <label>{t('concrete.waste')}</label>
          <NumberField value={element.wastePercent} step="1" onChange={(v) => onUpdate({ wastePercent: v ?? 0 })} />
        </div>
        {element.kind === 'column' && (
          <div className="form-row">
            <label>{t('concrete.quantity')}</label>
            <NumberField value={element.quantity ?? 1} step="1" onChange={(v) => onUpdate({ quantity: v })} />
          </div>
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
              <label>
                {t('concrete.length')} ({t('units.m')})
              </label>
              <NumberField
                value={element.sizeOverride!.lengthM || undefined}
                onChange={(v) => onUpdate({ sizeOverride: { ...element.sizeOverride!, lengthM: v ?? 0 } })}
              />
            </div>
            <div className="form-row">
              <label>
                {t('concrete.width')} ({t('units.m')})
              </label>
              <NumberField
                value={element.sizeOverride!.widthM || undefined}
                onChange={(v) => onUpdate({ sizeOverride: { ...element.sizeOverride!, widthM: v ?? 0 } })}
              />
            </div>
          </div>
          <p className="muted">{t('concrete.manualSizeHint')}</p>
        </>
      )}
    </div>
  );
}
