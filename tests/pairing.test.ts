import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePairing, validatePairing } from '../src/pairing';
const config = { url: 'ws://100.64.0.1:8771', token: 'test-token-with-at-least-24-characters' };
const code = 'pi-edge:v1:' + Buffer.from(JSON.stringify(config)).toString('base64url');
test('connection code and Obsidian link import the same connection', () => {
  assert.deepEqual(parsePairing(code), config);
  assert.deepEqual(parsePairing('obsidian://pi-edge?code=' + encodeURIComponent(code)), config);
});
test('rejects invalid codes, short tokens, foreign protocols and embedded credentials', () => {
  for (const value of ['', 'pi-edge:v1:invalid', 'other:v1:abc']) assert.throws(() => parsePairing(value));
  for (const url of ['https://100.64.0.1', 'ws://user:pass@host', 'ws://host/?token=secret', 'ws://host/unexpected']) assert.throws(() => validatePairing({ ...config, url }));
  assert.throws(() => validatePairing({ ...config, token: 'short' }));
});
