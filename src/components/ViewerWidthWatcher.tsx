import { useEffect, useRef } from 'react';

const EDGE = 12;
const GAP = 12;

/**
 * Marks the plan area it sits in with `data-width="narrow" | "tight"` when side panels leave too
 * little room for the centred dock and the zoom controls side by side (see index.css): "narrow" moves
 * the dock to the inline start, "tight" also lifts the zoom controls above it.
 */
export default function ViewerWidthWatcher() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const area = ref.current?.parentElement;
    if (!area || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const width = area.clientWidth;
      const dock = area.querySelector<HTMLElement>(':scope > .tool-dock')?.offsetWidth ?? 0;
      const zoom = area.querySelector<HTMLElement>('.zoom-controls')?.offsetWidth ?? 0;
      if (!dock || !zoom) { delete area.dataset.width; return; }
      const centredFits = width / 2 + dock / 2 + GAP <= width - zoom - EDGE;
      const sideBySideFits = EDGE + dock + GAP + zoom + EDGE <= width;
      if (centredFits) delete area.dataset.width;
      else area.dataset.width = sideBySideFits ? 'narrow' : 'tight';
    };
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    observer.observe(area);
    // The zoom controls mount once the page has loaded, and the dock's width follows its labels.
    const mutations = new MutationObserver(schedule);
    mutations.observe(area, { childList: true, subtree: true });
    schedule();
    return () => { observer.disconnect(); mutations.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  return <span ref={ref} hidden />;
}
