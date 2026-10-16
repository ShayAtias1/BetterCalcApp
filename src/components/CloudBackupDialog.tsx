import { useCallback, useEffect, useState } from 'react';
import { formatDate, useT } from '../i18n';
import { confirmDialog, notify } from '../lib/appDialogs';
import { listProjects, type ProjectWithPlans } from '../db/database';
import { getSupabase } from '../lib/supabase/client';
import {
  CloudBackupError,
  deleteCloudBackup,
  formatBytes,
  ltr,
  getCloudStatus,
  listCloudBackups,
  restoreCloudBackup,
  uploadProjectBackup,
  type CloudBackup,
  type CloudClient,
  type CloudStatus,
} from '../lib/cloud/cloudBackup';
import { useAppStore } from '../store/appStore';
import AppModal from './AppModal';
import './Account.css';

/** Tells the project list to reload after a restore. */
export const PROJECTS_CHANGED = 'bettercalc:projects-changed';

/**
 * Manual cloud backup of single projects: pick, approve, upload; list, restore as a new copy, delete the
 * cloud copy. Everything is started by a click here; local projects are only ever read (to back up) or
 * added to (a restore creates a copy).
 */
export default function CloudBackupDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [client, setClient] = useState<CloudClient | null>(null);
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [backups, setBackups] = useState<CloudBackup[]>([]);
  const [projects, setProjects] = useState<ProjectWithPlans[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const errorText = (e: unknown) => t(`cloud.errors.${e instanceof CloudBackupError ? e.code : (e as { name?: string })?.name === 'BackupError' ? 'restore' : 'unknown'}`);

  const reload = useCallback(async (c: CloudClient) => {
    const s = await getCloudStatus(c);
    setStatus(s);
    setBackups(s.canRead ? await listCloudBackups(c) : []);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const c = (await getSupabase()) as CloudClient | null;
        if (!c) return;
        const local = await listProjects();
        if (!alive) return;
        setClient(c);
        setProjects(local.filter((p) => p.plans.length + p.comparisons.length > 0));
        await reload(c);
      } catch (e) {
        if (alive) setError(errorText(e));
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  const run = async (label: string, action: (c: CloudClient) => Promise<void>) => {
    if (!client || busy) return;
    setBusy(label);
    setError(null);
    try {
      await action(client);
      await reload(client);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const backUp = () => run('backup', async (c) => {
    const chosen = projects.filter((p) => selected.has(p.project.id));
    if (!chosen.length) return;
    const names = chosen.map((p) => `• ${p.project.name}`).join('\n');
    if (!await confirmDialog(t('cloud.confirm', { count: chosen.length, names }))) return;
    // An open plan or comparison is saved first, as with every other export.
    await useAppStore.getState().persist();
    let done = 0;
    for (const p of chosen) {
      setBusy(t('cloud.progress', { current: done + 1, total: chosen.length }));
      const result = await uploadProjectBackup(c, { projectId: p.project.id, name: p.project.name });
      if (result) done += 1;
    }
    setSelected(new Set());
    notify(t('cloud.done', { count: done }));
  });

  const restore = (b: CloudBackup) => run('restore', async (c) => {
    if (!await confirmDialog(t('cloud.restoreConfirm', { name: b.name }))) return;
    const result = await restoreCloudBackup(c, b.id);
    if (!result) return;
    window.dispatchEvent(new Event(PROJECTS_CHANGED));
    setProjects((await listProjects()).filter((p) => p.plans.length + p.comparisons.length > 0));
    notify(t('cloud.restored'));
  });

  const remove = (b: CloudBackup) => run('delete', async (c) => {
    if (!await confirmDialog(t('cloud.deleteConfirm', { name: b.name }), { destructive: true, confirmLabel: t('cloud.delete') })) return;
    await deleteCloudBackup(c, b.id);
    notify(t('cloud.deleted'));
  });

  const percent = status && status.quotaBytes > 0 ? Math.min(100, Math.floor((status.usedBytes / status.quotaBytes) * 100)) : 0;
  const toggle = (id: string) => setSelected((cur) => { const next = new Set(cur); if (!next.delete(id)) next.add(id); return next; });

  return (
    <AppModal title={t('cloud.title')} onCancel={onClose} showClose wide className="cloud-dialog">
      <p className="muted">{t('cloud.intro')}</p>
      {!status && !error && <p role="status">{t('cloud.loading')}</p>}
      {status && !status.entitled && <p>{t('cloud.notEntitled')}</p>}
      {status?.entitled && (
        <>
          {!status.canWrite && <p>{t('cloud.readOnly')}</p>}
          <div className={`cloud-usage${status.usage === 'ok' ? '' : ' warn'}`}>
            <progress max={status.quotaBytes} value={Math.min(status.usedBytes, status.quotaBytes)} aria-label={t('cloud.usage', { used: ltr(formatBytes(status.usedBytes)), quota: ltr(formatBytes(status.quotaBytes)) })} />
            <span>{t('cloud.usage', { used: ltr(formatBytes(status.usedBytes)), quota: ltr(formatBytes(status.quotaBytes)) })}</span>
          </div>
          {status.usage === 'warning' && <p className="cloud-warning" role="status">{t('cloud.warning', { percent })}</p>}
          {status.usage === 'full' && <p className="cloud-warning" role="alert">{t('cloud.full')}</p>}

          {status.canWrite && (
            <section>
              <h3>{t('cloud.backUp')}</h3>
              {projects.length === 0 ? <p className="muted">{t('cloud.noProjects')}</p> : (
                <ul className="cloud-projects" aria-label={t('cloud.chooseProjects')}>
                  {projects.map((p) => (
                    <li key={p.project.id}>
                      <label>
                        <input type="checkbox" checked={selected.has(p.project.id)} disabled={!!busy} onChange={() => toggle(p.project.id)} />
                        <span>{p.project.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <div className="app-dialog-actions">
                <button type="button" className="btn-primary" disabled={!!busy || selected.size === 0 || status.usage === 'full'} onClick={() => void backUp()}>
                  {busy && busy !== 'backup' && busy !== 'restore' && busy !== 'delete' ? busy : t('cloud.start')}
                </button>
              </div>
            </section>
          )}

          <section>
            <h3>{t('cloud.existing')}</h3>
            {backups.length === 0 ? <p className="muted">{t('cloud.none')}</p> : (
              <ul className="cloud-backups">
                {backups.map((b) => (
                  <li key={b.id}>
                    <span className="cloud-backup-name">{b.name}</span>
                    <span className="muted"><bdi>{formatBytes(b.sizeBytes)}</bdi> · <bdi>{formatDate(b.createdAt)}</bdi></span>
                    <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => void restore(b)}>{t('cloud.restore')}</button>
                    {status.canWrite && <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => void remove(b)}>{t('cloud.delete')}</button>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {error && <p className="auth-error" role="alert">{error}</p>}
    </AppModal>
  );
}
