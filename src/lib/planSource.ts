import type { PDFPageProxy } from 'pdfjs-dist';
import { pdfjsLib } from './pdfjsSetup';
import { getPdfDocumentByKey } from './pdfCache';

export interface PlanRenderHandle {
  promise: Promise<void>;
  cancel: () => void;
}

/** A piece of text extracted from the plan, positioned in native (scale=1, top-left origin) px coords. */
export interface PlanTextItem {
  str: string;
  x: number;
  y: number;
}

/**
 * Abstraction over "a single page of a plan file" that the viewers render from.
 * Today only PDF (via pdf.js) is implemented; a future `DwgPlanSource` can implement
 * the same interface without touching any viewer/canvas code.
 */
export interface PlanPageSource {
  getNativeSize(): { width: number; height: number };
  /** Render the page as-is (original colors) at the given scale. */
  render(canvas: HTMLCanvasElement, scale: number): PlanRenderHandle;
  /** Render the page as a solid-color silhouette (transparent background, ink recolored). */
  renderTinted(canvas: HTMLCanvasElement, scale: number, color: string): PlanRenderHandle;
  /** Extract positioned text (native scale=1 coords) — used e.g. by room detection to name rooms. Empty for sources without a text layer. */
  getTextItems(): Promise<PlanTextItem[]>;
}

export class PdfPlanSource implements PlanPageSource {
  private page: PDFPageProxy;

  constructor(page: PDFPageProxy) {
    this.page = page;
  }

  /** The underlying pdf.js page, for analyses that read drawing operators (revision change detection). */
  get pdfPage(): PDFPageProxy {
    return this.page;
  }

  getNativeSize() {
    const vp = this.page.getViewport({ scale: 1 });
    return { width: vp.width, height: vp.height };
  }

  render(canvas: HTMLCanvasElement, scale: number): PlanRenderHandle {
    const viewport = this.page.getViewport({ scale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { promise: Promise.resolve(), cancel: () => {} };
    const task = this.page.render({ canvasContext: ctx, viewport, canvas });
    return {
      promise: task.promise.then(() => undefined).catch(() => undefined),
      cancel: () => task.cancel(),
    };
  }

  async getTextItems(): Promise<PlanTextItem[]> {
    const viewport = this.page.getViewport({ scale: 1 });
    const content = await this.page.getTextContent();
    const items: PlanTextItem[] = [];
    for (const raw of content.items) {
      // TextMarkedContent entries have no `transform`/`str`; skip them.
      if (!('str' in raw) || !('transform' in raw)) continue;
      const str = raw.str.trim();
      if (!str) continue;
      // Compose the item's own transform with the viewport transform to get top-left-origin px coords.
      const m = pdfjsLib.Util.transform(viewport.transform, raw.transform);
      items.push({ str, x: m[4], y: m[5] });
    }
    return items;
  }

  renderTinted(canvas: HTMLCanvasElement, scale: number, color: string): PlanRenderHandle {
    const viewport = this.page.getViewport({ scale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { promise: Promise.resolve(), cancel: () => {} };
    let cancelled = false;
    const task = this.page.render({ canvasContext: ctx, viewport, canvas, background: 'rgba(0,0,0,0)' });
    const promise = task.promise
      .then(() => {
        if (cancelled) return;
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
      })
      .catch(() => undefined);
    return {
      promise,
      cancel: () => {
        cancelled = true;
        task.cancel();
      },
    };
  }
}

export async function loadPdfPlanSource(
  cacheKey: string,
  loadBlob: () => Promise<Blob | undefined>,
  pageNumber: number
): Promise<{ source: PdfPlanSource; numPages: number }> {
  const doc = await getPdfDocumentByKey(cacheKey, loadBlob);
  const page = await doc.getPage(pageNumber);
  return { source: new PdfPlanSource(page), numPages: doc.numPages };
}
