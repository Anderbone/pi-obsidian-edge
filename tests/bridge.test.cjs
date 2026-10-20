const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocket } = require('ws');
const { createBridge } = require('../bridge/server.cjs');
const { getAgent } = require('../bridge/agents.cjs');
const token = 'test-token-never-a-real-device-credential';
async function setup(t, extra = {}) {
  const launches = [];
  const bridge = createBridge({ cwd: __dirname, token, graceMs: 3000, ...extra, spawn: (executable, args, options) => {
    launches.push({ executable, args, options });
    return spawn(process.execPath, [path.join(__dirname, 'fake-pi.cjs')], options);
  } });
  const address = await bridge.listen(0, '127.0.0.1');
  t.after(() => bridge.close());
  return { bridge, launches, url: `ws://127.0.0.1:${address.port}`, http: `http://127.0.0.1:${address.port}` };
}
async function connect(url, clientId = crypto.randomUUID()) {
  const ws = new WebSocket(`${url}/rpc?token=${token}`);
  const messages = [];
  ws.on('message', raw => messages.push(JSON.parse(raw)));
  await once(ws, 'open');
  const ready = new Promise(resolve => ws.on('message', raw => { const data = JSON.parse(raw); if (data.type === 'edge.ready') resolve(data); }));
  ws.send(JSON.stringify({ type: 'edge.hello', protocol: 1, clientId, agent: 'pi', cwd: '/untrusted', args: ['--tools', 'bash'] }));
  await ready;
  return { ws, messages, clientId };
}
function waitFor(ws, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', handler); reject(new Error('Event timeout')); }, 4000);
    const handler = raw => { const data = JSON.parse(raw); if (predicate(data)) { clearTimeout(timer); ws.off('message', handler); resolve(data); } };
    ws.on('message', handler);
  });
}
test('authentication protects HTTP and WebSocket endpoints', async t => {
  const { url, http } = await setup(t);
  assert.equal((await fetch(http + '/health')).status, 401);
  assert.equal((await fetch(http + '/health?token=' + token)).status, 200);
  const ws = new WebSocket(url + '/rpc?token=wrong');
  const closed = once(ws, 'close'); await once(ws, 'open');
  assert.equal((await closed)[0], 4001);
});
test('host policy controls arguments; images pass through; output uses provider-independent events', async t => {
  const { url, launches } = await setup(t, { tools: 'read,grep,find,ls' }); const { ws } = await connect(url); t.after(() => ws.terminate());
  assert.equal(launches[0].options.cwd, __dirname);
  assert.equal(launches[0].args[launches[0].args.indexOf('--tools') + 1], 'read,grep,find,ls');
  const response = waitFor(ws, value => value.event?.kind === 'message' && value.event.role === 'assistant');
  ws.send(JSON.stringify({ id: 'image-prompt', type: 'prompt', message: 'look', images: [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }] }));
  assert.equal((await response).event.text, 'Received image');
});
test('reconnection retains the same computer process and does not execute a prompt twice', async t => {
  const { url, launches } = await setup(t); const first = await connect(url);
  const reply = waitFor(first.ws, value => value.event?.kind === 'message' && value.event.role === 'assistant');
  first.ws.send(JSON.stringify({ id: 'same-command', type: 'prompt', message: 'hello' }));
  assert.equal((await reply).event.text, 'OK\u2028still one event');
  first.ws.close(); await once(first.ws, 'close');
  const second = await connect(url, first.clientId); t.after(() => second.ws.terminate());
  assert.equal(launches.length, 1);
  const replyCount = second.messages.filter(value => value.event?.kind === 'message' && value.event.role === 'assistant').length;
  second.ws.send(JSON.stringify({ id: 'same-command', type: 'prompt', message: 'hello' }));
  const state = waitFor(second.ws, value => value.event?.kind === 'state');
  second.ws.send(JSON.stringify({ id: 'inspect', type: 'get_state' })); await state;
  assert.equal(second.messages.filter(value => value.event?.kind === 'message' && value.event.role === 'assistant').length, replyCount);
});
test('adapter rejects an unimplemented agent and handles model errors', () => {
  assert.throws(() => getAgent('codex'));
  assert.deepEqual(getAgent('pi').normalize({ type: 'message_end', message: { role: 'assistant', content: [], errorMessage: 'Provider rejected image' } }).at(-1), { kind: 'error', message: 'Provider rejected image' });
});

test('Pi reports the active reasoning effort through common state events', () => {
  const [state] = getAgent('pi').normalize({ type: 'response', command: 'get_state', success: true, data: { thinkingLevel: 'high', isStreaming: false, model: { provider: 'test', id: 'model' } } });
  assert.equal(state.effort, 'high');
});

test('full access is the default and mobile can reopen the same saved session with read/write or read-only tools', async t => {
  const { url, launches } = await setup(t);
  const { ws, clientId } = await connect(url); t.after(() => ws.terminate());
  assert.match(launches[0].args[launches[0].args.indexOf('--tools') + 1], /bash/);
  for (const [mode, expected] of [['edit', 'read,grep,find,ls,write,edit'], ['read', 'read,grep,find,ls']]) {
    const ready = waitFor(ws, event => event.type === 'edge.ready' && event.permissions === mode);
    ws.send(JSON.stringify({ type: 'edge.permissions', id: 'permission-' + mode, mode }));
    const result = await ready;
    assert.equal(result.tools, expected);
    const last = launches.at(-1);
    assert.equal(last.args[last.args.indexOf('--session-id') + 1], clientId);
  }
});
test('phone permission selection cannot exceed an explicitly restricted host ceiling', async t => {
  const { url, launches } = await setup(t, { tools: 'read,grep,find,ls' });
  const { ws } = await connect(url); t.after(() => ws.terminate());
  const rejected = waitFor(ws, event => event.type === 'edge.error');
  ws.send(JSON.stringify({ type: 'edge.permissions', id: 'escalate', mode: 'full' }));
  assert.match((await rejected).message, /disabled/);
  assert.equal(launches.length, 1);
});

test('changing permissions never interrupts a running agent', async t => {
  const { url, launches } = await setup(t); const { ws } = await connect(url); t.after(() => ws.terminate());
  const running = waitFor(ws, event => event.event?.kind === 'run.started');
  ws.send(JSON.stringify({type:'prompt',id:'hold',message:'hold'})); await running;
  const rejected = waitFor(ws, event => event.type === 'edge.error');
  ws.send(JSON.stringify({type:'edge.permissions',id:'change-busy',mode:'read'}));
  assert.match((await rejected).message, /Stop the current run/); assert.equal(launches.length, 1);
  const stopped = waitFor(ws, event => event.event?.kind === 'run.finished');
  ws.send(JSON.stringify({type:'abort',id:'stop'})); await stopped;
  const changed = waitFor(ws, event => event.type === 'edge.ready' && event.permissions === 'read');
  ws.send(JSON.stringify({type:'edge.permissions',id:'change-idle',mode:'read'})); await changed;
  assert.equal(launches.length, 2);
});
test('non-reasoning models and real registry entries remain explicit in normalized events', () => {
  const adapter = getAgent('pi');
  assert.equal(adapter.normalize({type:'response',command:'get_state',success:true,data:{model:{provider:'example',id:'chat',reasoning:false},thinkingLevel:'off'}})[0].reasoning, false);
  assert.deepEqual(adapter.normalize({type:'response',command:'get_available_thinking_levels',success:true,data:{levels:['off']}})[0].levels, ['off']);
  const [catalog] = adapter.normalize({type:'response',command:'get_available_models',success:true,data:{models:[{provider:'custom',id:'my-model',name:'Configured model'}]}});
  assert.equal(catalog.models[0].id, 'custom/my-model');
});
