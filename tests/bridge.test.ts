import './browser-timers';
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn, type SpawnOptionsWithoutStdio } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { WebSocket, type RawData } from 'ws';
import { createBridge, type BridgeOptions } from '../bridge/server.mts';
import { getAgent } from '../bridge/agents.mts';
import type { AgentEvent, ServerPacket } from '../shared/protocol';
import { EdgeClient, type SocketLike } from '../src/client';

const directory = path.dirname(fileURLToPath(import.meta.url));
const token = 'test-token-never-a-real-device-credential';
const packet = (raw: RawData): ServerPacket => JSON.parse(raw.toString()) as ServerPacket;
async function setup(t: TestContext, extra: Partial<BridgeOptions> = {}) {
  const launches: { executable: string; args: string[]; options: SpawnOptionsWithoutStdio }[] = [];
  const bridge = createBridge({ cwd: directory, token, graceMs: 3000, ...extra, spawn: (executable, args, options) => {
    launches.push({ executable, args, options });
    return spawn(process.execPath, [path.join(directory, 'fake-pi.cjs')], { ...options, stdio: 'pipe' });
  } });
  const address = await bridge.listen(0, '127.0.0.1');
  t.after(() => bridge.close());
  return { bridge, launches, url: `ws://127.0.0.1:${address.port}`, http: `http://127.0.0.1:${address.port}` };
}
async function connect(url: string, clientId: string = crypto.randomUUID()) {
  const ws = new WebSocket(`${url}/rpc?token=${token}`);
  const messages: ServerPacket[] = [];
  ws.on('message', raw => messages.push(packet(raw)));
  await once(ws, 'open');
  const ready = waitFor(ws, 'edge.ready');
  // Extra launch fields are deliberately hostile test input; the bridge ignores them.
  ws.send(JSON.stringify({ type: 'edge.hello', protocol: 1, clientId, agent: 'pi', cwd: '/untrusted', args: ['--tools', 'bash'] }));
  await ready;
  return { ws, messages, clientId };
}
function waitFor<K extends ServerPacket['type']>(ws: WebSocket, type: K,
  predicate: (value: Extract<ServerPacket, { type: K }>) => boolean = () => true): Promise<Extract<ServerPacket, { type: K }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', handler); reject(new Error('Event timeout')); }, 4000);
    const handler = (raw: RawData) => {
      const data = packet(raw);
      if (data.type !== type) return;
      const matched = data as Extract<ServerPacket, { type: K }>;
      if (predicate(matched)) { clearTimeout(timer); ws.off('message', handler); resolve(matched); }
    };
    ws.on('message', handler);
  });
}
function waitForEvent<K extends AgentEvent['kind']>(ws: WebSocket, kind: K,
  predicate: (event: Extract<AgentEvent, { kind: K }>) => boolean = () => true): Promise<Extract<AgentEvent, { kind: K }>> {
  return waitFor(ws, 'edge.event', value => value.event.kind === kind && predicate(value.event as Extract<AgentEvent, { kind: K }>))
    .then(value => value.event as Extract<AgentEvent, { kind: K }>);
}

test('authentication protects HTTP and WebSocket endpoints', async t => {
  const { url, http } = await setup(t);
  assert.equal((await fetch(http + '/health')).status, 401);
  assert.equal((await fetch(http + '/health?token=' + token)).status, 200);
  const ws = new WebSocket(url + '/rpc?token=wrong');
  const closed = once(ws, 'close'); await once(ws, 'open');
  assert.equal((await closed)[0], 4001);
});
test('authenticated connection tests use the WebSocket route without launching a Pi session', async t => {
  const { url, launches } = await setup(t);
  const ws = new WebSocket(`${url}/rpc?token=${token}`); t.after(() => ws.terminate());
  await once(ws, 'open');
  const reply = waitFor(ws, 'edge.pong');
  ws.send(JSON.stringify({ type: 'edge.ping', protocol: 1 }));
  assert.equal((await reply).protocol, 1);
  assert.equal(launches.length, 0);
});
test('typed plugin client exchanges protocol 1 messages with the migrated bridge', { timeout: 5000 }, async t => {
  const { url, launches } = await setup(t);
  let receive!: (text: string) => void;
  const reply = new Promise<string>(resolve => { receive = resolve; });
  const client = new EdgeClient({ url, token }, 'typed-client-integration', {
    status() {},
    event(event) { if (event.kind === 'message' && event.role === 'assistant') receive(event.text); }
  }, address => new WebSocket(address) as unknown as SocketLike, 'read');
  t.after(() => client.disconnect());
  client.send('prompt', { message: 'Hello from the plugin' });
  assert.equal(await reply, 'OK\u2028still one event');
  assert.equal(launches.length, 1);
  assert.equal(launches[0].args[launches[0].args.indexOf('--tools') + 1], 'read,grep,find,ls');
});
test('untrusted JSON still passes through runtime command and image validation', async t => {
  const { url } = await setup(t); const { ws } = await connect(url); t.after(() => ws.terminate());
  for (const command of [
    { type: 'prompt', id: 'bad-text', message: 42 },
    { type: 'prompt', id: 'bad-image', message: 'look', images: [{ mimeType: 'image/png', data: 'not base64!' }] },
    { type: 'prompt', id: 'null-image', message: 'look', images: [null] },
    { type: 'spawn', id: 'launch', executable: 'sh' }
  ]) {
    const rejected = waitFor(ws, 'edge.error');
    ws.send(JSON.stringify(command));
    assert.ok((await rejected).message.length > 0);
  }
});
test('host policy controls arguments; images pass through; output uses provider-independent events', async t => {
  const { url, launches } = await setup(t, { tools: 'read,grep,find,ls' }); const { ws } = await connect(url); t.after(() => ws.terminate());
  assert.equal(launches[0].options.cwd, directory);
  assert.equal(launches[0].args[launches[0].args.indexOf('--tools') + 1], 'read,grep,find,ls');
  const response = waitForEvent(ws, 'message', event => event.role === 'assistant');
  ws.send(JSON.stringify({ id: 'image-prompt', type: 'prompt', message: 'look', images: [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }] }));
  assert.equal((await response).text, 'Received image');
});
test('reconnection retains the same computer process and does not execute a prompt twice', async t => {
  const { url, launches } = await setup(t); const first = await connect(url);
  const reply = waitForEvent(first.ws, 'message', event => event.role === 'assistant');
  first.ws.send(JSON.stringify({ id: 'same-command', type: 'prompt', message: 'hello' }));
  assert.equal((await reply).text, 'OK\u2028still one event');
  first.ws.close(); await once(first.ws, 'close');
  const second = await connect(url, first.clientId); t.after(() => second.ws.terminate());
  assert.equal(launches.length, 1);
  const replies = () => second.messages.filter(value => value.type === 'edge.event' && value.event.kind === 'message' && value.event.role === 'assistant').length;
  const replyCount = replies();
  second.ws.send(JSON.stringify({ id: 'same-command', type: 'prompt', message: 'hello' }));
  const state = waitForEvent(second.ws, 'state');
  second.ws.send(JSON.stringify({ id: 'inspect', type: 'get_state' })); await state;
  assert.equal(replies(), replyCount);
});
test('adapter rejects an unimplemented agent and handles model errors', () => {
  assert.throws(() => getAgent('codex'));
  assert.deepEqual(getAgent('pi').normalize({ type: 'message_end', message: { role: 'assistant', content: [], errorMessage: 'Provider rejected image' } }).at(-1), { kind: 'error', message: 'Provider rejected image' });
});

test('Pi reports the active reasoning effort through common state events', () => {
  const [state] = getAgent('pi').normalize({ type: 'response', command: 'get_state', success: true, data: { thinkingLevel: 'high', isStreaming: false, model: { provider: 'test', id: 'model' } } });
  assert.ok(state.kind === 'state');
  assert.equal(state.effort, 'high');
});

test('full access is the default and mobile can reopen the same saved session with read/write or read-only tools', async t => {
  const { url, launches } = await setup(t);
  const { ws, clientId } = await connect(url); t.after(() => ws.terminate());
  assert.match(launches[0].args[launches[0].args.indexOf('--tools') + 1], /bash/);
  for (const [mode, expected] of [['edit', 'read,grep,find,ls,write,edit'], ['read', 'read,grep,find,ls']]) {
    const ready = waitFor(ws, 'edge.ready', event => event.permissions === mode);
    ws.send(JSON.stringify({ type: 'edge.permissions', id: 'permission-' + mode, mode }));
    assert.equal((await ready).tools, expected);
    const last = launches.at(-1)!;
    assert.equal(last.args[last.args.indexOf('--session-id') + 1], clientId);
  }
});
test('phone permission selection cannot exceed an explicitly restricted host ceiling', async t => {
  const { url, launches } = await setup(t, { tools: 'read,grep,find,ls' });
  const { ws } = await connect(url); t.after(() => ws.terminate());
  const rejected = waitFor(ws, 'edge.error');
  ws.send(JSON.stringify({ type: 'edge.permissions', id: 'escalate', mode: 'full' }));
  assert.match((await rejected).message, /disabled/);
  assert.equal(launches.length, 1);
});

test('changing permissions never interrupts a running agent', async t => {
  const { url, launches } = await setup(t); const { ws } = await connect(url); t.after(() => ws.terminate());
  const running = waitForEvent(ws, 'run.started');
  ws.send(JSON.stringify({type:'prompt',id:'hold',message:'hold'})); await running;
  const rejected = waitFor(ws, 'edge.error');
  ws.send(JSON.stringify({type:'edge.permissions',id:'change-busy',mode:'read'}));
  assert.match((await rejected).message, /Stop the current run/); assert.equal(launches.length, 1);
  const stopped = waitForEvent(ws, 'run.finished');
  ws.send(JSON.stringify({type:'abort',id:'stop'})); await stopped;
  const changed = waitFor(ws, 'edge.ready', event => event.permissions === 'read');
  ws.send(JSON.stringify({type:'edge.permissions',id:'change-idle',mode:'read'})); await changed;
  assert.equal(launches.length, 2);
});
test('non-reasoning models and real registry entries remain explicit in normalized events', () => {
  const adapter = getAgent('pi');
  const [state] = adapter.normalize({type:'response',command:'get_state',success:true,data:{model:{provider:'example',id:'chat',reasoning:false},thinkingLevel:'off'}});
  assert.ok(state.kind === 'state'); assert.equal(state.reasoning, false);
  const [effort] = adapter.normalize({type:'response',command:'get_available_thinking_levels',success:true,data:{levels:['off']}});
  assert.ok(effort.kind === 'effort.levels'); assert.deepEqual(effort.levels, ['off']);
  const [catalog] = adapter.normalize({type:'response',command:'get_available_models',success:true,data:{models:[{provider:'custom',id:'my-model',name:'Configured model'}]}});
  assert.ok(catalog.kind === 'models'); assert.equal(catalog.models[0].id, 'custom/my-model');
});
