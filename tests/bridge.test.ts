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
  const sent = waitForEvent(ws, 'message', event => event.role === 'user');
  const images = [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }];
  ws.send(JSON.stringify({ id: 'image-prompt', type: 'prompt', message: 'look', images }));
  assert.deepEqual((await sent).images, images);
  assert.equal((await response).text, 'Received image');
  const history = waitForEvent(ws, 'history');
  ws.send(JSON.stringify({ id: 'image-history', type: 'get_messages' }));
  assert.deepEqual((await history).messages.find(message => message.role === 'user')?.images, images);
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

test('two concurrent Pi sessions keep histories, cancellation and lifetimes separate', async t => {
  const { url, launches } = await setup(t);
  const a = await connect(url), b = await connect(url);
  t.after(() => { a.ws.terminate(); b.ws.terminate(); });
  const runningA = waitForEvent(a.ws, 'run.started'), runningB = waitForEvent(b.ws, 'run.started');
  a.ws.send(JSON.stringify({ type: 'prompt', id: 'same-command-id', message: 'hold' }));
  b.ws.send(JSON.stringify({ type: 'prompt', id: 'same-command-id', message: 'hold' }));
  await Promise.all([runningA, runningB]);
  assert.equal(launches.length, 2);
  assert.notEqual(launches[0].args[launches[0].args.indexOf('--session-id') + 1], launches[1].args[launches[1].args.indexOf('--session-id') + 1]);
  const rejected = waitFor(a.ws, 'edge.error');
  a.ws.send(JSON.stringify({ type: 'edge.session.close', id: 'end-running' }));
  assert.match((await rejected).message, /Stop this chat/);
  const stopped = waitForEvent(a.ws, 'run.finished');
  a.ws.send(JSON.stringify({ type: 'abort', id: 'stop-a' })); await stopped;
  const bState = waitForEvent(b.ws, 'state');
  b.ws.send(JSON.stringify({ type: 'get_state', id: 'b-still-running' }));
  assert.equal((await bState).busy, true);
  const ended = once(a.ws, 'close');
  a.ws.send(JSON.stringify({ type: 'edge.session.close', id: 'end-idle' })); await ended;
  const bHistory = waitForEvent(b.ws, 'history');
  b.ws.send(JSON.stringify({ type: 'get_messages', id: 'b-history' }));
  assert.deepEqual((await bHistory).messages.map(message => message.text), ['hold']);
  const reconnectedA = await connect(url, a.clientId); t.after(() => reconnectedA.ws.terminate());
  assert.equal(launches.length, 3, 'only the ended chat starts another process');
});

test('disconnected work outlives the idle grace period and replays completion on the same process', async t => {
  const { url, launches } = await setup(t, { graceMs: 100 });
  const a = await connect(url);
  const running = waitForEvent(a.ws, 'run.started');
  a.ws.send(JSON.stringify({ type: 'prompt', id: 'background-work', message: 'delayed' })); await running;
  const closed = once(a.ws, 'close'); a.ws.close(); await closed;
  // Reattach after the old idle timeout, while the fixture is still running.
  await new Promise(resolve => setTimeout(resolve, 150));
  const b = await connect(url, a.clientId); t.after(() => b.ws.terminate());
  assert.equal(launches.length, 1);
  const finished = b.messages.some(packet => packet.type === 'edge.event' && packet.event.kind === 'run.finished')
    ? undefined : waitForEvent(b.ws, 'run.finished');
  await finished;
  const history = waitForEvent(b.ws, 'history');
  b.ws.send(JSON.stringify({ type: 'get_messages', id: 'completed-context' }));
  assert.equal((await history).messages.length, 2);
});

test('tool details are bounded and restored with inputs and failure status from Pi history', () => {
  const adapter = getAgent('pi');
  const start = adapter.normalize({ type: 'tool_execution_start', toolCallId: 'edit-1', toolName: 'edit', args: { path: '计划.md' } })[0];
  assert.ok(start.kind === 'tool'); assert.match(start.input!, /计划.md/);
  const end = adapter.normalize({ type: 'tool_execution_end', toolCallId: 'edit-1', toolName: 'edit', isError: true, result: { content: [{ type: 'text', text: 'x'.repeat(9000) }, { type: 'image', data: 'private-image' }] } })[0];
  assert.ok(end.kind === 'tool'); assert.equal(end.phase, 'failed'); assert.ok(end.output!.length < 6100); assert.ok(!end.output!.includes('private-image'));
  const history = adapter.normalize({ type: 'response', command: 'get_messages', success: true, data: { messages: [
    { role: 'user', timestamp: 1, content: 'Edit' },
    { role: 'assistant', timestamp: 2, content: [{ type: 'text', text: 'Checking' }, { type: 'toolCall', id: 'edit-1', name: 'edit', arguments: { path: '计划.md' } }] },
    { role: 'toolResult', toolCallId: 'edit-1', toolName: 'edit', content: [{ type: 'text', text: 'Conflict' }], isError: true },
    { role: 'assistant', timestamp: 3, content: 'No files changed: conflict.' }
  ] } })[0];
  assert.ok(history.kind === 'history');
  assert.deepEqual(history.messages.map(message => message.id), ['user:1', 'assistant:2', 'tool:edit-1', 'assistant:3']);
  assert.deepEqual(history.messages[2].tool, { name: 'edit', phase: 'failed', input: JSON.stringify({ path: '计划.md' }, null, 2), output: 'Conflict' });
});

test('Pi normalization retains user images in live events and restored image-only history', () => {
  const image = { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' };
  const message = { role: 'user', timestamp: 123, content: [image] };
  const adapter = getAgent('pi');
  const live = adapter.normalize({ type: 'message_start', message });
  assert.deepEqual(live, [{ kind: 'message', id: 'user:123', role: 'user', text: '', images: [image], final: true }]);
  const history = adapter.normalize({ type: 'response', command: 'get_messages', success: true, data: { messages: [message] } });
  assert.deepEqual(history, [{ kind: 'history', messages: [{ id: 'user:123', role: 'user', text: '', images: [image], final: true }] }]);
});

test('a running task accepts steering with images and finishes only after processing the adjustment', async t => {
  const { url, launches } = await setup(t); const { ws } = await connect(url); t.after(() => ws.terminate());
  const events: AgentEvent[] = [];
  ws.on('message', raw => { const value = packet(raw); if (value.type === 'edge.event') events.push(value.event); });
  const started = waitForEvent(ws, 'run.started');
  ws.send(JSON.stringify({ type: 'prompt', id: 'original', message: 'delayed' })); await started;
  const accepted = waitForEvent(ws, 'prompt.status', event => event.requestId === 'adjust');
  const settled = waitForEvent(ws, 'run.finished');
  ws.send(JSON.stringify({ type: 'prompt', id: 'adjust', message: 'Focus on the plan', streamingBehavior: 'steer', images: [{ mimeType: 'image/png', data: 'aGVsbG8=' }] }));
  assert.equal((await accepted).disposition, 'queued');
  await settled;
  assert.equal(launches.length, 1);
  assert.equal(events.filter(event => event.kind === 'run.finished').length, 1);
  const delivered = events.findIndex(event => event.kind === 'message' && event.role === 'user' && event.text === 'Focus on the plan');
  const finished = events.findIndex(event => event.kind === 'run.finished');
  assert.ok(delivered >= 0 && delivered < finished);
  assert.ok(events.some(event => event.kind === 'message' && event.text === 'Adjusted task'));
});

test('busy prompts from older clients default to steering and invalid modes are rejected', async t => {
  const { url } = await setup(t); const { ws } = await connect(url); t.after(() => ws.terminate());
  const started = waitForEvent(ws, 'run.started');
  ws.send(JSON.stringify({ type: 'prompt', id: 'hold-steer', message: 'hold' })); await started;
  const rejected = waitFor(ws, 'edge.error');
  ws.send(JSON.stringify({ type: 'prompt', id: 'bad-steer', message: 'No', streamingBehavior: 'untrusted' }));
  assert.match((await rejected).message, /Invalid streaming/);
  const queued = waitForEvent(ws, 'prompt.status', event => event.requestId === 'legacy-steer');
  ws.send(JSON.stringify({ type: 'prompt', id: 'legacy-steer', message: 'Adjust' }));
  assert.equal((await queued).disposition, 'queued');
  const cleared = waitForEvent(ws, 'queue.cleared');
  ws.send(JSON.stringify({ type: 'clear_queue', id: 'clear' }));
  assert.deepEqual((await cleared).messages, ['Adjust']);
  const finished = waitForEvent(ws, 'run.finished');
  ws.send(JSON.stringify({ type: 'abort', id: 'abort' })); await finished;
});

test('delta-only streaming stays isolated per Pi process and uses authoritative final text', () => {
  const a = getAgent('pi'), b = getAgent('pi');
  for (const adapter of [a, b]) adapter.normalize({ type: 'message_start', message: { role: 'assistant', timestamp: 42, content: [] } });
  const delta = (value: string) => ({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: value } });
  a.normalize(delta('Hello ')); b.normalize(delta('Other'));
  const part = a.normalize(delta('world'))[0];
  assert.ok(part.kind === 'message'); assert.equal(part.text, 'Hello world'); assert.equal(part.id, 'assistant:42');
  const authoritative = a.normalize({ type: 'message_update', assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'Corrected text' } })[0];
  assert.ok(authoritative.kind === 'message'); assert.equal(authoritative.text, 'Corrected text');
  assert.deepEqual(a.normalize({ type: 'agent_end', willRetry: true }), []);
  assert.deepEqual(a.normalize({ type: 'agent_settled' }), [{ kind: 'run.finished' }]);
});
