// Lets `node --test` load the app's TypeScript sources as they are written for Vite: Node strips the
// types itself (erasableSyntaxOnly keeps that possible), and this hook resolves the extensionless
// and directory imports (`./quantities`, `../types`) that Vite resolves on its own.
// Browser-only packages listed in STUBS, and Vite `?url` asset imports, resolve to a test stand-in instead.
import { registerHooks } from 'node:module';

const RETRY = new Set(['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT']);
const STUBS = { 'file-saver': new URL('./stubs/file-saver.mjs', import.meta.url).href };

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(STUBS, specifier)) return { url: STUBS[specifier], shortCircuit: true };
    // Vite asset imports (`file.js?url`) have no meaning in Node.
    if (specifier.endsWith('?url')) return { url: new URL('./stubs/vite-url.mjs', import.meta.url).href, shortCircuit: true };
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (!RETRY.has(err?.code) || !(specifier.startsWith('.') || specifier.startsWith('/'))) throw err;
      for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
        try {
          return nextResolve(candidate, context);
        } catch {
          // try the next candidate
        }
      }
      throw err;
    }
  },
});
