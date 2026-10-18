const CLEARED_FLAG = 'bettercalc.localDataCleared';

/** Remembers across the reload that follows a confirmed "clear local data" so the page can say so once. */
export function markLocalDataCleared(): void {
  try { sessionStorage.setItem(CLEARED_FLAG, '1'); } catch { /* the note is only a courtesy */ }
}
/** True once after a clear; consuming it removes the flag. */
export function consumeLocalDataCleared(): boolean {
  try {
    if (sessionStorage.getItem(CLEARED_FLAG) !== '1') return false;
    sessionStorage.removeItem(CLEARED_FLAG);
    return true;
  } catch { return false; }
}
