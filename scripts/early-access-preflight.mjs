/** Read-only release gate. Never applies migrations, changes flags, deploys or prints env values. */
import { readFileSync } from 'node:fs';
import { loadEnv } from 'vite';
import { LEGAL_CONTENT, legalDocumentStrings, legalPlaceholders } from '../src/lib/legal/legalContent.ts';
import { LEGAL_DOC_VERSION } from '../src/lib/legal/legalDocs.ts';
import { ACCESS_ENFORCEMENT_ENABLED, ACCOUNTS_ENABLED, CLOUD_BACKUP_ENABLED } from '../src/lib/access/accessPolicy.ts';

const errors = [];
const fail = (message) => errors.push(message);
const env = { ...loadEnv('production', process.cwd(), ''), ...process.env };
if (LEGAL_DOC_VERSION === 'pending') fail('Legal version is still pending: owner approval is required.');
for (const [kind, langs] of Object.entries(LEGAL_CONTENT)) for (const [lang, doc] of Object.entries(langs)) {
  if (legalPlaceholders(doc).length) fail(`${kind}/${lang}: unresolved facts remain.`);
  if (/\.invalid\b/.test(legalDocumentStrings(doc).join('\n'))) fail(`${kind}/${lang}: development contact remains.`);
}
if (CLOUD_BACKUP_ENABLED) fail('Cloud backup must remain unavailable.');
if (!ACCOUNTS_ENABLED) fail('Accounts must be available before trial enforcement.');
if (env.EARLY_ACCESS_STAGE !== 'policies' && !ACCESS_ENFORCEMENT_ENABLED) fail('Guest trial activation is awaiting final release approval.');
if (!/export const ANALYTICS_ENABLED = false;/.test(readFileSync('src/lib/analytics.ts', 'utf8'))) fail('Product analytics must remain disabled.');
const publicNames = new Set(['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_TURNSTILE_SITE_KEY', 'VITE_AI_DEV_TOOLS']);
for (const [name, value] of Object.entries(env)) {
  if (!value) continue;
  if (name.startsWith('VITE_') && !publicNames.has(name) && !/POSTHOG|ANALYTICS|TRACKING/.test(name)) fail(`Unreviewed public build variable ${name}.`);
  if (/^VITE_.*(POSTHOG|ANALYTICS|TRACKING)/.test(name)) fail(`Remove tracking variable ${name}.`);
  if (/^VITE_.*(SECRET|SERVICE_ROLE|OPENAI_API_KEY)/.test(name)) fail(`Unsafe browser variable ${name}.`);
  if (name === 'VITE_AI_DEV_TOOLS' && value === 'true') fail('AI development tools must be disabled.');
}
try {
  const url = new URL(env.VITE_SUPABASE_URL);
  if (url.protocol !== 'https:' || /localhost|127\.0\.0\.1/.test(url.hostname)) throw new Error();
} catch { fail('A valid HTTPS production Supabase URL is required.'); }
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
if (!key) fail('A Supabase publishable key is required.');
else if (key.startsWith('sb_secret_')) fail('A server secret cannot be used as a publishable key.');
else if (!key.startsWith('sb_publishable_')) {
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    if (payload.role !== 'anon') throw new Error();
  } catch { fail('The legacy public key must have the anon role.'); }
}
try {
  const notices = readFileSync('public/licenses/third-party-notices.txt', 'utf8');
  if (!notices.includes('PDFium') || notices.includes('MISSING NOTICE')) throw new Error();
} catch { fail('Generate and verify third-party notices before release.'); }
if (errors.length) {
  console.error('BLOCKED — public Early Access release prerequisites:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else console.log(`Local release prerequisites passed (${LEGAL_DOC_VERSION}). Backend version/flags and owner release approval still require verification.`);
