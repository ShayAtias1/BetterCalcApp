const CLEARED_FLAG = 'bettercalc.localDataCleared';
export type ClearedNote = 'signed-out' | 'sign-out-failed';

/** Remembers across the reload that follows a confirmed "clear local data" so the page can say what happened once. */
export function markLocalDataCleared(kind: ClearedNote = 'signed-out'): void {
  try { sessionStorage.setItem(CLEARED_FLAG, kind); } catch { /* the note is only a courtesy */ }
}
/** The pending note, once; consuming it removes the flag. */
export function consumeLocalDataCleared(): ClearedNote | null {
  try {
    const value = sessionStorage.getItem(CLEARED_FLAG);
    if (value === null) return null;
    sessionStorage.removeItem(CLEARED_FLAG);
    return value === 'sign-out-failed' ? 'sign-out-failed' : value === 'signed-out' || value === '1' ? 'signed-out' : null;
  } catch { return null; }
}
