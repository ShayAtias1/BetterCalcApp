/**
 * View menu visibility of the plan overlays, one switch per domain. A view preference of this
 * browser (like the grid and the UI language): kept in its own localStorage key, never in a plan,
 * so it survives reloads and never touches quantity data.
 */

export type OverlayKey = 'finishes' | 'concrete' | 'rebar' | 'measurements' | 'markups';
export type OverlayVisibility = Record<OverlayKey, boolean>;

export const OVERLAY_KEYS: readonly OverlayKey[] = ['finishes', 'concrete', 'rebar', 'measurements', 'markups'];
export const ALL_VISIBLE: OverlayVisibility = { finishes: true, concrete: true, rebar: true, measurements: true, markups: true };

export const OVERLAY_STORAGE_KEY = 'bettercalc.overlayVisibility';

/**
 * Saved preferences, validated field by field. The previous shape had two global switches:
 * `annotationsVisible` (rooms, markups and the structural zones together) and `measurementsVisible`.
 * A value saved that way maps onto the new controls: annotations → finishes, concrete, rebar and
 * markups; measurements → measurements. Anything missing or invalid is visible.
 */
export function readOverlayVisibility(raw: string | null): OverlayVisibility {
  if (!raw) return ALL_VISIBLE;
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (!v || typeof v !== 'object') return ALL_VISIBLE;
    const legacyAnnotations = v.annotationsVisible !== false;
    const legacyMeasurements = v.measurementsVisible !== false;
    const hasNew = OVERLAY_KEYS.some((k) => typeof v[k] === 'boolean');
    if (!hasNew) {
      return { finishes: legacyAnnotations, concrete: legacyAnnotations, rebar: legacyAnnotations, markups: legacyAnnotations, measurements: legacyMeasurements };
    }
    return Object.fromEntries(OVERLAY_KEYS.map((k) => [k, v[k] !== false])) as OverlayVisibility;
  } catch {
    return ALL_VISIBLE;
  }
}

/** The domain whose overlay a drawing tool produces, so it can be made visible when drawing starts. */
export function overlayForTool(toolMode: string, drawTarget: 'room' | 'concrete' | 'rebar'): OverlayKey | null {
  if (toolMode === 'draw' || toolMode === 'draw-rect') return drawTarget === 'room' ? 'finishes' : drawTarget;
  if (toolMode === 'measure') return 'measurements';
  if (toolMode === 'markup') return 'markups';
  return null;
}

/** What the plan exports treat as "annotations": rooms and markups, hidden only when both are. */
export const exportAnnotationsVisible = (v: OverlayVisibility): boolean => v.finishes || v.markups;
