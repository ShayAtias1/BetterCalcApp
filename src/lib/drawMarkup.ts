import type { Markup } from '../types';
import { arrowHeadPoints, cloudPath } from './geometry';
import { dimensionChainGeometry, dimensionStyleFor } from './dimensionChain';

const FONT = "'BetterCalc Numbers', 'Segoe UI', sans-serif";

/**
 * Draw order for a set of markups: masks first, so a block that hides part of the plan never
 * hides the annotations drawn on top of it.
 */
export function orderMarkups<T extends { tool: string }>(markups: T[]): T[] {
  return [...markups].sort((a, b) => Number(a.tool !== 'mask') - Number(b.tool !== 'mask'));
}

/**
 * Rasterizes one markup onto a 2D canvas context, matching the on-screen SVG rendering
 * (see MarkupShape in PdfViewer.tsx / CompareCanvas.tsx). `offsetX`/`offsetY` are in native
 * page coordinates (subtracted before scaling) — used when the canvas only covers a cropped region.
 */
export function drawMarkupOnCanvas(ctx: CanvasRenderingContext2D, markup: Markup, mult: number, offsetX: number, offsetY: number) {
  const tx = (x: number) => (x - offsetX) * mult;
  const ty = (y: number) => (y - offsetY) * mult;
  const pts = markup.points.map((p) => ({ x: tx(p.x), y: ty(p.y) }));
  const strokeW = 2 * mult;
  const fontScale = markup.fontScale ?? 1;

  ctx.save();
  // The on-screen overlay SVG is pinned to direction="rtl", so text is laid out and anchored
  // right-to-left there — the canvas has to match, or labels land on the wrong side of their point.
  ctx.direction = 'rtl';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  switch (markup.tool) {
    case 'arrow': {
      const [a, b] = pts;
      ctx.strokeStyle = markup.color;
      ctx.lineWidth = strokeW * 1.3;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const head = arrowHeadPoints(a, b, strokeW * 8)
        .split(' ')
        .map((pair) => {
          const [x, y] = pair.split(',').map(Number);
          return { x, y };
        });
      ctx.fillStyle = markup.color;
      ctx.beginPath();
      head.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'mask': {
      // Solid fill only — the dashed outline is an on-screen editing aid, not part of the output.
      const [a, b] = pts;
      ctx.fillStyle = markup.color;
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      break;
    }
    case 'rectangle': {
      const [a, b] = pts;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      ctx.fillStyle = markup.color;
      ctx.globalAlpha = 0.1;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = markup.color;
      ctx.lineWidth = strokeW * 1.3;
      ctx.strokeRect(x, y, w, h);
      break;
    }
    case 'dimension': {
      // Mirrors components/DimensionShape.tsx: one line through every stop, a tick at each stop, a
      // centimetre value above each measured segment and — for a chain — an overall dimension line.
      const fontSize = strokeW * 6 * fontScale;
      // The line weight scales with the label size too, so a small dimension isn't drawn with a heavy line.
      const lineW = strokeW * fontScale;
      const geo = dimensionChainGeometry(pts, dimensionStyleFor(fontSize), (markup.offset ?? 0) * mult, markup.flipped);
      if (!geo) break;
      const angleRad = (geo.angleDeg * Math.PI) / 180;
      const segment = (s: { from: { x: number; y: number }; to: { x: number; y: number } }) => {
        ctx.beginPath();
        ctx.moveTo(s.from.x, s.from.y);
        ctx.lineTo(s.to.x, s.to.y);
        ctx.stroke();
      };
      const drawLabel = (text: string, at: { x: number; y: number }) => {
        ctx.save();
        ctx.translate(at.x, at.y);
        ctx.rotate(angleRad);
        ctx.font = `italic ${fontSize}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = markup.color;
        ctx.fillText(text, 0, 0);
        ctx.restore();
      };

      ctx.strokeStyle = markup.color;
      ctx.lineWidth = lineW * 0.6;
      geo.extensions.forEach(segment);
      ctx.lineWidth = lineW;
      ctx.beginPath();
      geo.line.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      geo.ticks.forEach(segment);

      const labels = markup.segmentTexts ?? (markup.text && pts.length === 2 ? [markup.text] : []);
      labels.forEach((label, i) => {
        const seg = geo.segments[i];
        if (seg && label) drawLabel(label, seg.labelPos);
      });

      if (geo.total) {
        segment(geo.total.line);
        geo.total.ticks.forEach(segment);
        if (markup.text) drawLabel(markup.text, geo.total.labelPos);
      }
      break;
    }
    case 'cloud': {
      const path = new Path2D(cloudPath(pts, 14 * strokeW));
      ctx.fillStyle = markup.color;
      ctx.globalAlpha = 0.08;
      ctx.fill(path);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = markup.color;
      ctx.lineWidth = strokeW * 1.3;
      ctx.stroke(path);
      break;
    }
    case 'text': {
      const [a] = pts;
      if (markup.text) {
        const fontSize = strokeW * 6.5 * fontScale;
        ctx.save();
        ctx.translate(a.x, a.y);
        if (markup.rotationDeg) ctx.rotate((markup.rotationDeg * Math.PI) / 180);
        ctx.font = `italic ${fontSize}px ${FONT}`;
        // TextNoteShape's text-anchor="start" under direction="rtl" puts the anchor at the text's right edge.
        ctx.textAlign = 'right';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = markup.color;
        markup.text.split('\n').forEach((line, i) => ctx.fillText(line, 0, i * fontSize * 1.25));
        ctx.restore();
      }
      break;
    }
  }

  ctx.restore();
}
