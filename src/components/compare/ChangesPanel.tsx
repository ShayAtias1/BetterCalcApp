import { useCallback, useEffect, useRef, useState } from 'react';
import { useCompareStore } from '../../store/compareStore';
import type { AreaKind } from '../../types/compare';
import { CHANGE_KINDS, changeMeasurements, changeNumbering, changeTotals } from '../../lib/changeMeasurements';
import { round } from '../../lib/geometry';
import Icon from '../Icon';
import { useT } from '../../i18n';

/** Never smaller than a header plus a couple of rows, never taller than leaving a strip of plan. */
const MIN_HEIGHT = 160;
/** Space kept for the top bar and a usable sliver of the canvas above the panel. */
const RESERVED_ABOVE = 220;
/** Maximised still shows the plan — this is a work panel, not a modal. */
const MAXIMIZED_RESERVED = 140;

/**
 * The review surface for demolition / new construction: the changes recorded against the active
 * revision, with their running metres and square metres, across the full width of the workspace
 * while the plan stays visible above it.
 *
 * Like the takeoff side's quantities panel it is a sibling of the canvas+sidebar row, so opening it
 * shortens that row instead of overlaying the canvas — the coordinate transform is untouched. Its
 * size, open state and page filter are session UI state; nothing here is persisted.
 *
 * It is also the navigation surface: a row selects its measurement and, when that measurement
 * belongs to another source page, takes the user there.
 */
export default function ChangesPanel() {
  const t = useT();
  const comparison = useCompareStore((s) => s.comparison);
  const currentPageKey = useCompareStore((s) => s.currentPageKey);
  const open = useCompareStore((s) => s.changesOpen);
  const setOpen = useCompareStore((s) => s.setChangesOpen);
  const height = useCompareStore((s) => s.changesHeight);
  const setHeight = useCompareStore((s) => s.setChangesHeight);
  const maximized = useCompareStore((s) => s.changesMaximized);
  const toggleMaximized = useCompareStore((s) => s.toggleChangesMaximized);
  const scope = useCompareStore((s) => s.changesScope);
  const setScope = useCompareStore((s) => s.setChangesScope);
  const selectedMeasurementId = useCompareStore((s) => s.selectedMeasurementId);
  const focusMeasurement = useCompareStore((s) => s.focusMeasurement);
  const setMeasurementKind = useCompareStore((s) => s.setMeasurementKind);
  const updateMeasurement = useCompareStore((s) => s.updateMeasurement);
  const deleteMeasurement = useCompareStore((s) => s.deleteMeasurement);
  const setAreaKindColor = useCompareStore((s) => s.setAreaKindColor);

  const [resizing, setResizing] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window === 'undefined' ? 900 : window.innerHeight));
  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const maxHeight = Math.max(MIN_HEIGHT, viewportHeight - RESERVED_ABOVE);
  const clamp = useCallback((px: number) => Math.min(Math.max(px, MIN_HEIGHT), maxHeight), [maxHeight]);
  const effectiveHeight = maximized ? Math.max(MIN_HEIGHT, viewportHeight - MAXIMIZED_RESERVED) : clamp(height);

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
    setHeight(clamp(drag.startHeight + (drag.startY - e.clientY)));
  };
  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setResizing(false);
  };
  const onResizerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') setHeight(clamp(effectiveHeight + 32));
    else if (e.key === 'ArrowDown') setHeight(clamp(effectiveHeight - 32));
    else return;
    e.preventDefault();
  };

  if (!comparison) return null;

  const activeRevision = comparison.revisions.find((r) => r.id === comparison.activeRevisionId);
  const all = changeMeasurements(activeRevision?.measurements ?? []);
  // Numbers come from the whole revision, so filtering the table never renumbers a row.
  const numbers = changeNumbering(activeRevision?.measurements ?? []);
  const rows = scope === 'page' ? all.filter((m) => m.pageNumber === currentPageKey) : all;
  const totalsOf = (kind: AreaKind) => changeTotals(rows, kind);

  const demolition = totalsOf('demolition');
  const construction = totalsOf('construction');

  if (!open) {
    return (
      <div className="qty-panel-collapsed">
        <button className="btn-ghost small qty-open-btn" onClick={() => setOpen(true)} title={t('compare.changes.open')}>
          <Icon name="table" />
          {t('compare.changes.title')}
        </button>
        <span className="muted">
          {t('compare.changes.collapsedMeta', { count: all.length })} <Icon name="link" size={12} /> {activeRevision?.label ?? '-'}
        </span>
      </div>
    );
  }

  return (
    <section className={`qty-panel changes-panel ${resizing ? 'resizing' : ''} ${maximized ? 'maximized' : ''}`} style={{ height: effectiveHeight }} aria-label={t('compare.changes.title')}>
      <button
        className="qty-panel-resizer"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onResizerKeyDown}
        aria-label={t('compare.changes.resize')}
        title={t('quantitiesPanel.resizeHint')}
      />
      <header className="qty-panel-head">
        <Icon name="table" size={18} />
        <h2 className="qty-panel-title">{t('compare.changes.title')}</h2>
        {/* The context, at meta weight: what is being reviewed against what. */}
        <span className="qty-panel-meta">
          {t('compare.changes.source')} <Icon name="link" size={12} /> {activeRevision?.label ?? '-'} · {t('compare.changes.marks', { count: rows.length })}
        </span>
        <div className="qty-panel-actions">
          {/* All pages of this revision, or just the page on screen. */}
          <div className="segmented changes-scope">
            <button className={`tool-btn ${scope === 'all' ? 'active' : ''}`} onClick={() => setScope('all')} aria-pressed={scope === 'all'}>
              <span className="tool-label">{t('compare.changes.allPages')}</span>
            </button>
            <button className={`tool-btn ${scope === 'page' ? 'active' : ''}`} onClick={() => setScope('page')} aria-pressed={scope === 'page'}>
              <span className="tool-label">{t('common.page', { page: currentPageKey })}</span>
            </button>
          </div>
          <button className="icon-btn" onClick={toggleMaximized} title={maximized ? t('quantitiesPanel.restore') : t('quantitiesPanel.maximize')}>
            <Icon name={maximized ? 'collapse' : 'expand'} />
          </button>
          <button className="icon-btn" onClick={() => setOpen(false)} title={t('compare.changes.close')}>
            <Icon name="close" />
          </button>
        </div>
      </header>

      <div className="qty-panel-body">
        {/* A workstation read-out, not KPI cards: two lines of label/value, the table below is
            the actual subject of the panel. */}
        <div className="changes-summary">
          {CHANGE_KINDS.map((kind) => {
            const totals = kind === 'demolition' ? demolition : construction;
            return (
              <div key={kind} className={`changes-summary-item ${kind}`}>
                <input
                  type="color"
                  value={comparison.areaKindColors[kind]}
                  onChange={(e) => setAreaKindColor(kind, e.target.value)}
                  title={t('compare.changes.kindColor')}
                />
                <span className="changes-summary-label">{t(`areaKinds.${kind}`)}</span>
                <span className="muted tnum">{totals.count}</span>
                {/* Running metres exist only for wall items, so they appear only when there are any. */}
                {totals.lengthM > 0 && (
                  <span className="changes-metric tnum">
                    {round(totals.lengthM, 2)} {t('units.lm')}
                  </span>
                )}
                <span className="changes-metric strong tnum">
                  {round(totals.areaM2, 2)} {t('units.m2')}
                </span>
              </div>
            );
          })}
        </div>

        {rows.length === 0 ? (
          <div className="empty-state">
            <Icon name="scan" size={24} />
            <p>
              {scope === 'page'
                ? t('compare.changes.emptyPage', { page: currentPageKey, revision: activeRevision?.label ?? '' })
                : t('compare.changes.emptyAll', { revision: activeRevision?.label ?? '' })}
            </p>
            <span className="muted">{t('compare.changes.emptyHint')}</span>
          </div>
        ) : (
          <div className="qty-table-scroll">
            <table className="qty-table changes-table">
              <thead>
                <tr>
                  <th className="num">{t('compare.changes.headers.number')}</th>
                  <th>{t('compare.changes.headers.kind')}</th>
                  <th className="num">{t('compare.changes.headers.page')}</th>
                  <th>{t('compare.changes.headers.calcMode')}</th>
                  <th className="num">{t('compare.changes.headers.length')}</th>
                  <th className="num">{t('compare.changes.headers.height')}</th>
                  <th className="num">{t('compare.changes.headers.area')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const isWall = m.calcMode === 'wall';
                  return (
                    <tr
                      key={m.id}
                      className={m.id === selectedMeasurementId ? 'selected' : ''}
                      onClick={() => focusMeasurement(m.id)}
                      title={m.pageNumber === currentPageKey ? t('compare.changes.selectMark') : t('compare.changes.goToMark', { page: m.pageNumber })}
                    >
                      <td className="num">{numbers.get(m.id) ?? ''}</td>
                      <td>
                        {/* Reclassifying keeps the geometry and every derived quantity as they are. */}
                        <span className="changes-kind-cell">
                          <span className="color-dot" style={{ background: comparison.areaKindColors[m.areaKind!] }} />
                          <select
                            className="changes-kind-select"
                            value={m.areaKind}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setMeasurementKind(m.id, e.target.value as AreaKind)}
                            title={t('compare.changes.reclassify')}
                          >
                            {CHANGE_KINDS.map((k) => (
                              <option key={k} value={k}>
                                {t(`areaKinds.${k}`)}
                              </option>
                            ))}
                          </select>
                        </span>
                      </td>
                      <td className="num">{m.pageNumber}</td>
                      <td>{isWall ? t('measure.calcModes.wall') : t('measure.calcModes.footprint')}</td>
                      <td className="num">{isWall ? round(m.wallLengthM ?? 0, 2) : '-'}</td>
                      <td className="num">
                        {isWall ? (
                          <input
                            type="number"
                            step="0.05"
                            min="0.1"
                            className="inline-number"
                            value={m.wallHeightM ?? comparison.wallHeightDefaultM}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const h = parseFloat(e.target.value) || 0;
                              const area = round((m.wallLengthM ?? 0) * h, 2);
                              updateMeasurement(m.id, { wallHeightM: h, areaM2: area });
                            }}
                          />
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="num order">{round(m.areaM2 ?? 0, 2)}</td>
                      <td className="row-actions">
                        <button
                          className="icon-btn danger"
                          title={t('compare.changes.delete')}
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMeasurement(m.id);
                          }}
                        >
                          <Icon name="trash" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
