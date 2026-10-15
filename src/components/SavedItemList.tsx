import Icon, { type IconName } from './Icon';
import { useT } from '../i18n';

export interface SavedItem {
  id: string;
  name: string;
  /** One line of honest metadata: what is in it, and when it was last touched. */
  meta: string;
}

/**
 * The saved-work list on the home screen, shared by both products so a project row and a
 * comparison row are the same object in two colours of ink.
 *
 * Same language as the lists inside the workspaces: background separation rather than a bordered,
 * shadowed card, a neutral hover, the accent reserved for state, and the destructive action
 * revealed on hover/focus instead of a permanent ✕.
 */
export default function SavedItemList({
  items,
  icon,
  loading,
  emptyText,
  onOpen,
  onDelete,
  openTitle,
  deleteTitle,
  onExport,
  exportTitle,
  exportLabel,
}: {
  items: SavedItem[];
  /** Marks which product the row belongs to. */
  icon: IconName;
  loading: boolean;
  emptyText: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  openTitle: string;
  deleteTitle: string;
  /** Optional per-row export (project backup); rows show no export action without it. */
  onExport?: (id: string) => void;
  exportTitle?: string;
  /** Visible text beside the export icon. */
  exportLabel?: string;
}) {
  const t = useT();
  if (loading) return <p className="muted saved-list-loading">{t('common.loading')}</p>;

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <Icon name={icon} size={24} />
        <p>{emptyText}</p>
      </div>
    );
  }

  return (
    <ul className="saved-list">
      {items.map((item) => (
        <li key={item.id} onClick={() => onOpen(item.id)} title={openTitle}>
          <Icon name={icon} />
          <span className="saved-list-text">
            <span className="saved-list-name" dir="auto">{item.name}</span>
            <span className="saved-list-meta">{item.meta}</span>
          </span>
          {onExport && (
            <button
              className="btn-secondary small saved-list-export"
              title={exportTitle}
              onClick={(e) => {
                e.stopPropagation();
                onExport(item.id);
              }}
            >
              <Icon name="download" />
              {exportLabel}
            </button>
          )}
          <span className="list-item-actions">
            <button
              className="icon-btn danger"
              title={deleteTitle}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(item.id);
              }}
            >
              <Icon name="trash" />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
