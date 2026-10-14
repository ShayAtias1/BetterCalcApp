import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { revisionPageModelRequest, revisionModelRequest, REVISION_PAGE_IMAGE_NAMES } from '../../server/revision-pipeline.mjs';

// Captured before the cache-policy change: all model inputs and settings must remain identical.
const before = {
  design: {
    page: 'ed44366de2dcfb6e10151dc161e3f9672bd2186813298b34c35f5bae9f6155d6',
    region: 'da49989064436bf7bc8d7b4a6850b6952b0f2d43ea0fc2fff719a0822176c061',
  },
  construction: {
    page: 'c1516ad9851785f9922181f333600b2e33ef03bbc957a10f525489fbca0232e2',
    region: '1a92fe385bd9f5d35ee23d33a87c5ae1be6da2fc8939f9c1d6a0b3ef97a0cf08',
  },
};
const images = REVISION_PAGE_IMAGE_NAMES.map((name, i) => ({ name, width: i < 2 ? 2200 : 3022, height: i < 2 ? 1760 : 2418, base64: 'cG5n' + i }));

for (const context of ['design', 'construction']) {
  test(`${context} revision requests cache only the reusable prefix without changing analysis inputs`, () => {
    const requests = {
      page: revisionPageModelRequest(images, { context }),
      region: revisionModelRequest([{ name: 'C1', width: 600, height: 400, base64: 'cG5n' }], { context, candidates: [{ name: 'C1', note: 'wall moved' }] }),
    };
    for (const [task, request] of Object.entries(requests)) {
      assert.deepEqual(request.prompt_cache_options, { mode: 'explicit' });
      const content = request.input[0].content;
      assert.equal(content[0].type, 'input_text');
      assert.deepEqual(content[0].prompt_cache_breakpoint, { mode: 'explicit' });
      assert.ok(content.slice(1).every(block => !Object.hasOwn(block, 'prompt_cache_breakpoint')));
      if (task === 'page') assert.equal(content.filter(block => block.type === 'input_image').length, 10);
      const original = structuredClone(request);
      delete original.prompt_cache_options;
      delete original.input[0].content[0].prompt_cache_breakpoint;
      assert.equal(createHash('sha256').update(JSON.stringify(original)).digest('hex'), before[context][task]);
    }
    const changedImages = images.map(image => ({ ...image, base64: image.base64 + 'changed' }));
    const changed = revisionPageModelRequest(changedImages, { context });
    assert.deepEqual(changed.input[0].content[0], requests.page.input[0].content[0]);
    assert.ok(changed.input[0].content.slice(1).every(block => !Object.hasOwn(block, 'prompt_cache_breakpoint')));
  });
}
