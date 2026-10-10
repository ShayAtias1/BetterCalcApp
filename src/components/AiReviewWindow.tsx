import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import Icon from './Icon';

export const OPEN_OPENINGS_REVIEW = 'bettercalc:open-openings-review';

/** Independent, opt-in review window anchored above its fixed launcher. */
export default function AiReviewWindow({ title, progress, meaning, scope, bodyId, openEvent, selectedId, children }: {
  title: string; progress: string; meaning: string; scope: string; bodyId: string;
  openEvent?: string; selectedId?: string | null; children: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false), [extended, setExtended] = useState(false);
  const windowRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setOpen(false); setExtended(false); }, [scope]);
  useEffect(() => {
    if (!openEvent) return;
    const show = () => setOpen(true);
    window.addEventListener(openEvent, show);
    return () => window.removeEventListener(openEvent, show);
  }, [openEvent, scope]);
  useEffect(() => {
    if (open) windowRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [open, selectedId]);
  return <section className="ai-review-workspace" aria-label={title}>
    <header className="ai-review-workspace-head ai-review-launcher">
      <button className="btn-ghost small" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(v => !v)}>{title}</button>
      <span className="muted" title={meaning} role="status">{progress}</span>
    </header>
    {open && <div ref={windowRef} className={`ai-review-window${extended ? ' extended' : ''}`}>
      <header className="ai-review-workspace-head">
        <strong>{title}</strong>
        <div className="ai-review-window-actions">
          <button className="icon-btn" title={t(extended ? 'aiReviewWindow.reduce' : 'aiReviewWindow.extend')} aria-label={t(extended ? 'aiReviewWindow.reduce' : 'aiReviewWindow.extend')} onClick={() => setExtended(v => !v)}><Icon name={extended ? 'collapse' : 'expand'} /></button>
          <button className="icon-btn" title={t('aiReviewWindow.close')} aria-label={t('aiReviewWindow.close')} onClick={() => { setOpen(false); setExtended(false); }}><Icon name="close" /></button>
        </div>
      </header>
      <div className="ai-review-workspace-body" id={bodyId}>{children}</div>
    </div>}
  </section>;
}
