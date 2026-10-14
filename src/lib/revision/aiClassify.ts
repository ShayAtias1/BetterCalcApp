import { v4 as uuid } from 'uuid';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { Comparison } from '../../types/compare';
import { IDENTITY_TRANSFORM } from '../../types/compare';
import type { RevisionAiLabel, RevisionChange, RevisionPageAnalysis, RevisionSegment } from '../../types/revisionAnalysis';
import { loadComparePdfBlob } from '../../db/database';
import { loadPdfPlanSource } from '../planSource';
import { alignmentMatrix, baseRevisionOf } from './detect';

/**
 * AI classification of locally detected candidate regions — semantic labels only.
 *
 * Each candidate is sent as one small before/after image with the locally found lines tinted; the
 * model answers per image name (C1…C12) with a category, whether the change is meaningful and a
 * one-line summary. It never returns coordinates or quantities, and its answer only re-ranks
 * proposals: approval and every quantity remain local and deterministic.
 *
 * The request lifecycle follows the openings task: a priced preview, explicit consent bound to the
 * exact prepared payload, a durable request identity saved before admission, and recovery by free
 * status reads only — a paid request is never resubmitted.
 */

export const MAX_AI_CANDIDATES = 12;
const HALF_W = 540;
const HALF_H = 500;
const HEADER = 22;

type Matrix = [number, number, number, number, number, number];

export interface RevisionAiPreview {
  task: 'revision-v1';
  previewId: string;
  requestId: string;
  requestDigest: string;
  expiresAt: number;
  estimatedCostUsd: number;
  reservationUsd: number;
}

interface Submission {
  task: 'revision-v1';
  requestId: string;
  manifest: {
    preparationVersion: 'revision-crops-v1';
    comparisonId: string;
    revisionId: string;
    pageNumber: number;
    context: 'design' | 'construction';
    candidates: { name: string; note: string }[];
  };
  images: { name: string; width: number; height: number; base64: string }[];
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-BetterCalc-AI': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('ai-unreachable');
  }
  let value: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(await response.text());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    value = parsed as Record<string, unknown>;
  } catch {
    // Not a definitive rejection: a lost admission must stay recoverable, so no status is attached.
    throw new Error('ai-invalid-response');
  }
  if (!response.ok) throw Object.assign(new Error(typeof value.error === 'string' ? value.error : 'ai-failed'), { status: response.status });
  return value as T;
}

export async function checkRevisionAiService(): Promise<void> {
  const health = await request<{ supportedTasks?: string[]; configured?: boolean }>('/ai/health');
  if (!health.supportedTasks?.includes('revision-v1')) throw new Error('ai-outdated');
  if (!health.configured) throw new Error('ai-not-configured');
}

/** Which proposals are worth a label: unlabelled, still open, strongest first, minus annotation-only noise. */
export function aiCandidates(analysis: RevisionPageAnalysis): RevisionChange[] {
  return analysis.changes
    .filter((c) => !c.ai && (c.status === 'pending' || c.status === 'approved'))
    .filter((c) => !(c.category === 'annotation' && c.significance === 'low'))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_AI_CANDIDATES);
}

async function pageOf(comparisonId: string, layer: string, pageNumber: number): Promise<PDFPageProxy> {
  const { source } = await loadPdfPlanSource(`compare-detect:${comparisonId}:${layer}`, () => loadComparePdfBlob(comparisonId, layer), pageNumber);
  return source.pdfPage;
}

async function renderCrop(page: PDFPageProxy, m: Matrix | null, x0: number, y0: number, k: number, w: number, h: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas-unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const b: Matrix = m ?? [1, 0, 0, 1, 0, 0];
  const transform: Matrix = [k * b[0], k * b[1], k * b[2], k * b[3], k * (b[4] - x0), k * (b[5] - y0)];
  await page.render({ canvasContext: ctx, canvas, viewport: page.getViewport({ scale: 1 }), transform }).promise;
  return canvas;
}

function tint(ctx: CanvasRenderingContext2D, segments: RevisionSegment[], color: string, x0: number, y0: number, k: number, dx: number, dy: number) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  for (const s of segments) {
    ctx.moveTo(dx + (s.x1 - x0) * k, dy + (s.y1 - y0) * k);
    ctx.lineTo(dx + (s.x2 - x0) * k, dy + (s.y2 - y0) * k);
  }
  ctx.stroke();
  ctx.restore();
}

function noteFor(c: RevisionChange): string {
  const parts = [`category ${c.category}`, `change ${c.kind}`, `evidence ${c.evidence.join(', ') || 'none'}`];
  if (c.walls.length) parts.push(`${c.walls.length} parallel-line wall run(s)`);
  if (c.doors.length) parts.push(`${c.doors.length} door swing arc(s)`);
  if (c.textChanges) parts.push(`text before [${c.textChanges.before.join(' | ')}] after [${c.textChanges.after.join(' | ')}]`);
  return parts.join('; ').slice(0, 300);
}

/** Builds the before/after candidate images. Nothing is sent anywhere here. */
export async function prepareRevisionAiRequest(comparison: Comparison, revisionId: string, pageKey: number, candidates: RevisionChange[]): Promise<Submission> {
  const revision = comparison.revisions.find((r) => r.id === revisionId);
  if (!revision) throw new Error('revision-missing');
  const base = baseRevisionOf(comparison, revision);
  const page = comparison.pages[pageKey];
  const rp = page?.revisions[revisionId];
  const analysis = revision.analysis?.pages[pageKey];
  const revisedPage = await pageOf(comparison.id, `revision:${revisionId}`, rp?.revisedPageNumber ?? pageKey);
  const bp = base ? page?.revisions[base.id] : undefined;
  const basePage = base
    ? await pageOf(comparison.id, `revision:${base.id}`, bp?.revisedPageNumber ?? pageKey)
    : await pageOf(comparison.id, 'original', page?.originalPageNumber ?? pageKey);
  const pivot = (p: PDFPageProxy) => {
    const vp = p.getViewport({ scale: 1 });
    return { x: vp.width / 2, y: vp.height / 2 };
  };
  const revMatrix = alignmentMatrix(analysis?.usedAlignment ?? rp?.alignment ?? IDENTITY_TRANSFORM, pivot(revisedPage));
  const baseMatrix = base ? alignmentMatrix(bp?.alignment ?? IDENTITY_TRANSFORM, pivot(basePage)) : null;

  const images: Submission['images'] = [];
  const notes: Submission['manifest']['candidates'] = [];
  for (const [i, c] of candidates.entries()) {
    const name = `C${i + 1}`;
    const cx = c.bbox.x + c.bbox.width / 2;
    const cy = c.bbox.y + c.bbox.height / 2;
    const rw = Math.max(c.bbox.width * 1.6, 120);
    const rh = Math.max(c.bbox.height * 1.6, 120);
    const k = Math.min(HALF_W / rw, HALF_H / rh, 4);
    const w = Math.round(Math.min(HALF_W, rw * k));
    const h = Math.round(Math.min(HALF_H, rh * k));
    const x0 = cx - w / k / 2;
    const y0 = cy - h / k / 2;
    const [before, after] = await Promise.all([
      renderCrop(basePage, baseMatrix, x0, y0, k, w, h),
      renderCrop(revisedPage, revMatrix, x0, y0, k, w, h),
    ]);
    const out = document.createElement('canvas');
    out.width = w * 2 + 20;
    out.height = h + HEADER;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('canvas-unavailable');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`${name} BEFORE`, 6, 16);
    ctx.fillText(`${name} AFTER`, w + 26, 16);
    ctx.drawImage(before, 0, HEADER);
    ctx.drawImage(after, w + 20, HEADER);
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(w + 8, HEADER, 4, h);
    tint(ctx, c.removedSegments, '#dc2626', x0, y0, k, 0, HEADER);
    tint(ctx, c.addedSegments, '#16a34a', x0, y0, k, w + 20, HEADER);
    const base64 = out.toDataURL('image/png').split(',')[1];
    images.push({ name, width: out.width, height: out.height, base64 });
    notes.push({ name, note: noteFor(c) });
    before.width = before.height = after.width = after.height = 0;
  }
  return {
    task: 'revision-v1',
    requestId: `revision-${uuid()}`,
    manifest: {
      preparationVersion: 'revision-crops-v1',
      comparisonId: comparison.id,
      revisionId,
      pageNumber: pageKey,
      context: comparison.context ?? 'design',
      candidates: notes,
    },
    images,
  };
}

export async function previewRevisionAi(body: Submission): Promise<RevisionAiPreview> {
  const preview = await request<RevisionAiPreview>('/ai/revision-previews', body);
  if (preview.task !== 'revision-v1' || preview.requestId !== body.requestId || !/^[a-f0-9]{64}$/.test(preview.requestDigest ?? '') ||
      !Number.isFinite(preview.estimatedCostUsd) || !(preview.expiresAt > Date.now())) throw new Error('ai-invalid-preview');
  return preview;
}

export interface RevisionJobResponse {
  task: 'revision-v1';
  id: string;
  requestId: string;
  requestDigest: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  result?: unknown;
  error?: string;
}

export function submitRevisionAi(body: Submission, preview: RevisionAiPreview): Promise<RevisionJobResponse> {
  return request<RevisionJobResponse>('/ai/revision-jobs', {
    ...body,
    consent: { approved: true, approvedAt: Date.now(), previewId: preview.previewId, requestDigest: preview.requestDigest },
  });
}

export function findRevisionAiJob(requestId: string): Promise<RevisionJobResponse> {
  return request<RevisionJobResponse>(`/ai/revision-jobs?requestId=${encodeURIComponent(requestId)}`);
}

const CATEGORIES = new Set(['wall', 'door', 'window', 'room-boundary', 'opening-other', 'dimension', 'text', 'furniture', 'fixture', 'hatch', 'structure', 'mep', 'noise', 'other']);
const TYPES = new Set(['added', 'removed', 'moved', 'modified', 'none']);

/** Validates the labels against the request's image names; anything malformed is dropped, not guessed. */
export function parseRevisionLabels(result: unknown, changeIds: string[]): Map<string, RevisionAiLabel> {
  const labels = new Map<string, RevisionAiLabel>();
  const list = (result as { changes?: unknown })?.changes;
  if (!Array.isArray(list)) throw new Error('ai-invalid-result');
  for (const raw of list) {
    const item = raw as Record<string, unknown>;
    const match = /^C(\d+)$/.exec(String(item.name ?? ''));
    const id = match ? changeIds[Number(match[1]) - 1] : undefined;
    if (!id || labels.has(id) || !CATEGORIES.has(String(item.category)) || !TYPES.has(String(item.changeType)) ||
        typeof item.meaningful !== 'boolean' || typeof item.confidence !== 'number' || !Number.isFinite(item.confidence)) continue;
    labels.set(id, {
      category: item.category as RevisionAiLabel['category'],
      changeType: item.changeType as RevisionAiLabel['changeType'],
      meaningful: item.meaningful,
      confidence: Math.min(1, Math.max(0, item.confidence)),
      summary: typeof item.summary === 'string' ? item.summary.slice(0, 200) : '',
    });
  }
  return labels;
}

/**
 * Applies AI labels to proposals. AI only re-ranks: a confident "not meaningful" demotes a proposal
 * out of the default list, a confident confirmation can promote one with real local evidence. It
 * never deletes a proposal and never changes geometry.
 */
export function mergeRevisionLabels(analysis: RevisionPageAnalysis, labels: Map<string, RevisionAiLabel>): RevisionPageAnalysis {
  return {
    ...analysis,
    changes: analysis.changes.map((c) => {
      const ai = labels.get(c.id);
      if (!ai) return c;
      const next: RevisionChange = { ...c, ai, evidence: c.evidence.filter((e) => e !== 'ai-confirmed' && e !== 'ai-not-meaningful') };
      if (c.status !== 'pending') return next;
      if (!ai.meaningful && ai.confidence >= 0.6) {
        next.significance = 'low';
        next.score = Math.round(c.score * 500) / 1000;
        next.evidence.push('ai-not-meaningful');
      } else if (ai.meaningful && ai.confidence >= 0.75) {
        next.evidence.push('ai-confirmed');
        next.score = Math.min(1, Math.round((c.score + 0.1) * 1000) / 1000);
        if (c.significance === 'medium' && c.category !== 'annotation' && c.category !== 'unknown') next.significance = 'high';
        else if (c.significance === 'low' && ai.confidence >= 0.8) next.significance = 'medium';
      }
      return next;
    }),
  };
}
