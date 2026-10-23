import './browser-timers';
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
test('malformed or foreign probe replies cannot report a successful connection', async () => {
  const socket = new Socket(); let connected = false;
  const pending = checkConnection(pairing, undefined, () => socket).then(() => { connected = true; });
  for (const value of [null, 42, 'edge.pong', [], { type: 'edge.pong', protocol: 2 }]) socket.message(value);
  await Promise.resolve();
  assert.equal(connected, false);
  socket.message({ type: 'edge.pong', protocol: 1 }); await pending;
  assert.equal(connected, true);
});

test('pairing failures and unreachable bridges show actionable errors without leaking credentials', async () => {
  for (const code of [4001, 4003, 1006]) {
    const socket = new Socket();
    const pending = checkConnection(pairing, undefined, () => socket);
    socket.onclose?.({ code });
    await assert.rejects(pending, error => error instanceof Error && !error.message.includes(pairing.token) && /Pairing|closed/.test(error.message));
    assert.equal(socket.closed, true);
  }
  await assert.rejects(checkConnection(pairing, undefined, () => { throw new Error(pairing.token); }), /Could not open/);
});

test('older bridges pass via authenticated health after rejecting the newer WebSocket probe', async () => {
  for (const base of ['ws://192.168.1.20:8771', 'wss://pi.example.com/edge']) {
    const socket = new Socket(); let address = '';
    const pending = checkConnection({ ...pairing, url: base }, undefined, () => socket, 8000, async url => {
      address = url; return { status: 200, json: { ok: true, protocol: 1 } };
    });
    socket.onopen?.(); socket.onclose?.({ code: 4003 });
    await pending;
    const health = new URL(address);
    assert.equal(health.protocol, base.startsWith('wss:') ? 'https:' : 'http:');
    assert.equal(health.pathname, base.includes('/edge') ? '/edge/health' : '/health');
    assert.equal(health.searchParams.get('token'), pairing.token);
    assert.equal(socket.closed, true);
    assert.deepEqual(socket.sent, [{ type: 'edge.ping', protocol: 1 }]);
  }
});

test('legacy fallback requires an authenticated protocol response and never bypasses an auth failure', async () => {
  for (const response of [
    { status: 401, json: {} }, { status: 200, json: { ok: false, protocol: 1 } },
    { status: 200, json: { ok: true, protocol: 2 } }, { status: 200, json: null },
    { status: 404, json: { ok: true, protocol: 1 } }
  ]) {
    const socket = new Socket();
    const pending = checkConnection(pairing, undefined, () => socket, 8000, async () => response);
    socket.onclose?.({ code: 4003 });
    await assert.rejects(pending, /Pairing|valid connection test response/);
  }
  const socket = new Socket(); let calls = 0;
  const pending = checkConnection(pairing, undefined, () => socket, 8000, async () => { calls++; return { status: 200, json: { ok: true, protocol: 1 } }; });
  socket.onclose?.({ code: 4001 });
  await assert.rejects(pending, /Pairing expired/);
  assert.equal(calls, 0);
});

test('cancelling a pending legacy health check cannot turn a stale test green', async () => {
  const socket = new Socket(); const controller = new AbortController();
  let healthReady!: (response: { status: number; json: unknown }) => void;
  const pending = checkConnection(pairing, controller.signal, () => socket, 8000,
    () => new Promise(resolve => { healthReady = resolve; }));
  socket.onclose?.({ code: 4003 }); controller.abort();
  await assert.rejects(pending, /cancelled/);
  healthReady({ status: 200, json: { ok: true, protocol: 1 } });
  await Promise.resolve();
  assert.equal(socket.onmessage, null);
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
