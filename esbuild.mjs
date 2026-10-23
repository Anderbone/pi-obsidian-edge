import { build } from 'esbuild';
const result = await build({ entryPoints: ['main.ts'], bundle: true, outfile: 'main.js', metafile: true,
  format: 'cjs', platform: 'browser', target: 'es2020', external: ['obsidian'],
  minify: true, legalComments: 'none' });
const computerOnly = Object.keys(result.metafile.inputs).filter(file => /^(bridge|dev)\//.test(file));
const unexpectedImports = Object.values(result.metafile.outputs).flatMap(output =>
  output.imports.filter(dependency => dependency.external && dependency.path !== 'obsidian'));
if (computerOnly.length || unexpectedImports.length) {
  throw new Error('The mobile plugin bundle must not include computer-only tools or Node.js dependencies.');
}
