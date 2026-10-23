import './browser-timers';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EdgeClient, type SocketLike } from '../src/client';
import type { ClientPacket, ClientEvent, EventPacket, ReadyPacket } from '../shared/protocol';
const ready: ReadyPacket = { type: 'edge.ready', protocol: 1, sessionId: 'session-a', agent: 'pi', agents: [], tools: 'read', permissions: 'read', permissionModes: [{ id: 'read', label: 'Read only' }], cwdLabel: 'test' };
class Socket implements SocketLike {
  readyState = 0; sent: ClientPacket[] = [];
  onopen: SocketLike['onopen'] = null; onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null; onerror: SocketLike['onerror'] = null;
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
function setup() {
  const sockets: Socket[] = [], events: ClientEvent[] = [], states: string[] = [];
  const client = new EdgeClient({ url: 'ws://100.64.0.1:8771', token: 'test-token-24-characters-long' }, 'test-client-123', {
    status: state => states.push(state), event: event => events.push(event)
  }, () => { const socket = new Socket(); sockets.push(socket); return socket; });
  return { client, sockets, events, states };
}
test('connects through a secure reverse-proxy path and encodes the token', () => {
  let address = '';
  const client = new EdgeClient({ url: 'wss://pi.example.com/edge', token: 'token+/=' }, 'client-proxy', { status() {}, event() {} }, url => {
    address = url; return new Socket();
  });
  client.connect();
  assert.equal(address, 'wss://pi.example.com/edge/rpc?token=token%2B%2F%3D');
  client.disconnect();
});
test('queues first prompt including images until bridge readiness, not only WebSocket open', t => {
  const { client, sockets } = setup(); t.after(() => client.disconnect());
  client.send('prompt', { message: 'hi', images: [{ data: 'abc', mimeType: 'image/png' }] });
  client.connect(); assert.equal(sockets.length, 1);
  const socket = sockets[0]; socket.open();
  assert.deepEqual(socket.sent.map(message => message.type), ['edge.hello']);
  socket.message(ready);
  assert.deepEqual(socket.sent.map(message => message.type), ['edge.hello', 'prompt']);
  const prompt = socket.sent[1]; assert.ok(prompt.type === 'prompt');
  assert.deepEqual(prompt.images, [{ data: 'abc', mimeType: 'image/png' }]);
});
test('replayed event IDs are delivered only once per session', t => {
  const { client, sockets, events } = setup(); t.after(() => client.disconnect()); client.connect();
  const socket = sockets[0]; socket.open();
  const event: EventPacket = { type: 'edge.event', seq: 1, sessionId: 'session-a', event: { kind: 'message', id: 'reply', role: 'assistant', text: 'hi', final: true } };
  socket.message(event); socket.message(event); socket.message({ ...event, sessionId: 'session-b' });
  assert.equal(events.length, 2);
});
test('closed/stale socket callbacks cannot send old queued prompts', () => {
  const { client, sockets } = setup(); client.send('prompt', { message: 'old' });
  const old = sockets[0]; client.disconnect(); client.connect();
  old.open(); old.message(ready);
  assert.deepEqual(old.sent, []);
  sockets[1].open(); sockets[1].message(ready);
  assert.deepEqual(sockets[1].sent.map(message => message.type), ['edge.hello']);
  client.disconnect();
});
test('invalid pairing closes without retrying or retaining queued commands', () => {
  const { client, sockets, states } = setup(); client.send('prompt', { message: 'hi' });
  sockets[0].onclose?.({ code: 4001 }); assert.equal(states.at(-1), 'error'); client.disconnect();
});
