import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const read = (file) => readFileSync(file, 'utf8');
const noticeName = /^(licen[sc]e|notice|copying|copyright|ofl)([._-]|$)/i;

/** Copy original shipped notices; no invented copyright holders or dates. */
export function thirdPartyNotices() {
  return {
    name: 'bettercalc-third-party-notices',
    generateBundle(_, bundle) {
      const dirs = new Set();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const moduleId of Object.keys(chunk.modules)) {
          if (!moduleId.includes('/node_modules/')) continue;
          let dir = path.dirname(moduleId.split('?')[0]);
          while (dir.includes('/node_modules/')) {
            if (existsSync(path.join(dir, 'package.json'))) { dirs.add(dir); break; }
            dir = path.dirname(dir);
          }
        }
      }
      // PDFium is emitted as a WASM asset rather than a rendered JavaScript module.
      dirs.add(path.join(root, 'node_modules/@embedpdf/pdfium'));
      const parts = ['BetterCalc — Third-party notices',
        'Original licence notices for packages represented in this browser build. Inclusion does not mean a service is enabled.',
        `Dependency lock SHA-256: ${createHash('sha256').update(read('package-lock.json')).digest('hex')}`];
      const records = [...dirs].map((dir) => ({ dir, pkg: JSON.parse(read(path.join(dir, 'package.json'))) }))
        .sort((a, b) => `${a.pkg.name}@${a.pkg.version}`.localeCompare(`${b.pkg.name}@${b.pkg.version}`));
      for (const { dir, pkg } of records) {
        parts.push(`\n${'='.repeat(72)}\n${pkg.name} ${pkg.version}\nDeclared licence: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license)}`);
        const files = readdirSync(dir).filter((f) => noticeName.test(f)).sort();
        if (!files.length && pkg.name !== '@pdf-lib/fontkit') throw new Error(`Missing bundled package notice: ${pkg.name}`);
        for (const file of files) parts.push(`\n--- ${file} ---\n${read(path.join(dir, file))}`);
        if (pkg.name === '@pdf-lib/fontkit') {
          // This published package has no LICENSE file. Preserve its own licence declaration,
          // package-supplied author attribution and embedded dependency legal comments verbatim.
          const readme = read(path.join(dir, 'README.md'));
          parts.push(`Repository: https://github.com/Hopding/fontkit\nAuthor (package metadata): ${pkg.author}\n${readme.slice(readme.lastIndexOf('## License'))}`);
          parts.push(read(path.join(root, 'scripts/license-sources/fontkit-mit-terms.txt')));
          const source = read(path.join(dir, 'dist/fontkit.umd.js'));
          const comments = source.match(/\/\*[\s\S]*?\*\/|(?:^[\t ]*\/\/[^\n]*(?:\n|$))+/gm) ?? [];
          parts.push('Embedded legal comments from distributed fontkit.umd.js:\n' + comments.filter((c) => /copyright|permission is hereby|licensed under/i.test(c)).join('\n\n'));
        }
      }
      // Keep the existing full PDFium notice and wrapper notice available separately too.
      this.emitFile({ type: 'asset', fileName: 'licenses/third-party-notices.txt', source: parts.join('\n\n') + '\n' });
    },
  };
}
