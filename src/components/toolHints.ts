import { useAppStore } from '../store/appStore';
import { useT } from '../i18n';

/** One-line drawing guidance for the active measure tool, or null when none is in use. */
export function useMeasureHint(): string | null {
  const t = useT();
  const toolMode = useAppStore((s) => s.toolMode);
  const measureTool = useAppStore((s) => s.measureTool);
  const areaShape = useAppStore((s) => s.areaShape);
  const measurePoints = useAppStore((s) => s.measurePoints);
  if (toolMode !== 'measure' || !measureTool) return null;
  return measureTool === 'distance' || (measureTool === 'area' && areaShape === 'line')
    ? t('measure.hintDistance')
    : measureTool === 'area' && areaShape === 'rectangle'
      ? t('measure.hintRectangle')
      : t('measure.hintPolygon', { count: measurePoints.length });
}

/** One short drawing hint for the active markup tool (long form as tooltip), or null. */
export function useMarkupHint(): { short: string; long?: string } | null {
  const t = useT();
  const toolMode = useAppStore((s) => s.toolMode);
  const markupTool = useAppStore((s) => s.markupTool);
  const markupPoints = useAppStore((s) => s.markupPoints);
  if (toolMode !== 'markup' || !markupTool) return null;
  return markupTool === 'cloud'
    ? { short: t('markup.hints.cloud', { count: markupPoints.length }) }
    : markupTool === 'arrow' || markupTool === 'rectangle'
      ? { short: t('markup.hints.twoPoints') }
      : markupTool === 'mask'
        ? { short: t('markup.hints.mask'), long: t('markup.hints.maskLong') }
        : markupTool === 'dimension'
          ? { short: t('markup.hints.dimension', { count: Math.max(0, markupPoints.length - 1) }), long: t('markup.hints.dimensionLong') }
          : { short: t('markup.hints.text'), long: t('markup.hints.textLong') };
}
