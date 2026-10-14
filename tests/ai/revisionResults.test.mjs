import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAiService } from '../../server/ai-server.mjs';
import { aiTiles } from '../../src/lib/ai/contracts.ts';

// A paid full-plan revision answer must outlive the service process: results are recovered by
// status reads after a restart, never by a second provider call.
const headers = { Origin: 'http://127.0.0.1:5173', 'X-BetterCalc-AI': '1', 'Content-Type': 'application/json' };
const answer = { changes: [], coverageNotes: ['mock'] };
const usage = { input_tokens: 1000, output_tokens: 200, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 200 } };
const raw = () => ({ status: 'completed', model: 'gpt-6.1-sol', service_tier: 'default', usage,
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] });

function png(width, height) {
  const b = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b);
  b.write('IHDR', 12);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b.toString('base64');
}

function submission() {
  const [W, H] = [5500, 4400];
  const tiles = aiTiles(W, H);
  const overview = [2200, 1760];
  const manifest = {
    preparationVersion: 'revision-page-v1', comparisonId: 'c', revisionId: 'r', baseRevisionId: null, pageNumber: 1, context: 'design',
    sourceHash: 'a'.repeat(64), revisedHash: 'b'.repeat(64), nativeWidth: 1000, nativeHeight: 800, renderScale: 5.5,
    pageDimensions: [W, H], overviewDimensions: overview, tiles,
  };
  const images = ['BEFORE_PAGE', 'AFTER_PAGE', ...tiles.flatMap((t) => [`BEFORE_${t.tileId}`, `AFTER_${t.tileId}`])].map((name, i) => {
    const tile = i < 2 ? null : tiles[Math.floor((i - 2) / 2)];
    const [width, height] = tile ? [tile.tileWidth, tile.tileHeight] : overview;
    return { name, width, height, base64: png(width, height) };
  });
  return { task: 'revision-page-v1', requestId: `revision-${randomUUID()}`, manifest, images };
}

async function start(context, ledgerPath, fetchProvider) {
  const server = createAiService({ env: { OPENAI_API_KEY: 'mock-test-key' }, fetchProvider, ledgerPath });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    server,
    post: (path, body) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) }),
    status: (requestId) => fetch(`${base}/ai/revision-jobs?requestId=${requestId}`, { headers }),
  };
}

test('a finished full-plan revision result is recovered after a service restart without a new provider call', async (context) => {
  const dir = mkdtempSync(join(tmpdir(), 'bettercalc-revision-results-'));
  context.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledgerPath = join(dir, 'spending.json');
  let calls = 0;
  const first = await start(context, ledgerPath, async (_url, options) => {
    calls++;
    const request = JSON.parse(options.body);
    assert.deepEqual(request.prompt_cache_options, { mode: 'explicit' });
    assert.deepEqual(request.input[0].content[0].prompt_cache_breakpoint, { mode: 'explicit' });
    assert.ok(request.input[0].content.slice(1).every(block => !Object.hasOwn(block, 'prompt_cache_breakpoint')));
    return Response.json(raw());
  });
  const body = submission();
  const preview = await (await first.post('/ai/revision-previews', body)).json();
  assert.equal(preview.requestId, body.requestId);
  const admitted = await first.post('/ai/revision-jobs', { ...body, consent: { approved: true, approvedAt: Date.now(), previewId: preview.previewId, requestDigest: preview.requestDigest } });
  assert.equal(admitted.status, 202);
  let job;
  for (let i = 0; i < 100; i++) {
    job = await (await first.status(body.requestId)).json();
    if (job.status !== 'PROCESSING') break;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(job.status, 'COMPLETED');
  await new Promise((resolve) => first.server.close(resolve));

  const restarted = await start(context, ledgerPath, async () => { calls++; throw new Error('must not call the provider again'); });
  const recovered = await restarted.status(body.requestId);
  assert.equal(recovered.status, 200);
  const value = await recovered.json();
  assert.equal(value.status, 'COMPLETED');
  assert.equal(value.task, 'revision-page-v1');
  assert.equal(value.requestId, body.requestId);
  assert.deepEqual(value.result, answer);
  assert.deepEqual(value.metrics.usage, usage);
  assert.equal(value.metrics.inputTokens, 1000);
  assert.equal(value.metrics.outputTokens, 200);
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  assert.equal(ledger.length, 1);
  assert.deepEqual(ledger[0].metrics, value.metrics);
  assert.equal(ledger[0].charge, 0.0041);
  assert.equal(calls, 1);
});
