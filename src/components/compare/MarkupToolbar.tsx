import { useCompareStore } from '../../store/compareStore';
import type { MarkupTool } from '../../types/compare';
import Icon, { type IconName } from '../Icon';
import { useT } from '../../i18n';
import type { PanelPart } from '../PanelPart';

const MARKUP_TOOLS: MarkupTool[] = ['cloud', 'arrow', 'rectangle', 'text', 'dimension', 'mask'];
const MARKUP_ICONS: Record<MarkupTool, IconName> = {
  cloud: 'cloud',
  arrow: 'arrow',
  rectangle: 'rectangle',
  text: 'text',
  dimension: 'dimension',
  mask: 'mask',
};

const MARKUP_COLORS = ['#ef4444', '#f59e0b', '#16a34a', '#2563eb', '#9333ea', '#0f172a'];

export default function MarkupToolbar({ part }: { part?: PanelPart } = {}) {
  const t = useT();
  const comparison = useCompareStore((s) => s.comparison);
  const currentPageKey = useCompareStore((s) => s.currentPageKey);
  const toolMode = useCompareStore((s) => s.toolMode);
  const markupTool = useCompareStore((s) => s.markupTool);
  const setMarkupTool = useCompareStore((s) => s.setMarkupTool);
  const markupPoints = useCompareStore((s) => s.markupPoints);
  const markupColor = useCompareStore((s) => s.markupColor);
  const setMarkupColor = useCompareStore((s) => s.setMarkupColor);
  const markupOrtho = useCompareStore((s) => s.markupOrtho);
  const setMarkupOrtho = useCompareStore((s) => s.setMarkupOrtho);
  const deleteMarkup = useCompareStore((s) => s.deleteMarkup);
  const duplicateMarkup = useCompareStore((s) => s.duplicateMarkup);
  const selectedMarkupId = useCompareStore((s) => s.selectedMarkupId);
  const setSelectedMarkupId = useCompareStore((s) => s.setSelectedMarkupId);
  const markupFontScale = useCompareStore((s) => s.markupFontScale);
  const setMarkupFontScale = useCompareStore((s) => s.setMarkupFontScale);
  const updateMarkup = useCompareStore((s) => s.updateMarkup);
  const updateMarkupQuiet = useCompareStore((s) => s.updateMarkupQuiet);

  if (!comparison) return null;
  const activeRevision = comparison.revisions.find((r) => r.id === comparison.activeRevisionId);
  // Markups belong to the source page they were drawn on — only that page's are listed or editable.
  const markups = (activeRevision?.markups ?? []).filter((m) => m.pageNumber === currentPageKey);

  const sizeTargetMarkup = markups.find((m) => m.id === selectedMarkupId && (m.tool === 'text' || m.tool === 'dimension'));
  const selectedTextMarkup = markups.find((m) => m.id === selectedMarkupId && m.tool === 'text');
  const selectedDimension = markups.find((m) => m.id === selectedMarkupId && m.tool === 'dimension');
  const activeFontScale = sizeTargetMarkup ? sizeTargetMarkup.fontScale ?? 1 : markupFontScale;
  const applyFontScale = (v: number) => {
    if (sizeTargetMarkup) updateMarkup(sizeTargetMarkup.id, { fontScale: v });
    else setMarkupFontScale(v);
  };

  // The colour swatches recolour the selected markup when there is one, so any markup can be
  // recoloured after it was drawn; with nothing selected they set the colour for new markups.
  const selectedMarkup = markups.find((m) => m.id === selectedMarkupId);
  const activeColor = selectedMarkup ? selectedMarkup.color : markupColor;
  const applyColor = (c: string) => {
    if (selectedMarkup) updateMarkup(selectedMarkup.id, { color: c });
    else setMarkupColor(c);
  };

  // The drawing hint for whichever tool is active: a single short line, with the long form kept
  // as its tooltip. Null when no markup tool is in use, so the panel stays quiet.
  const hint: { short: string; long?: string } | null =
    toolMode !== 'markup' || !markupTool
      ? null
      : markupTool === 'cloud'
        ? { short: t('markup.hints.cloud', { count: markupPoints.length }) }
        : markupTool === 'arrow' || markupTool === 'rectangle'
          ? { short: t('markup.hints.twoPoints') }
          : markupTool === 'mask'
            ? { short: t('markup.hints.mask'), long: t('markup.hints.maskLong') }
            : markupTool === 'dimension'
              ? {
                  short: t('markup.hints.dimension', { count: Math.max(0, markupPoints.length - 1) }),
                  long: t('markup.hints.dimensionLong'),
                }
              : { short: t('markup.hints.text'), long: t('markup.hints.textLong') };

  return (
    <div className="markup-toolbar">
      {/* Desktop split: tools and settings in the inspector, the page's markups in the side panel. */}
      {part !== 'list' && <>
      <div className="markup-color-row" title={selectedMarkup ? t('markup.colorSelectedHint') : t('markup.colorNewHint')}>
        <span className="section-label">{selectedMarkup ? t('markup.colorSelected') : t('markup.color')}</span>
        {/* The swatches sit on their own line, in the same grey tray as the tool groups. */}
        <div className="markup-color-tray">
        <div className="tint-swatches">
          {MARKUP_COLORS.map((c) => (
            <button
              key={c}
              className={`tint-swatch ${c === activeColor ? 'active' : ''}`}
              style={{ background: c }}
              onClick={() => applyColor(c)}
              title={c}
            />
          ))}
        </div>
        <input
          type="color"
          className="markup-color-input"
          value={activeColor}
          onChange={(e) => applyColor(e.target.value)}
          title={t('markup.freeColor')}
        />
        </div>
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

      {/* Text-note / dimension-label size: edits the selected note when one is selected, otherwise sets the default for new ones. */}
      <div className="markup-size-row" title={sizeTargetMarkup ? t('markup.sizeSelectedHint') : t('markup.sizeDefaultHint')}>
        <label>{t('markup.textSize', { percent: Math.round(activeFontScale * 100) })}</label>
        <input
          type="range"
          min={0.4}
          max={2.5}
          step={0.05}
          value={activeFontScale}
          onChange={(e) => applyFontScale(parseFloat(e.target.value))}
        />
        <button className="icon-btn" title={t('markup.resetSize')} onClick={() => applyFontScale(1)}>
          <Icon name="reset" />
        </button>
      </div>

      {/* Orientation of the selected text note; double-clicking a note on the plan reopens its editor. */}
      {selectedTextMarkup && (
        <button
          className="btn-secondary small"
          onClick={() => updateMarkup(selectedTextMarkup.id, { rotationDeg: selectedTextMarkup.rotationDeg ? 0 : -90 })}
        >
          <Icon name="rotate" />
          {selectedTextMarkup.rotationDeg ? t('markup.unrotate') : t('markup.rotate')}
        </button>
      )}

      {/* Mirrors the selected dimension about its own line: values and the overall line swap sides. */}
      {selectedDimension && (
        <button className="btn-secondary small" onClick={() => updateMarkup(selectedDimension.id, { flipped: !selectedDimension.flipped })}>
          <Icon name="flip" />
          {t('markup.flipDimension')}
        </button>
      )}

      {toolMode === 'markup' && (markupTool === 'dimension' || markupTool === 'arrow' || markupTool === 'cloud') && (
        <label className="source-color-toggle">
          <input type="checkbox" checked={markupOrtho} onChange={(e) => setMarkupOrtho(e.target.checked)} />
          {t('markup.orthoOnly')}
        </label>
      )}

      {/* One short hint at a time for the active tool; the long instructions are its tooltip. */}
      {hint && (
        <p className="tool-hint" title={hint.long ?? hint.short}>
          <Icon name="alert" size={13} />
          {hint.short}
        </p>
      )}

      </>}
      {part !== 'detail' && <>
      {markups.length === 0 ? (
        <div className="empty-state">
          <Icon name="cloud" size={24} />
          <p>{t('markup.empty')}</p>
        </div>
      ) : (
        <ul className="measurement-list">
          {markups.map((m) => (
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
      </>}
    </div>
  );
}
