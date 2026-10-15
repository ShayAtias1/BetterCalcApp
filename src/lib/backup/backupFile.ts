import { saveAs } from 'file-saver';
import { BACKUP_FILE_EXTENSION } from './backupFormat';

/** `BetterCalc-<name>-YYYY-MM-DD.bettercalc`, with characters Windows/macOS reject replaced. */
export function backupFileName(name: string | null, now = new Date()): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const safe = name?.replace(/[\\/:*?"<>|]/g, '_').trim();
  return `BetterCalc-${safe || 'backup'}-${day}${BACKUP_FILE_EXTENSION}`;
}

export function downloadBackup(bytes: Uint8Array, fileName: string): void {
  saveAs(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }), fileName);
}
