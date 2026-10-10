import { t, translate, type TranslateFn } from '../i18n';

const messageKeys = [
  "crossTile", "unsupportedEndpoints", "requiresReview", "vertices", "finite", "outsidePage", "repeatedVertex", "doubleBack", "intersectingEdges", "zeroArea", "outsideTile", "vertexCount", "missingTarget", "boundaryUncertain", "balconyOverlay", "doorwayThresholds", "lowerBalcony", "laundryUse", "laundryOverlap", "extension", "shortThresholds", "partitions", "noUse", "unlabelledUse", "unlabelledSmall", "demolition", "oneClickBedroom", "oneClickDoorway", "uncertainTarget", "swingArc", "jambUncertain", "oneJamb", "oneJambVisible"
] as const;
const normalize = (text: string) => text.trim().replace(/[.。]+$/, '').toLocaleLowerCase();

/** Localize at display time: saved source notes and acknowledgment IDs stay untouched. */
export function aiWarningText(source: string, tr: TranslateFn = t): string {
  if (source === 'CROSS_TILE_INCOMPLETE') return tr('aiReview.crossTile');
  if (source === 'UNSUPPORTED_ENDPOINTS') return tr('aiWarningText.unsupportedEndpoints');
  const overlap = source.match(/^Overlap with existing Room [“"](.+)[”"]. Review before approval\.$/);
  if (overlap) return tr('aiWarningText.overlap', { name: overlap[1] });
  const normalized = normalize(source);
  for (const key of messageKeys) {
    const path = `aiWarningText.${key}` as const;
    if (normalized === normalize(translate('en', path)) || normalized === normalize(translate('he', path))) return tr(path);
  }
  // Provider prose has no translation key. Never invent a translation or overwrite its source.
  const hebrew = tr('aiWarningText.additional') === translate('he', 'aiWarningText.additional');
  if (hebrew ? /[א-ת]/.test(source) && !/[a-z]/i.test(source) : !/[א-ת]/.test(source)) return source;
  return tr('aiWarningText.additional');
}
