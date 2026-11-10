#!/usr/bin/env node
// Register globally: scoped tsImport adds a query to dependency URLs, which
// breaks Pi AI's OAuth loader when it chooses compiled .js versus source .ts.
require('tsx/esm/api').register();
import('./cli.mts').catch(error => { console.error(error); process.exitCode = 1; });
