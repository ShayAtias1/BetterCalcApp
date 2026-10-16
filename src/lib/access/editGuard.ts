import { create } from 'zustand';
import type { StateCreator } from 'zustand';
import { canEditWork } from '../workspaceCapabilities';

/** Why the registration prompt is open; the account dialog words itself from this. */
export type PromptReason = 'edit' | 'create' | 'account';

/** Whether the sign-in dialog is open. Opened by the account menu or by a blocked edit. */
export const useAccessPrompt = create<{ open: boolean; reason: PromptReason; mode: 'signIn' | 'create'; show(reason: PromptReason, mode?: 'signIn' | 'create'): void; close(): void }>((set) => ({
  open: false,
  reason: 'account',
  mode: 'signIn',
  show: (reason, mode = 'signIn') => set({ open: true, reason, mode }),
  close: () => set({ open: false }),
}));

/**
 * Entry guard for creating things (project, plan, comparison, backup import). Returns false and asks the
 * user to register when the trial has ended and restrictions are enforced; a no-op otherwise.
 */
export function requireEditAccess(reason: PromptReason = 'create'): boolean {
  if (canEditWork()) return true;
  useAccessPrompt.getState().show(reason);
  return false;
}

type Doc = { id: string } | null | undefined;

/**
 * zustand middleware for the stores that hold an open document (`project`, `comparison`). While editing is
 * not allowed it drops any change that replaces the open document with another version of itself, along with
 * that change's `history`/`future`/`dirty` companions, so nothing half-applies. Everything else passes:
 * opening or closing a document, selection, view state, and `persist` (which writes the document as it is,
 * so unsaved edits made before the trial ended are still saved). Allowed (the default, and always while
 * enforcement is off) this is a straight pass-through.
 */
export const guardEdits =
  <S extends object>(field: keyof S & string) =>
  (initializer: StateCreator<S, [], []>): StateCreator<S, [], []> =>
  (set, get, api) => {
    const guardedSet: typeof set = (partial, replace) => {
      if (canEditWork()) return set(partial as never, replace as never);
      const current = get();
      const patch = (typeof partial === 'function' ? (partial as (s: S) => unknown)(current) : partial) as Partial<S> | null;
      const before = current[field] as Doc;
      const after = patch && field in patch ? (patch[field] as Doc) : undefined;
      const isEdit = !!before && !!after && before.id === after.id && before !== after;
      if (!isEdit) return set(patch as never, replace as never);
      const { [field]: _document, history: _history, future: _future, dirty: _dirty, ...rest } = patch as Record<string, unknown>;
      useAccessPrompt.getState().show('edit');
      return set(rest as never, replace as never);
    };
    return initializer(guardedSet, get, api);
  };
