const { buildSync } = require('esbuild');
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const bundle = buildSync({ entryPoints: [path.join(__dirname, 'preview.ts')], bundle: true, format: 'iife', write: false, platform: 'browser' }).outputFiles[0].contents;
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pi Edge UI preview</title><link rel="stylesheet" href="/styles.css"><style>body{margin:0;background:#111114;color:#e9e7ef}#app{height:100dvh;max-width:460px;margin:auto;border-inline:1px solid #303036}textarea,button,select{font:inherit}select option{background:#202024}button{cursor:pointer}</style></head><body><main id="app"></main><script src="/preview.js"></script></body></html>';
createServer((req, res) => {
  if (req.url === '/preview.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle); }
  else if (req.url === '/styles.css') { res.setHeader('Content-Type', 'text/css'); res.end(readFileSync(path.join(root, 'styles.css'))); }
  else { res.setHeader('Content-Type', 'text/html'); res.end(html); }
}).listen(8781, '127.0.0.1', () => console.log('UI preview: http://127.0.0.1:8781 (no model requests)'));
