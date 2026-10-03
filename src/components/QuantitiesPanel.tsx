import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import QuantityTable from './QuantityTable';
import QuantityExportActions from './QuantityExportActions';
import ConcreteSummary from './ConcreteSummary';
import RebarSummary from './RebarSummary';
import { concreteOf, rebarOf } from '../lib/structuralPlan';
import Icon from './Icon';
import { useT } from '../i18n';

/** Never smaller than a header plus a couple of rows, never taller than leaving a strip of plan. */
const MIN_HEIGHT = 160;
/** Space kept for the top bar and a usable sliver of the canvas above the panel. */
const RESERVED_ABOVE = 220;
/** Maximised still shows the plan — this is a work panel, not a modal. */
const MAXIMIZED_RESERVED = 140;

/**
 * The quantity report, across the full width of the workspace instead of inside the 360px sidebar.
 *
 * The report is a wide table (a column group per work type in use); in the sidebar two columns were
 * visible at a time. Here it gets the whole window width while the plan stays on screen above it. The panel is a sibling of the
 * canvas+sidebar row, so opening it simply shortens that row — it never overlays the canvas and
 * never touches the coordinate transform, which is why drawing and calibration are unaffected.
 *
 * Its height lives in session UI state; nothing here is persisted with the project.
 */
export default function QuantitiesPanel() {
  const t = useT();
  const open = useAppStore((s) => s.quantitiesOpen);
  const setOpen = useAppStore((s) => s.setQuantitiesOpen);
  const height = useAppStore((s) => s.quantitiesHeight);
  const setHeight = useAppStore((s) => s.setQuantitiesHeight);
  const maximized = useAppStore((s) => s.quantitiesMaximized);
  const toggleMaximized = useAppStore((s) => s.toggleQuantitiesMaximized);
  const project = useAppStore((s) => s.project);

  // Which domain the panel shows. Finishes, Concrete and Rebar stay separate tables, never one merged report.
  const [domain, setDomain] = useState<'finishes' | 'concrete' | 'rebar'>('finishes');
  const [resizing, setResizing] = useState(false);
  // Calculation defaults: a secondary toggle in the header, deliberately not competing with export.
  const [showDefaults, setShowDefaults] = useState(false);
  // Tracked so the panel re-clamps itself when the window is resized smaller than its height.
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window === 'undefined' ? 900 : window.innerHeight));
  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const maxHeight = Math.max(MIN_HEIGHT, viewportHeight - RESERVED_ABOVE);
  const clamp = useCallback((px: number) => Math.min(Math.max(px, MIN_HEIGHT), maxHeight), [maxHeight]);
  // Clamping at render time means a window resize can never leave the panel taller than the window.
  const effectiveHeight = maximized ? Math.max(MIN_HEIGHT, viewportHeight - MAXIMIZED_RESERVED) : clamp(height);

  // Dragging the top edge. Pointer capture keeps the drag alive over the canvas and the iframe-free
  // areas alike, and the listener is removed as soon as the pointer is released.
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (maximized) return;
    dragRef.current = { startY: e.clientY, startHeight: effectiveHeight };
    e.currentTarget.setPointerCapture(e.pointerId);
    setResizing(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    // Dragging upwards (a smaller clientY) makes the panel taller.
    setHeight(clamp(drag.startHeight + (drag.startY - e.clientY)));
  };
  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setResizing(false);
  };
  // The same resize from the keyboard, so the panel is not mouse-only.
  const onResizerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') setHeight(clamp(effectiveHeight + 32));
    else if (e.key === 'ArrowDown') setHeight(clamp(effectiveHeight - 32));
    else return;
    e.preventDefault();
  };

  if (!project) return null;

  const roomCount = project.rooms.length;
  const counts = { finishes: roomCount, concrete: concreteOf(project).length, rebar: rebarOf(project).length };
  const domainLabel = { finishes: 'workspace.tabs.rooms', concrete: 'workspace.tabs.concrete', rebar: 'workspace.tabs.rebar' } as const;

  if (!open) {
    return (
      <div className="qty-panel-collapsed">
        <button className="btn-ghost small qty-open-btn" onClick={() => setOpen(true)} title={t('quantitiesPanel.open')}>
          <Icon name="table" />
          {t('quantitiesPanel.title')}
        </button>
        <span className="muted">{t('quantitiesPanel.rooms', { count: roomCount })}</span>
      </div>
    );
  }

  return (
    <section
      className={`qty-panel ${resizing ? 'resizing' : ''} ${maximized ? 'maximized' : ''}`}
      style={{ height: effectiveHeight }}
      aria-label={t('quantitiesPanel.region')}
    >
      <button
        className="qty-panel-resizer"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onResizerKeyDown}
        aria-label={t('quantitiesPanel.resize')}
        title={t('quantitiesPanel.resizeHint')}
      />
      <header className="qty-panel-head">
        <Icon name="table" size={18} />
        <h2 className="qty-panel-title">{t('quantitiesPanel.title')}</h2>
        <span className="qty-panel-meta">{t('quantitiesPanel.roomsInProject', { count: roomCount })}</span>
        <div className="qty-panel-actions">
          {domain === 'finishes' && (
          <button
            className={`btn-ghost small ${showDefaults ? 'active' : ''}`}
            onClick={() => setShowDefaults((v) => !v)}
            title={t('quantitiesPanel.defaultsHint')}
          >
            <Icon name="settings" />
            <span className="btn-label">{t('quantitiesPanel.defaults')}</span>
          </button>
          )}
          <span className="top-bar-sep" />
          <QuantityExportActions variant="buttons" />
          <button
            className="icon-btn"
            onClick={toggleMaximized}
            title={maximized ? t('quantitiesPanel.restore') : t('quantitiesPanel.maximize')}
          >
            <Icon name={maximized ? 'collapse' : 'expand'} />
          </button>
          <button className="icon-btn" onClick={() => setOpen(false)} title={t('quantitiesPanel.close')}>
            <Icon name="close" />
          </button>
        </div>
      </header>
      <div className="qty-domains" role="tablist" aria-label={t('quantitiesPanel.domains')}>
        {(['finishes', 'concrete', 'rebar'] as const).map((d) => (
          <button key={d} role="tab" aria-selected={domain === d} className={`btn-ghost small ${domain === d ? 'active' : ''}`} onClick={() => setDomain(d)}>
            {t(domainLabel[d])}
            {counts[d] > 0 && <span className="qty-domain-count">{counts[d]}</span>}
          </button>
        ))}
      </div>
      <div className="qty-panel-body">
        {domain === 'finishes' && <QuantityTable showDefaults={showDefaults} />}
        {domain === 'concrete' &&
          (counts.concrete === 0 ? <p className="muted qty-domain-empty">{t('quantitiesPanel.emptyConcrete')}</p> : <div className="qty-structural"><ConcreteSummary plan={project} /></div>)}
        {domain === 'rebar' &&
          (counts.rebar === 0 ? <p className="muted qty-domain-empty">{t('quantitiesPanel.emptyRebar')}</p> : <div className="qty-structural"><RebarSummary plan={project} /></div>)}
      </div>
    </section>
  );
}
