import { promptDialog, confirmDialog } from '../../lib/appDialogs';
import { useRef } from 'react';
import { useCompareStore } from '../../store/compareStore';
import { deleteComparePdfBlob, saveComparePdfBlob } from '../../db/database';
import { trackRevisionAdded } from '../../lib/analytics';
import Icon from '../Icon';
import { useT } from '../../i18n';

const TINT_PRESETS = ['#9ca3af', '#6b7280', '#ef4444', '#2563eb', '#16a34a', '#f59e0b', '#9333ea'];

/** Appearance of one plan layer: shown or hidden, how strongly, and in which tint. */
function LayerRow({
  title,
  visible,
  opacity,
  tint,
  useSourceColors,
  onToggleVisible,
  onOpacityChange,
  onTintChange,
  onToggleSourceColors,
}: {
  title: string;
  visible: boolean;
  opacity: number;
  tint: string;
  useSourceColors: boolean;
  onToggleVisible: () => void;
  onOpacityChange: (v: number) => void;
  onTintChange: (c: string) => void;
  onToggleSourceColors: (v: boolean) => void;
}) {
  const t = useT();
  return (
    <div className="layer-row">
      <div className="layer-row-header">
        <button className="icon-btn" onClick={onToggleVisible} title={visible ? t('compare.layers.hide') : t('compare.layers.show')} aria-pressed={visible}>
          <Icon name={visible ? 'eye' : 'eye-off'} />
        </button>
        <span className="layer-title">{title}</span>
        {!useSourceColors && <span className="color-dot" style={{ background: tint }} />}
        <span className="muted tnum">{Math.round(opacity * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={opacity}
        onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
        disabled={!visible}
        title={t('compare.layers.opacity')}
      />
      <label className="source-color-toggle">
        <input type="checkbox" checked={useSourceColors} onChange={(e) => onToggleSourceColors(e.target.checked)} />
        {t('compare.layers.sourceColors')}
      </label>
      <div className={`tint-swatches ${useSourceColors ? 'disabled' : ''}`}>
        {TINT_PRESETS.map((c) => (
          <button
            key={c}
            className={`tint-swatch ${c === tint && !useSourceColors ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => onTintChange(c)}
            disabled={useSourceColors}
            title={c}
          />
        ))}
      </div>
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

  if (!comparison) return null;

  const activeRevision = comparison.revisions.find((r) => r.id === comparison.activeRevisionId) ?? comparison.revisions[0];

  const handleAddFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      const id = addRevision(file.name);
      if (!id) continue;
      await saveComparePdfBlob(comparison.id, `revision:${id}`, file);
      trackRevisionAdded(comparison.id, useCompareStore.getState().comparison?.revisions.length ?? 0);
    }
  };

  const handleRemove = async (id: string) => {
    if (!await confirmDialog(t('compare.layers.removeConfirm'), { destructive: true })) return;
    removeRevision(id);
    await deleteComparePdfBlob(comparison.id, `revision:${id}`);
  };

  const handleRename = async (id: string, current: string) => {
    const label = await promptDialog(t('compare.layers.renamePrompt'), current);
    if (label && label.trim()) renameRevision(id, label.trim());
  };

  return (
    <div className="layer-panel">
      {/* 1 — which revision is active. A selectable list, in the export/display order, with its
          row actions revealed on hover like the takeoff room list. */}
      <div className="tool-group">
        <span className="section-label">{t('compare.layers.revisions')}</span>
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
          <ul className="revision-list">
            {comparison.revisions.map((r, i) => (
              <li
                key={r.id}
                className={r.id === comparison.activeRevisionId ? 'active' : ''}
                onClick={() => setActiveRevisionId(r.id)}
                onDoubleClick={() => handleRename(r.id, r.label)}
                title={t('compare.layers.revisionHint')}
              >
                <span className="color-dot" style={{ background: r.colorTint }} />
                <span className="revision-name">{r.label}</span>
                <span className="list-item-actions">
                  <button
                    className="icon-btn"
                    disabled={i === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveRevision(r.id, -1);
                    }}
                    title={t('compare.layers.moveUp')}
                  >
                    <Icon name="chevron-up" />
                  </button>
                  <button
                    className="icon-btn"
                    disabled={i === comparison.revisions.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveRevision(r.id, 1);
                    }}
                    title={t('compare.layers.moveDown')}
                  >
                    <Icon name="chevron-down" />
                  </button>
                  <button
                    className="icon-btn danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRemove(r.id);
                    }}
                    title={t('compare.layers.removeRevision')}
                  >
                    <Icon name="trash" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {comparison.revisions.length > 0 && (
          <button className="btn-secondary small full-width" onClick={() => fileInputRef.current?.click()}>
            <Icon name="plus" />
            {t('compare.layers.addRevision')}
          </button>
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

      {/* 2 — secondary: how each layer is drawn. */}
      <div className="tool-group">
        <span className="section-label">{t('compare.layers.display')}</span>
        <LayerRow
          title={t('compare.layers.original')}
          visible={comparison.originalVisible}
          opacity={comparison.originalOpacity}
          tint={comparison.originalColorTint}
          useSourceColors={comparison.originalUseSourceColors}
          onToggleVisible={() => setLayerVisible('original', !comparison.originalVisible)}
          onOpacityChange={(v) => setLayerOpacity('original', v)}
          onTintChange={(c) => setLayerTint('original', c)}
          onToggleSourceColors={(v) => setLayerSourceColors('original', v)}
        />
        {activeRevision && (
          <LayerRow
            title={activeRevision.label}
            visible={activeRevision.visible}
            opacity={activeRevision.opacity}
            tint={activeRevision.colorTint}
            useSourceColors={activeRevision.useSourceColors}
            onToggleVisible={() => setLayerVisible(activeRevision.id, !activeRevision.visible)}
            onOpacityChange={(v) => setLayerOpacity(activeRevision.id, v)}
            onTintChange={(c) => setLayerTint(activeRevision.id, c)}
            onToggleSourceColors={(v) => setLayerSourceColors(activeRevision.id, v)}
          />
        )}
      </div>
    </div>
  );
}
