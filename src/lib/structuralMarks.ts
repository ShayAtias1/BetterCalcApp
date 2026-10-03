/**
 * Marks of concrete zones and rebar items — the label that names an element on the plan, in lists
 * and in the reports.
 *
 * A mark is EITHER typed by the user OR automatic, and the two are stored differently so that
 * switching the UI language can never touch what the user wrote:
 *
 *   manual    `mark` holds the user's text, exactly as typed, and `markManual` is true.
 *   automatic `mark` is '' and `autoNumber` holds the running number of the kind (1, 2, 3 …).
 *
 * The readable automatic name ("תקרה 01" / "Slab 01") is never stored: it is derived each time it
 * is shown, from the kind's name in the language being shown and the number — in the UI that is the
 * UI language, in a report the report language. A number is kept per kind and plan.
 *
 * Data saved before this existed holds letter marks (`S01`, `W01`, `B01`, `C01`, `M01`, `R01`).
 * A mark of exactly the automatic shape of its own kind, without `markManual`, is read as that
 * automatic number; any other text is a manual mark. Reading never writes — the converted form
 * is persisted only when the item is next edited.
 */

import type { TranslateFn } from '../i18n';
import type { ConcreteKind } from '../types/structural';

export type MarkKind = ConcreteKind | 'mesh' | 'bars';

/** The mark-related fields shared by concrete elements and rebar items. */
export interface MarkFields {
  /** The user's own text; '' means the mark is automatic. */
  mark: string;
  /** Set when the user typed `mark`, so a typed "S01" is never mistaken for an old automatic one. */
  markManual?: boolean;
  /** The running number of an automatic mark within its kind. */
  autoNumber?: number;
}

/** The letter the pre-localisation automatic marks started with. Only used to read old data. */
const LEGACY_PREFIX: Record<MarkKind, string> = { slab: 'S', wall: 'W', beam: 'B', column: 'C', mesh: 'M', bars: 'R' };

/** The number inside an old automatic mark of this kind (`S07` → 7), or null for anything else. */
export function legacyAutoNumber(kind: MarkKind, mark: string): number | null {
  const m = new RegExp(`^${LEGACY_PREFIX[kind]}(\\d+)$`).exec(mark.trim());
  return m ? Number(m[1]) : null;
}

/** The item with its mark fields in the current shape; the same object when they already are. */
export function withMarkFields<T extends MarkFields & { kind: MarkKind }>(item: T): T {
  if (item.markManual) return item;
  const mark = typeof item.mark === 'string' ? item.mark : '';
  if (mark.trim() === '') return item; // automatic
  const legacy = legacyAutoNumber(item.kind, mark);
  return legacy === null ? item : { ...item, mark: '', autoNumber: legacy }; // old letter mark → number; any other text is the user's
}

/** Whether the user typed this mark (as opposed to it being the automatic one). */
export const hasManualMark = (item: Pick<MarkFields, 'mark'>): boolean => typeof item.mark === 'string' && item.mark.trim() !== '';

/** The kind's name in the language of `t` — the word an automatic mark starts with. */
export function kindName(kind: MarkKind, t: TranslateFn): string {
  return kind === 'mesh' ? t('rebar.mesh') : kind === 'bars' ? t('rebar.bars') : t(`concrete.kinds.${kind}`);
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * What to show for an item: the user's mark verbatim, or the automatic name in the language of `t`
 * ("Slab 01"). An item with neither (an emptied field with no number) shows just the kind's name.
 */
export function markLabel(item: MarkFields & { kind: MarkKind }, t: TranslateFn): string {
  if (hasManualMark(item)) return item.mark;
  const name = kindName(item.kind, t);
  return typeof item.autoNumber === 'number' ? `${name} ${pad(item.autoNumber)}` : name;
}

/**
 * The next automatic number of a kind: one above the highest automatic number any item of that kind
 * already has — a deleted number is not refilled while a higher one remains. Items must already be
 * in the current shape (as `concreteOf` / `rebarOf` return them).
 */
export function nextAutoNumber(items: ReadonlyArray<MarkFields & { kind: MarkKind }>, kind: MarkKind): number {
  let highest = 0;
  for (const item of items) {
    if (item.kind === kind && typeof item.autoNumber === 'number' && item.autoNumber > highest) highest = item.autoNumber;
  }
  return highest + 1;
}

/**
 * The patch that applies text typed into the mark field. Text → a manual mark, kept verbatim.
 * Emptied → back to automatic, with the next free number of the kind among the item's siblings.
 * Fields set to `undefined` are removed by the update reducers.
 */
export function markPatch(
  siblings: ReadonlyArray<MarkFields & { kind: MarkKind; id: string }>,
  self: { id: string; kind: MarkKind },
  text: string,
): MarkFields {
  if (text.trim() === '') {
    const others = siblings.filter((s) => s.id !== self.id);
    return { mark: '', markManual: undefined, autoNumber: nextAutoNumber(others, self.kind) };
  }
  return { mark: text, markManual: true, autoNumber: undefined };
}
