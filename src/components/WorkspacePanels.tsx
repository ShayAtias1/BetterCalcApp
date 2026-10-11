import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { LIMITS, MIN_CANVAS, usePanelLayout, type PanelSide } from './panelLayout';
import { useT } from '../i18n';
import Icon from './Icon';

function clampWidth(side: PanelSide, px: number, otherPx: number) {
  const { min, max } = LIMITS[side];
  const room = window.innerWidth - otherPx - MIN_CANVAS;
  return Math.round(Math.max(min, Math.min(px, max, Math.max(min, room))));
}

/** Width of the other panel as laid out now (0 when collapsed). */
function otherWidth(handle: HTMLElement, side: PanelSide) {
  const other = handle.closest('.workspace')?.querySelector<HTMLElement>(side === 'list' ? '.inspector-panel' : '.object-panel');
  return other?.getBoundingClientRect().width ?? 0;
}

/**
 * The drag handle on a panel's inner edge (the edge that meets the plan). Moving it towards the plan
 * widens the panel, in either reading direction.
 */
export function PanelResizer({ side }: { side: PanelSide }) {
  const t = useT();
  const setWidth = usePanelLayout((s) => s.setWidth);
  const drag = useRef<{ startX: number; startWidth: number; sign: number; other: number } | null>(null);
  // In LTR the list is on the left (its inner edge on the right): moving right widens it. RTL mirrors that.
  const sign = (el: HTMLElement) => (side === 'list') === (getComputedStyle(el).direction === 'ltr') ? 1 : -1;
  const panelWidth = (el: HTMLElement) => el.parentElement?.getBoundingClientRect().width ?? 0;
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    drag.current = { startX: e.clientX, startWidth: panelWidth(el), sign: sign(el), other: otherWidth(el, side) };
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setWidth(side, clampWidth(side, d.startWidth + (e.clientX - d.startX) * d.sign, d.other));
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    e.currentTarget.classList.remove('dragging');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const el = e.currentTarget;
    const step = (e.key === 'ArrowRight' ? 16 : -16) * sign(el);
    setWidth(side, clampWidth(side, panelWidth(el) + step, otherWidth(el, side)));
  };
  const label = t(side === 'list' ? 'workspace.panels.resizeList' : 'workspace.panels.resizeInspector');
  return (
    <div
      className={`panel-resizer panel-resizer-${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      // Double-click returns to the default width.
      onDoubleClick={() => usePanelLayout.getState().setWidth(side, null)}
    />
  );
}

/**
 * One toggle per side panel, on the plan's edge where the panel meets it: the same button collapses
 * the panel and brings it back at its previous width. Its arrow points the way the panel will move —
 * towards the window edge while open, back over the plan while collapsed.
 */
export function PanelRestoreButtons() {
  const t = useT();
  const { open, setOpen } = usePanelLayout();
  return <>
    {(['list', 'inspector'] as const).map((side) => {
      const isOpen = open[side];
      const label = t(side === 'list'
        ? isOpen ? 'workspace.panels.collapseList' : 'workspace.panels.restoreList'
        : isOpen ? 'workspace.panels.collapseInspector' : 'workspace.panels.restoreInspector');
      // The list sits at the inline start, the inspector at the inline end.
      const icon = (side === 'list') === isOpen ? 'chevron-previous' : 'chevron-next';
      return <button key={side} className={`panel-restore panel-restore-${side} ${isOpen ? 'is-open' : ''}`} onClick={() => setOpen(side, !isOpen)}
        title={label} aria-label={label} aria-expanded={isOpen}>
        <Icon name={icon} size={14} />
      </button>;
    })}
  </>;
}
