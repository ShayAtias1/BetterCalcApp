/**
 * Browser "persistent storage" for the local IndexedDB data. It only asks the browser not to evict the
 * site's data under storage pressure; it is not a backup and does not protect against the user
 * clearing site data, a browser reset or a disk failure. Nothing here reads or writes project data.
 */
export const PERSIST_STATE_KEY = 'bettercalc.storagePersistence.v1';
/** A denied request is not repeated sooner than this (browsers may prompt the user on each one). */
export const RETRY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export type StorageProtection = 'persistent' | 'not-persistent' | 'unsupported';

interface StorageManagerLike {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}
interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
interface Env {
  storage?: StorageManagerLike;
  local?: KeyValueStorage | null;
  now?: number;
}
interface PersistState { requestedAt: number; granted: boolean }

function defaultEnv(env: Env): Required<Env> {
  let local: KeyValueStorage | null = null;
  try { local = globalThis.localStorage ?? null; } catch { /* storage may be blocked */ }
  return {
    storage: env.storage ?? (typeof navigator !== 'undefined' ? (navigator.storage as StorageManagerLike | undefined) : undefined) ?? {},
    local: env.local === undefined ? local : env.local,
    now: env.now ?? Date.now(),
  };
}

function readState(local: KeyValueStorage | null): PersistState | null {
  try {
    const raw = JSON.parse(local?.getItem(PERSIST_STATE_KEY) ?? 'null');
    return raw && typeof raw.requestedAt === 'number' ? { requestedAt: raw.requestedAt, granted: raw.granted === true } : null;
  } catch {
    return null;
  }
}

/** Current protection, without ever showing a permission prompt. */
export async function getStorageProtection(env: Env = {}): Promise<StorageProtection> {
  const { storage } = defaultEnv(env);
  if (typeof storage.persisted !== 'function' || typeof storage.persist !== 'function') return 'unsupported';
  try {
    return (await storage.persisted()) ? 'persistent' : 'not-persistent';
  } catch {
    return 'unsupported';
  }
}

/**
 * Asks the browser for persistent storage, at most once per `RETRY_AFTER_MS` and never when it is
 * already granted. Safe to call after every save: it returns immediately in the common case.
 * Never throws.
 */
export async function requestPersistentStorage(env: Env = {}): Promise<StorageProtection> {
  const resolved = defaultEnv(env);
  const { storage, local, now } = resolved;
  try {
    if (typeof storage.persist !== 'function' || typeof storage.persisted !== 'function') return 'unsupported';
    if (await storage.persisted()) return 'persistent';
    const previous = readState(local);
    if (previous && now - previous.requestedAt < RETRY_AFTER_MS) return 'not-persistent';
    const granted = await storage.persist();
    try { local?.setItem(PERSIST_STATE_KEY, JSON.stringify({ requestedAt: now, granted } satisfies PersistState)); } catch { /* ignore */ }
    return granted ? 'persistent' : 'not-persistent';
  } catch {
    return 'unsupported';
  }
}

let requestedThisSession = false;
/** Called after a project document was saved. Fire-and-forget; one attempt per page session. */
export function requestPersistentStorageAfterSave(): void {
  if (requestedThisSession) return;
  requestedThisSession = true;
  void requestPersistentStorage();
}
