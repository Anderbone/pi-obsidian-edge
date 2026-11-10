import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { Harness, createRegistry, defineExtension, defineTool, section, type Conversation, type ConversationView, type LiveState, type InboxState } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { ModelRuntime, SessionManager, loadProjectContextFiles, getAgentDir, createCodingTools, createReadOnlyTools } from '@earendil-works/pi-coding-agent';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai/models';
import type { Models, ModelThinkingLevel, UserMessage } from '@earendil-works/pi-ai';
import type { PiRequest } from '../shared/protocol';

export interface DurableOptions { directory: string; cwd: string; clientId: string; tools: string; model?: string; models?: Models; }
const closing = new Map<string, Promise<void>>();
export async function closeDurableProcesses(): Promise<void> { await Promise.all(closing.values()); }
let defaultModels: Promise<Models> | undefined;
export function durableTools(cwd: string) {
  const tools = [...createCodingTools(cwd), ...createReadOnlyTools(cwd).filter(tool => tool.name !== 'read')];
  return defineExtension({ name: 'edge-coding', sections: [section('role', () => 'You are Pi, a coding assistant. Use the available tools to help the user.'), section('project', () => loadProjectContextFiles({ cwd, agentDir: getAgentDir() }).map(file => `${file.path}\n${file.content}`).join('\n\n'))], tools: tools.map(tool => defineTool({
    name: tool.name, description: tool.description, parameters: tool.parameters, ...(tool.prepareArguments ? { prepareArguments: tool.prepareArguments } : {}),
    ...(new Set(['read', 'grep', 'find', 'ls']).has(tool.name) ? { replay: 'safe' as const } : {}),
    execute: async (args, api, ctx) => {
      const result = await tool.execute(api.callId, args, ctx.abortSignal, update => { for (const block of update.content) if (block.type === 'text') api.output(block.text); });
      return { output: result.content };
    }
  })) });
}

// Adapt a durable runtime to the existing bridge's bounded RPC transport. No CLI
// subprocess owns the task: SQLite owns its recoverable state.
export function createDurableProcess(options: DurableOptions): ChildProcessWithoutNullStreams {
  const child = new EventEmitter();
  const stdout = new PassThrough(), stderr = new PassThrough();
  let harness: Harness | undefined, conversation: Conversation;
  let stopped = false, busy = false;
  const marker = path.join(options.directory, options.clientId + '.active');
  const markBusy = (value: boolean) => { if (value && !existsSync(marker)) writeFileSync(marker, JSON.stringify({ tools: options.tools }), { mode: 0o600, flush: true }); else if (!value && existsSync(marker)) unlinkSync(marker); };
  const emitted = new Set<number>();
  let lastFailure = 0;
  let view: ConversationView | undefined;
  const emit = (value: unknown) => { if (!stopped) stdout.write(JSON.stringify(value) + '\n'); };
  const response = (request: PiRequest, data: unknown = {}) => emit({ type: 'response', command: request.type, id: request.id, success: true, data });
    const publish = async (current: ConversationView) => {
    view = current;
    const live = current.docs['pi.live'] as unknown as LiveState | undefined;
    const inbox = current.docs['pi.inbox'] as unknown as InboxState | undefined;
    const nextBusy = !!live?.run || !!inbox?.items.length;
    markBusy(nextBusy);
    if (nextBusy !== busy) { busy = nextBusy; emit({ type: busy ? 'agent_start' : 'agent_settled' }); }
    // Stable provider timestamps preserve the existing client's message identities.
    for (const entry of current.entries) {
      if (emitted.has(entry.id)) continue; emitted.add(entry.id);
      for (const message of entry.model || []) {
        if (message.role === 'user') emit({ type: 'message_start', message });
        if (message.role === 'assistant') emit({ type: 'message_end', message });
        if (message.role === 'toolResult') emit({ type: 'tool_execution_end', toolCallId: message.toolCallId, toolName: message.toolName, isError: message.isError, result: message });
      }
    }
    if (emitted.size > 2048) { emitted.clear(); for (const entry of current.entries) emitted.add(entry.id); }
    if (live?.generation?.message) emit({ type: 'message_update', message: live.generation.message, assistantMessageEvent: { type: 'text_delta' } });
    for (const slot of live?.tools || []) {
      const result = current.entries.flatMap(entry => entry.model || []).find(message => message.role === 'toolResult' && message.toolCallId === slot.callId);
      const call = current.entries.flatMap(entry => entry.model || []).flatMap(message => message.role === 'assistant' ? message.content : []).find(block => block.type === 'toolCall' && block.id === slot.callId);
      emit({ type: slot.status === 'done' ? 'tool_execution_end' : 'tool_execution_start', toolCallId: slot.callId, toolName: slot.name,
        args: call?.type === 'toolCall' ? call.arguments : undefined, isError: result?.role === 'toolResult' ? result.isError : slot.diagnostics?.some(item => item.severity === 'error'), result: result || { content: slot.output || '' } });
    }
    if (live?.runFailure && live.runFailure.reason !== 'aborted' && lastFailure !== live.runFailure.taskId) { lastFailure = live.runFailure.taskId; emit({ type: 'response', success: false, error: live.runFailure.detail || live.runFailure.reason }); }
    await state();
  };
  async function state(request?: PiRequest) {
    const agent = await conversation.agent(context);
    const model = agent.model ? models.getModel(agent.model.provider, agent.model.modelId) : undefined;
    response(request || { type: 'get_state' }, { isStreaming: busy, model, thinkingLevel: agent.thinkingLevel });
  }
  let models: Models;
  const initialized = (async () => {
    await closing.get(path.join(options.directory, options.clientId));
    mkdirSync(options.directory, { recursive: true, mode: 0o700 });
    models = options.models || await (defaultModels ??= ModelRuntime.create());
    const registry = createRegistry(); const extension = durableTools(options.cwd); registry.install(extension);
    const allowedTools = extension.tools!.filter(tool => options.tools.split(',').includes(tool.name));
    harness = await Harness.open(await openNodeSqliteStorage(path.join(options.directory, options.clientId + '.sqlite')), { models, registry, env: () => new NodeExecutionEnv({ cwd: options.cwd }) }, context);
    const available = await models.getAvailable();
    const configured = options.model || (available[0] ? `${available[0].provider}/${available[0].id}` : '');
    const slash = configured.indexOf('/');
    const legacyFile = SessionManager.findById(options.cwd, options.clientId);
    const legacy = legacyFile ? SessionManager.open(legacyFile).buildSessionContext() : undefined;
    conversation = await harness.root(context, {
      agent: { extensions: [extension], tools: allowedTools, cwd: options.cwd,
        ...(legacy?.model ? { model: legacy.model } : slash > 0 ? { model: { provider: configured.slice(0, slash), modelId: configured.slice(slash + 1) } } : {}),
        ...(legacy?.thinkingLevel ? { thinkingLevel: legacy.thinkingLevel as ModelThinkingLevel } : {}) },
      init: async (tx, id) => {
        for (const message of legacy?.messages || []) {
          if (message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult') await tx.appendEntry(id, { kind: message.role === 'user' ? 'pi.user' : message.role === 'assistant' ? 'pi.assistant' : 'pi.tool_result', model: [message] });
        }
      }
    });
    // Apply the current permission ceiling also when reopening an existing store.
    await conversation.configure({ tools: allowedTools }, context);
    const watch = await conversation.watch(context, { min: 500, max: 1000 });
    view = watch.value; for (const entry of view.entries) emitted.add(entry.id); busy = !!(view.docs['pi.live'] as unknown as LiveState | undefined)?.run;
    watch.start(async call => { if (call.kind === 'value') await publish(call.value); });
    if (stopped) { await harness.close(context); return; }
    child.emit('spawn');
    await publish(watch.value);
    harness.resume();
  })();
  initialized.catch(error => { void harness?.close(context); child.emit('error', error); });
  async function command(request: PiRequest) {
    await initialized;
    if (stopped) return;
    switch (request.type) {
      case 'prompt': {
        const content: UserMessage['content'] = [{ type: 'text', text: request.message || '' }, ...(request.images || []).map(image => ({ ...image, type: 'image' as const }))];
        markBusy(true);
        const submission = await conversation.submit({ type: 'input', requestId: request.id, content, whenBusy: request.streamingBehavior || 'steer' }, context);
        response(request, { disposition: busy ? 'queued' : 'started' });
        void submission.wait(context).then(() => response(request, { disposition: 'handled' })).catch(error => emit({ type: 'response', command: 'prompt', id: request.id, success: false, error: String(error) }));
        return;
      }
      case 'get_state': return state(request);
      case 'get_messages': {
        const all = []; let cursor;
        do { const page = await conversation.entries({ order: 'ascending' }, 500, cursor, context); all.push(...page.items.flatMap(entry => entry.model || [])); cursor = page.next; } while (cursor);
        response(request, { messages: all });
        const failure = (view?.docs['pi.live'] as unknown as LiveState | undefined)?.runFailure;
        if (failure && failure.reason !== 'aborted') emit({ type: 'response', success: false, error: failure.detail || failure.reason });
        return;
      }
      case 'get_available_models': return response(request, { models: await models.getAvailable() });
      case 'get_available_thinking_levels': {
        const agent = await conversation.agent(context); const model = agent.model && models.getModel(agent.model.provider, agent.model.modelId);
        return response(request, { levels: model ? getSupportedThinkingLevels(model) : ['off'] });
      }
      case 'set_model': {
        if (!request.provider || !request.modelId || !models.getModel(request.provider, request.modelId)) throw new Error('Unknown model');
        await conversation.configure({ model: { provider: request.provider, modelId: request.modelId } }, context);
        return response(request, { model: models.getModel(request.provider, request.modelId) });
      }
      case 'set_thinking_level': {
        const agent = await conversation.agent(context); const model = agent.model && models.getModel(agent.model.provider, agent.model.modelId);
        if (!(model ? getSupportedThinkingLevels(model) : ['off']).includes(request.level as ModelThinkingLevel)) throw new Error('Invalid thinking level');
        await conversation.configure({ thinkingLevel: request.level as ModelThinkingLevel }, context); return response(request);
      }
      case 'abort': await conversation.abort(context); return response(request);
      case 'clear_queue': {
        const inbox = view?.docs['pi.inbox'] as unknown as InboxState | undefined;
        for (const item of inbox?.items || []) await (await harness!.submission(item.id, context))?.abort(context);
        const text = (content: unknown) => typeof content === 'string' ? content : Array.isArray(content) ? content.filter(item => item.type === 'text').map(item => item.text).join('\n') : '';
        return response(request, { steering: inbox?.items.filter(item => item.mode === 'steer').map(item => 'content' in item ? text(item.content) : '') || [], followUp: inbox?.items.filter(item => item.mode === 'followUp').map(item => 'content' in item ? text(item.content) : '') || [] });
      }
      case 'new_session': await conversation.reset(undefined, context); return response(request);
      case 'get_session_stats': return response(request, view?.docs['pi.usage'] || {});
    }
  }
  let line = '';
  // Serialize admissions and settings, never the long-running submitted tasks.
  let commands = Promise.resolve();
  const stdin = new Writable({ write(chunk, _encoding, done) {
    line += String(chunk); let newline;
    while ((newline = line.indexOf('\n')) >= 0) {
      const raw = line.slice(0, newline); line = line.slice(newline + 1);
      commands = commands.then(async () => { const request = JSON.parse(raw) as PiRequest; try { await command(request); } catch (error) { emit({ type: 'response', command: request.type, id: request.id, success: false, error: String(error) }); } });
    }
    done();
  } });
  const runtime = Object.assign(child, { stdin, stdout, stderr, exitCode: null as number | null, kill() {
    if (stopped) return true;
    stopped = true;
    const closed = initialized.then(async () => { await commands; await harness?.close(context); runtime.exitCode = 0; child.emit('exit', 0); }).catch(() => { runtime.exitCode = 1; child.emit('exit', 1); });
    closing.set(path.join(options.directory, options.clientId), closed);
    return true;
  } });
  return runtime as unknown as ChildProcessWithoutNullStreams;
}
