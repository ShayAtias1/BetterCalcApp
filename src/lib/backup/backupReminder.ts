/**
 * Remembers, per browser, when each project was last exported to a `.bettercalc` file, so the home
 * screen can gently remind about projects that changed since their last backup. Only ids and
 * timestamps are stored, in localStorage; no project data.
 */
export const BACKUP_LOG_KEY = 'bettercalc.backupLog.v1';
export const REMINDER_SNOOZE_KEY = 'bettercalc.backupReminderSnoozedUntil';
export const REMINDER_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
function defaultStorage(storage?: KeyValueStorage | null): KeyValueStorage | null {
  if (storage !== undefined) return storage;
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function readLog(storage: KeyValueStorage | null): Record<string, number> {
  try {
    const raw = JSON.parse(storage?.getItem(BACKUP_LOG_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'number')) as Record<string, number>;
  } catch {
    return {};
  }
}

export function recordBackup(projectIds: string[], now = Date.now(), storage?: KeyValueStorage | null): void {
  const target = defaultStorage(storage);
  try {
    const log = readLog(target);
    for (const id of projectIds) log[id] = now;
    target?.setItem(BACKUP_LOG_KEY, JSON.stringify(log));
  } catch { /* the reminder is a convenience; never block an export */ }
}

export interface BackupCandidate { id: string; lastTouched: number }

/**
 * Projects that changed after their last export (or were never exported) and whose last export is
 * older than a week. Empty while the reminder is snoozed.
 */
export function projectsNeedingBackup(projects: BackupCandidate[], now = Date.now(), storage?: KeyValueStorage | null): string[] {
  const target = defaultStorage(storage);
  const snoozedUntil = Number(target?.getItem(REMINDER_SNOOZE_KEY) ?? 0);
  if (Number.isFinite(snoozedUntil) && snoozedUntil > now) return [];
  const log = readLog(target);
  return projects
    .filter((p) => {
      const last = log[p.id];
      if (last === undefined) return now - p.lastTouched >= 0; // never exported
      return p.lastTouched > last && now - last >= REMINDER_AFTER_MS;
    })
    .map((p) => p.id);
}

export function snoozeBackupReminder(now = Date.now(), storage?: KeyValueStorage | null): void {
  try { defaultStorage(storage)?.setItem(REMINDER_SNOOZE_KEY, String(now + SNOOZE_MS)); } catch { /* ignore */ }
}
