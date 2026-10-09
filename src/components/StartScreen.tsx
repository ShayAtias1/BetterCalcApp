import { confirmDialog } from '../lib/appDialogs';
import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { deleteProject, listProjects, type ProjectWithPlans } from '../db/database';
import { trackProjectOpened } from '../lib/analytics';
import SavedItemList, { type SavedItem } from './SavedItemList';
import Icon from './Icon';
import { formatDate, useT, type TranslateFn } from '../i18n';

/** What the row says about a project: its plans and rooms, and when it was last touched. */
function projectMeta({ project, plans, comparisons }: ProjectWithPlans, t: TranslateFn): string {
  const lastTouched = Math.max(project.updatedAt, ...plans.map((p) => p.updatedAt), ...comparisons.map((c) => c.updatedAt));
  const updated = t('startScreen.meta.updated', { date: formatDate(lastTouched) });
  if (plans.length === 0 && comparisons.length === 0) return t('startScreen.meta.empty', { updated });
  const rooms = plans.reduce((n, p) => n + p.rooms.length, 0);
  const parts: string[] = [];
  if (plans.length > 0) parts.push(plans.length === 1 ? t('startScreen.meta.onePlan') : t('startScreen.meta.plans', { count: plans.length }));
  if (rooms > 0) parts.push(t('startScreen.meta.rooms', { count: rooms }));
  if (comparisons.length > 0)
    parts.push(comparisons.length === 1 ? t('startScreen.meta.oneComparison') : t('startScreen.meta.comparisons', { count: comparisons.length }));
  parts.push(updated);
  return parts.join(' · ');
}

export default function StartScreen() {
  const t = useT();
  const openProject = useAppStore((s) => s.openProject);
  const createProject = useAppStore((s) => s.createProject);
  const [projects, setProjects] = useState<ProjectWithPlans[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const refresh = () => {
    listProjects()
      .then(setProjects)
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const handleDelete = async (id: string) => {
    const entry = projects.find((p) => p.project.id === id);
    const count = (entry?.plans.length ?? 0) + (entry?.comparisons.length ?? 0);
    if (!await confirmDialog(count > 0 ? t('startScreen.deleteConfirmWithContents') : t('startScreen.deleteConfirm'), { destructive: true })) return;
    await deleteProject(id);
    refresh();
  };

  const closeDialog = () => {
    setCreating(false);
    setNewName('');
  };

  // A project is only a name. It opens on its overview, where the user chooses what to add first —
  // a quantity plan or a revision comparison; nothing is uploaded or opened on their behalf.
  const confirmCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    closeDialog();
    await createProject(name);
  };

  const items: SavedItem[] = projects.map((p) => ({ id: p.project.id, name: p.project.name, meta: projectMeta(p, t) }));

  return (
    <div className="home-panel">
      <div className="home-panel-head">
        <div className="home-panel-text">
          <h2>{t('startScreen.title')}</h2>
          <p className="muted">{t('startScreen.description')}</p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          <Icon name="plus" />
          {t('startScreen.newProject')}
        </button>
      </div>

      <span className="section-label">{t('startScreen.savedProjects')}</span>
      <SavedItemList
        items={items}
        icon="map"
        loading={loading}
        emptyText={t('startScreen.empty')}
        onOpen={(id) => {
          const entry = projects.find((p) => p.project.id === id);
          if (entry) trackProjectOpened(entry);
          void openProject(id);
        }}
        onDelete={(id) => void handleDelete(id)}
        openTitle={t('startScreen.open')}
        deleteTitle={t('startScreen.delete')}
      />

      {creating && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>{t('startScreen.newProject')}</h3>
            <div className="form-row">
              <label>{t('startScreen.nameLabel')}</label>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void confirmCreate();
                  else if (e.key === 'Escape') closeDialog();
                }}
                placeholder={t('startScreen.namePlaceholder')}
              />
              <p className="form-hint muted">{t('startScreen.nameHint')}</p>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={closeDialog}>
                {t('common.cancel')}
              </button>
              <button className="btn-primary" onClick={() => void confirmCreate()} disabled={!newName.trim()}>
                {t('startScreen.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
