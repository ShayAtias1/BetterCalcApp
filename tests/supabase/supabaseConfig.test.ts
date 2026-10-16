import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { isSecretKey, readSupabaseConfig, SupabaseConfigError } from '../../src/lib/supabase/supabaseConfig';

const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.sig`;

test('missing configuration means accounts are off, not an error', () => {
  assert.equal(readSupabaseConfig({}), null);
  assert.equal(readSupabaseConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co' }), null);
  assert.equal(readSupabaseConfig({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' }), null);
});

test('a valid configuration is normalised', () => {
  assert.deepEqual(readSupabaseConfig({ VITE_SUPABASE_URL: ' https://abc.supabase.co/ ', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' }), {
    url: 'https://abc.supabase.co', publishableKey: 'sb_publishable_abc',
  });
  assert.ok(readSupabaseConfig({ VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_PUBLISHABLE_KEY: jwt('anon') }));
});

test('secret and service-role keys are refused', () => {
  assert.equal(isSecretKey('sb_secret_abc'), true);
  assert.equal(isSecretKey(jwt('service_role')), true);
  assert.equal(isSecretKey(jwt('anon')), false);
  assert.equal(isSecretKey('sb_publishable_abc'), false);
  for (const key of ['sb_secret_abc', jwt('service_role')]) {
    assert.throws(() => readSupabaseConfig({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: key }), SupabaseConfigError);
  }
});

test('invalid or insecure URLs are refused', () => {
  const key = 'sb_publishable_abc';
  assert.throws(() => readSupabaseConfig({ VITE_SUPABASE_URL: 'nonsense', VITE_SUPABASE_PUBLISHABLE_KEY: key }), SupabaseConfigError);
  assert.throws(() => readSupabaseConfig({ VITE_SUPABASE_URL: 'http://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: key }), SupabaseConfigError);
});

test('the frontend source never references a secret Supabase key or env variable', () => {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name) && !path.endsWith('supabaseConfig.ts')) {
        const text = readFileSync(path, 'utf8');
        if (/SERVICE_ROLE|service_role|sb_secret_|SUPABASE_SECRET|VITE_SUPABASE_[A-Z_]*(SECRET|SERVICE)/.test(text)) hits.push(path);
      }
    }
  };
  walk(new URL('../../src', import.meta.url).pathname);
  assert.deepEqual(hits, []);
  const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  assert.doesNotMatch(example, /^\s*VITE_[A-Z_]*(SECRET|SERVICE)[A-Z_]*\s*=/m);
});
