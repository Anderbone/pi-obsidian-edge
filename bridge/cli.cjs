#!/usr/bin/env node
// Preserve existing service commands while loading ESM-only runtime packages.
const { tsImport } = require('tsx/esm/api');
tsImport('./cli.mts', __filename).catch(error => { console.error(error); process.exitCode = 1; });
