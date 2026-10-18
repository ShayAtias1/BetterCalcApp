import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Read-only gate: a public build must fail safely without leaking supplied credentials.
test('release gate rejects draft documents, tracking and a server key without printing values', () => {
  const fakeSecret = 'sb_secret_release_test_never_real';
  const fakeTracking = 'tracking-test-value-not-for-logs';
  const result = spawnSync(process.execPath, ['scripts/early-access-preflight.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, VITE_SUPABASE_PUBLISHABLE_KEY: fakeSecret, VITE_POSTHOG_KEY: fakeTracking },
  });
  assert.equal(result.status, 1);
  const output = result.stdout + result.stderr;
  assert.match(output, /Legal version is still pending/);
  assert.match(output, /Remove tracking variable VITE_POSTHOG_KEY/);
  assert.match(output, /server secret/);
  assert.ok(!output.includes(fakeSecret));
  assert.ok(!output.includes(fakeTracking));
});
