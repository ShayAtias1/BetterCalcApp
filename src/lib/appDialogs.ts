import { create } from 'zustand';
import { t } from '../i18n';

export interface DialogOptions {
  title?: string;
  confirmLabel?: string;
  destructive?: boolean;
  disclosure?: string;
  notice?: string;
  /** An unchecked switch under the message; its state is returned by `confirmDialogWithToggle`. */
  toggleLabel?: string;
  /** Shown as a warning while the switch is on. */
  toggleWarning?: string;
  /** Replaces the confirm button label while the switch is on. */
  toggleConfirmLabel?: string;
}
export interface DialogRequest extends DialogOptions {
  id: number;
  kind: 'confirm' | 'message' | 'prompt';
  message: string;
  initialValue?: string;
  resolve: (value: string | boolean | null, toggled?: boolean) => void;
}
export interface NoticeAction { label: string; run: () => void; }
interface Notice { id: number; message: string; action?: NoticeAction; }
let nextId = 0;
export const useAppDialogs = create<{ queue: DialogRequest[]; notices: Notice[] }>(() => ({ queue: [], notices: [] }));
function request(kind: DialogRequest['kind'], message: string, options: DialogOptions, initialValue?: string) {
  return new Promise<{ value: string | boolean | null; toggled: boolean }>((resolve) => {
    useAppDialogs.setState(s => ({ queue: [...s.queue, { ...options, id: ++nextId, kind, message, initialValue, resolve: (value, toggled = false) => resolve({ value, toggled }) }] }));
  });
}
export async function confirmDialog(message: string, options: DialogOptions = {}): Promise<boolean> {
  return (await request('confirm', message, options)).value === true;
}
/** A confirmation with one extra switch (default off). `toggled` is only true when the user also confirmed. */
export async function confirmDialogWithToggle(message: string, options: DialogOptions & { toggleLabel: string }): Promise<{ confirmed: boolean; toggled: boolean }> {
  const { value, toggled } = await request('confirm', message, options);
  return { confirmed: value === true, toggled: value === true && toggled };
}
/** Shared credit consent; processing disclosures remain separately expandable. */
export function confirmAiDialog(disclosure: string, notice?: string): Promise<boolean> {
  return confirmDialog(t('aiConfirmation.description'), {
    title: t('aiConfirmation.title'),
    confirmLabel: t('aiConfirmation.confirm'),
    disclosure,
    notice,
  });
}
export async function promptDialog(message: string, initialValue = '', options: DialogOptions = {}): Promise<string | null> {
  const { value } = await request('prompt', message, options, initialValue);
  return typeof value === 'string' ? value : null;
}
export async function messageDialog(message: string, options: DialogOptions = {}): Promise<void> {
  await request('message', message, options);
}
export function settleDialog(id: number, value: string | boolean | null, toggled = false): void {
  const item = useAppDialogs.getState().queue.find(d => d.id === id);
  useAppDialogs.setState(s => ({ queue: s.queue.filter(d => d.id !== id) }));
  item?.resolve(value, toggled);
}
/** How long a notice stays: long enough to read its text, never stuck on screen. */
export function noticeDuration(message: string): number {
  return Math.min(12_000, 4_000 + message.length * 50);
}

export function notify(message: string, action?: NoticeAction): void {
  useAppDialogs.setState(s => ({ notices: [...s.notices, { id: ++nextId, message, action }] }));
}
export function dismissNotice(id: number): void {
  useAppDialogs.setState(s => ({ notices: s.notices.filter(n => n.id !== id) }));
}
