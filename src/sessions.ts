import { EdgeClient, type ConnectionStatus, type SocketLike } from './client';
import type { Pairing } from './pairing';
import type { Attachment } from './panel';
import type { Conversation } from './history';
import { completionPrompt, userMessage } from './references';
import { toolMessage, mergeToolHistory } from './tools';
import type { ChatMessage, ClientEvent, ModelEntry, PermissionId, PermissionMode } from '../shared/protocol';

export const MAX_ACTIVE_CHATS = 8;
export const ACTIVE_IDLE_MS = 24 * 60 * 60 * 1000;
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
  private stateKnown = false;
  private disposed = false;
  private reconcilingError = false;
  private configure = false;
  private historyQueries = new Map<string, { settled: Set<string>; updates: Map<string, ChatMessage>; sequence: number }>();
  private clearQueries = new Map<string, Set<string>>();
  private historySequence = 0;
  private appliedHistorySequence = 0;
  private reconnectOutbox = new Set<string>();

  private acceptedRequests(): Set<string> {
    return new Set(this.conversation.outbox!.filter(message => message.delivery === 'accepted' || message.delivery === 'queued').map(message => message.requestId!));
  }
  private refreshHistory(ids = this.acceptedRequests()): void {
    const id = this.client.send('get_messages');
    this.historyQueries.set(id, { settled: ids, updates: new Map(), sequence: ++this.historySequence });
    // A broken connection must not retain unbounded snapshots.
    if (this.historyQueries.size > 16) this.historyQueries.delete(this.historyQueries.keys().next().value!);
  }
  private reconcileEcho(message: ChatMessage): void {
    if (message.role !== 'user') return;
    const saved = this.conversation.messages.find(item => item.id === message.id);
    if (saved) {
      message.requestId ??= saved.requestId;
      if (!message.images?.length && saved.images?.length) message.images = saved.images;
      return;
    }
    // Attachment fallback for old bridges that omitted images. This never
    // acknowledges a send; ambiguous equal-text submissions stay untouched.
    const candidates = this.conversation.outbox!.filter(item => item.delivery !== 'failed' && item.text === message.text);
    if (!message.images?.length && candidates.length === 1 && candidates[0].images?.length) message.images = candidates[0].images;
  }

  constructor(readonly conversation: Conversation, private options: SessionOptions) {
    const legacy = conversation.messages.filter(message => message.delivery).map(message => ({ ...message, delivery: message.delivery === 'failed' ? 'failed' as const : 'unconfirmed' as const }));
    conversation.outbox = [...(conversation.outbox || []), ...legacy];
    conversation.messages = conversation.messages.filter(message => !message.delivery);
    // Old releases mixed optimistic bubbles into history. Preserve uncertain
    // sends outside the transcript rather than guessing from text/timestamps.
    conversation.lastActivity ??= conversation.updated;
    this.configure = !conversation.messages.length && !conversation.model;
    this.permissions = conversation.permissions || options.permissions;
    this.model = conversation.model || '';
    this.effort = conversation.effort || options.effort;
    this.client = new EdgeClient(options.pairing, conversation.id, {
      status: (state, detail) => {
        this.status = state; this.detail = detail;
        if (state !== 'ready') this.stateKnown = false;
        options.status(state); this.notify();
      },
      event: event => this.handle(event)
    }, options.createSocket, this.permissions);
  }
  get hasKnownState(): boolean { return this.stateKnown; }
  connect(): void { this.client.connect(); }
  private notify(event?: ClientEvent): void {
    if (!this.disposed) for (const listener of this.listeners) listener(event);
  }
  private handle(event: ClientEvent): void {
    let changed = false;
    if (event.type === 'edge.ready') {
      this.reconnectOutbox = this.acceptedRequests();
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
      const message: ChatMessage = { id: event.id, role: event.role, text: event.text, final: event.final, ...(event.images?.length ? { images: event.images } : {}) };
      this.reconcileEcho(message);
      const index = this.conversation.messages.findIndex(item => item.id === message.id);
      if (index < 0) this.conversation.messages.push(message);
      else this.conversation.messages[index] = message;
      for (const query of this.historyQueries.values()) query.updates.set(message.id, message);
      event = { kind: 'message', ...message };
      changed = true;
    } else if (event.kind === 'prompt.status') {
      const reply = event;
      const pending = this.conversation.outbox!.find(item => item.requestId === reply.requestId);
      if (pending) {
        if (reply.disposition === 'handled') this.conversation.outbox!.splice(this.conversation.outbox!.indexOf(pending), 1);
        else pending.delivery = reply.disposition === 'failed' ? 'failed' : reply.disposition === 'queued' ? 'queued' : 'accepted';
      }
      if ((reply.disposition === 'started' || reply.disposition === 'queued') && !this.busy) this.refreshHistory();
      if (reply.disposition === 'failed') this.error = reply.error || 'Pi rejected the message.';
      if (reply.disposition === 'failed' || reply.disposition === 'handled') this.client.send('get_state');
      this.notify({ kind: 'history', messages: this.conversation.messages });
      event = reply.disposition === 'failed' ? { kind: 'error', message: this.error } : { kind: 'history', messages: this.conversation.messages };
      changed = true;
    } else if (event.kind === 'queue.cleared') {
      const cleared = event.requestId ? this.clearQueries.get(event.requestId) : undefined;
      if (event.requestId) this.clearQueries.delete(event.requestId);
      for (const message of this.conversation.outbox!) if (message.delivery === 'queued' && (cleared ? cleared.has(message.requestId!) : event.messages.includes(message.text))) message.delivery = 'failed';
      event = { kind: 'history', messages: this.conversation.messages }; changed = true;
    } else if (event.kind === 'history') {
      const query = event.requestId ? this.historyQueries.get(event.requestId) : undefined;
      if (event.requestId && !query) return;
      if (event.requestId) this.historyQueries.delete(event.requestId);
      if (query && query.sequence < this.appliedHistorySequence) return;
      if (query) this.appliedHistorySequence = query.sequence;
      const incoming = event.messages.map(message => ({ ...message }));
      for (const message of incoming) this.reconcileEcho(message);
      this.conversation.messages = mergeToolHistory(this.conversation.messages, incoming);
      if (query) {
        // A live message can arrive while the history response is in flight.
        for (const message of query.updates.values()) {
          const index = this.conversation.messages.findIndex(item => item.id === message.id);
          if (index < 0) this.conversation.messages.push(message);
          else this.conversation.messages[index] = message;
        }
      }
      if (query) {
        this.conversation.outbox = this.conversation.outbox!.filter(message => {
          if (!query.settled.has(message.requestId!) || message.delivery === 'failed') return true;
          const anchor = message.afterMessageId ? incoming.findIndex(item => item.id === message.afterMessageId) : -1;
          const following = incoming.slice(anchor + 1);
          const user = following.findIndex(item => item.role === 'user');
          if ((!message.afterMessageId || anchor >= 0) && user >= 0 && following.slice(user + 1).some(item => item.role === 'assistant' && !item.tool && item.final && item.text)) return false;
          message.delivery = 'unconfirmed';
          this.error = 'The run ended without a confirmed reply. Your outgoing message is retained; check the conversation before retrying.';
          return true;
        });
      }
      event = { ...event, messages: this.conversation.messages };
      changed = true;
    } else if (event.kind === 'session.new') {
      this.conversation.messages = []; this.conversation.outbox = []; this.historyQueries.clear(); this.clearQueries.clear(); changed = true;
    } else if (event.kind === 'run.started') {
      this.busy = true; this.error = ''; this.activity = ''; this.reconcilingError = false;
    } else if (event.kind === 'run.finished') {
      this.busy = false; this.activity = ''; this.refreshHistory(); changed = true;
    } else if (event.kind === 'state') {
      this.stateKnown = true;
      if (this.busy && !event.busy) this.conversation.lastActivity = Date.now();
      this.reconcilingError = false;
      if (!event.busy && this.reconnectOutbox.size) this.refreshHistory(this.reconnectOutbox);
      this.reconnectOutbox = new Set();
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
      const updated = this.conversation.messages.find(item => item.id === message.id)!;
      for (const query of this.historyQueries.values()) query.updates.set(message.id, updated);
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
      if (event.kind === 'message') this.conversation.updated = Date.now();
    }
    if ((changed && event.kind !== 'history') || event.kind === 'run.started') this.conversation.lastActivity = Date.now();
    this.options.changed(); this.notify(event);
    if (event.kind === 'history' && this.error) this.notify({ kind: 'error', message: this.error });
  }
  send(message: string, images: { type: 'image'; data: string; mimeType: string }[]): void {
    if (this.busy && !this.steeringSupported) throw new Error('Update and restart the computer bridge to send instructions while this chat is running.');
    const prompt = completionPrompt(message);
    if (prompt.length > 150000) throw new Error('The message and notes are too long. Attach a smaller selection.');
    const requestId = this.client.send('prompt', { message: prompt, streamingBehavior: 'steer', ...(images.length ? { images } : {}) });
    this.conversation.outbox!.push({ id: `pending:${requestId}`, requestId, afterMessageId: this.conversation.messages.at(-1)?.id, delivery: 'sending', role: 'user', text: prompt, final: true,
      ...(images.length ? { images: images.map(image => ({ ...image })) } : {}) });
    this.conversation.updated = this.conversation.lastActivity = Date.now();
    this.busy = true; this.error = ''; this.activity = '';
    this.options.changed(); this.notify({ kind: 'history', messages: this.conversation.messages }); this.notify();
  }
  dismissOutgoing(id: string): void {
    this.conversation.outbox = this.conversation.outbox!.filter(message => message.id !== id || (message.delivery !== 'failed' && message.delivery !== 'unconfirmed'));
    this.options.changed(); this.notify();
  }
  canDetach(): boolean {
    // Disconnecting preserves the bridge process and saved Pi context. Never
    // evict a known run, composer draft, or outgoing message to make room.
    return !this.busy && !this.draft.text && !this.draft.attachments.length && !this.conversation.outbox!.length;
  }
  canRelease(): boolean {
    return this.status === 'ready' && this.stateKnown && !this.busy && !this.draft.text && !this.draft.attachments.length && !this.conversation.outbox!.length;
  }
  isExpired(now = Date.now()): boolean {
    return this.canRelease() && now - (this.conversation.lastActivity ?? this.conversation.updated) >= ACTIVE_IDLE_MS;
  }
  stop(): void {
    if (this.steeringSupported) {
      const ids = new Set(this.conversation.outbox!.map(message => message.requestId!));
      this.clearQueries.set(this.client.send('clear_queue'), ids);
    }
    this.client.send('abort');
  }
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
