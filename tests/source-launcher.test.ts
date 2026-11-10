import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('source service launcher supports lazy OAuth refresh with compiled dependencies', async () => {
  const result = await promisify(execFile)(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    process.argv = [process.execPath, 'bridge/cli.cjs', '--help'];
    require('./bridge/cli.cjs');
    (async () => {
      await import('./bridge/durable.mts');
      const { openaiProvider } = await import('@earendil-works/pi-ai/providers/openai');
      const oauth = openaiProvider().auth.oauth;
      let refreshed = false;
      globalThis.fetch = async () => { refreshed = true; return new Response(JSON.stringify({access_token:'new-access', refresh_token:'new-refresh', expires_in:3600,scope:'openid offline_access chatgpt.tokens.use.direct'}), {status:200,headers:{'content-type':'application/json'}}); };
      const credential = await oauth.refresh({type:'oauth',access:'expired',refresh:'old-refresh',expires:0,clientId:'test-issued-client'}, new AbortController().signal);
      assert.ok(refreshed);
      assert.equal(credential.access, 'new-access');
      assert.equal((await oauth.toAuth(credential)).apiKey, 'new-access');
      console.log('OAUTH_REFRESH_OK');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], { cwd: new URL('..', import.meta.url), timeout: 15000 });
  assert.match(result.stdout, /OAUTH_REFRESH_OK/);
});
