import { useEffect, useState } from 'react';
import { alignmentStatusFor, useCompareStore } from '../../store/compareStore';
import { IDENTITY_TRANSFORM } from '../../types/compare';
import Icon from '../Icon';
import { useT } from '../../i18n';

/** A numeric alignment value that can be half-typed ("-0.") without fighting the stored transform. */
function AlignmentNumber({ value, step, precision, unit, disabled, label, valid, onChange }: {
  value: number;
  step: number;
  precision: number;
  unit: string;
  disabled: boolean;
  label: string;
  valid: (v: number) => boolean;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(value.toFixed(precision));
  useEffect(() => {
    if (Number(draft) !== value) setDraft(value.toFixed(precision));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <span className="alignment-number">
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={draft}
        disabled={disabled}
        aria-label={label}
        dir="ltr"
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(n) && valid(n)) onChange(n);
        }}
        onBlur={() => setDraft(value.toFixed(precision))}
      />
      <span className="alignment-unit" aria-hidden="true">{unit}</span>
    </span>
  );
}

/**
 * Bringing the revised layer onto the original (approved design, board 08): the sheet's alignment
 * status, rotation and relative scale as numbers, then "align by reference points" and "reset".
 * Dragging the revised plan stays available as the rough first step.
 */
export default function AlignmentTools() {
  const t = useT();
  const comparison = useCompareStore((s) => s.comparison);
  const currentPageKey = useCompareStore((s) => s.currentPageKey);
  const toolMode = useCompareStore((s) => s.toolMode);
  const setToolMode = useCompareStore((s) => s.setToolMode);
  const setAlignmentTransform = useCompareStore((s) => s.setAlignmentTransform);
  const beginAlignmentPointPick = useCompareStore((s) => s.beginAlignmentPointPick);
  const clearAlignmentPoints = useCompareStore((s) => s.clearAlignmentPoints);
  const pickingAlignmentPoints = useCompareStore((s) => s.pickingAlignmentPoints);
  const alignmentPendingOriginal = useCompareStore((s) => s.alignmentPendingOriginal);

  if (!comparison) return null;
  const alignment = comparison.pages[currentPageKey]?.revisions[comparison.activeRevisionId]?.alignment ?? IDENTITY_TRANSFORM;
  const status = alignmentStatusFor(comparison, currentPageKey);
  const aligned = status !== 'identity';
  const hasRevision = comparison.revisions.length > 0;

  return (
    <div className="alignment-tools tool-group">
      <div className="alignment-card">
        <div className="alignment-card-row">
          <span className="alignment-card-label">{t('compare.context.alignmentLabel')}</span>
          <span className={`status-chip ${status}`}>{t(`compare.context.alignment.${status}`)}</span>
        </div>
        <div className="alignment-card-row">
          <span className="alignment-card-label">{t('compare.alignment.rotation')}</span>
          <AlignmentNumber
            value={alignment.rotationDeg}
            step={0.1}
            precision={1}
            unit="°"
            label={t('compare.alignment.rotation')}
            disabled={!hasRevision}
            valid={(v) => v >= -180 && v <= 180}
            onChange={(v) => setAlignmentTransform(currentPageKey, { ...alignment, rotationDeg: v })}
          />
        </div>
        <div className="alignment-card-row">
          <span className="alignment-card-label">{t('compare.alignment.scale')}</span>
          <AlignmentNumber
            value={alignment.scale}
            step={0.001}
            precision={3}
            unit="×"
            label={t('compare.alignment.scale')}
            disabled={!hasRevision}
            valid={(v) => v > 0}
            onChange={(v) => setAlignmentTransform(currentPageKey, { ...alignment, scale: v })}
          />
        </div>
      </div>

      {/* The accurate route: two matching points solve offset, rotation and scale together. */}
      <div className="alignment-actions">
        <button
          className={`${pickingAlignmentPoints ? 'btn-primary' : 'btn-secondary alignment-points-btn'} small`}
          onClick={beginAlignmentPointPick}
          disabled={!hasRevision}
          aria-pressed={pickingAlignmentPoints}
          title={t('compare.alignment.pickPairs')}
        >
          <Icon name="target" />
          {pickingAlignmentPoints ? t('compare.alignment.picking') : t('compare.alignment.byPoints')}
        </button>
        <button
          className="btn-secondary small"
          onClick={() => clearAlignmentPoints(currentPageKey)}
          disabled={!hasRevision || !aligned}
          title={t('compare.alignment.resetHint')}
        >
          <Icon name="reset" />
          {t('compare.alignment.resetShort')}
        </button>
      </div>
      {pickingAlignmentPoints && (
        <p className="tool-hint">
          <Icon name="alert" size={13} />
          {alignmentPendingOriginal ? t('compare.alignment.pickRevised') : t('compare.alignment.pickOriginal')}
        </p>
      )}

      <button
        className={`btn-ghost small full-width ${toolMode === 'align' && !pickingAlignmentPoints ? 'active' : ''}`}
        onClick={() => setToolMode(toolMode === 'align' ? 'select' : 'align')}
        disabled={!hasRevision}
        aria-pressed={toolMode === 'align' && !pickingAlignmentPoints}
      >
        <Icon name="move" />
        {t('compare.alignment.drag')}
      </button>
    </div>
  );
}
