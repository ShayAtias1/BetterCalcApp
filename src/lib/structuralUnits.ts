/**
 * Unit conversion at the form boundary. The data and the calculation engines keep metres; the forms
 * for a slab's thickness and a rebar spacing speak centimetres, as the people filling them in do.
 * Rounded to four decimals so a stored 0.2 m reads back as exactly 20 cm, never 20.000000000000004.
 */

import { round } from './geometry';

/** Metres → centimetres for display in a field; undefined stays undefined (not entered). */
export const metersToCm = (m: number | undefined): number | undefined => (m === undefined || !Number.isFinite(m) ? undefined : round(m * 100, 4));

/** Centimetres typed in a field → metres for storage; undefined stays undefined. */
export const cmToMeters = (cm: number | undefined): number | undefined => (cm === undefined || !Number.isFinite(cm) ? undefined : cm / 100);
