import { promptDialog, confirmDialog } from '../../lib/appDialogs';
import { useRef, useState } from 'react';
import { useCompareStore } from '../../store/compareStore';
import { requireEditAccess } from '../../lib/access/editGuard';
import { deleteComparePdfBlob, saveComparePdfBlob } from '../../db/database';
import { trackRevisionAdded } from '../../lib/analytics';
import Icon from '../Icon';
import { useT } from '../../i18n';

const TINT_PRESETS = ['#9ca3af', '#6b7280', '#ef4444', '#2563eb', '#16a34a', '#f59e0b', '#9333ea'];

/** The tint palette, opened from a layer's swatch so the rows stay compact (approved design, board 08). */
function TintPalette({ tint, disabled, onTintChange }: { tint: string; disabled: boolean; onTintChange: (c: string) => void }) {
  return (
    <div className={`tint-swatches ${disabled ? 'disabled' : ''}`}>
      {TINT_PRESETS.map((c) => (
        <button
          key={c}
          className={`tint-swatch ${c === tint && !disabled ? 'active' : ''}`}
          style={{ background: c }}
          onClick={() => onTintChange(c)}
          disabled={disabled}
          title={c}
          aria-label={c}
        />
      ))}
    </div>
  );
}

/** A layer's swatch: shows its tint and opens the palette. */
function SwatchButton({ tint, open, useSourceColors, onClick }: { tint: string; open: boolean; useSourceColors: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className={`layer-swatch-btn ${open ? 'open' : ''}`}
      aria-expanded={open}
      title={t('compare.layers.tint')}
      aria-label={t('compare.layers.tint')}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <span className="layer-swatch" style={{ background: useSourceColors ? 'conic-gradient(#ef4444, #f59e0b, #16a34a, #2563eb, #9333ea, #ef4444)' : tint }} />
    </button>
  );
}

/** Opacity and original-colour controls of the expanded layer. */
function LayerAppearance({ visible, opacity, tint, useSourceColors, paletteOpen, onOpacityChange, onTintChange, onToggleSourceColors }: {
  visible: boolean;
  opacity: number;
  tint: string;
  useSourceColors: boolean;
  paletteOpen: boolean;
  onOpacityChange: (v: number) => void;
  onTintChange: (c: string) => void;
  onToggleSourceColors: (v: boolean) => void;
}) {
  const t = useT();
  return (
    <div className="layer-appearance" onClick={(e) => e.stopPropagation()}>
      <div className="layer-opacity-row">
        <span className="muted">{t('compare.layers.opacityShort')}</span>
        <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => onOpacityChange(parseFloat(e.target.value))} disabled={!visible} title={t('compare.layers.opacity')} aria-label={t('compare.layers.opacity')} />
        <span className="muted tnum">{Math.round(opacity * 100)}%</span>
      </div>
      <label className="source-color-toggle">
        <input type="checkbox" checked={useSourceColors} onChange={(e) => onToggleSourceColors(e.target.checked)} />
        {t('compare.layers.sourceColors')}
      </label>
      {paletteOpen && <TintPalette tint={tint} disabled={useSourceColors} onTintChange={onTintChange} />}
    </div>
  );
}

export default function LayerPanel() {
  const t = useT();
  const comparison = useCompareStore((s) => s.comparison);
  const setLayerOpacity = useCompareStore((s) => s.setLayerOpacity);
  const setLayerVisible = useCompareStore((s) => s.setLayerVisible);
  const setLayerTint = useCompareStore((s) => s.setLayerTint);
  const setLayerSourceColors = useCompareStore((s) => s.setLayerSourceColors);
  const addRevision = useCompareStore((s) => s.addRevision);
  const removeRevision = useCompareStore((s) => s.removeRevision);
  const renameRevision = useCompareStore((s) => s.renameRevision);
  const setActiveRevisionId = useCompareStore((s) => s.setActiveRevisionId);
  const moveRevision = useCompareStore((s) => s.moveRevision);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Which layer's tint palette is open: 'original', a revision id, or none. */
  const [palette, setPalette] = useState<string | null>(null);

  if (!comparison) return null;

  const activeRevision = comparison.revisions.find((r) => r.id === comparison.activeRevisionId) ?? comparison.revisions[0];

  const handleAddFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !requireEditAccess('edit')) return;
    for (const file of Array.from(files)) {
      const id = addRevision(file.name);
      if (!id) continue;
      await saveComparePdfBlob(comparison.id, `revision:${id}`, file);
      trackRevisionAdded(comparison.id, useCompareStore.getState().comparison?.revisions.length ?? 0);
    }
  };

  const handleRemove = async (id: string) => {
    if (!requireEditAccess('edit')) return;
    if (!await confirmDialog(t('compare.layers.removeConfirm'), { destructive: true })) return;
    removeRevision(id);
    await deleteComparePdfBlob(comparison.id, `revision:${id}`);
  };

  const handleRename = async (id: string, current: string) => {
    const label = await promptDialog(t('compare.layers.renamePrompt'), current);
    if (label && label.trim()) renameRevision(id, label.trim());
  };

  const visibilityButton = (visible: boolean, onClick: () => void) => (
    <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onClick(); }} title={visible ? t('compare.layers.hide') : t('compare.layers.show')} aria-label={visible ? t('compare.layers.hide') : t('compare.layers.show')} aria-pressed={visible}>
      <Icon name={visible ? 'eye' : 'eye-off'} />
    </button>
  );

  return (
    <div className="layer-panel layer-panel-compact">
      {/* Approved design (board 08): the original plan's display card first, then compact revision rows —
          radio, swatch, visibility, order and removal; the active revision carries its opacity. */}
      <div className="tool-group">
        <span className="section-label">{t('compare.layers.display')}</span>
        <div className="layer-card">
          <div className="layer-card-row">
            <span className="layer-title">{t('compare.layers.original')}</span>
            <SwatchButton tint={comparison.originalColorTint} useSourceColors={comparison.originalUseSourceColors} open={palette === 'original'} onClick={() => setPalette(palette === 'original' ? null : 'original')} />
            {visibilityButton(comparison.originalVisible, () => setLayerVisible('original', !comparison.originalVisible))}
          </div>
          <LayerAppearance
            visible={comparison.originalVisible}
            opacity={comparison.originalOpacity}
            tint={comparison.originalColorTint}
            useSourceColors={comparison.originalUseSourceColors}
            paletteOpen={palette === 'original'}
            onOpacityChange={(v) => setLayerOpacity('original', v)}
            onTintChange={(c) => setLayerTint('original', c)}
            onToggleSourceColors={(v) => setLayerSourceColors('original', v)}
          />
        </div>
      </div>

      <div className="tool-group">
        <div className="layer-section-head">
          <span className="section-label">{t('compare.layers.revisions')}</span>
          {comparison.revisions.length > 0 && (
            <button className="btn-ghost small layer-add-link" onClick={() => fileInputRef.current?.click()}>
              <Icon name="plus" size={13} />
              {t('compare.layers.addRevision')}
            </button>
          )}
        </div>
        {comparison.revisions.length === 0 ? (
          <div className="empty-state">
            <Icon name="layers" size={24} />
            <p>{t('compare.layers.empty')}</p>
            <button className="btn-primary small" onClick={() => fileInputRef.current?.click()}>
              <Icon name="plus" />
              {t('compare.layers.addRevision')}
            </button>
          </div>
        ) : (
          <ul className="revision-list revision-list-compact">
            {comparison.revisions.map((r, i) => {
              const active = r.id === activeRevision?.id;
              return (
                <li
                  key={r.id}
                  className={active ? 'active' : ''}
                  onClick={() => setActiveRevisionId(r.id)}
                  onDoubleClick={() => handleRename(r.id, r.label)}
                  title={t('compare.layers.revisionHint')}
                >
                  <div className="revision-row">
                    <input type="radio" name="active-revision" checked={active} onChange={() => setActiveRevisionId(r.id)} onClick={(e) => e.stopPropagation()} aria-label={r.label} />
                    <span className="revision-name">{r.label}</span>
                    <SwatchButton tint={r.colorTint} useSourceColors={r.useSourceColors} open={palette === r.id} onClick={() => { setActiveRevisionId(r.id); setPalette(palette === r.id ? null : r.id); }} />
                    {visibilityButton(r.visible, () => setLayerVisible(r.id, !r.visible))}
                    <span className="list-item-actions">
                      <button className="icon-btn" disabled={i === 0} onClick={(e) => { e.stopPropagation(); moveRevision(r.id, -1); }} title={t('compare.layers.moveUp')} aria-label={t('compare.layers.moveUp')}>
                        <Icon name="chevron-up" />
                      </button>
                      <button className="icon-btn" disabled={i === comparison.revisions.length - 1} onClick={(e) => { e.stopPropagation(); moveRevision(r.id, 1); }} title={t('compare.layers.moveDown')} aria-label={t('compare.layers.moveDown')}>
                        <Icon name="chevron-down" />
                      </button>
                      <button className="icon-btn danger" onClick={(e) => { e.stopPropagation(); void handleRemove(r.id); }} title={t('compare.layers.removeRevision')} aria-label={t('compare.layers.removeRevision')}>
                        <Icon name="close" />
                      </button>
                    </span>
                  </div>
                  {active && (
                    <LayerAppearance
                      visible={r.visible}
                      opacity={r.opacity}
                      tint={r.colorTint}
                      useSourceColors={r.useSourceColors}
                      paletteOpen={palette === r.id}
                      onOpacityChange={(v) => setLayerOpacity(r.id, v)}
                      onTintChange={(c) => setLayerTint(r.id, c)}
                      onToggleSourceColors={(v) => setLayerSourceColors(r.id, v)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            void handleAddFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
