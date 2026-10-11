import { useEffect, useState } from 'react';

/** A number field that can be empty or half-typed ("0.") without fighting the stored value. */
export default function NumberField({ value, onChange, step = '0.01', precision }: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  step?: string;
  /** Display only: a stored value is shown with this many decimals. The value itself is never rounded. */
  precision?: number;
}) {
  const shown = (v: number | undefined) => (v === undefined ? '' : precision === undefined ? String(v) : v.toFixed(precision));
  const [draft, setDraft] = useState(shown(value));
  // Follow the stored value when it changes from elsewhere (undo, another element) — but not while
  // the draft already parses to it, so typing "0." is never rewritten to "0".
  useEffect(() => {
    const parsed = draft.trim() === '' ? undefined : Number(draft);
    if (parsed !== value) setDraft(shown(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="number"
      inputMode="decimal"
      min="0"
      step={step}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const text = e.target.value.trim();
        if (text === '') return onChange(undefined);
        const n = Number(text);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}
