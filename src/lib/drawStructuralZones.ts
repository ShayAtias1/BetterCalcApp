/**
 * Concrete and rebar zones rasterized onto the exported plan page - the canvas twin of
 * ConcreteZones / RebarZones (the text comes from lib/structuralOverlay, shared with the screen).
 * Concrete/Mesh keep their existing outlines and notation. Spatial Straight Bars reuse the same
 * prepared zone and actual bar lines as the UI. Mesh sheets are not drawn here. Points are native page pixels; `offsetY` is the header band above
 * the plan, `mult` the export scale.
 */

import type { ConcreteElement, RebarItem } from '../types/structural';
import type { Calibration, Plan } from '../types';
import { prepareStraightBarsOverlay } from './straightBarsOverlay';
import type { ExportContext } from './exportLanguage';
import { polygonCentroid } from './geometry';
import { labelDirection } from './textDirection';
import { CONCRETE_COLOR, REBAR_COLOR, concreteZoneLabel, rebarZoneRows } from './structuralOverlay';

const FONT = "'Segoe UI', sans-serif";

/** A rebar zone narrower than this (native px) cannot hold the level lines: it shows the mark and a B / T tag. */
export const REBAR_COMPACT_WIDTH_PX = 110;

type Pt = { x: number; y: number };

function tracePath(ctx: CanvasRenderingContext2D, points: Pt[], mult: number, offsetY: number) {
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = p.x * mult;
    const y = p.y * mult + offsetY;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

/** Text with a white halo so it reads over the plan; centred on (x, y). */
function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, weight: number, direction: 'rtl' | 'ltr') {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = direction;
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.3;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

export function drawConcreteZonesOnCanvas(ctx: CanvasRenderingContext2D, elements: ConcreteElement[], mult: number, offsetY: number, x: ExportContext) {
  for (const el of elements) {
    if (el.points.length < 3) continue;
    ctx.save();
    tracePath(ctx, el.points, mult, offsetY);
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = CONCRETE_COLOR;
    ctx.fill();
    // Hatch: diagonal lines clipped to the zone.
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = CONCRETE_COLOR;
    ctx.lineWidth = mult;
    const xs = el.points.map((p) => p.x * mult);
    const ys = el.points.map((p) => p.y * mult + offsetY);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const step = 7 * mult;
    ctx.beginPath();
    for (let k = minX - (maxY - minY); k < maxX; k += step) {
      ctx.moveTo(k, maxY);
      ctx.lineTo(k + (maxY - minY), minY);
    }
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
    tracePath(ctx, el.points, mult, offsetY);
    ctx.setLineDash([6 * mult, 3 * mult]);
    ctx.lineWidth = 2 * mult;
    ctx.strokeStyle = CONCRETE_COLOR;
    ctx.stroke();
    ctx.setLineDash([]);

    const label = concreteZoneLabel(el, x.t, x.number);
    const c = polygonCentroid(el.points);
    haloText(ctx, label, c.x * mult, c.y * mult + offsetY, 10.5 * mult, CONCRETE_COLOR, 600, labelDirection(label, x.language));
    ctx.restore();
  }
}

export function drawRebarZonesOnCanvas(ctx: CanvasRenderingContext2D, items: RebarItem[], mult: number, offsetY: number, x: ExportContext, calibration: Calibration | null = null, pageNumber?: number, pages?: Plan['pages']) {
  for (const m of items) {
    if (m.kind === 'bars') {
      const overlay = prepareStraightBarsOverlay(m, calibration, x.t, x.number, pageNumber ?? m.pageNumber, pages);
      if (!overlay.center) continue;
      ctx.save();
      ctx.strokeStyle = REBAR_COLOR;
      ctx.lineWidth = 2 * mult;
      if (overlay.points.length >= 3) {
        tracePath(ctx, overlay.points, mult, offsetY);
        ctx.globalAlpha = 0.03;
        ctx.fillStyle = REBAR_COLOR;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.setLineDash([3 * mult, 3 * mult]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      for (const line of overlay.lines) {
        ctx.beginPath();
        ctx.moveTo(line.start.x * mult, line.start.y * mult + offsetY);
        ctx.lineTo(line.end.x * mult, line.end.y * mult + offsetY);
        ctx.stroke();
      }
      overlay.rows.forEach((row, index) => haloText(ctx, row, overlay.center!.x * mult,
        (overlay.center!.y + index * 12) * mult + offsetY, 10.5 * mult, REBAR_COLOR, index === 0 ? 600 : 500, labelDirection(row, x.language)));
      ctx.restore();
      continue;
    }
    if (m.points.length < 3) continue;
    ctx.save();
    tracePath(ctx, m.points, mult, offsetY);
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = REBAR_COLOR;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.setLineDash([1.5 * mult, 3.5 * mult]);
    ctx.lineCap = 'round';
    ctx.lineWidth = 2 * mult;
    ctx.strokeStyle = REBAR_COLOR;
    ctx.stroke();
    ctx.setLineDash([]);

    const xs = m.points.map((p) => p.x);
    const compact = Math.max(...xs) - Math.min(...xs) < REBAR_COMPACT_WIDTH_PX;
    const rows = rebarZoneRows(m, x.t, compact);
    const c = polygonCentroid(m.points);
    const size = 10.5 * mult;
    const lineH = size * 1.2;
    const top = c.y * mult + offsetY - ((rows.length - 1) * lineH) / 2;
    rows.forEach((row, i) => {
      const direction = i === 0 ? labelDirection(row, x.language) : x.rtl && !compact ? 'rtl' : 'ltr';
      haloText(ctx, row, c.x * mult, top + i * lineH, i === 0 ? size : size * 0.92, REBAR_COLOR, i === 0 ? 600 : 500, direction);
    });
    ctx.restore();
  }
}
