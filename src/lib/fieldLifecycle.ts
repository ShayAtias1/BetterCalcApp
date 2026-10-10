/** Presentation-only signal: discard uncommitted previews before resetting transient tool state. */
export const FIELD_OPERATION_CANCEL = 'bettercalc-field-operation-cancel';
export function cancelFieldOperation() {
  window.dispatchEvent(new Event(FIELD_OPERATION_CANCEL));
}
