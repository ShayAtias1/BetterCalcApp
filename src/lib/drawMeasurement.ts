import type { Point } from '../types';
import { polygonCentroid, tickMarkEndpoints } from './geometry';
import { translatorFor, type Language } from '../i18n';
import { labelDirection } from './textDirection';
import { measurementLabel, type MeasurementValueFields } from './measurementValues';

const FONT = "'Segoe UI', sans-serif";
const PLAIN_COLOR = '#0ea5e9';

/** Structural shape shared by both apps' Measurement types (quantity-takeoff and Revision Compare). */
export interface MeasurementShape extends MeasurementValueFields {
  points: Point[];
  areaKind?: 'demolition' | 'construction';
  calcMode?: 'footprint' | 'wall';
}

/**
 * Rasterizes one measurement onto a 2D canvas context, matching the on-screen SVG rendering
 * (see PdfViewer.tsx / CompareCanvas.tsx): a distance gets a line with end ticks and its value
 * rotated to follow the line; area/perimeter get a filled polygon with a centered label — except
 * kind-tagged areas, which carry their value in the exported table instead, and show only a
 * numbered badge in 'wall' calc mode. `offsetX`/`offsetY` are in native page coordinates
 * (subtracted before scaling) — used when the canvas only covers a cropped region.
 */
export function drawMeasurementOnCanvas(
  ctx: CanvasRenderingContext2D,
  m: MeasurementShape,
  mult: number,
  offsetX: number,
  offsetY: number,
  /** The export's language: the label's unit and its reading direction (never the UI's). */
  language: Language,
  color = PLAIN_COLOR,
  number?: number
) {
  if (m.points.length < 2) return;
  const tx = (x: number) => (x - offsetX) * mult;
  const ty = (y: number) => (y - offsetY) * mult;
  const pts = m.points.map((p) => ({ x: tx(p.x), y: ty(p.y) }));
  const isDistance = m.tool === 'distance' || (m.tool === 'area' && m.points.length === 2);
  const isKindArea = m.tool === 'area' && !!m.areaKind;
  const isWall = m.tool === 'area' && m.calcMode === 'wall';
  const strokeW = 2 * mult;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = strokeW;

  let labelX: number;
  let labelY: number;
  let angleRad = 0;

  if (isDistance) {
    const [a, b] = m.points;
    ctx.beginPath();
    ctx.moveTo(tx(a.x), ty(a.y));
    ctx.lineTo(tx(b.x), ty(b.y));
    ctx.stroke();
    const tickLen = 14;
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      const [t1, t2] = tickMarkEndpoints(from, to, tickLen);
      ctx.beginPath();
      ctx.moveTo(tx(t1.x), ty(t1.y));
      ctx.lineTo(tx(t2.x), ty(t2.y));
      ctx.stroke();
    }

    // Offset the label to the side of the line that points "up", so it never sits on the line itself.
    const segDx = b.x - a.x;
    const segDy = b.y - a.y;
    const segLen = Math.hypot(segDx, segDy) || 1;
    let perpX = -segDy / segLen;
    let perpY = segDx / segLen;
    if (perpY > 0) {
      perpX = -perpX;
      perpY = -perpY;
    }
    labelX = tx((a.x + b.x) / 2 + perpX * 12);
    labelY = ty((a.y + b.y) / 2 + perpY * 12);
    let deg = (Math.atan2(segDy, segDx) * 180) / Math.PI;
    if (deg > 90) deg -= 180;
    if (deg < -90) deg += 180;
    angleRad = (deg * Math.PI) / 180;
  } else {
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.globalAlpha = isKindArea ? 0.28 : 0.12;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
    if (m.tool !== 'area') {
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 * mult, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const centroid = polygonCentroid(m.points);
    labelX = tx(centroid.x);
    labelY = ty(centroid.y);
  }

  // Kind-tagged footprint areas are identified by color + the exported table, not by an on-plan label.
  if (!isKindArea || isWall) {
    if (isWall) {
      ctx.beginPath();
      ctx.arc(labelX, labelY, 9 * mult, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
    }
    // Match the on-screen overlay's labels: a Hebrew export lays `3.24 מ'` out RTL as the overlay always
    // has, an English one `3.24 m` LTR (see labelDirection); the anchor itself is centered, same as
    // text-anchor="middle" there.
    const text = isWall ? `${number ?? ''}` : measurementLabel(m, translatorFor(language));
    ctx.direction = labelDirection(text, language);
    ctx.font = `bold ${12 * mult}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (angleRad) {
      ctx.translate(labelX, labelY);
      ctx.rotate(angleRad);
      ctx.fillText(text, 0, 0);
    } else {
      ctx.fillText(text, labelX, labelY);
    }
  }

  ctx.restore();
}
