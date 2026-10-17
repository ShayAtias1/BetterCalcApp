import type { PDFPageProxy } from 'pdfjs-dist';
import type { Plan } from '../../types';
import type { LayerTransform } from '../../types/compare';
import { loadComparePdfBlob, loadPdfBlob } from '../../db/database';
import { getPdfDocumentByKey, clearPdfCache } from '../pdfCache';
import { loadPdfPlanSource, type PlanPageSource, type PlanRenderHandle, type PlanTextItem } from '../planSource';
import { boundedPdfScale } from '../pdfRenderBudget';
import { viewerRenderCancelled } from '../pdfium/document';
import type { ViewerPageSource, ViewerRenderOptions } from '../pdfViewerSource';
import type { ViewerRegion } from '../pdfium/protocol';
import { alignmentMatrix } from './detect';

/**
 * The revision drawing shown behind a linked plan. The plan's own PDF stays the coordinate reference
 * and is never replaced: the revised sheet is drawn through the alignment its quantities were derived
 * with (`Plan.revisionBackdrop`), so measurements, rooms and calibration stay exactly where they are.
 */

export type DrawingChoice = 'revised' | 'original';

/** The drawing a plan is shown with, per plan; exports follow the same choice. Default: the revision. */
const choices = new Map<string, DrawingChoice>();
export function drawingChoice(planId: string): DrawingChoice { return choices.get(planId) ?? 'revised'; }
export function setDrawingChoice(planId: string, choice: DrawingChoice) { choices.set(planId, choice); }

/** The plan shows a revised drawing whose changes are not all in its quantities. */
export function revisionCoverage(plan: Pick<Plan, 'revisionBackdrop'> | null | undefined): { applied: number; total: number } | null {
  const c = plan?.revisionBackdrop?.coverage;
  return c && c.applied < c.total ? c : null;
}

/** An export must not pair the original drawing with quantities updated from a revision. */
export class RevisionDrawingMissingError extends Error {
  readonly code = 'revision-drawing-missing';
  constructor() { super('The revised drawing is unavailable'); }
}

/** Coverage the export must warn about: set when the revised drawing is what the page exports. */
export function exportCoverageWarning(plan: Plan, pageNumber: number): { applied: number; total: number } | null {
  return drawingChoice(plan.id) === 'revised' && hasRevisionDrawing(plan, pageNumber) ? revisionCoverage(plan) : null;
}

export type RevisionDrawing =
  | { status: 'none' }
  | { status: 'missing' }
  | { status: 'ok'; page: PDFPageProxy; alignment: LayerTransform };

const cacheKey = (b: { comparisonId: string; revisionId: string }) => `plan-backdrop:${b.comparisonId}:${b.revisionId}`;

/** True when the plan has a revision drawing for this page (it may still turn out to be missing). */
export function hasRevisionDrawing(plan: Pick<Plan, 'revisionBackdrop'> | null | undefined, pageNumber: number): boolean {
  return !!plan?.revisionBackdrop?.pages[pageNumber];
}

/** Loads the revised sheet of a page; a missing or unreadable file is reported, never thrown. */
export async function loadRevisionDrawing(plan: Pick<Plan, 'revisionBackdrop'>, pageNumber: number): Promise<RevisionDrawing> {
  const backdrop = plan.revisionBackdrop;
  const entry = backdrop?.pages[pageNumber];
  if (!backdrop || !entry) return { status: 'none' };
  const key = cacheKey(backdrop);
  try {
    const doc = await getPdfDocumentByKey(key, () => loadComparePdfBlob(backdrop.comparisonId, `revision:${backdrop.revisionId}`));
    return { status: 'ok', page: await doc.getPage(entry.revisedPageNumber), alignment: entry.alignment };
  } catch {
    // A failed load must not stay cached: the file may be restored later.
    clearPdfCache(key);
    return { status: 'missing' };
  }
}

export class AlignedRevisionPage implements PlanPageSource {
  private readonly matrix: ReturnType<typeof alignmentMatrix>;
  private readonly page: PDFPageProxy;
  private readonly size: { width: number; height: number };
  private readonly text: () => Promise<PlanTextItem[]>;

  constructor(page: PDFPageProxy, alignment: LayerTransform, size: { width: number; height: number }, text: () => Promise<PlanTextItem[]>) {
    this.page = page;
    this.size = size;
    this.text = text;
    const viewport = page.getViewport({ scale: 1 });
    // The same pivot and matrix the comparison used to derive the quantities.
    this.matrix = alignmentMatrix(alignment, { x: viewport.width / 2, y: viewport.height / 2 });
  }

  getNativeSize() { return this.size; }
  getTextItems() { return this.text(); }
  render(canvas: HTMLCanvasElement, scale: number, options: ViewerRenderOptions = {}): PlanRenderHandle {
    return this.draw(canvas, scale, { x: 0, y: 0, ...this.size }, true, options);
  }
  renderRegion(canvas: HTMLCanvasElement, scale: number, region: ViewerRegion, options: ViewerRenderOptions = {}): PlanRenderHandle {
    return this.draw(canvas, scale, region, false, options);
  }
  renderTinted(canvas: HTMLCanvasElement, scale: number, color: string): PlanRenderHandle {
    return this.draw(canvas, scale, { x: 0, y: 0, ...this.size }, true, { transparent: true, tint: color });
  }

  /** `region` is in the plan's page space; pdf.js draws the revised sheet straight through the alignment. */
  private draw(canvas: HTMLCanvasElement, desired: number, region: ViewerRegion, whole: boolean, options: ViewerRenderOptions): PlanRenderHandle {
    const scale = boundedPdfScale(region.width, region.height, desired);
    const width = Math.max(1, whole ? Math.floor(region.width * scale) : Math.ceil(region.width * scale));
    const height = Math.max(1, whole ? Math.floor(region.height * scale) : Math.ceil(region.height * scale));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { promise: Promise.reject(new Error('PDF viewer canvas context unavailable')), cancel: () => {} };
    const [a, b, c, d, e, f] = this.matrix;
    let cancelled = false;
    const task = this.page.render({
      canvasContext: ctx,
      canvas,
      viewport: this.page.getViewport({ scale: 1 }),
      transform: [a * scale, b * scale, c * scale, d * scale, (e - region.x) * scale, (f - region.y) * scale],
      background: options.transparent ? 'rgba(0,0,0,0)' : '#ffffff',
    });
    const promise = task.promise.then(() => {
      if (!options.tint) return;
      ctx.save();
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = options.tint;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }).catch((error) => { throw cancelled ? viewerRenderCancelled() : error; });
    return { promise, cancel: () => { cancelled = true; task.cancel(); } };
  }
}

/** The viewer's flavour: the page identity, rotation and AI preparation stay those of the original sheet. */
export class AlignedViewerPage extends AlignedRevisionPage implements ViewerPageSource {
  readonly pageNumber: number;
  readonly rotation: number;
  readonly numPages: number;
  private readonly base: ViewerPageSource;
  constructor(page: PDFPageProxy, alignment: LayerTransform, base: ViewerPageSource) {
    super(page, alignment, base.getNativeSize(), () => base.getTextItems());
    this.base = base;
    this.pageNumber = base.pageNumber;
    this.rotation = base.rotation;
    this.numPages = base.numPages;
  }
  prepareAiRaster() { return this.base.prepareAiRaster(); }
  /** The page is owned by the revision document cache and the original source by its own session. */
  release() {}
}

/** The drawing exports render for a plan page: the revision when the plan shows it, else the original. */
export async function loadPlanDrawing(plan: Plan, pageNumber: number): Promise<PlanPageSource> {
  const original = await loadPdfPlanSource(plan.id, () => loadPdfBlob(plan.id), pageNumber);
  if (drawingChoice(plan.id) === 'revised') {
    const drawing = await loadRevisionDrawing(plan, pageNumber);
    if (drawing.status === 'ok') {
      return new AlignedRevisionPage(drawing.page, drawing.alignment, original.source.getNativeSize(), () => original.source.getTextItems());
    }
    // Choosing Original is explicit; a revision that cannot be read is not.
    if (drawing.status === 'missing') throw new RevisionDrawingMissingError();
  }
  return original.source;
}
