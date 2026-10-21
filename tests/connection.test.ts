import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkConnection } from '../src/connection';
import type { SocketLike } from '../src/client';

class Socket implements SocketLike {
  readyState = 0; sent: unknown[] = []; closed = false;
  onopen: SocketLike['onopen'] = null; onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null; onerror: SocketLike['onerror'] = null;
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.closed = true; }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
const pairing = { url: 'wss://pi.example.com/edge', token: 'private-token+/' };

test('connection test waits for an authenticated protocol reply and sends no prompt or session', async () => {
  const socket = new Socket(); let address = '';
  const pending = checkConnection(pairing, undefined, url => { address = url; return socket; });
  assert.equal(address, 'wss://pi.example.com/edge/rpc?token=private-token%2B%2F');
  socket.onopen?.();
  assert.deepEqual(socket.sent, [{ type: 'edge.ping', protocol: 1 }]);
  socket.message({ type: 'edge.pong', protocol: 1 });
  await pending;
  assert.equal(socket.closed, true);
  assert.equal(socket.onmessage, null);
});

test('pairing failures and unreachable bridges show actionable errors without leaking credentials', async () => {
  for (const code of [4001, 4003, 1006]) {
    const socket = new Socket();
    const pending = checkConnection(pairing, undefined, () => socket);
    socket.onclose?.({ code });
    await assert.rejects(pending, error => error instanceof Error && !error.message.includes(pairing.token) && /Pairing|Update|closed/.test(error.message));
    assert.equal(socket.closed, true);
  }
  await assert.rejects(checkConnection(pairing, undefined, () => { throw new Error(pairing.token); }), /Could not open/);
});

test('tests time out and can be cancelled when connection settings change or the plugin unloads', async () => {
  const socket = new Socket();
  await assert.rejects(checkConnection(pairing, undefined, () => socket, 5), /timed out/);
  assert.equal(socket.closed, true);
  const controller = new AbortController();
  const pending = checkConnection(pairing, controller.signal, () => socket);
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(socket.onopen, null);
});
