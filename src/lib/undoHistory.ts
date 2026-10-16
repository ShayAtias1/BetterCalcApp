/**
 * Generic undo/redo history tracker for a Zustand store whose interesting state is a single
 * object (e.g. `project` or `comparison`) that gets wholesale-replaced on every mutation.
 *
 * Two ways to record a change, both called with the state as it was *before* the mutation:
 * - `push`: records immediately — one user action, one undo step (deletes, "finish" actions, etc).
 * - `pushDebounced`: coalesces a burst of rapid calls (typing in a field, dragging a slider or a
 *   vertex) into a single undo step, captured after a short pause in activity. Every call in the
 *   burst must go through this same function (including the very first "quiet" ones during a drag)
 *   so the "before" snapshot captured is the one from *before the whole burst*, not a mid-burst one.
 */

import { canEditWork } from './workspaceCapabilities';

const HISTORY_LIMIT = 50;
const DEBOUNCE_MS = 600;

export interface HistorySlice<T> {
  history: T[];
  future: T[];
}

export function createHistoryTracker<T>() {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pending: T | null = null;

  function flush(get: () => HistorySlice<T>, set: (patch: Partial<HistorySlice<T>>) => void) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (pending !== null) {
      const { history } = get();
      set({ history: [...history, pending].slice(-HISTORY_LIMIT), future: [] });
      pending = null;
    }
  }

  function push(get: () => HistorySlice<T>, set: (patch: Partial<HistorySlice<T>>) => void, before: T) {
    // A refused edit (editing locked, see access/editGuard) leaves no undo step.
    if (!canEditWork()) return;
    flush(get, set);
    const { history } = get();
    set({ history: [...history, before].slice(-HISTORY_LIMIT), future: [] });
  }

  function pushDebounced(get: () => HistorySlice<T>, set: (patch: Partial<HistorySlice<T>>) => void, before: T) {
    if (!canEditWork()) return;
    if (pending === null) pending = before;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => flush(get, set), DEBOUNCE_MS);
  }

  /** Discards any pending debounced snapshot without recording it — use when switching projects/comparisons. */
  function discard() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    pending = null;
  }

  return { push, pushDebounced, flush, discard };
}
