import { type ReactNode } from 'react';
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import { useT } from '../i18n';
import Icon from './Icon';

/** One host for existing panels. Visibility never touches domain, selection or tools. */
export default function AdaptiveInspector({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode;
}) {
  const { layout } = useWorkspaceLayout();
  const t = useT();
  return <aside className="sidebar adaptive-inspector" hidden={layout !== 'expanded' && !open} aria-label={title}>
    {layout !== 'expanded' && <div className="adaptive-panel-head">
      <strong>{title}</strong>
      <button className="icon-btn" onClick={onClose} aria-label={t('adaptive.close')}><Icon name="close" /></button>
    </div>}
    {children}
  </aside>;
}
