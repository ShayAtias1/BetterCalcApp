import { useAppStore } from '../store/appStore';
import Icon from './Icon';
import { InspectorCloseButton, InspectorEmpty, type PanelPart } from './PanelPart';
import { MARKUP_ICONS, MARKUP_TOOLS } from './toolLists';
import { useT } from '../i18n';
import { useMarkupHint } from './toolHints';


const MARKUP_COLORS = ['#ef4444', '#f59e0b', '#16a34a', '#2563eb', '#9333ea', '#0f172a'];
const FONT_SCALE_MIN = 0.4;
const FONT_SCALE_MAX = 2.5;

/** Colour and text size apply to the selected markup when there is one, otherwise to new markups. */
function useMarkupStyle() {
  const project = useAppStore((s) => s.project);
  const currentPage = useAppStore((s) => s.currentPage);
  const selectedMarkupId = useAppStore((s) => s.selectedMarkupId);
  const markupColor = useAppStore((s) => s.markupColor);
  const setMarkupColor = useAppStore((s) => s.setMarkupColor);
  const markupFontScale = useAppStore((s) => s.markupFontScale);
  const setMarkupFontScale = useAppStore((s) => s.setMarkupFontScale);
  const updateMarkup = useAppStore((s) => s.updateMarkup);
  const pageMarkups = (project?.markups ?? []).filter((m) => m.pageNumber === currentPage);
  const selectedMarkup = pageMarkups.find((m) => m.id === selectedMarkupId);
  const sizeTargetMarkup = selectedMarkup && (selectedMarkup.tool === 'text' || selectedMarkup.tool === 'dimension') ? selectedMarkup : undefined;
  const activeColor = selectedMarkup ? selectedMarkup.color : markupColor;
  const activeFontScale = sizeTargetMarkup ? sizeTargetMarkup.fontScale ?? 1 : markupFontScale;
  return {
    selectedMarkup,
    sizeTargetMarkup,
    activeColor,
    activeFontScale,
    applyColor: (c: string) => (selectedMarkup ? updateMarkup(selectedMarkup.id, { color: c }) : setMarkupColor(c)),
    applyFontScale: (v: number) => (sizeTargetMarkup ? updateMarkup(sizeTargetMarkup.id, { fontScale: v }) : setMarkupFontScale(v)),
  };
}

function MarkupColorControl() {
  const t = useT();
  const { selectedMarkup, activeColor, applyColor } = useMarkupStyle();
  return (
    <div className="markup-color-tray" title={selectedMarkup ? t('markup.colorSelectedHint') : t('markup.colorNewHint')}>
      <div className="tint-swatches">
        {MARKUP_COLORS.map((c) => (
          <button
            key={c}
            className={`tint-swatch ${c === activeColor ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => applyColor(c)}
            title={c}
            aria-label={c}
            aria-pressed={c === activeColor}
          />
        ))}
      </div>
      <input
        type="color"
        className="markup-color-input"
        value={activeColor}
        onChange={(e) => applyColor(e.target.value)}
        title={t('markup.freeColor')}
        aria-label={t('markup.freeColor')}
      />
    </div>
  );
}

/** Text-note / dimension-label size: − percent + and a reset, in steps of 10%. */
function MarkupSizeControl() {
  const t = useT();
  const { sizeTargetMarkup, activeFontScale, applyFontScale } = useMarkupStyle();
  const step = (delta: number) => applyFontScale(Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round((activeFontScale + delta) * 100) / 100)));
  return (
    <div className="markup-size-stepper" title={sizeTargetMarkup ? t('markup.sizeSelectedHint') : t('markup.sizeDefaultHint')}>
      <span className="markup-size-label">{t('markup.textSizeLabel')}</span>
      <button className="icon-btn" aria-label={t('markup.smaller')} title={t('markup.smaller')} disabled={activeFontScale <= FONT_SCALE_MIN} onClick={() => step(-0.1)}>
        <Icon name="minus" size={13} />
      </button>
      <output className="markup-size-value" dir="ltr">{Math.round(activeFontScale * 100)}%</output>
      <button className="icon-btn" aria-label={t('markup.larger')} title={t('markup.larger')} disabled={activeFontScale >= FONT_SCALE_MAX} onClick={() => step(0.1)}>
        <Icon name="plus" size={13} />
      </button>
      <button className="icon-btn" title={t('markup.resetSize')} aria-label={t('markup.resetSize')} onClick={() => applyFontScale(1)}>
        <Icon name="reset" size={13} />
      </button>
    </div>
  );
}

/**
 * The active markup tool's options for the contextual bar above the canvas dock (approved design,
 * board 12): tool, colour, text size and straight lines.
 */
export function MarkupToolOptions() {
  const t = useT();
  const toolMode = useAppStore((s) => s.toolMode);
  const markupTool = useAppStore((s) => s.markupTool);
  const setMarkupTool = useAppStore((s) => s.setMarkupTool);
  const markupOrtho = useAppStore((s) => s.markupOrtho);
  const setMarkupOrtho = useAppStore((s) => s.setMarkupOrtho);
  return (
    <>
      <div className="segmented" role="group" aria-label={t('markup.tools')}>
        {MARKUP_TOOLS.map((tool) => (
          <button
            key={tool}
            className={`tool-btn ${toolMode === 'markup' && markupTool === tool ? 'active' : ''}`}
            aria-pressed={toolMode === 'markup' && markupTool === tool}
            onClick={() => setMarkupTool(markupTool === tool ? null : tool)}
          >
            <span className="tool-label">{t(`markupTools.${tool}`)}</span>
          </button>
        ))}
      </div>
      <MarkupColorControl />
      {(markupTool === 'text' || markupTool === 'dimension') && <MarkupSizeControl />}
      {(markupTool === 'dimension' || markupTool === 'arrow' || markupTool === 'cloud') && (
        <label className="source-color-toggle">
          <input type="checkbox" checked={markupOrtho} onChange={(e) => setMarkupOrtho(e.target.checked)} />
          {t('markup.orthoOnly')}
        </label>
      )}
    </>
  );
}

export default function MarkupToolbar({ part }: { part?: PanelPart } = {}) {
  const t = useT();
  const project = useAppStore((s) => s.project);
  const currentPage = useAppStore((s) => s.currentPage);
  const toolMode = useAppStore((s) => s.toolMode);
  const markupTool = useAppStore((s) => s.markupTool);
  const setMarkupTool = useAppStore((s) => s.setMarkupTool);
  const markupOrtho = useAppStore((s) => s.markupOrtho);
  const setMarkupOrtho = useAppStore((s) => s.setMarkupOrtho);
  const deleteMarkup = useAppStore((s) => s.deleteMarkup);
  const duplicateMarkup = useAppStore((s) => s.duplicateMarkup);
  const selectedMarkupId = useAppStore((s) => s.selectedMarkupId);
  const setSelectedMarkupId = useAppStore((s) => s.setSelectedMarkupId);
  const updateMarkup = useAppStore((s) => s.updateMarkup);
  const updateMarkupQuiet = useAppStore((s) => s.updateMarkupQuiet);
  const hint = useMarkupHint();
  const { selectedMarkup } = useMarkupStyle();

  if (!project) return null;
  const pageMarkups = (project.markups ?? []).filter((m) => m.pageNumber === currentPage);
  const selectedTextMarkup = selectedMarkup?.tool === 'text' ? selectedMarkup : undefined;
  const selectedDimension = selectedMarkup?.tool === 'dimension' ? selectedMarkup : undefined;

  // Orientation of the selected text note; double-clicking a note on the plan reopens its editor.
  const rotateButton = selectedTextMarkup && (
    <button
      className="btn-secondary small"
      onClick={() => updateMarkup(selectedTextMarkup.id, { rotationDeg: selectedTextMarkup.rotationDeg ? 0 : -90 })}
    >
      <Icon name="rotate" />
      {selectedTextMarkup.rotationDeg ? t('markup.unrotate') : t('markup.rotate')}
    </button>
  );
  // Mirrors the selected dimension about its own line: values and the overall line swap sides.
  const flipButton = selectedDimension && (
    <button className="btn-secondary small" onClick={() => updateMarkup(selectedDimension.id, { flipped: !selectedDimension.flipped })}>
      <Icon name="flip" />
      {t('markup.flipDimension')}
    </button>
  );

  // Desktop inspector (approved design, board 12): the selected markup only — its colour, text size,
  // orientation and actions. The tool options are in the bar above the dock.
  if (part === 'detail') {
    if (!selectedMarkup) return <InspectorEmpty text={t('workspace.inspector.empty.markup')} />;
    return (
      <div className="markup-toolbar markup-inspector">
        <div className="detail-header">
          <span className="detail-kicker">{t(`markupTools.${selectedMarkup.tool}`)} · {t('common.page', { page: selectedMarkup.pageNumber })}</span>
          <span className="opening-detail-actions">
            <button className="icon-btn" title={t('markup.duplicate')} aria-label={t('markup.duplicate')} onClick={() => duplicateMarkup(selectedMarkup.id)}>
              <Icon name="copy" />
            </button>
            <button className="icon-btn danger" title={t('markup.delete')} aria-label={t('markup.delete')} onClick={() => deleteMarkup(selectedMarkup.id)}>
              <Icon name="trash" />
            </button>
            <InspectorCloseButton onClick={() => setSelectedMarkupId(null)} />
          </span>
        </div>
        {selectedMarkup.text && <p className="markup-inspector-text" dir="auto">{selectedMarkup.tool === 'dimension' ? `${selectedMarkup.text} ${t('units.cm')}` : selectedMarkup.text}</p>}
        {selectedTextMarkup && <p className="muted small-text">{t('markup.editTextHint')}</p>}
        <div className="tool-group">
          <span className="section-label">{t('markup.colorSelected')}</span>
          <MarkupColorControl />
        </div>
        {(selectedTextMarkup || selectedDimension) && <MarkupSizeControl />}
        {(rotateButton || flipButton) && <div className="markup-inspector-actions">{rotateButton}{flipButton}</div>}
      </div>
    );
  }

  return (
    <div className="markup-toolbar">
      {/* Tablet and phone: one panel with the tools, their options and the list. */}
      {part !== 'list' && <>
      <h4>{t('markup.title')}</h4>

      <div className="markup-color-row">
        <span className="section-label">{selectedMarkup ? t('markup.colorSelected') : t('markup.color')}</span>
        <MarkupColorControl />
      </div>

      <span className="section-label">{t('markup.tools')}</span>
      <div className="markup-tool-grid segmented">
        {MARKUP_TOOLS.map((tool) => (
          <button
            key={tool}
            className={`tool-btn ${toolMode === 'markup' && markupTool === tool ? 'active' : ''}`}
            aria-pressed={toolMode === 'markup' && markupTool === tool}
            onClick={() => setMarkupTool(markupTool === tool ? null : tool)}
          >
            <Icon name={MARKUP_ICONS[tool]} />
            <span className="tool-label">{t(`markupTools.${tool}`)}</span>
          </button>
        ))}
      </div>

      <MarkupSizeControl />
      {rotateButton}
      {flipButton}

      {toolMode === 'markup' && (markupTool === 'dimension' || markupTool === 'arrow' || markupTool === 'cloud') && (
        <label className="source-color-toggle">
          <input type="checkbox" checked={markupOrtho} onChange={(e) => setMarkupOrtho(e.target.checked)} />
          {t('markup.orthoOnly')}
        </label>
      )}

      {/* One short hint at a time for the active tool; the full instructions are the tooltip. */}
      {hint && (
        <p className="tool-hint" title={hint.long ?? hint.short}>
          <Icon name="alert" size={13} />
          {hint.short}
        </p>
      )}
      </>}

      {pageMarkups.length === 0 ? (
        <div className="empty-state">
          <Icon name="cloud" size={24} />
          <p>{t('markup.empty')}</p>
        </div>
      ) : (
        <ul className="measurement-list">
          {pageMarkups.map((m) => (
            <li
              key={m.id}
              className={m.id === selectedMarkupId ? 'selected' : ''}
              onClick={() => setSelectedMarkupId(m.id === selectedMarkupId ? null : m.id)}
            >
              <span>
                <input
                  type="color"
                  className="markup-color-input"
                  value={m.color}
                  onClick={(e) => e.stopPropagation()}
                  // The OS picker streams changes while it's open: preview them, commit once on close.
                  onChange={(e) => updateMarkupQuiet(m.id, { color: e.target.value })}
                  onBlur={() => updateMarkup(m.id, {})}
                  title={t('markup.changeColor')}
                />{' '}
                {t(`markupTools.${m.tool}`)}
                {m.text ? (m.tool === 'dimension' ? `: ${m.text} ${t('units.cm')}` : `: ${m.text}`) : ''}
              </span>
              <span className="list-item-actions">
                <button className="icon-btn" title={t('markup.duplicate')} onClick={(e) => { e.stopPropagation(); duplicateMarkup(m.id); }}>
                  <Icon name="copy" />
                </button>
                <button className="icon-btn danger" title={t('markup.delete')} onClick={(e) => { e.stopPropagation(); deleteMarkup(m.id); }}>
                  <Icon name="trash" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
