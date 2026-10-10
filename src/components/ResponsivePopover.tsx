import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import { LANGUAGES, useLanguage } from '../i18n';

/** Small anchored surfaces share collision handling; dialogs and form selects keep their own UI. */
export default function ResponsivePopover({ anchorRef, onClose, id, label, children, desktopMaxWidth = 480 }: {
  anchorRef: RefObject<HTMLButtonElement | null>; onClose: () => void;
  id: string; label: string; children: ReactNode;
  desktopMaxWidth?: number;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const safeRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const { layout, touchInput } = useWorkspaceLayout();
  const language = useLanguage();
  const dir = LANGUAGES[language].dir;
  useLayoutEffect(() => {
    const surface = surfaceRef.current, anchor = anchorRef.current, safe = safeRef.current;
    if (!surface || !anchor || !safe) return;
    let frame = 0;
    const viewport = window.visualViewport;
    const position = () => {
      if (!anchor.isConnected || !anchor.getClientRects().length) { closeRef.current(); return; }
      const padding = getComputedStyle(safe);
      const left = (viewport?.offsetLeft ?? 0) + parseFloat(padding.paddingLeft);
      const top = (viewport?.offsetTop ?? 0) + parseFloat(padding.paddingTop);
      const right = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? document.documentElement.clientWidth) - parseFloat(padding.paddingRight);
      const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - parseFloat(padding.paddingBottom);
      const bounds = anchor.getBoundingClientRect();
      const width = Math.max(1, right - left);
      surface.style.maxWidth = `${Math.min(layout === 'expanded' ? desktopMaxWidth : 360, width)}px`;
      surface.style.minWidth = `${Math.min(layout === 'expanded' ? Math.min(240, desktopMaxWidth) : 168, width)}px`;
      surface.style.maxHeight = `${Math.max(1, bottom - top)}px`;
      let size = surface.getBoundingClientRect();
      const gap = 6;
      const below = Math.max(0, bottom - Math.max(top, bounds.bottom + gap));
      const above = Math.max(0, Math.min(bottom, bounds.top - gap) - top);
      const flipUp = size.height > below && above > below;
      surface.style.maxHeight = `${Math.max(1, flipUp ? above : below)}px`;
      size = surface.getBoundingClientRect();
      const natural = dir === 'rtl' ? bounds.right - size.width : bounds.left;
      const flipped = dir === 'rtl' ? bounds.left : bounds.right - size.width;
      const fits = (x: number) => x >= left && x + size.width <= right;
      const x = fits(natural) ? natural : fits(flipped) ? flipped : Math.max(left, Math.min(natural, right - size.width));
      const y = flipUp ? bounds.top - gap - size.height : bounds.bottom + gap;
      surface.style.left = `${x}px`;
      surface.style.top = `${Math.max(top, Math.min(y, bottom - size.height))}px`;
      surface.style.visibility = 'visible';
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(position); };
    position();
    const observer = new ResizeObserver(schedule);
    observer.observe(surface); observer.observe(anchor);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    viewport?.addEventListener('resize', schedule); viewport?.addEventListener('scroll', schedule);
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !surface.contains(event.target) && !anchor.contains(event.target)) closeRef.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); anchor.focus({ preventScroll: true }); }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true);
      viewport?.removeEventListener('resize', schedule); viewport?.removeEventListener('scroll', schedule);
      document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape);
    };
  }, [anchorRef, layout, dir, desktopMaxWidth]);

  return createPortal(<>
    <div ref={safeRef} className="popover-safe-margins" aria-hidden="true" />
    <div ref={surfaceRef} id={id} role="region" aria-label={label} dir={dir} lang={language}
      data-layout={layout} data-touch-input={touchInput} data-plan-control="popover"
      className="top-bar-menu responsive-popover" style={{ visibility: 'hidden' }}>
      {children}
    </div>
  </>, document.body);
}
