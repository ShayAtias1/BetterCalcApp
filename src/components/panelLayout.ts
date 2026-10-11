import type { CSSProperties } from 'react';
import { create } from 'zustand';

export type PanelSide = 'list' | 'inspector';

export const LIMITS: Record<PanelSide, { min: number; max: number }> = { list: { min: 220, max: 480 }, inspector: { min: 260, max: 560 } };
/** The plan always keeps at least this much width beside the panels. */
export const MIN_CANVAS = 360;

/**
 * Desktop side-panel layout. Session UI state only — never written to the plan. A width stays null
 * until the panel is dragged, so the stylesheet's defaults (narrower on small desktops) apply until then;
 * collapsing keeps the width, so a panel reopens at the size it had.
 */
export const usePanelLayout = create<{
  width: Record<PanelSide, number | null>;
  open: Record<PanelSide, boolean>;
  setWidth: (side: PanelSide, px: number | null) => void;
  setOpen: (side: PanelSide, open: boolean) => void;
}>((set) => ({
  width: { list: null, inspector: null },
  open: { list: true, inspector: true },
  setWidth: (side, px) => set((s) => ({ width: { ...s.width, [side]: px } })),
  setOpen: (side, open) => set((s) => ({ open: { ...s.open, [side]: open } })),
}));

const VAR: Record<PanelSide, string> = { list: '--list-w', inspector: '--panel-w' };

/** The grid's column widths: 0 for a collapsed panel, the dragged width if there is one. */
export function usePanelGridStyle(): CSSProperties {
  const { width, open } = usePanelLayout();
  const style: Record<string, string> = {};
  for (const side of ['list', 'inspector'] as const) {
    if (!open[side]) style[VAR[side]] = '0px';
    else if (width[side] !== null) style[VAR[side]] = `${width[side]}px`;
  }
  return style as CSSProperties;
}

