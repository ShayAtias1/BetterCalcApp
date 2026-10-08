import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useLanguage, useT } from '../i18n';
import Icon from './Icon';
import './AppDialogs.css';

/** HTML dialog renders in the top layer: background is inert, focus is trapped and restored. */
export default function AppModal({ title, children, onCancel, wide = false, descriptionId, showClose = false, className = '' }: {
  title: string; children: ReactNode; onCancel: () => void; wide?: boolean; descriptionId?: string; showClose?: boolean; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const language = useLanguage();
  const t = useT();
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => { dialog.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} className={`app-dialog${wide ? ' app-dialog-wide' : ''} ${className}`} dir={language === 'he' ? 'rtl' : 'ltr'}
    aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={e => { e.preventDefault(); onCancel(); }}
    onKeyDown={e => e.stopPropagation()} onKeyUp={e => e.stopPropagation()}>
    {showClose ? <header className="app-dialog-header">
      <h2 id={titleId}>{title}</h2>
      <button type="button" className="icon-btn app-dialog-close" aria-label={t('dialogs.close')} title={t('dialogs.close')} onClick={onCancel}>
        <Icon name="close" size={20} />
      </button>
    </header> : <h2 id={titleId}>{title}</h2>}
    {children}
  </dialog>;
}
