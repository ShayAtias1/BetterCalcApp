import { useT } from '../i18n';
import Icon from './Icon';

/**
 * On desktop each domain panel renders in two places: its list in the side panel at the inline start
 * and the selected item's details in the inspector at the inline end. Without a part (tablet and
 * phone) a panel keeps its single list ⇄ detail view.
 */
export type PanelPart = 'list' | 'detail';

/** What the inspector shows while nothing is selected. */
export function InspectorEmpty({ text }: { text: string }) {
  return (
    <div className="empty-state inspector-empty">
      <Icon name="select" size={28} />
      <p>{text}</p>
    </div>
  );
}

/** Closes the inspector by clearing the selection; the list beside it stays as it is. */
export function InspectorCloseButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button className="icon-btn" onClick={onClick} title={t('workspace.inspector.close')} aria-label={t('workspace.inspector.close')}>
      <Icon name="close" />
    </button>
  );
}
