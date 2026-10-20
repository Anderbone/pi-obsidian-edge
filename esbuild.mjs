import { build } from 'esbuild';
await build({ entryPoints: ['main.ts'], bundle: true, outfile: 'main.js',
  format: 'cjs', platform: 'browser', target: 'es2020', external: ['obsidian'],
  minify: true, legalComments: 'none' });
