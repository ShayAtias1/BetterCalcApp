/**
 * What a concrete or rebar zone says about itself on the plan - the same text on screen
 * (ConcreteZones / RebarZones) and in the exported PDF (lib/drawStructuralZones). Pure: the caller
 * passes the translator and number formatter of the language it writes in.
 */

import type { TranslateFn } from '../i18n';
import type { ConcreteElement, RebarMesh } from '../types/structural';
import { meshLevels, specNotation } from './rebarMesh';
import { markLabel } from './structuralMarks';
import { metersToCm } from './structuralUnits';

/** One colour for every concrete zone: a warm stone grey, apart from the room palette. */
export const CONCRETE_COLOR = '#78716c';
/** One colour for every rebar zone: a rust orange, apart from the room and concrete colours. */
export const REBAR_COLOR = '#c2410c';

/** Keeps a bar notation (`Ø12 @ 20`) reading left-to-right inside a right-to-left line, so its numbers do not reorder. */
const ltr = (text: string) => `⁦${text}⁩`;

/** `S-01 · 20 cm · B30`: the mark, the thickness (slab, cm) or height (m) once entered, and the grade. */
export function concreteZoneLabel(el: ConcreteElement, t: TranslateFn, formatNumber: (n: number) => string): string {
  const parts = [markLabel(el, t)];
  if (typeof el.depthM === 'number' && Number.isFinite(el.depthM) && el.depthM > 0) {
    parts.push(el.kind === 'slab' ? `${formatNumber(metersToCm(el.depthM)!)} ${t('units.cm')}` : `${formatNumber(el.depthM)} ${t('units.m')}`);
  }
  if (el.grade?.trim()) parts.push(el.grade.trim());
  return parts.join(' · ');
}

/** One line per level: `Bottom: Ø12 @ 20 - 2 directions` or `Top: Long Ø12@20 | Short Ø10@15`. Levels with nothing entered yet have a bare tag line. */
export function rebarLevelLines(mesh: RebarMesh, t: TranslateFn): { tag: string; text: string }[] {
  const out: { tag: string; text: string }[] = [];
  for (const { level, reinforcement: r } of meshLevels(mesh)) {
    const word = t(level === 'bottom' ? 'rebar.overlay.bottom' : 'rebar.overlay.top');
    const tag = t(level === 'bottom' ? 'rebar.overlay.bottomShort' : 'rebar.overlay.topShort');
    let body: string | null;
    if (r.mode === 'uniform') {
      const n = specNotation(r.spec);
      body = n ? `${ltr(n)} - ${t('rebar.overlay.both')}` : null;
    } else {
      const parts = [
        specNotation(r.long) && `${t('rebar.overlay.long')} ${ltr(specNotation(r.long)!.replace(' @ ', '@'))}`,
        specNotation(r.short) && `${t('rebar.overlay.short')} ${ltr(specNotation(r.short)!.replace(' @ ', '@'))}`,
      ].filter(Boolean);
      body = parts.length > 0 ? parts.join(' | ') : null;
    }
    out.push({ tag, text: body ? `${word}: ${body}` : `${word}:` });
  }
  return out;
}

/** The label rows of a mesh zone: its mark, then one line per level - or, on a narrow zone, the mark and a compact `B+T` tag. */
export function rebarZoneRows(mesh: RebarMesh, t: TranslateFn, compact: boolean): string[] {
  const lines = rebarLevelLines(mesh, t);
  const body = compact ? [lines.map((l) => l.tag).join('+')].filter(Boolean) : lines.map((l) => l.text);
  return [markLabel(mesh, t), ...body];
}
