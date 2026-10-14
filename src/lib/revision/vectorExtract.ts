import type { PDFPageProxy } from 'pdfjs-dist';
import { pdfjsLib } from '../pdfjsSetup';
import type { Point } from '../../types';

/**
 * Reads a PDF page's drawing operators into straight segments in native page px (scale 1, top-left
 * origin) — the vector half of revision change detection. Line weight, colour and dash pattern are
 * deliberately ignored: a revision re-exported with different pens must not look "changed".
 *
 * Text drawn with fonts is not part of the operator paths; it is read separately with its positions.
 */

type Matrix = [number, number, number, number, number, number];

/** A quarter arc (typically a door swing) recognised from one cubic Bézier. */
export interface VectorArc {
  center: Point;
  radius: number;
  start: Point;
  end: Point;
}

export interface VectorText {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VectorPage {
  width: number;
  height: number;
  /** x1,y1,x2,y2 per segment. */
  segments: Float32Array;
  /** 1 when the segment came from flattening a curve. */
  curve: Uint8Array;
  arcs: VectorArc[];
  texts: VectorText[];
  /** Share of the page area covered by raster images — high on scanned plans. */
  imageCoverage: number;
}

const MAX_SEGMENTS = 400_000;

function multiply(m1: Matrix, m2: Matrix): Matrix {
  return pdfjsLib.Util.transform(m1, m2) as Matrix;
}

function apply(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function quarterArc(p0: Point, p1: Point, p2: Point, p3: Point): VectorArc | null {
  const t0 = { x: p1.x - p0.x, y: p1.y - p0.y };
  const t3 = { x: p3.x - p2.x, y: p3.y - p2.y };
  const l0 = Math.hypot(t0.x, t0.y);
  const l3 = Math.hypot(t3.x, t3.y);
  if (l0 < 1e-6 || l3 < 1e-6) return null;
  // Tangents of a quarter circle at its ends are perpendicular.
  if (Math.abs((t0.x * t3.x + t0.y * t3.y) / (l0 * l3)) > 0.15) return null;
  // Centre: on the normal through p0 and on the normal through p3.
  // Solve p0 + s*n0 = p3 + u*n3 where n0 ⟂ t0, n3 ⟂ t3.
  const n0 = { x: -t0.y / l0, y: t0.x / l0 };
  const n3 = { x: -t3.y / l3, y: t3.x / l3 };
  const det = n0.x * -n3.y - n0.y * -n3.x;
  if (Math.abs(det) < 1e-6) return null;
  const rx = p3.x - p0.x;
  const ry = p3.y - p0.y;
  const s = (rx * -n3.y - ry * -n3.x) / det;
  const center = { x: p0.x + s * n0.x, y: p0.y + s * n0.y };
  const r0 = Math.hypot(p0.x - center.x, p0.y - center.y);
  const r3 = Math.hypot(p3.x - center.x, p3.y - center.y);
  if (r0 < 1 || Math.abs(r0 - r3) / Math.max(r0, r3) > 0.1) return null;
  return { center, radius: (r0 + r3) / 2, start: p0, end: p3 };
}

export async function extractVectorPage(page: PDFPageProxy): Promise<VectorPage> {
  const viewport = page.getViewport({ scale: 1 });
  const OPS = pdfjsLib.OPS;
  const list = await page.getOperatorList();
  const segs: number[] = [];
  const curve: number[] = [];
  const arcs: VectorArc[] = [];
  let imageArea = 0;
  let ctm: Matrix = viewport.transform.slice(0, 6) as Matrix;
  const stack: Matrix[] = [];

  const pushSeg = (a: Point, b: Point, isCurve: boolean) => {
    if (curve.length >= MAX_SEGMENTS) return;
    if (Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05) return;
    segs.push(a.x, a.y, b.x, b.y);
    curve.push(isCurve ? 1 : 0);
  };

  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = multiply(ctm, args as Matrix);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      const matrix = args?.[0] as Matrix | null;
      if (matrix) ctm = multiply(ctm, matrix);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
      imageArea += Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
    } else if (fn === OPS.constructPath) {
      const paintOp = args[0] as number;
      if (paintOp === OPS.endPath) continue; // a clipping path, never drawn
      const data = (args[1] as unknown[] | undefined)?.[0] as ArrayLike<number> | undefined;
      if (!data || typeof (data as { length?: number }).length !== 'number') continue;
      let start: Point | null = null;
      let current: Point | null = null;
      for (let k = 0; k < data.length; ) {
        const op = data[k++];
        if (op === 0) {
          current = apply(ctm, data[k++], data[k++]);
          start = current;
        } else if (op === 1) {
          const next = apply(ctm, data[k++], data[k++]);
          if (current) pushSeg(current, next, false);
          current = next;
        } else if (op === 2) {
          const c1 = apply(ctm, data[k++], data[k++]);
          const c2 = apply(ctm, data[k++], data[k++]);
          const end = apply(ctm, data[k++], data[k++]);
          if (current) {
            const arc = quarterArc(current, c1, c2, end);
            if (arc) arcs.push(arc);
            const chord = Math.hypot(end.x - current.x, end.y - current.y) + Math.hypot(c1.x - current.x, c1.y - current.y);
            const n = Math.min(16, Math.max(2, Math.ceil(chord / 6)));
            let prev = current;
            for (let s = 1; s <= n; s++) {
              const t = s / n;
              const u = 1 - t;
              const p = {
                x: u * u * u * current.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
                y: u * u * u * current.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
              };
              pushSeg(prev, p, true);
              prev = p;
            }
          }
          current = end;
        } else if (op === 3) {
          const c = apply(ctm, data[k++], data[k++]);
          const end = apply(ctm, data[k++], data[k++]);
          if (current) {
            pushSeg(current, c, true);
            pushSeg(c, end, true);
          }
          current = end;
        } else if (op === 4) {
          if (current && start) pushSeg(current, start, false);
          current = start;
        } else {
          break; // unknown drawing op: stop reading this path rather than misread its coordinates
        }
      }
    }
  }

  const texts: VectorText[] = [];
  try {
    const content = await page.getTextContent();
    for (const raw of content.items) {
      if (!('str' in raw) || !('transform' in raw)) continue;
      const str = raw.str.trim();
      if (!str) continue;
      const m = pdfjsLib.Util.transform(viewport.transform, raw.transform) as Matrix;
      const fontH = Math.hypot(m[2], m[3]) || raw.height || 4;
      const scaleX = Math.hypot(raw.transform[0], raw.transform[1]) || 1;
      const width = (raw.width / scaleX) * Math.hypot(m[0], m[1]) || str.length * fontH * 0.5;
      texts.push({ str, x: m[4], y: m[5] - fontH, width, height: fontH });
    }
  } catch {
    // Pages without a usable text layer are compared on drawing alone.
  }

  return {
    width: viewport.width,
    height: viewport.height,
    segments: Float32Array.from(segs),
    curve: Uint8Array.from(curve),
    arcs,
    texts,
    imageCoverage: Math.min(1, imageArea / Math.max(1, viewport.width * viewport.height)),
  };
}

/** Same segments mapped through a 2-D affine matrix (revised native px → source native px). */
export function transformVectorPage(page: VectorPage, m: Matrix): VectorPage {
  const out = new Float32Array(page.segments.length);
  for (let i = 0; i < out.length; i += 2) {
    const x = page.segments[i];
    const y = page.segments[i + 1];
    out[i] = m[0] * x + m[2] * y + m[4];
    out[i + 1] = m[1] * x + m[3] * y + m[5];
  }
  const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const map = (p: Point) => apply(m, p.x, p.y);
  return {
    ...page,
    segments: out,
    arcs: page.arcs.map((a) => ({ center: map(a.center), radius: a.radius * scale, start: map(a.start), end: map(a.end) })),
    texts: page.texts.map((t) => {
      const p = map({ x: t.x, y: t.y });
      return { ...t, x: p.x, y: p.y, width: t.width * scale, height: t.height * scale };
    }),
  };
}
