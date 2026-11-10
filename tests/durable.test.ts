import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import type { AssistantMessage, Models, ToolCall } from '@earendil-works/pi-ai';
import { createDurableProcess } from '../bridge/durable.mts';
import { SessionManager } from '@earendil-works/pi-coding-agent';

function fakeModels(delay = 10, toolCalls: { name: string; arguments: ToolCall['arguments'] }[] = []) {
  const models = builtinModels(); let calls = 0;
  const model = models.getModel('openai', 'gpt-6.1-sol')!;
  const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const fake: Models = Object.assign(Object.create(models) as Models, {
    getAvailable: async () => [model],
    streamSimple: () => {
      calls++;
      const stream = new AssistantMessageEventStream();
      const message: AssistantMessage = { role: 'assistant', content: calls === 1 && toolCalls.length ? toolCalls.map((tool, i) => ({ type: 'toolCall' as const, id: `tool-${i}`, ...tool })) : [{ type: 'text', text: 'durable response' }], api: model.api, provider: model.provider, model: model.id, usage, stopReason: calls === 1 && toolCalls.length ? 'toolUse' : 'stop', timestamp: Date.now() };
      setTimeout(() => { stream.push({ type: 'done', reason: message.stopReason === 'toolUse' ? 'toolUse' : 'stop', message }); }, delay);
      return stream;
    }
  });
  return { models: fake, calls: () => calls };
}
async function runtime(directory: string, models: Models, clientId = 'durable-test-client', cwd = directory, tools = 'read,grep,find,ls') {
  const child = createDurableProcess({ directory, cwd, clientId, tools, models, model: 'openai/gpt-6.1-sol' });
  const events: Record<string, unknown>[] = []; let buffer = '';
  child.stdout.on('data', value => { buffer += value; let n; while ((n = buffer.indexOf('\n')) >= 0) { events.push(JSON.parse(buffer.slice(0, n))); buffer = buffer.slice(n + 1); } });
  await once(child, 'spawn');
  return { child, events, send: (value: object) => child.stdin.write(JSON.stringify(value) + '\n'), close: async () => { const exited = once(child, 'exit'); child.kill(); await exited; } };
}
async function waitFor(predicate: () => unknown) {
  for (let i = 0; i < 2000; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('Durable runtime did not reach expected state');
}
test('durable runtime persists history and deduplicates a request across reopen', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'edge-durable-test-'));
  const fake = fakeModels(); let run = await runtime(directory, fake.models);
  try {
    run.send({ type: 'prompt', id: 'persisted-request', message: 'remember me', images: [{ type: 'image', mimeType: 'image/png', data: 'YWJj' }] });
    await waitFor(() => run.events.some(event => event.command === 'prompt' && (event.data as { disposition?: string })?.disposition === 'handled'));
    assert.equal(fake.calls(), 1);
    await run.close(); run = await runtime(directory, fake.models);
    run.send({ type: 'get_messages', id: 'history' });
    await waitFor(() => run.events.some(event => event.id === 'history'));
    const data = run.events.find(event => event.id === 'history')!.data as { messages: { role: string; content: unknown }[] };
    assert.equal(data.messages.filter(message => message.role === 'user' || message.role === 'assistant').length, 2);
    assert.match(JSON.stringify(data.messages), /YWJj/);
    run.send({ type: 'prompt', id: 'persisted-request', message: 'remember me' });
    await waitFor(() => run.events.some(event => event.command === 'prompt' && (event.data as { disposition?: string })?.disposition === 'handled'));
    assert.equal(fake.calls(), 1);
    run.send({ type: 'set_thinking_level', id: 'effort', level: 'high' });
    run.send({ type: 'get_state', id: 'state' });
    await waitFor(() => run.events.some(event => event.id === 'state'));
    assert.equal((run.events.find(event => event.id === 'state')!.data as { thinkingLevel: string }).thinkingLevel, 'high');
  } finally { await run.close(); await rm(directory, { recursive: true, force: true }); }
});
test('existing CLI session imports once without executing a model or modifying the original', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'edge-import-test-'));
  const fake = fakeModels();
  const legacy = SessionManager.create(directory, undefined, { id: 'legacy-import-test' });
  legacy.appendMessage({ role: 'user', content: 'legacy question', timestamp: Date.now() });
  const run = await runtime(path.join(directory, 'durable'), fake.models, 'legacy-import-test', directory);
  try {
    run.send({ type: 'get_messages', id: 'history' });
    await waitFor(() => run.events.some(event => event.id === 'history'));
    assert.match(JSON.stringify(run.events.find(event => event.id === 'history')), /legacy question/);
    assert.equal(fake.calls(), 0);
    assert.equal(legacy.buildSessionContext().messages.length, 1);
  } finally { if (legacy.getSessionFile()) await rm(legacy.getSessionFile()!, { force: true }); await run.close(); await rm(directory, { recursive: true, force: true }); }
});

test('unfinished generation resumes from SQLite without resubmitting the prompt', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'edge-recovery-test-'));
  const slow = fakeModels(300);
  let run = await runtime(directory, slow.models);
  try {
    run.send({ type: 'prompt', id: 'interrupted-request', message: 'finish after restart' });
    await waitFor(() => slow.calls() === 1);
    await run.close();
    const resumed = fakeModels();
    run = await runtime(directory, resumed.models);
    await waitFor(() => run.events.some(event => event.type === 'message_end'));
    assert.equal(resumed.calls(), 1);
    run.send({ type: 'get_messages', id: 'history' });
    await waitFor(() => run.events.some(event => event.id === 'history'));
    const data = run.events.find(event => event.id === 'history')!.data as { messages: { role: string }[] };
    assert.equal(data.messages.filter(message => message.role === 'user').length, 1);
  } finally { await run.close(); await rm(directory, { recursive: true, force: true }); }
});

test('all seven existing tools execute through Durable with results and final completion', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'edge-tools-test-'));
  const { writeFile, readFile } = await import('node:fs/promises');
  await writeFile(path.join(directory, 'read.txt'), 'needle original');
  await writeFile(path.join(directory, 'edit.txt'), 'old');
  const tools: { name: string; arguments: ToolCall['arguments'] }[] = [
    { name: 'read', arguments: { path: 'read.txt' } },
    { name: 'grep', arguments: { pattern: 'needle', path: directory } },
    { name: 'find', arguments: { pattern: '*.txt', path: directory } },
    { name: 'ls', arguments: { path: directory } },
    { name: 'write', arguments: { path: 'written.txt', content: 'written' } },
    { name: 'edit', arguments: { path: 'edit.txt', edits: [{ oldText: 'old', newText: 'new' }] } },
    { name: 'bash', arguments: { command: 'printf shell-ok' } }
  ];
  const fake = fakeModels(10, tools);
  const run = await runtime(path.join(directory, 'state'), fake.models, 'durable-tool-test', directory, 'read,grep,find,ls,write,edit,bash');
  try {
    run.send({ type: 'prompt', id: 'tools-request', message: 'exercise tools' });
    await waitFor(() => run.events.some(event => event.command === 'prompt' && (event.data as { disposition?: string })?.disposition === 'handled'));
    assert.equal(await readFile(path.join(directory, 'written.txt'), 'utf8'), 'written');
    assert.equal(await readFile(path.join(directory, 'edit.txt'), 'utf8'), 'new');
    for (let i = 0; i < tools.length; i++) {
      const result = run.events.filter(event => event.type === 'tool_execution_end' && event.toolCallId === `tool-${i}`).at(-1);
      assert.ok(result, tools[i].name); assert.equal(result.isError, false, JSON.stringify(result));
    }
    assert.equal(fake.calls(), 2);
  } finally { await run.close(); await rm(directory, { recursive: true, force: true }); }
});
test('Durable bridge reconnects the same chat, restores history and changes permissions', async () => {
  const { createBridge } = await import('../bridge/server.mts');
  const { WebSocket } = await import('ws');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'edge-durable-wire-'));
  const fake = fakeModels();
  const bridge = createBridge({ cwd: directory, token: 'test-token-with-at-least-24-characters', durableDirectory: directory, durableModels: fake.models, model: 'openai/gpt-6.1-sol' });
  const address = await bridge.listen(0);
  let socket: InstanceType<typeof WebSocket> | undefined;
  let events: Record<string, unknown>[] = [];
  async function connect() {
    events = [];
    socket = new WebSocket(`ws://127.0.0.1:${address.port}/rpc?token=test-token-with-at-least-24-characters`);
    socket.on('message', raw => events.push(JSON.parse(String(raw))));
    await once(socket, 'open');
    socket.send(JSON.stringify({ type: 'edge.hello', protocol: 1, clientId: 'durable-wire-test', agent: 'pi', permissions: 'read' }));
    await waitFor(() => events.some(event => event.type === 'edge.ready'));
    return events.find(event => event.type === 'edge.ready')!;
  }
  try {
    const first = await connect();
    socket!.send(JSON.stringify({ type: 'prompt', id: 'wire-prompt', message: 'wire test' }));
    await waitFor(() => events.some(event => (event.event as { kind?: string })?.kind === 'run.finished'));
    const closed = once(socket!, 'close'); socket!.close(); await closed;
    const second = await connect(); assert.equal(second.sessionId, first.sessionId);
    await waitFor(() => events.some(event => (event.event as { kind?: string; messages?: unknown[] })?.kind === 'history' && JSON.stringify(event).includes('durable response')));
    socket!.send(JSON.stringify({ type: 'edge.permissions', id: 'permissions', mode: 'full' }));
    await waitFor(() => events.some(event => event.type === 'edge.ready' && event.permissions === 'full'));
    socket!.send(JSON.stringify({ type: 'get_messages', id: 'after-permissions' }));
    await waitFor(() => events.some(event => (event.event as { requestId?: string })?.requestId === 'after-permissions'));
    assert.ok(events.some(event => JSON.stringify(event).includes('durable response')));
  } finally { socket?.terminate(); await bridge.close(); await rm(directory, { recursive: true, force: true }); }
});
test('SIGKILL recovery starts unfinished work when the bridge boots, before any phone connects', async () => {
  const { spawn } = await import('node:child_process');
  const { createBridge } = await import('../bridge/server.mts');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'edge-hard-crash-'));
  const source = `
    import { createDurableProcess } from './bridge/durable.mts';
    import { builtinModels } from '@earendil-works/pi-ai/providers/all';
    import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
    const models = builtinModels();
    const fake = Object.assign(Object.create(models), {
      getAvailable: async () => [models.getModel('openai', 'gpt-6.1-sol')],
      streamSimple: () => { console.log('DURABLE_STARTED'); return new AssistantMessageEventStream(); }
    });
    const child = createDurableProcess({ directory: process.argv[1], cwd: process.argv[1], clientId: 'hard-crash-client', tools: 'read,grep,find,ls', models: fake, model: 'openai/gpt-6.1-sol' });
    child.on('error', error => { console.error(error); process.exit(1); });
    child.on('spawn', () => child.stdin.write(JSON.stringify({ type: 'prompt', id: 'hard-crash-request', message: 'recover this task' }) + '\\n'));
    setInterval(() => {}, 1000);
  `;
  const processChild = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source, directory], { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; processChild.stdout.on('data', value => { output += value; });
  let error = ''; processChild.stderr.on('data', value => { error += value; });
  let bridge: ReturnType<typeof createBridge> | undefined;
  try {
    await waitFor(() => { if (processChild.exitCode !== null) throw new Error(error); return output.includes('DURABLE_STARTED'); });
    const exited = once(processChild, 'exit'); processChild.kill('SIGKILL'); await exited;
    const fake = fakeModels();
    bridge = createBridge({ cwd: directory, token: 'hard-crash-test-token-24-characters', durableDirectory: directory, durableModels: fake.models, model: 'openai/gpt-6.1-sol' });
    await bridge.listen(0);
    await waitFor(() => fake.calls() === 1);
    const { access } = await import('node:fs/promises');
    for (let i = 0; i < 100; i++) { try { await access(path.join(directory, 'hard-crash-client.active')); } catch { break; } await new Promise(resolve => setTimeout(resolve, 10)); }
    await assert.rejects(access(path.join(directory, 'hard-crash-client.active')));
  } finally { processChild.kill('SIGKILL'); await bridge?.close(); await rm(directory, { recursive: true, force: true }); }
});
test('queued follow-ups can be cleared and a running Durable chat can be stopped', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'edge-durable-stop-'));
  const fake = fakeModels(300); const run = await runtime(directory, fake.models);
  try {
    run.send({ type: 'prompt', id: 'running-prompt', message: 'running task' });
    await waitFor(() => fake.calls() === 1);
    run.send({ type: 'prompt', id: 'queued-prompt', message: 'cancel this follow-up', streamingBehavior: 'followUp' });
    run.send({ type: 'clear_queue', id: 'clear' });
    run.send({ type: 'abort', id: 'abort' });
    run.send({ type: 'get_state', id: 'stopped-state' });
    await waitFor(() => run.events.some(event => event.id === 'stopped-state'));
    assert.equal((run.events.find(event => event.id === 'stopped-state')!.data as { isStreaming: boolean }).isStreaming, false);
    assert.match(JSON.stringify(run.events.find(event => event.id === 'clear')), /cancel this follow-up/);
    run.send({ type: 'get_messages', id: 'history' });
    await waitFor(() => run.events.some(event => event.id === 'history'));
    assert.doesNotMatch(JSON.stringify(run.events.find(event => event.id === 'history')), /cancel this follow-up/);
  } finally { await run.close(); await rm(directory, { recursive: true, force: true }); }
});
