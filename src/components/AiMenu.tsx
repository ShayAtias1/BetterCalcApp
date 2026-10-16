import { useId, useRef } from 'react';
import Icon from './Icon';
import ResponsivePopover from './ResponsivePopover';
import AiSpaceDetectionPanel from './AiSpaceDetectionPanel';
import { type MenuId } from './TopBarMenu';
import { useAiReviewMode, useOpeningReviewSummary, useSpaceReviewSummary, type AiReviewMode } from './aiReviewState';
import { useT } from '../i18n';
import { useAccountUi } from '../store/accountUi';
import { useAiAccountState } from '../lib/access/useAiAccountState';
import { LockIcon } from './AiComingSoonDialog';
import './Account.css';

/** The live detection tools (they call the local AI proxy) are a deliberate opt-in; otherwise dev shows the same locked rows as production. */
const DEV_AI_TOOLS = import.meta.env.DEV && import.meta.env.VITE_AI_DEV_TOOLS === 'true';

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
  const setAiDialog = useAccountUi((s) => s.setAiDialog);
  const { accountState, credits } = useAiAccountState();
  const savedResults = spaces.available || openings.available;
  const pending = spaces.pending + openings.pending;
  // Production builds have no detection tools yet: the menu is always there, shows saved results to review,
  // and says the AI tools are coming soon.

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
        className={`top-bar-ai-btn ai-state-${accountState} ${open || mode ? 'active' : ''}`}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={accountState === 'guest' ? t('acct.aiStateGuest') : accountState === 'free' ? t('acct.aiStateFree') : accountState === 'low-credits' ? t('acct.aiStateLow', { count: credits }) : undefined}
        // A guest is asked for an account, unless there are saved results to review (those stay reachable).
        onClick={() => (accountState === 'guest' && !savedResults ? setAiDialog('guest') : setOpenId(open ? null : 'ai'))}
      >
        {t('aiMenu.button')}
        {/* Everything that decorates "AI" follows the text, so it sits on the left in Hebrew and on the right in English. */}
        {(accountState === 'guest' || accountState === 'free') && <LockIcon />}
        {accountState === 'low-credits' && <span className="ai-credit-chip">{credits}</span>}
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
          {DEV_AI_TOOLS ? <div className="ai-menu-section ai-menu-run">
            <p className="ai-menu-title">{t('aiMenu.runNew')}</p>
            <AiSpaceDetectionPanel />
          </div> : <div className="ai-menu-section ai-menu-run">
            <p className="ai-menu-title">{t('aiMenu.runNew')}</p>
            <section className="ai-tools-section">
              <p className="menu-hint">{t('aiConfirmation.status')}</p>
              <div className="ai-tools-actions">
                {([['aiRowSpaces', 'scan', 'aiTools.allSpaces'], ['aiRowClick', 'target', 'aiTools.oneClick'], ['aiRowMulti', 'layers', 'aiTools.multiPlan'], ['aiRowOpenings', 'scan', 'openingAi.title']] as const).map(([key, icon, label]) => (
                  <button key={key} type="button" className="btn-secondary ai-tool-button" onClick={() => { setOpenId(null); setAiDialog(accountState === 'guest' ? 'guest' : 'soon', key); }}>
                    <Icon name={icon} size={16} /><span>{t(label)}</span><span className="soon-badge">{t('acct.soon')}<LockIcon /></span>
                  </button>
                ))}
              </div>
            </section>
          </div>}
        </div>
      </ResponsivePopover>}
    </div>
  );
}
