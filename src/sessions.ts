import { EdgeClient, type ConnectionStatus, type SocketLike } from './client';
import type { Pairing } from './pairing';
import type { Attachment } from './panel';
import type { Conversation } from './history';
import { completionPrompt, userMessage } from './references';
import { toolMessage, mergeToolHistory } from './tools';
import type { ClientEvent, ModelEntry, PermissionId, PermissionMode } from '../shared/protocol';

export const MAX_ACTIVE_CHATS = 8;
export interface ComposerDraft { text: string; attachments: Attachment[]; }
interface SessionOptions {
  pairing: Pairing; permissions: PermissionId; model: string; effort: string;
  changed(): void;
  status(state: ConnectionStatus): void;
  createSocket?: (url: string) => SocketLike;
}

// A session belongs to the plugin, so hiding or rebuilding a view never stops it.
export class ConversationSession {
  readonly client: EdgeClient;
  readonly listeners = new Set<(event?: ClientEvent) => void>();
  draft: ComposerDraft = { text: '', attachments: [] };
  status: ConnectionStatus = 'disconnected';
  detail = 'Disconnected';
  busy = false;
  error = '';
  activity = '';
  models: ModelEntry[] = [];
  effortLevels: string[] = [];
  model = '';
  effort = 'off';
  permissions: PermissionId;
  permissionModes: PermissionMode[] = [];
  private steeringSupported = false;
  private configured = false;
  private disposed = false;
  private reconcilingError = false;
  private configure = false;

  constructor(readonly conversation: Conversation, private options: SessionOptions) {
    this.configure = !conversation.messages.length && !conversation.model;
    this.permissions = conversation.permissions || options.permissions;
    this.model = conversation.model || '';
    this.effort = conversation.effort || options.effort;
    this.client = new EdgeClient(options.pairing, conversation.id, {
      status: (state, detail) => {
        this.status = state; this.detail = detail;
        options.status(state); this.notify();
      },
      event: event => this.handle(event)
    }, options.createSocket, this.permissions);
  }
  connect(): void { this.client.connect(); }
  private notify(event?: ClientEvent): void {
    if (!this.disposed) for (const listener of this.listeners) listener(event);
  }
  private handle(event: ClientEvent): void {
    let changed = false;
    if (event.type === 'edge.ready') {
      if (this.conversation.bridgeSessionId && this.conversation.bridgeSessionId !== event.sessionId) {
        this.configure = true; this.configured = false;
      }
      this.steeringSupported = !!event.steering;
      this.conversation.bridgeSessionId = event.sessionId;
      this.permissions = event.permissions;
      this.permissionModes = event.permissionModes;
      this.conversation.permissions = event.permissions;
      this.client.send('get_available_models');
      this.client.send('get_available_thinking_levels');
    } else if (event.kind === 'message' && (event.text || event.images?.length)) {
      const message = { id: event.id, role: event.role, text: event.text, final: event.final, ...(event.images?.length ? { images: event.images } : {}) };
      const pending = event.role === 'user' ? this.conversation.messages.findIndex(item => item.delivery && item.delivery !== 'failed' && item.text === message.text) : -1;
      const previous = this.conversation.messages.find(item => item.id === message.id) || this.conversation.messages[pending];
      if (!message.images?.length && previous?.images?.length) message.images = previous.images;
      if (pending >= 0) this.conversation.messages.splice(pending, 1);
      const index = this.conversation.messages.findIndex(item => item.id === message.id);
      if (index < 0) this.conversation.messages.push(message);
      else this.conversation.messages[index] = message;
      event = pending >= 0 ? { kind: 'history', messages: this.conversation.messages } : { kind: 'message', ...message };
      changed = true;
    } else if (event.kind === 'prompt.status') {
      const reply = event;
      const pending = this.conversation.messages.find(item => item.requestId === reply.requestId && item.delivery);
      if (pending) {
        if (reply.disposition === 'handled') this.conversation.messages.splice(this.conversation.messages.indexOf(pending), 1);
        else pending.delivery = reply.disposition === 'failed' ? 'failed' : reply.disposition === 'queued' ? 'queued' : 'sending';
      }
      if (reply.disposition === 'failed') this.error = reply.error || 'Pi rejected the message.';
      if (reply.disposition === 'failed' || reply.disposition === 'handled') this.client.send('get_state');
      this.notify({ kind: 'history', messages: this.conversation.messages });
      event = reply.disposition === 'failed' ? { kind: 'error', message: this.error } : { kind: 'history', messages: this.conversation.messages };
      changed = true;
    } else if (event.kind === 'queue.cleared') {
      const cleared = event.messages;
      for (const message of this.conversation.messages) if (message.delivery && cleared.includes(message.text)) message.delivery = 'failed';
      event = { kind: 'history', messages: this.conversation.messages }; changed = true;
    } else if (event.kind === 'history') {
      this.conversation.messages = mergeToolHistory(this.conversation.messages, event.messages);
      event = { ...event, messages: this.conversation.messages };
      changed = true;
    } else if (event.kind === 'session.new') {
      this.conversation.messages = []; changed = true;
    } else if (event.kind === 'run.started') {
      this.busy = true; this.error = ''; this.activity = ''; this.reconcilingError = false;
    } else if (event.kind === 'run.finished') {
      this.busy = false; this.activity = ''; changed = true;
    } else if (event.kind === 'state') {
      this.reconcilingError = false;
      this.busy = event.busy; this.model = event.model; this.effort = event.effort;
      if (!this.configured) {
        this.configured = true;
        // A reconnect may find work still running. Leave its configuration alone.
        if (this.configure && !event.busy) {
          const model = this.conversation.model || this.options.model;
          const effort = this.conversation.effort || this.options.effort;
          if (model && model !== event.model) this.selectModel(model);
          if (event.reasoning && effort !== event.effort) this.setEffort(effort);
        }
      }
      this.conversation.model = event.model; this.conversation.effort = event.effort;
    } else if (event.kind === 'models') this.models = event.models;
    else if (event.kind === 'effort.levels') this.effortLevels = event.levels;
    else if (event.kind === 'model') this.model = this.conversation.model = event.model;
    else if (event.kind === 'tool') {
      this.activity = `${event.name || 'Tool'} · ${event.phase}`;
      const message = toolMessage(event);
      const index = this.conversation.messages.findIndex(item => item.id === message.id);
      if (index < 0) this.conversation.messages.push(message);
      else this.conversation.messages[index] = { ...message, tool: { ...this.conversation.messages[index].tool, ...message.tool } };
      changed = true;
    }
    else if (event.kind === 'state.refresh') {
      this.client.send('get_state'); this.client.send('get_available_thinking_levels');
    } else if (event.kind === 'error' || event.type === 'edge.error') {
      this.error = event.message;
      // A rejected settings command must not make an ongoing run appear idle.
      if (!this.reconcilingError) { this.reconcilingError = true; this.client.send('get_state'); }
    }
    if (changed) {
      const first = this.conversation.messages.find(message => message.role === 'user');
      if (first) this.conversation.title = userMessage(first.text).text.slice(0, 70);
      this.conversation.updated = Date.now();
    }
    this.options.changed(); this.notify(event);
  }
  send(message: string, images: { type: 'image'; data: string; mimeType: string }[]): void {
    if (this.busy && !this.steeringSupported) throw new Error('Update and restart the computer bridge to send instructions while this chat is running.');
    const prompt = completionPrompt(message);
    if (prompt.length > 150000) throw new Error('The message and notes are too long. Attach a smaller selection.');
    const requestId = this.client.send('prompt', { message: prompt, streamingBehavior: 'steer', ...(images.length ? { images } : {}) });
    this.conversation.messages.push({ id: `pending:${requestId}`, requestId, delivery: 'sending', role: 'user', text: prompt, final: true,
      ...(images.length ? { images: images.map(image => ({ ...image })) } : {}) });
    this.conversation.updated = Date.now();
    this.busy = true; this.error = ''; this.activity = '';
    this.options.changed(); this.notify({ kind: 'history', messages: this.conversation.messages }); this.notify();
  }
  stop(): void { if (this.steeringSupported) this.client.send('clear_queue'); this.client.send('abort'); }
  selectModel(id: string): void {
    const separator = id.indexOf('/'); if (separator < 1) return;
    this.client.send('set_model', { provider: id.slice(0, separator), modelId: id.slice(separator + 1) });
  }
  setEffort(level: string): void { this.client.send('set_thinking_level', { level }); }
  setPermissions(mode: PermissionId): void { this.client.send('edge.permissions', { mode }); }
  dispose(end = false): void {
    this.disposed = true; this.listeners.clear();
    if (end) this.client.endSession(); else this.client.disconnect();
  }
}
