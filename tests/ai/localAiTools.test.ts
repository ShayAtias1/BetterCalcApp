import test from 'node:test';
import assert from 'node:assert/strict';
import { localAiToolsEnabled, LOCAL_AI_TOOLS } from '../../src/lib/access/localAiTools.ts';

test('local AI tools work in development without a separate opt-in, with an explicit opt-out', () => {
  for (const hostname of ['localhost', '127.0.0.1']) {
    assert.equal(localAiToolsEnabled(true, hostname), true);
    assert.equal(localAiToolsEnabled(true, hostname, 'true'), true);
    assert.equal(localAiToolsEnabled(true, hostname, 'false'), false);
    assert.equal(localAiToolsEnabled(false, hostname, 'true'), false);
  }
});

test('a flag never opens AI tools on production or non-loopback development hosts', () => {
  for (const hostname of ['bettercalcapp.netlify.app', 'localhost.example.com', '192.168.1.1', '']) {
    assert.equal(localAiToolsEnabled(true, hostname, 'true'), false);
    assert.equal(localAiToolsEnabled(false, hostname, 'true'), false);
  }
  assert.equal(LOCAL_AI_TOOLS, false, 'Node/test execution must not implicitly enable browser tools');
});
