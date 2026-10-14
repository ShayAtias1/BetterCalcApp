import { create } from 'zustand';
import { t } from '../i18n';

export interface DialogOptions {
  title?: string;
  confirmLabel?: string;
  destructive?: boolean;
  disclosure?: string;
  notice?: string;
}
export interface DialogRequest extends DialogOptions {
  id: number;
  kind: 'confirm' | 'message' | 'prompt';
  message: string;
  initialValue?: string;
  resolve: (value: string | boolean | null) => void;
}
interface Notice { id: number; message: string; }
let nextId = 0;
export const useAppDialogs = create<{ queue: DialogRequest[]; notices: Notice[] }>(() => ({ queue: [], notices: [] }));
function request(kind: DialogRequest['kind'], message: string, options: DialogOptions, initialValue?: string) {
  return new Promise<string | boolean | null>((resolve) => {
    useAppDialogs.setState(s => ({ queue: [...s.queue, { ...options, id: ++nextId, kind, message, initialValue, resolve }] }));
  });
}
export async function confirmDialog(message: string, options: DialogOptions = {}): Promise<boolean> {
  return await request('confirm', message, options) === true;
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
  const value = await request('prompt', message, options, initialValue);
  return typeof value === 'string' ? value : null;
}
export async function messageDialog(message: string, options: DialogOptions = {}): Promise<void> {
  await request('message', message, options);
}
export function settleDialog(id: number, value: string | boolean | null): void {
  const item = useAppDialogs.getState().queue.find(d => d.id === id);
  useAppDialogs.setState(s => ({ queue: s.queue.filter(d => d.id !== id) }));
  item?.resolve(value);
}
/** How long a notice stays: long enough to read its text, never stuck on screen. */
export function noticeDuration(message: string): number {
  return Math.min(12_000, 4_000 + message.length * 50);
}

export function notify(message: string): void {
  useAppDialogs.setState(s => ({ notices: [...s.notices, { id: ++nextId, message }] }));
}
export function dismissNotice(id: number): void {
  useAppDialogs.setState(s => ({ notices: s.notices.filter(n => n.id !== id) }));
}
