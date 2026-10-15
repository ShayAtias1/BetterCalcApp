import { confirmDialog, notify } from '../lib/appDialogs';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { deleteProject, listProjects, type ProjectWithPlans } from '../db/database';
import { trackProjectOpened } from '../lib/analytics';
import { exportProjects, importBackup } from '../lib/backup/backupService';
import { backupFileName, downloadBackup } from '../lib/backup/backupFile';
import { projectsNeedingBackup, recordBackup, snoozeBackupReminder } from '../lib/backup/backupReminder';
import { getStorageProtection, type StorageProtection } from '../lib/storagePersistence';
import { BackupError, type BackupErrorCode } from '../lib/backup/backupFormat';
import { BACKUP_HARD_LIMIT_BYTES, toMegabytes } from '../lib/backup/backupLimits';
import type { ConfirmLarge } from '../lib/backup/backupService';
import { BackupImportConflictError } from '../db/database';
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

const ERROR_KEYS: Record<BackupErrorCode, 'notBackup' | 'tooNew' | 'corrupt' | 'invalid' | 'tooLarge' | 'conflict'> = {
  'not-a-backup': 'notBackup',
  'unsupported-version': 'tooNew',
  'hash-mismatch': 'corrupt',
  'missing-blob': 'corrupt',
  invalid: 'invalid',
  'too-large': 'tooLarge',
  conflict: 'conflict',
};

/** Browsers report a full disk as a DOMException named QuotaExceededError (legacy code 22). */
function isQuotaError(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && ((error as { name?: string }).name === 'QuotaExceededError' || (error as { code?: number }).code === 22);
}

export default function StartScreen() {
  const t = useT();
  const openProject = useAppStore((s) => s.openProject);
  const createProject = useAppStore((s) => s.createProject);
  const [projects, setProjects] = useState<ProjectWithPlans[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [protection, setProtection] = useState<StorageProtection | null>(null);
  const [reminderTick, setReminderTick] = useState(0);

  const refresh = () => {
    listProjects()
      .then(setProjects)
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  // Read-only check: never shows a permission prompt (the request happens after a project save).
  useEffect(() => {
    void getStorageProtection().then(setProtection);
  }, []);

  const unbackedIds = (() => {
    void reminderTick; // re-evaluated after a snooze or an export
    return projectsNeedingBackup(projects.filter((p) => p.plans.length + p.comparisons.length > 0).map((p) => ({
      id: p.project.id,
      lastTouched: Math.max(p.project.updatedAt, ...p.plans.map((x) => x.updatedAt), ...p.comparisons.map((c) => c.updatedAt)),
    })));
  })();

  const handleDelete = async (id: string) => {
    const entry = projects.find((p) => p.project.id === id);
    const count = (entry?.plans.length ?? 0) + (entry?.comparisons.length ?? 0);
    if (!await confirmDialog(count > 0 ? t('startScreen.deleteConfirmWithContents') : t('startScreen.deleteConfirm'), { destructive: true })) return;
    await deleteProject(id);
    refresh();
  };

  const runBackupTask = async (task: () => Promise<void>) => {
    if (backupBusy) return;
    setBackupBusy(true);
    try {
      await task();
    } catch (error) {
      console.error('[backup] operation failed', error);
      if (error instanceof BackupError) {
        const key = ERROR_KEYS[error.code];
        notify(key === 'tooLarge'
          ? t('startScreen.backup.error.tooLarge', { limit: toMegabytes(BACKUP_HARD_LIMIT_BYTES) })
          : t(`startScreen.backup.error.${key}`));
      } else if (error instanceof BackupImportConflictError) notify(t('startScreen.backup.error.conflict'));
      else if (error instanceof RangeError) notify(t('startScreen.backup.error.outOfMemory', { limit: toMegabytes(BACKUP_HARD_LIMIT_BYTES) }));
      else if (isQuotaError(error)) notify(t('startScreen.backup.error.quota'));
      else {
        // Unexpected: say what failed so it can be reported, instead of a bare "failed".
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        notify(t('startScreen.backup.error.failedDetail', { detail: detail.slice(0, 160) }));
      }
    } finally {
      setBackupBusy(false);
    }
  };

  const handleExport = (id: string | null) =>
    runBackupTask(async () => {
      const confirmLarge: ConfirmLarge = ({ bytes }) =>
        confirmDialog(t('startScreen.backup.confirm.largeExport', { size: toMegabytes(bytes) }));
      const result = await exportProjects(id ? [id] : undefined, confirmLarge);
      if (!result) return;
      const { bytes, projectCount } = result;
      if (projectCount === 0) {
        notify(t('startScreen.backup.nothingToExport'));
        return;
      }
      const name = id ? (projects.find((p) => p.project.id === id)?.project.name ?? null) : null;
      downloadBackup(bytes, backupFileName(name));
      recordBackup(id ? [id] : projects.map((p) => p.project.id));
      setReminderTick((n) => n + 1);
      notify(t('startScreen.backup.exported', { count: projectCount }));
    });

  const handleImportFile = (file: File) =>
    runBackupTask(async () => {
      const confirmLarge: ConfirmLarge = ({ bytes, freeBytes, lowStorage }) =>
        confirmDialog(
          lowStorage && freeBytes !== null
            ? t('startScreen.backup.confirm.lowStorage', { size: toMegabytes(bytes), free: toMegabytes(freeBytes) })
            : t('startScreen.backup.confirm.largeImport', { size: toMegabytes(bytes) }),
        );
      const result = await importBackup(file, confirmLarge);
      if (!result) return;
      refresh();
      const copies = result.projects.filter((p) => p.importedAsCopy).length;
      notify(t('startScreen.backup.imported', { count: result.projects.length }));
      if (copies > 0) notify(t('startScreen.backup.warning.copies', { count: copies }));
      if (result.droppedPlanLinks.length > 0) notify(t('startScreen.backup.warning.unlinkedPlans', { count: result.droppedPlanLinks.length }));
      if (result.detachedComparisonRefs.length > 0) notify(t('startScreen.backup.warning.detachedHistory', { count: result.detachedComparisonRefs.length }));
    });

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
    <div className="home-panel projects-page">
      <div className="home-panel-head">
        <div className="home-panel-text">
          <h2>{t('startScreen.title')}</h2>
          <p className="muted">{t('startScreen.description')}</p>
        </div>
        <div className="panel-head-actions">
          <input
            ref={fileInput}
            type="file"
            accept=".bettercalc"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void handleImportFile(file);
            }}
          />
          <button className="btn-secondary" disabled={backupBusy} onClick={() => fileInput.current?.click()} title={t('startScreen.backup.importHint')}>
            <Icon name="folder" />
            {t('startScreen.backup.import')}
          </button>
          <button className="btn-secondary" disabled={backupBusy || projects.length === 0} onClick={() => void handleExport(null)} title={t('startScreen.backup.exportAllHint')}>
            <Icon name="download" />
            {t('startScreen.backup.exportAll')}
          </button>
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" />
            {t('startScreen.newProject')}
          </button>
        </div>
      </div>

      <div className="storage-notes">
        {unbackedIds.length > 0 && (
          <div className="storage-note storage-note-reminder" role="status">
            <Icon name="alert" />
            <span>{t('startScreen.protection.reminder', { count: unbackedIds.length })}</span>
            <button className="btn-secondary small" disabled={backupBusy} onClick={() => void handleExport(null)}>
              {t('startScreen.protection.reminderExport')}
            </button>
            <button
              className="btn-ghost small"
              onClick={() => {
                snoozeBackupReminder();
                setReminderTick((n) => n + 1);
              }}
            >
              {t('startScreen.protection.reminderLater')}
            </button>
          </div>
        )}
        {protection && (
          <div className="storage-note" title={t('startScreen.protection.caveat')}>
            <Icon name={protection === 'persistent' ? 'check' : 'alert'} />
            <span>{t(`startScreen.protection.${protection === 'persistent' ? 'persistent' : protection === 'unsupported' ? 'unsupported' : 'notPersistent'}`)}</span>
          </div>
        )}
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
        onExport={(id) => void handleExport(id)}
        exportTitle={t('startScreen.backup.exportOne')}
        exportLabel={t('startScreen.backup.exportOneLabel')}
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
