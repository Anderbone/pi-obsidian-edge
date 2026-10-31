import type { AgentEvent, AgentInfo, ChatMessage } from '../shared/protocol';
import { toolMessage } from '../src/tools';
import { isRecord } from '../shared/protocol';
import { contentImages } from '../src/images';

interface PiMessage {
  role?: string; content?: string | { type: string; text?: string; id?: string; name?: string; arguments?: unknown; data?: string; mimeType?: string }[];
  toolCallId?: string; toolName?: string; isError?: boolean;
  timestamp?: number; id?: string; errorMessage?: string;
}
interface PiModel { provider?: string; id?: string; name?: string; reasoning?: boolean; }
interface PiData extends PiModel {
  steering?: string[]; followUp?: string[];
  disposition?: 'started' | 'queued' | 'handled';
  model?: PiModel; isStreaming?: boolean; isCompacting?: boolean; pendingMessageCount?: number; thinkingLevel?: string;
  levels?: string[]; messages?: PiMessage[]; models?: PiModel[];
}
interface PiEvent {
  id?: string; type?: string; message?: PiMessage; assistantMessageEvent?: { type?: string; contentIndex?: number; delta?: string; content?: string };
  toolCallId?: string; toolName?: string; isError?: boolean; args?: unknown; result?: PiMessage;
  success?: boolean; command?: string; error?: string; data?: PiData;
}
export interface AgentLaunchOptions { pi?: string; tools: string; sessionId?: string; model?: string; }
export interface AgentCommand { executable: string; args: string[]; }
export interface AgentAdapter extends AgentInfo {
  launch(options: AgentLaunchOptions): AgentCommand;
  normalize(value: unknown): AgentEvent[];
}

// Adapter-owned CLI arguments and event translation. No provider protocol reaches the UI.
function text(message: PiMessage | undefined): string {
  if (typeof message?.content === 'string') return message.content;
  return (message?.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
}
function messageId(message: PiMessage | undefined): string {
  return `${message?.role}:${message?.timestamp || message?.id || 'current'}`;
}
function bounded(value: unknown): string | undefined {
  if (value === undefined) return;
  const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return content.length > 6000 ? content.slice(0, 6000) + '\n[truncated]' : content;
}
const pi: AgentAdapter = {
  id: 'pi', label: 'Pi', capabilities: { models: true, cancel: true, tools: true, newSession: true },
  launch(options) {
    const args = ['--mode', 'rpc', '--tools', options.tools, '--no-extensions', '--no-mcp', '--no-skills', '--no-approve'];
    if (options.sessionId) args.push('--session-id', options.sessionId);
    if (options.model) args.push('--model', options.model);
    return { executable: options.pi || 'pi', args };
  },
  normalize(value): AgentEvent[] {
    if (!isRecord(value)) return [];
    const event = value as PiEvent;
    switch (event.type) {
      case 'agent_start': return [{ kind: 'run.started' }];
      case 'agent_settled': return [{ kind: 'run.finished' }];
      // agent_end can be followed by recovery or queued steering. Only Pi's
      // session-level settled event means the whole task is finished.
      case 'agent_end': return [];
      case 'message_start': {
        const images = contentImages(event.message?.content);
        if (event.message?.role === 'user') return [{ kind: 'message', id: messageId(event.message), role: 'user', text: text(event.message), final: true,
          ...(images.length ? { images } : {}) }];
        return [];
      }
      case 'message_update':
        return event.assistantMessageEvent?.type === 'text_delta'
          ? [{ kind: 'message', id: messageId(event.message), role: 'assistant', text: text(event.message), final: false }] : [];
      case 'message_end':
        if (event.message?.role !== 'assistant') return [];
        return [{ kind: 'message', id: messageId(event.message), role: 'assistant', text: text(event.message), final: true },
          ...(event.message.errorMessage ? [{ kind: 'error' as const, message: event.message.errorMessage }] : [])];
      case 'tool_execution_start': return [{ kind: 'tool', id: event.toolCallId, name: event.toolName, input: bounded(event.args), phase: 'running' }];
      case 'tool_execution_end': return [{ kind: 'tool', id: event.toolCallId, name: event.toolName, output: bounded(text(event.result)), phase: event.isError ? 'failed' : 'completed' }];
      case 'extension_ui_request': return [{ kind: 'error', message: 'This agent requested an unsupported interaction. Complete it on the computer or stop the run.' }];
      case 'response':
        if (event.command === 'clear_queue' && event.success !== false) return [{ kind: 'queue.cleared', messages: [...(event.data?.steering || []), ...(event.data?.followUp || [])] }];
        if (event.command === 'prompt' && event.id) return [{ kind: 'prompt.status', requestId: event.id,
          disposition: event.success === false ? 'failed' : event.data?.disposition || 'started',
          ...(event.success === false ? { error: event.error || 'Pi rejected the message.' } : {}) }];
        if (event.success === false) return [{ kind: 'error', message: event.error || 'Agent command failed.' }];
        if (event.command === 'get_state') return [{ kind: 'state', busy: !!(event.data?.isStreaming || event.data?.isCompacting || event.data?.pendingMessageCount),
          reasoning: !!event.data?.model?.reasoning, effort: event.data?.thinkingLevel || 'off', model: event.data?.model ? `${event.data.model.provider}/${event.data.model.id}` : '' }];
        if (event.command === 'get_available_thinking_levels') return [{ kind: 'effort.levels', levels: event.data?.levels || ['off'] }];
        if (event.command === 'set_thinking_level') return [{ kind: 'state.refresh' }];
        if (event.command === 'set_model' && event.data) { const model = event.data.model || event.data; return [{ kind: 'model', model: `${model.provider}/${model.id}` }, { kind: 'state.refresh' }]; }
        if (event.command === 'get_messages') {
          const history = event.data?.messages || [];
          const seen = new Set<string>();
          const messages = history.flatMap(message => {
            if (message.role === 'toolResult') return [toolMessage({ kind: 'tool', id: message.toolCallId, name: message.toolName,
              phase: message.isError ? 'failed' : 'completed', output: bounded(text(message)) })];
            if (message.role !== 'user' && message.role !== 'assistant') return [];
            const images = contentImages(message.content);
            const content = text(message);
            const entries: ChatMessage[] = content || images.length ? [{ id: messageId(message), role: message.role, text: content, final: true,
              ...(images.length ? { images } : {}) }] : [];
            // Tool results below provide the final status; retain their inputs here.
            if (Array.isArray(message.content)) for (const block of message.content) {
              if (block.type === 'toolCall') {
                const result = history.find(item => item.role === 'toolResult' && item.toolCallId === block.id);
                entries.push(toolMessage({ kind: 'tool', id: block.id, name: block.name, input: bounded(block.arguments),
                  phase: result ? result.isError ? 'failed' : 'completed' : 'running', output: result ? bounded(text(result)) : undefined }));
              }
            }
            return entries;
          }).filter(message => {
            if (seen.has(message.id)) return false;
            seen.add(message.id); return true;
          });
          return [{ kind: 'history', messages }];
        }
        if (event.command === 'get_available_models') return [{ kind: 'models', models: (event.data?.models || []).map(model => ({
          id: `${model.provider}/${model.id}`, name: `${model.provider} / ${model.name || model.id}`, provider: model.provider, modelId: model.id })) }];
        if (event.command === 'new_session') return [{ kind: 'session.new' }];
        return [];
      default: return [];
    }
  }
};
// Pi 1.x sends text deltas without the cumulative message. Keep a separate
// accumulator for every subprocess; older cumulative RPC events still work.
function streamingAdapter(adapter: AgentAdapter): AgentAdapter {
  let current: PiMessage | undefined;
  const blocks = new Map<number, string>();
  return { ...adapter, normalize(value): AgentEvent[] {
    if (isRecord(value)) {
      const event = value as PiEvent;
      if (event.type === 'message_start' && event.message?.role === 'assistant') {
        current = event.message; blocks.clear();
      }
      const update = event.assistantMessageEvent;
      if (event.type === 'message_update' && !event.message && current &&
          (update?.type === 'text_delta' || update?.type === 'text_end')) {
        const index = update.contentIndex ?? 0;
        blocks.set(index, update.type === 'text_end' ? update.content || '' : (blocks.get(index) || '') + (update.delta || ''));
        return [{ kind: 'message', id: messageId(current), role: 'assistant',
          text: [...blocks.entries()].sort(([a], [b]) => a - b).map(([, content]) => content).join('\n'), final: false }];
      }
      if (event.type === 'message_end' && event.message?.role === 'assistant') { current = undefined; blocks.clear(); }
    }
    return adapter.normalize(value);
  } };
}
const agents = new Map<string, AgentAdapter>([[pi.id, pi]]);
export function getAgent(id: string): AgentAdapter {
  const adapter = agents.get(id);
  if (!adapter) throw new Error('Agent is not enabled on this computer.');
  return streamingAdapter(adapter);
}
export function listAgents(): AgentInfo[] {
  return [...agents.values()].map(({ id, label, capabilities }) => ({ id, label, capabilities }));
}
