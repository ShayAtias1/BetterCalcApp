import type { ReactNode } from 'react';

/** Reuse the existing detail presentation, including its calculated results, without authoring. */
export default function ReviewFields({ readOnly, children }: { readOnly: boolean; children: ReactNode }) {
  return <fieldset className="review-fields" disabled={readOnly}
    onClickCapture={readOnly ? (e) => { e.preventDefault(); e.stopPropagation(); } : undefined}
    onPointerDownCapture={readOnly ? (e) => { e.stopPropagation(); } : undefined}>
    {children}
  </fieldset>;
}
