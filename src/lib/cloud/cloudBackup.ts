import type { SupabaseClient } from '@supabase/supabase-js';
import { BACKUP_SCHEMA_VERSION } from '../../db/database';
import { exportProjects, importBackup, type BackupImportResult, type ConfirmLarge } from '../backup/backupService';

/**
 * Manual cloud backups of single projects as `.bettercalc` files in a private Supabase bucket. Local data
 * stays the working copy: nothing here reads or writes IndexedDB except through the existing backup
 * export and import, and nothing runs unless the user starts it. Who may use it, how much space they
 * have and which path an upload may use are decided by the database (see the cloud_backups migration);
 * this file only asks.
 */
export const CLOUD_BUCKET = 'cloud-backups';
/** Usage at or above this share of the quota shows a warning (HANDOFF: 80%). */
export const CLOUD_WARN_RATIO = 0.8;

export type CloudClient = Pick<SupabaseClient, 'rpc' | 'from' | 'storage'>;

export type CloudErrorCode =
  | 'not-entitled'
  | 'quota-exceeded'
  | 'file-too-large'
  | 'too-many-uploads'
  | 'not-found'
  | 'network'
  | 'unknown';

export class CloudBackupError extends Error {
  readonly code: CloudErrorCode;
  constructor(code: CloudErrorCode, detail?: string) {
    super(detail ?? code);
    this.name = 'CloudBackupError';
    this.code = code;
  }
}

function toCloudError(error: unknown): CloudBackupError {
  if (error instanceof CloudBackupError) return error;
  const { name, message, status } = (error ?? {}) as { name?: string; message?: string; status?: number };
  const text = message ?? '';
  if (name === 'TypeError' || status === 0 || /failed to fetch|network|load failed/i.test(text)) return new CloudBackupError('network', text);
  if (text.includes('not_entitled')) return new CloudBackupError('not-entitled', text);
  if (text.includes('quota_exceeded')) return new CloudBackupError('quota-exceeded', text);
  if (text.includes('file_too_large')) return new CloudBackupError('file-too-large', text);
  if (text.includes('too_many_uploads')) return new CloudBackupError('too-many-uploads', text);
  // Row-level security refusing an upload means the entitlement or reservation is gone.
  if (/row-level security|unauthorized|not_authenticated/i.test(text)) return new CloudBackupError('not-entitled', text);
  return new CloudBackupError('unknown', text);
}

/** Exact enough to be honest at both ends: an empty cloud is not "1 MB", and a small backup is not rounded up to a megabyte. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

// ---------------------------------------------------------------- status

export interface CloudStatus {
  entitled: boolean;
  /** Active or grace: may back up and delete. */
  canWrite: boolean;
  /** May list and restore (also after a subscription ended, for 90 days). */
  canRead: boolean;
  status: 'active' | 'grace' | 'ended' | null;
  quotaBytes: number;
  usedBytes: number;
  maxFileBytes: number;
  usage: CloudUsage;
}
export type CloudUsage = 'ok' | 'warning' | 'full';

export function cloudUsage(usedBytes: number, quotaBytes: number): CloudUsage {
  if (quotaBytes <= 0) return 'ok';
  if (usedBytes >= quotaBytes) return 'full';
  return usedBytes >= quotaBytes * CLOUD_WARN_RATIO ? 'warning' : 'ok';
}

export async function getCloudStatus(client: CloudClient): Promise<CloudStatus> {
  try {
    const { data, error } = await client.rpc('cloud_backup_status');
    if (error) throw error;
    const s = (data ?? {}) as Record<string, unknown>;
    const quotaBytes = Number(s.quota_bytes ?? 0);
    const usedBytes = Number(s.used_bytes ?? 0);
    return {
      entitled: s.entitled === true,
      canWrite: s.can_write === true,
      canRead: s.can_read === true,
      status: (s.status as CloudStatus['status']) ?? null,
      quotaBytes,
      usedBytes,
      maxFileBytes: Number(s.max_file_bytes ?? 0),
      usage: cloudUsage(usedBytes, quotaBytes),
    };
  } catch (error) {
    throw toCloudError(error);
  }
}

// ---------------------------------------------------------------- list

export interface CloudBackup {
  id: string;
  name: string;
  sizeBytes: number;
  projectCount: number;
  createdAt: number;
}

export async function listCloudBackups(client: CloudClient): Promise<CloudBackup[]> {
  try {
    const { data, error } = await client
      .from('cloud_backups')
      .select('id, name, size_bytes, project_count, created_at')
      .eq('status', 'complete')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      name: String(row.name),
      sizeBytes: Number(row.size_bytes),
      projectCount: Number(row.project_count),
      createdAt: Date.parse(String(row.created_at)),
    }));
  } catch (error) {
    throw toCloudError(error);
  }
}

// ---------------------------------------------------------------- upload

export interface UploadRequest {
  projectId: string;
  /** The project's name, shown in the cloud list. */
  name: string;
}

/**
 * Backs up one project: the same export the local backup uses, then reserve space on the server, upload
 * to the single path it allows, and confirm. A new file every time: an earlier backup is never replaced.
 * Returns null when the user cancels the large-backup warning. Callers persist an open plan first.
 */
export async function uploadProjectBackup(
  client: CloudClient,
  request: UploadRequest,
  confirm?: ConfirmLarge,
  exportFn: typeof exportProjects = exportProjects,
): Promise<CloudBackup | null> {
  const exported = await exportFn([request.projectId], confirm);
  if (!exported) return null;
  const body = new Blob([exported.bytes as BlobPart], { type: 'application/octet-stream' });

  let reserved: { id: string; object_path: string } | null = null;
  try {
    const { data, error } = await client.rpc('reserve_cloud_backup', {
      p_name: request.name,
      p_size_bytes: body.size,
      p_project_count: exported.projectCount,
      p_schema_version: BACKUP_SCHEMA_VERSION,
    });
    if (error) throw error;
    reserved = (Array.isArray(data) ? data[0] : data) as { id: string; object_path: string };
    if (!reserved?.id) throw new CloudBackupError('unknown', 'no reservation');

    const upload = await client.storage.from(CLOUD_BUCKET).upload(reserved.object_path, body, { contentType: 'application/octet-stream', upsert: false });
    if (upload.error) throw upload.error;

    const done = await client.rpc('complete_cloud_backup', { p_id: reserved.id });
    if (done.error) throw done.error;
    if (done.data !== 'complete') throw new CloudBackupError('file-too-large', String(done.data));
  } catch (error) {
    // Best effort: do not leave a half-finished upload behind. Whatever stays is expired and cleaned up server-side.
    if (reserved?.object_path) await client.storage.from(CLOUD_BUCKET).remove([reserved.object_path]).catch(() => undefined);
    throw toCloudError(error);
  }
  return { id: reserved.id, name: request.name, sizeBytes: body.size, projectCount: exported.projectCount, createdAt: Date.now() };
}

// ---------------------------------------------------------------- restore

/**
 * Downloads a backup and imports it with the existing import: always as new copies, never over a
 * project already on this device. Returns null when the user cancels a large-import warning.
 */
export async function restoreCloudBackup(
  client: CloudClient,
  backupId: string,
  confirm?: ConfirmLarge,
  importFn: typeof importBackup = importBackup,
): Promise<BackupImportResult | null> {
  try {
    const path = await objectPath(client, backupId);
    const { data, error } = await client.storage.from(CLOUD_BUCKET).download(path);
    if (error) throw error;
    if (!data) throw new CloudBackupError('not-found');
    return await importFn(data, confirm);
  } catch (error) {
    if (error && typeof error === 'object' && (error as { name?: string }).name === 'BackupError') throw error;
    throw toCloudError(error);
  }
}

async function objectPath(client: CloudClient, backupId: string): Promise<string> {
  const { data, error } = await client.from('cloud_backups').select('object_path').eq('id', backupId).eq('status', 'complete').maybeSingle();
  if (error) throw error;
  if (!data) throw new CloudBackupError('not-found');
  return String((data as { object_path: string }).object_path);
}

// ---------------------------------------------------------------- delete

/** Deletes a cloud copy only. Local projects are never touched. File first, then the record. */
export async function deleteCloudBackup(client: CloudClient, backupId: string): Promise<void> {
  try {
    const path = await objectPath(client, backupId);
    const removed = await client.storage.from(CLOUD_BUCKET).remove([path]);
    if (removed.error) throw removed.error;
    const { error } = await client.rpc('delete_cloud_backup', { p_id: backupId });
    if (error) throw error;
  } catch (error) {
    throw toCloudError(error);
  }
}
