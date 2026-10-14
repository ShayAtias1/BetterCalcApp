import type { Point } from '../../types';

export interface LabelBox { x: number; y: number; width: number; height: number }
export interface LabelBounds { left: number; top: number; right: number; bottom: number }

function overlap(a: LabelBox, b: LabelBox, gap = 0): number {
  return Math.max(0, Math.min(a.x + a.width + gap, b.x + b.width + gap) - Math.max(a.x - gap, b.x - gap))
    * Math.max(0, Math.min(a.y + a.height + gap, b.y + b.height + gap) - Math.max(a.y - gap, b.y - gap));
}

/** Bounds that never influence placement, so panning cannot reposition labels. */
export const UNBOUNDED: LabelBounds = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };

/**
 * Zoom used for label layout: quarter-octave steps at or below the real zoom. Layout reruns only when the
 * step changes; boxes laid out at this zoom are at least as large as the rendered ones, so bubbles shrunk
 * about their layout centre at the real zoom stay clear of each other and of geometry.
 */
export function layoutZoom(zoom: number): number {
  return 2 ** (Math.floor(Math.log2(zoom) * 4 + 1e-9) / 4);
}

/** Search locally in screen-sized steps. Viewport edges never become distant placement targets. */
export function placeRevisionLabel(tip: Point, width: number, height: number, zoom: number,
  occupied: LabelBox[], geometry: LabelBox[], bounds: LabelBounds, arrowPenalty?: (box: LabelBox) => number): Point {
  const gap = 8 / zoom;
  // The search widens only when a crowded cluster leaves no clear spot nearby.
  const radii = [128 / zoom, 192 / zoom, 256 / zoom];
  const radius = radii[radii.length - 1];
  const xs = [tip.x + gap, tip.x - width - gap, tip.x - width / 2];
  const ys = [tip.y - height - gap, tip.y + gap, tip.y - height / 2];
  for (let offset = width + gap; offset <= radius; offset += width + gap) {
    xs.push(tip.x + gap + offset, tip.x - width - gap - offset);
  }
  for (let offset = height + gap; offset <= radius; offset += height + gap) {
    ys.push(tip.y + gap + offset, tip.y - height - gap - offset);
  }
  const unbounded = !Number.isFinite(bounds.right - bounds.left) || !Number.isFinite(bounds.bottom - bounds.top);
  const viewport = { x: bounds.left, y: bounds.top, width: Math.max(0, bounds.right - bounds.left), height: Math.max(0, bounds.bottom - bounds.top) };
  const candidates = xs.flatMap(x => ys.map(y => ({ x, y, width, height }))).map(box => {
    const distance = Math.hypot(Math.max(box.x - tip.x, tip.x - box.x - width, 0), Math.max(box.y - tip.y, tip.y - box.y - height, 0));
    return { box, distance, labels: occupied.reduce((sum, other) => sum + overlap(box, other, 3 / zoom), 0),
      geometry: geometry.reduce((sum, other) => sum + overlap(box, other, 2 / zoom), 0) };
  }).filter(candidate => candidate.distance <= radius);
  const near = radii.map(r => candidates.filter(candidate => candidate.distance <= r))
    .find(pool => pool.some(candidate => candidate.labels === 0)) ?? candidates.filter(candidate => candidate.distance <= radii[0]);
  const clearLabels = near.filter(candidate => candidate.labels === 0);
  const clearGeometry = clearLabels.filter(candidate => candidate.geometry === 0);
  const pool = clearGeometry.length ? clearGeometry : clearLabels.length ? clearLabels : near;
  const score = (candidate: typeof candidates[number]) => candidate.distance * zoom
    + (candidate.labels * 120 + candidate.geometry * 40) / (width * height)
    + (unbounded ? 0 : (1 - overlap(candidate.box, viewport) / (width * height)) * 16)
    + (arrowPenalty?.(candidate.box) ?? 0);
  return pool.reduce((best, candidate) => score(candidate) < score(best) ? candidate : best).box;
}

/** Screen-px metrics of an expanded change description. */
export const NOTE_POPUP = { padding: 8, maxWidth: 280, titleSize: 10.5, titleLine: 14, bodySize: 10, bodyLine: 13, sectionGap: 3 } as const;

/**
 * Wrap text to a measured width. Words never overflow: a word wider than the line is split by character.
 * `measure` returns screen-px width; descriptions are never truncated.
 */
export function wrapNoteText(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const joined = line ? `${line} ${word}` : word;
    if (measure(joined) <= maxWidth) { line = joined; continue; }
    if (line) lines.push(line);
    line = '';
    for (const char of Array.from(word)) {
      if (line && measure(line + char) > maxWidth) { lines.push(line); line = ''; }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Popup content and size from measured text: wraps title and description inside the padded width,
 * limited by the viewport so the popup always fits on screen.
 */
export function layoutNotePopup(title: string, description: string, work: string, viewportWidth: number,
  measure: (text: string, size: number, bold: boolean) => number) {
  const { padding, maxWidth, titleSize, titleLine, bodySize, bodyLine, sectionGap } = NOTE_POPUP;
  // The white text halo (3 px stroke) and font fallback differences need a small allowance.
  const widthOf = (text: string, size: number, bold: boolean) => measure(text, size, bold) * 1.06 + 3;
  const inner = Math.max(60, Math.min(maxWidth, viewportWidth - 16) - padding * 2);
  const titleLines = wrapNoteText(title, inner, text => widthOf(text, titleSize, true));
  const lines = description ? wrapNoteText(description, inner, text => widthOf(text, bodySize, false)) : [];
  const content = Math.max(...titleLines.map(l => widthOf(l, titleSize, true)), ...lines.map(l => widthOf(l, bodySize, false)),
    work ? widthOf(work, bodySize, true) : 0);
  const width = Math.min(inner, content) + padding * 2;
  const height = padding * 2 + titleLines.length * titleLine + (lines.length ? sectionGap + lines.length * bodyLine : 0)
    + (work ? sectionGap + bodyLine : 0);
  return { titleLines, lines, width, height };
}
