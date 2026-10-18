import { build } from 'vite';
import { copyFileSync } from 'node:fs';
await build();
copyFileSync('dist/licenses/third-party-notices.txt', 'public/licenses/third-party-notices.txt');
console.log('Updated public browser-build third-party notices.');
