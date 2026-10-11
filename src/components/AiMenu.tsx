import { useId, useRef } from 'react';
import ResponsivePopover from './ResponsivePopover';
import AiSpaceDetectionPanel from './AiSpaceDetectionPanel';
import { type MenuId } from './TopBarMenu';
import { useAiReviewMode, useOpeningReviewSummary, useSpaceReviewSummary, type AiReviewMode } from './aiReviewState';
import { useT } from '../i18n';

/**
 * The header's AI menu: reviewing saved results (free, nothing is sent) above running a new detection
 * (paid, development builds only — the same tools that used to sit in the rooms panel).
 */
export default function AiMenu({ openId, setOpenId }: { openId: MenuId | null; setOpenId: (id: MenuId | null) => void }) {
  const t = useT();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const spaces = useSpaceReviewSummary();
  const openings = useOpeningReviewSummary();
  const mode = useAiReviewMode((s) => s.mode);
  const setMode = useAiReviewMode((s) => s.setMode);
  const open = openId === 'ai';
  const pending = spaces.pending + openings.pending;
  // Production builds have no detection tools, so the menu appears only when there is something to review.
  if (!import.meta.env.DEV && !spaces.available && !openings.available) return null;

  const row = (kind: AiReviewMode, title: string, progress: string, count: number, available: boolean) => (
    <div className={`ai-menu-row ${mode === kind ? 'active' : ''}`}>
      <span className="ai-menu-row-text">
        <strong>{title}</strong>
        <span className="muted">{available ? progress : t('aiMenu.noResults')}</span>
      </span>
      {count > 0 && <span className="ai-menu-pending">{t('aiMenu.pending', { count })}</span>}
      <button className="btn-secondary small" disabled={!available} onClick={() => { setMode(kind); setOpenId(null); }}>{t('aiMenu.open')}</button>
    </div>
  );

  return (
    <div className="top-bar-menu-anchor">
      <button
        ref={anchorRef}
        type="button"
        className={`top-bar-ai-btn ${open || mode ? 'active' : ''}`}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpenId(open ? null : 'ai')}
      >
        {t('aiMenu.button')}
        {pending > 0 && <span className="top-bar-ai-count" aria-label={t('aiMenu.pendingLabel', { count: pending })}>{pending}</span>}
      </button>
      {open && <ResponsivePopover id={menuId} label={t('aiMenu.button')} anchorRef={anchorRef} onClose={() => setOpenId(null)} desktopMaxWidth={420}>
        <div className="ai-menu">
          <div className="ai-menu-section">
            <p className="ai-menu-title">{t('aiMenu.reviewSaved')}</p>
            <p className="menu-hint">{t('aiMenu.reviewNote')}</p>
            {row('spaces', t('aiReviewWorkspace.title'), t('aiReviewWorkspace.progress', { resolved: spaces.resolved, total: spaces.total }), spaces.pending, spaces.available)}
            {row('openings', t('openingAiReview.title'), t('openingAiReview.progress', { resolved: openings.resolved, total: openings.total }), openings.pending, openings.available)}
          </div>
          {import.meta.env.DEV && <div className="ai-menu-section ai-menu-run">
            <p className="ai-menu-title">{t('aiMenu.runNew')}</p>
            <p className="menu-hint">{t('aiMenu.runNote')}</p>
            <AiSpaceDetectionPanel />
          </div>}
        </div>
      </ResponsivePopover>}
    </div>
  );
}
