import {
  Children, Fragment, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type SelectHTMLAttributes,
} from 'react';

interface Entry { value: string; label: string; disabled: boolean; group?: string }

const textOf = (node: ReactNode): string => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
};

/** Flattens the <option>/<optgroup> children, so call sites keep writing a native select's markup. */
function collect(children: ReactNode, group: string | undefined, out: Entry[]) {
  Children.forEach(children, (child) => {
    if (!isValidElement<{ children?: ReactNode; value?: unknown; label?: string; disabled?: boolean }>(child)) return;
    if (child.type === Fragment) collect(child.props.children, group, out);
    else if (child.type === 'optgroup') collect(child.props.children, child.props.label, out);
    else if (child.type === 'option') {
      const label = textOf(child.props.children);
      out.push({ value: child.props.value == null ? label : String(child.props.value), label, disabled: !!child.props.disabled, group });
    }
  });
}

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'multiple' | 'size'>;

/**
 * Drop-in replacement for a native single <select>: same props and the same `onChange(e)` shape (`e.target.value`),
 * rendered as a floating listbox. The list is `position: fixed` (measured from the trigger) so scrolling panels and
 * modals never clip it, and it follows the document direction, so Hebrew RTL and English LTR both work.
 */
export default function Select({
  children, value, defaultValue, onChange, onClick, className, disabled, id, name, title, style,
  'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy, required, autoFocus,
}: Props) {
  const entries = useMemo(() => { const out: Entry[] = []; collect(children, undefined, out); return out; }, [children]);
  const [inner, setInner] = useState(defaultValue == null ? '' : String(defaultValue));
  const current = value !== undefined ? String(value) : inner;
  const selected = entries.find((e) => e.value === current);

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [box, setBox] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-o${i}`;

  const enabledFrom = useCallback((from: number, step: 1 | -1) => {
    for (let i = from; i >= 0 && i < entries.length; i += step) if (!entries[i].disabled) return i;
    return -1;
  }, [entries]);

  const place = useCallback(() => {
    const el = trigger.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const below = vh - r.bottom - 12;
    const above = r.top - 12;
    const want = Math.min(entries.length * 40 + 12, 320);
    const flip = below < Math.min(want, 180) && above > below;
    const width = Math.max(r.width, 160);
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8));
    setBox(flip
      ? { left, width, bottom: vh - r.top + 6, maxHeight: Math.max(120, Math.min(320, above)) }
      : { left, width, top: r.bottom + 6, maxHeight: Math.max(120, Math.min(320, below)) });
  }, [entries.length]);

  const openList = (to?: number) => {
    if (disabled) return;
    const at = entries.findIndex((e) => e.value === current && !e.disabled);
    setActive(to ?? (at >= 0 ? at : enabledFrom(0, 1)));
    setOpen(true);
  };
  const close = (refocus = true) => { setOpen(false); if (refocus) trigger.current?.focus(); };

  const choose = (i: number) => {
    const entry = entries[i];
    if (!entry || entry.disabled) return;
    setOpen(false);
    trigger.current?.focus();
    if (value === undefined) setInner(entry.value);
    if (entry.value === current) return;
    const target = { value: entry.value, name: name ?? '', id: id ?? '' };
    onChange?.({ target, currentTarget: target, type: 'change', preventDefault() {}, stopPropagation() {} } as unknown as ChangeEvent<HTMLSelectElement>);
  };

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!trigger.current?.contains(n) && !list.current?.contains(n)) setOpen(false);
    };
    const reflow = (e: Event) => { if (!list.current?.contains(e.target as Node)) place(); };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', reflow, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', reflow, true);
    };
  }, [open, place]);
  useEffect(() => {
    if (open && active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const key = e.key;
    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') { e.preventDefault(); openList(); }
      else if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typeAhead(key, true);
      return;
    }
    if (key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (key === 'Tab') setOpen(false);
    else if (key === 'ArrowDown') { e.preventDefault(); const n = enabledFrom(active + 1, 1); if (n >= 0) setActive(n); }
    else if (key === 'ArrowUp') { e.preventDefault(); const n = enabledFrom(active - 1, -1); if (n >= 0) setActive(n); }
    else if (key === 'Home') { e.preventDefault(); setActive(enabledFrom(0, 1)); }
    else if (key === 'End') { e.preventDefault(); setActive(enabledFrom(entries.length - 1, -1)); }
    else if (key === 'Enter' || key === ' ') { e.preventDefault(); choose(active); }
    else if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typeAhead(key, false);
  };

  /** Type-ahead: jumps to (or, closed, selects) the next option starting with what was typed. */
  const typeAhead = (char: string, selectNow: boolean) => {
    const now = Date.now();
    typed.current = { text: now - typed.current.at > 700 ? char : typed.current.text + char, at: now };
    const needle = typed.current.text.toLowerCase();
    const start = entries.findIndex((e) => e.value === current);
    const order = [...entries.keys()].map((_, k) => (start + 1 + k) % entries.length);
    const hit = order.find((i) => !entries[i].disabled && entries[i].label.toLowerCase().startsWith(needle));
    if (hit == null) return;
    if (selectNow) choose(hit); else setActive(hit);
  };

  return (
    <div className={`bc-select${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`} style={style} onClick={onClick as never}>
      <button
        ref={trigger}
        type="button"
        className="bc-select-trigger"
        id={id}
        name={name}
        title={title}
        disabled={disabled}
        autoFocus={autoFocus}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-required={required || undefined}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="bc-select-value" dir="auto">{selected?.label ?? ''}</span>
        <svg className="bc-select-chevron" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
          <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && box && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          className="bc-select-list"
          aria-label={ariaLabel}
          style={{ left: box.left, width: box.width, top: box.top, bottom: box.bottom, maxHeight: box.maxHeight }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {entries.map((entry, i) => (
            <Fragment key={`${i}-${entry.value}`}>
              {entry.group && entry.group !== entries[i - 1]?.group && <li role="presentation" className="bc-select-group">{entry.group}</li>}
              <li
                id={optionId(i)}
                role="option"
                aria-selected={entry.value === current}
                aria-disabled={entry.disabled || undefined}
                className={`bc-select-option${entry.value === current ? ' is-selected' : ''}${i === active ? ' is-active' : ''}${entry.disabled ? ' is-disabled' : ''}`}
                onMouseEnter={() => !entry.disabled && setActive(i)}
                onClick={() => choose(i)}
              >
                <span dir="auto">{entry.label}</span>
              </li>
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}
