/** CSS-pixel targets, independent of plan/native coordinates and visible SVG marker size. */
export const TOUCH_TARGET_PX = 48;
export const TOUCH_TAP_SLOP_PX = 8;
export const TOUCH_TAP_MAX_MS = 500;
export function nativeHitRadius(zoom: number, pointerType: string, mouseRadius = 9): number {
  return (pointerType === 'mouse' ? mouseRadius : TOUCH_TARGET_PX / 2) / zoom;
}

/** Cancels uncommitted child previews when the plan surface takes navigation ownership. */
export const PLAN_NAVIGATION_CANCEL = 'bettercalc-plan-navigation-cancel';
