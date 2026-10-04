/** Viewer raster limits, independent of canonical scale=1 plan coordinates.
 * 8 million RGBA pixels are 32 MB per canvas; PDF.js may use extra working surfaces.
 * Keep base/detail/standby allocations bounded rather than enlarging an A0 bitmap.
 */
export const PDF_RENDER_BUDGET = {
  maxPixels: 8_000_000,
  maxDimension: 4096,
  initialMaxScale: 4,
  settleDelayMs: 220,
  detailMarginScreenPx: 64,
} as const;

export function currentPdfDpr(): number {
  const value = window.devicePixelRatio;
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function boundedPdfScale(width: number, height: number, desired: number): number {
  if (![width, height, desired].every((v) => Number.isFinite(v) && v > 0)) {
    throw new Error('Invalid PDF raster dimensions or density');
  }
  let scale = Math.min(desired,
    Math.sqrt(PDF_RENDER_BUDGET.maxPixels / width / height),
    PDF_RENDER_BUDGET.maxDimension / Math.max(width, height));
  // Include integer canvas rounding in the budget, without modifying native dimensions.
  while (Math.ceil(width * scale) * Math.ceil(height * scale) > PDF_RENDER_BUDGET.maxPixels ||
    Math.ceil(width * scale) > PDF_RENDER_BUDGET.maxDimension ||
    Math.ceil(height * scale) > PDF_RENDER_BUDGET.maxDimension) scale *= 0.999;
  return scale;
}

export function initialPdfScale(width: number, height: number): number {
  return boundedPdfScale(width, height,
    Math.min(PDF_RENDER_BUDGET.initialMaxScale, Math.max(2, currentPdfDpr() * 2)));
}
