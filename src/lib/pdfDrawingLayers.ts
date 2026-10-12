import type { OverlayVisibility } from './overlayVisibility';

export const PDF_DRAWING_LAYERS = ['architectural', 'finishes', 'concrete', 'rebar'] as const;
export type PdfDrawingLayer = typeof PDF_DRAWING_LAYERS[number];
export interface PdfDrawingOptions {
  drawingMode?: 'combined' | 'separate';
  drawingLayers?: readonly PdfDrawingLayer[];
}

/** The original combined drawing remains the default; each separate layer uses the same source. */
export function pdfDrawingPages(overlays: OverlayVisibility, options: PdfDrawingOptions = {}) {
  if (options.drawingMode !== 'separate') return [{ layer: null, overlays }];
  return PDF_DRAWING_LAYERS.filter(layer => (options.drawingLayers ?? PDF_DRAWING_LAYERS).includes(layer)).map(layer => ({
    layer,
    overlays: {
      finishes: layer === 'finishes', concrete: layer === 'concrete', rebar: layer === 'rebar',
      measurements: layer === 'finishes' && overlays.measurements,
      markups: layer === 'finishes' && overlays.markups,
    },
  }));
}
