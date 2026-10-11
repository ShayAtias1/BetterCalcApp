import { confirmDialog } from '../lib/appDialogs';
import ReviewFields from './ReviewFields';
import { useT, formatNumber } from '../i18n';
import { useAppStore } from '../store/appStore';
import type { Calibration } from '../types';
import type { ConcreteElement, ConcreteKind } from '../types/structural';
import { calculateConcrete, type ConcreteCalc } from '../lib/concrete';
import { CONCRETE_KINDS } from '../lib/structuralMutations';
import { concreteOf } from '../lib/structuralPlan';
import { markCode, markLabel, markPatch } from '../lib/structuralMarks';
import { cmToMeters, metersToCm } from '../lib/structuralUnits';
import { zoneGeometry } from '../lib/zoneGeometry';
import { round } from '../lib/geometry';
import { CONCRETE_COLOR } from './ConcreteZones';
import ExistingAreaPicker from './ExistingAreaPicker';
import NumberField from './NumberField';
import Icon from './Icon';
import { InspectorCloseButton, InspectorEmpty, type PanelPart } from './PanelPart';

/** A zone's spec line: grade · thickness (slab, cm) or height (m) · count (columns). */
function concreteSpec(el: ConcreteElement, t: ReturnType<typeof useT>): string {
  const depth = el.depthM
    ? el.kind === 'slab'
      ? `${formatNumber(metersToCm(el.depthM) ?? 0)} ${t('units.cm')}`
      : `${t('concrete.height')} ${formatNumber(el.depthM)}`
    : '';
  const count = el.kind === 'column' && (el.quantity ?? 1) > 1 ? `${el.quantity}×` : '';
  return [el.grade?.trim(), depth, count].filter(Boolean).join(' · ');
}

function volumeText(calc: ConcreteCalc, t: ReturnType<typeof useT>, field: 'volumeM3' | 'orderM3'): string {
  const v = calc[field];
  return v === null ? t('concrete.notCalculable') : `${formatNumber(round(v, 2))} ${t('units.m3')}`;
}

export default function ConcretePanel({ readOnly = false, part }: { readOnly?: boolean; part?: PanelPart }) {
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
  const duplicateElement = useAppStore((s) => s.duplicateConcreteElement);
  const changeKind = useAppStore((s) => s.changeConcreteElementKind);
  const copyRoomsToConcrete = useAppStore((s) => s.copyRoomsToConcrete);

  if (!project) return null;
  const elements = concreteOf(project);
  const selected = elements.find((e) => e.id === selectedId);

  if (part === 'detail' && !selected) return <InspectorEmpty text={t('workspace.inspector.empty.concrete')} />;
  if (selected && part !== 'list') {
    return (
      <div className="room-panel">
        {!part && <div className="detail-nav">
          <button className="btn-ghost small" onClick={() => setSelectedId(null)}>
            <Icon name="back" />
            {t('concrete.back')}
          </button>
        </div>}
        <div className="detail-header">
          <span className="color-dot" style={{ background: CONCRETE_COLOR }} />
          <span className="detail-header-text">
            <span className="detail-title" dir="auto">{markLabel(selected, t)}</span>
            <span className="detail-subtitle">{t(`concrete.kinds.${selected.kind}`)} · {t('concrete.page', { page: selected.pageNumber })}</span>
          </span>
          {!readOnly && <><button className="icon-btn" title={t('concrete.duplicate')} aria-label={t('concrete.duplicate')} onClick={() => duplicateElement(selected.id)}>
            <Icon name="copy" />
          </button>
          <button
            className="icon-btn danger"
            title={t('concrete.delete')}
            onClick={async () => {
              if (await confirmDialog(t('concrete.deleteConfirm', { mark: markLabel(selected, t) }), { destructive: true })) deleteElement(selected.id);
            }}
          >
            <Icon name="trash" />
          </button>
        </>}
          {part && <InspectorCloseButton onClick={() => setSelectedId(null)} />}
        </div>
        <ReviewFields readOnly={readOnly}><ConcreteDetail
          key={selected.id}
          element={selected}
          siblings={elements}
          calibration={project.pages[selected.pageNumber]?.calibration ?? null}
          onUpdate={(patch) => updateElement(selected.id, patch)}
          onChangeKind={(kind) => changeKind(selected.id, kind)}
        /></ReviewFields>
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
      <div hidden={readOnly}>
      <span className="panel-kicker">{t('concrete.kindPicker')}</span>
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

      <div className="room-create-row concrete-create-controls">
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
      <ExistingAreaPicker
        copy={copyRoomsToConcrete}
        willCreate={(count) => t('concrete.copy.willCreate', { count, kind: t(`concrete.kinds.${concreteKind}`) })}
        addLabel={t('concrete.copy.add')}
        doneLabel={(count) => t('concrete.copy.done', { count })}
      />
      </div>

      </div>
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
              <li key={el.id} className={`structural-row ${el.id === selectedId ? 'active' : ''}`} onClick={() => select(el)} title={markLabel(el, t)}>
                {/* Approved design (board 05): mark · name with its spec line · volume at the end. */}
                <span className="structural-mark" dir="auto">{markCode(el)}</span>
                <span className="structural-name">
                  <span dir="auto">{t(`concrete.kinds.${el.kind}`)}</span>
                  {concreteSpec(el, t) && <small dir="auto">{concreteSpec(el, t)}</small>}
                </span>
                {el.pageNumber !== currentPage && <span className="room-list-page">{t('concrete.page', { page: el.pageNumber })}</span>}
                <span className="structural-value" title={volumeText(calc, t, 'volumeM3')}>{calc.volumeM3 === null ? '-' : formatNumber(round(calc.volumeM3, 1))}</span>
              </li>
            );
          })}
        </ul>
      </div>
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
      {message && <div className="warning-box">{message}</div>}

      {/* Approved design (board 05): compact rows — the element kind first (the same zone for every
          kind, so a wrong pick is fixed here instead of by redrawing), the results card after them. */}
      <div className="form-grid">
        <div className="form-row">
          <label>{t('concrete.kindPicker')}</label>
          <select value={element.kind} onChange={(e) => onChangeKind(e.target.value as ConcreteKind)}>
            {CONCRETE_KINDS.map((kind) => <option key={kind} value={kind}>{t(`concrete.kinds.${kind}`)}</option>)}
          </select>
        </div>
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
    </div>
  );
}
