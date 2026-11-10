import { toolMessage } from './tools';
import { panelHeight } from './viewport';
import { userMessage } from './references';
import { clipboardImageFiles, IMAGE_TYPES, imageSource, readClipboardImages } from './images';
import type { ComposerDraft } from './sessions';
import { isPermissionId, type AgentEvent, type ChatMessage, type ErrorPacket, type ModelEntry, type PermissionId, type PermissionMode } from '../shared/protocol';
export type { ChatMessage } from '../shared/protocol';
export interface Attachment { id: string; name: string; path?: string; text?: string; data?: string; mimeType?: string; }
export interface PanelActions {
  send(text: string, attachments: Attachment[]): void | Promise<void>;
  stop(): void;
  pair(): void;
  settings(): void;
  fresh(): void;
  history(): void;
  attach(kind: 'note' | 'selection' | 'browse'): Promise<Attachment | undefined>;
  model(id: string): void;
  effort(level: string): void;
  permissions(mode: PermissionId): void;
  icon?(element: HTMLElement, name: string): void;
  openNote?(path: string): void;
  copyNotePath?(path: string): void;
  markdown(text: string, element: HTMLElement): void;
  changed(messages: ChatMessage[]): void;
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  return createEl(tag, { cls, text });
}
function button(label: string, title: string, action: () => void, cls = ''): HTMLButtonElement {
  const element = node('button', cls, label); element.type = 'button'; element.title = title; element.setAttribute('aria-label', title);
  element.addEventListener('click', action); return element;
}
export class ChatPanel {
  private status: HTMLElement;
  private model: HTMLSelectElement;
  private effort: HTMLSelectElement;
  private permissions: HTMLSelectElement;
  private currentPermissions: PermissionId = 'full';
  private typing: HTMLElement;
  private typingText: HTMLElement;
  private viewportCleanup?: () => void;
  private transcript: HTMLElement;
  private empty: HTMLElement;
  private input: HTMLTextAreaElement;
  private sendButton: HTMLButtonElement;
  private stopButton: HTMLButtonElement;
  private chips: HTMLElement;
  private activity: HTMLElement;
  private outbox: HTMLElement;
  private outboxKey = '';
  private attachments: Attachment[] = [];
  private skipAutoAttachment = false;
  private autoAttachmentPath?: string;
  private imageQueue: Promise<void> = Promise.resolve();
  private imageImports = 0;
  private imageDialog?: HTMLDialogElement;
  private rows = new Map<string, { row: HTMLElement; body: HTMLElement; text: string; final: boolean; images?: ChatMessage['images'] }>();
  private messages: ChatMessage[] = [];
  private disposed = false;
  private busy = false;
  private activeButton: HTMLButtonElement;
  private activeCount: HTMLElement;
  private conversationLabel: HTMLButtonElement;
  private conversationNotePath?: string;
  private chatState: HTMLElement;
  private state: string = 'disconnected';
  setResumeHint(text: string, resume?: () => void): void {
    this.root.querySelector('.edge-resume-hint')?.remove();
    const hint = node('div', 'edge-resume-hint', text);
    if (resume) hint.append(button('Continue last chat', 'Continue last chat', resume));
    this.transcript.before(hint);
  }
  constructor(private root: HTMLElement, private actions: PanelActions, paired: boolean) {
    root.replaceChildren(); root.classList.add('edge-panel');
    const header = node('header', 'edge-header');
    const heading = node('div', 'edge-heading');
    heading.append(node('span', 'edge-mark', 'π'), node('h2', '', 'Pi Edge'));
    const controls = node('div', 'edge-header-actions');
    this.activeButton = this.iconButton('History', 'Chat history', () => actions.history(), 'history', 'edge-active-button');
    this.activeCount = node('span', 'edge-active-count', '0');
    this.activeButton.append(node('span', 'edge-active-label', 'History'), this.activeCount);
    controls.append(this.iconButton('+', 'New conversation', () => actions.fresh(), 'plus'), this.activeButton, this.iconButton('Settings', 'Open settings', () => actions.settings(), 'settings'));
    header.append(heading, controls);
    const conversation = node('div', 'edge-conversation');
    this.conversationLabel = node('button', 'edge-conversation-title', 'New conversation');
    this.conversationLabel.type = 'button';
    this.conversationLabel.addEventListener('click', () => {
      if (this.conversationNotePath) this.actions.copyNotePath?.(this.conversationNotePath);
    });
    this.chatState = node('span', 'edge-chat-state', 'Offline');
    conversation.append(this.conversationLabel, this.chatState);
    const connection = node('div', 'edge-connection');
    this.status = node('span', 'edge-status', paired ? 'Connecting…' : 'Computer not paired'); this.status.setAttribute('role', 'status');
    this.model = node('select', 'edge-model'); this.model.setAttribute('aria-label', 'Model');
    this.model.append(new Option('Pi · model on computer', ''));
    this.model.addEventListener('change', () => { this.effort.hidden = true; actions.model(this.model.value); });
    this.effort = node('select', 'edge-effort'); this.effort.setAttribute('aria-label', 'Reasoning effort'); this.effort.title = 'Reasoning effort';
    for (const level of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) this.effort.add(new Option(level.charAt(0).toUpperCase() + level.slice(1), level));
    this.effort.value = 'medium'; this.effort.hidden = true;
    this.effort.addEventListener('change', () => actions.effort(this.effort.value));
    const modelControls = node('div', 'edge-model-controls'); modelControls.append(this.model, this.effort);
    connection.append(this.status, modelControls);
    header.insertBefore(connection, controls);
    this.transcript = node('div', 'edge-transcript'); this.transcript.setAttribute('role', 'log'); this.transcript.setAttribute('aria-label', 'Conversation');
    this.empty = node('section', 'edge-empty');
    this.empty.append(node('h3', '', paired ? 'Start a conversation' : 'Connect your computer'),
      node('p', '', paired ? 'Fresh context. Ask Pi or attach a note to begin.' : 'Start the bridge on your computer, then paste its connection code here.'));
    if (!paired) this.empty.append(button('Pair computer', 'Paste a connection code', () => actions.pair(), 'mod-cta'));
    this.typing = node('div', 'edge-typing'); this.typing.hidden = true; this.typing.setAttribute('role', 'status');
    const dots = node('span', 'edge-typing-dots'); dots.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 3; index++) dots.append(node('i'));
    this.typingText = node('span', 'edge-typing-text', 'Thinking…'); this.typing.append(dots, this.typingText);
    this.transcript.append(this.empty, this.typing);
    this.activity = node('div', 'edge-activity'); this.activity.setAttribute('role', 'status'); this.activity.hidden = true;
    this.outbox = node('div', 'edge-outbox'); this.outbox.hidden = true;
    this.outbox.setAttribute('aria-label', 'Outgoing messages');
    const composer = node('form', 'edge-composer');
    this.chips = node('div', 'edge-attachments');
    this.input = node('textarea', 'edge-input'); this.input.placeholder = 'Ask Pi…'; this.input.rows = 2; this.input.setAttribute('aria-label', 'Message');
    this.input.addEventListener('input', () => { this.input.style.removeProperty('--edge-input-height'); this.input.style.setProperty('--edge-input-height', Math.min(140, this.input.scrollHeight) + 'px'); });
    this.input.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); this.submit(); } });
    this.input.addEventListener('paste', event => {
      const files = clipboardImageFiles(event.clipboardData);
      if (files.length) {
        event.preventDefault(); event.stopPropagation(); void this.addImages(files);
      } else if (!event.clipboardData?.types.length || event.clipboardData.types.some(type => type.startsWith('image/'))) {
        // Native mobile paste can announce an image but omit its file payload.
        event.preventDefault(); event.stopPropagation(); void this.pasteImage();
      }
    }, { capture: true });
    this.input.addEventListener('beforeinput', event => {
      if (event.inputType !== 'insertFromPaste') return;
      const files = clipboardImageFiles(event.dataTransfer);
      if (files.length) { event.preventDefault(); event.stopPropagation(); void this.addImages(files); }
    }, { capture: true });
    composer.addEventListener('dragover', event => event.preventDefault());
    composer.addEventListener('drop', event => {
      const files = clipboardImageFiles(event.dataTransfer);
      if (files.length) { event.preventDefault(); event.stopPropagation(); void this.addImages(files); }
    });
    const toolbar = node('div', 'edge-toolbar');
    const references = node('div', 'edge-reference-actions');
    for (const [label, kind, title, icon] of [['Note', 'note', 'Attach current note', 'file-text'], ['Selection', 'selection', 'Attach selected text', 'text-select']] as const) {
      references.append(this.iconButton(label, title, () => { void actions.attach(kind).then(item => { if (item) this.addAttachment(item); }).catch((error: unknown) => this.error(error instanceof Error ? error.message : 'Could not attach the note.')); }, icon));
    }
    const upload = node('input'); upload.type = 'file'; upload.accept = 'image/png,image/jpeg,image/webp,image/gif'; upload.multiple = true; upload.hidden = true;
    upload.addEventListener('change', () => { void this.addImages([...(upload.files || [])]); upload.value = ''; });
    references.append(this.iconButton('Image', 'Attach images', () => upload.click(), 'image'));
    this.permissions = node('select', 'edge-permissions'); this.permissions.setAttribute('aria-label', 'Permissions'); this.permissions.title = 'Tool permissions';
    this.setPermissions('full', [{ id: 'read', label: 'Read only' }, { id: 'edit', label: 'Read & write' }, { id: 'full', label: 'Full access' }]);
    this.permissions.addEventListener('change', () => { const selected = this.permissions.value; this.permissions.value = this.currentPermissions; if (isPermissionId(selected)) actions.permissions(selected); });
    const primary = node('div', 'edge-primary-actions');
    this.stopButton = this.iconButton('Stop', 'Stop generation', () => actions.stop(), 'square'); this.stopButton.classList.add('edge-stop-inactive'); this.stopButton.disabled = true;
    this.sendButton = this.iconButton('↑', 'Send message', () => { void this.submit(); }, 'arrow-up', 'mod-cta edge-send-button');
    this.sendButton.append(node('span', 'edge-send-label', 'Send'));
    primary.append(this.stopButton, this.sendButton); toolbar.append(references, this.permissions, primary);
    const autoAttachment = node('div', 'edge-auto-attachment'); autoAttachment.hidden = true;
    autoAttachment.setAttribute('role', 'status');
    autoAttachment.append(node('span', '', 'Current note will be attached'),
      this.iconButton('×', 'Do not attach current note', () => {
        this.skipAutoAttachment = true;
        this.setAutoAttachment(this.autoAttachmentPath);
      }, 'x', 'edge-auto-attachment-remove'));
    composer.append(autoAttachment, this.chips, this.input, upload, toolbar);
    composer.addEventListener('submit', event => { event.preventDefault(); this.submit(); });
    root.append(header, conversation, this.transcript, this.activity, this.outbox, composer);
    this.trackViewport();
  }
  private iconButton(label: string, title: string, action: () => void, icon: string, cls = ''): HTMLButtonElement {
    const element = button(label, title, action, `edge-icon-button ${cls}`); this.actions.icon?.(element, icon); return element;
  }
  setToolDetails(show: boolean): void { this.root.classList.toggle('edge-show-tools', show); }
  setActiveCount(_total: number, running: number): void {
    this.activeCount.textContent = running ? String(running) : '';
    this.activeCount.hidden = !running;
    this.activeButton.dataset.running = String(running > 0);
    this.activeButton.title = `Chat history · ${running} running`;
    this.activeButton.setAttribute('aria-label', `Chat history, running: ${running}`);
  }
  setConversation(title: string, notePath?: string): void {
    this.conversationLabel.textContent = notePath || title;
    this.conversationNotePath = notePath;
    this.conversationLabel.disabled = !notePath;
    this.conversationLabel.title = notePath ? `${notePath} · ${title} · 点击复制仓库内路径` : title;
    this.conversationLabel.setAttribute('aria-label', notePath ? `复制文档路径（从仓库根目录）：${notePath}` : title);
  }
  getDraft(): ComposerDraft { return { text: this.input.value, attachments: [...this.attachments], skipAutoAttachment: this.skipAutoAttachment }; }
  restoreDraft(draft: ComposerDraft): void {
    this.input.value = draft.text; this.attachments = [...draft.attachments]; this.renderAttachments();
    this.skipAutoAttachment = !!draft.skipAutoAttachment;
    this.setAutoAttachment(this.autoAttachmentPath);
  }
  setPermissions(mode: PermissionId, modes: PermissionMode[]): void {
    this.currentPermissions = mode; this.permissions.replaceChildren(...modes.map(item => new Option(item.label, item.id))); this.permissions.value = mode;
  }
  private trackViewport(): void {
    const viewport = window.visualViewport;
    let layoutHeight = window.innerHeight, width = window.innerWidth, frame = 0;
    const update = () => {
      frame = 0;
      if (this.disposed) return;
      const keyboardHeight = Math.max(Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-height')) || 0, Number.parseFloat(getComputedStyle(document.body).getPropertyValue('--keyboard-height')) || 0);
      if (width !== window.innerWidth) { layoutHeight = window.innerHeight; width = window.innerWidth; }
      else if (!keyboardHeight) layoutHeight = Math.max(layoutHeight, window.innerHeight);
      this.root.style.maxHeight = panelHeight({ layoutHeight,
        viewportHeight: viewport?.height ?? window.innerHeight,
        viewportTop: viewport?.offsetTop ?? 0, keyboardHeight,
        top: this.root.getBoundingClientRect().top }) + 'px';
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    viewport?.addEventListener('resize', schedule); viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule); this.root.addEventListener('focusin', schedule); this.root.addEventListener('focusout', schedule);
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
    this.viewportCleanup = () => {
      window.cancelAnimationFrame(frame); observer.disconnect();
      viewport?.removeEventListener('resize', schedule); viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule); this.root.removeEventListener('focusin', schedule); this.root.removeEventListener('focusout', schedule);
      this.root.style.removeProperty('max-height');
    };
    schedule();
  }
  setAutoAttachment(path?: string): void {
    this.autoAttachmentPath = path;
    const hint = this.input.parentElement?.querySelector<HTMLElement>('.edge-auto-attachment');
    if (hint) hint.hidden = !path || this.skipAutoAttachment;
  }
  private submitting = false;
  private async submit(): Promise<void> {
    if (this.submitting) return;
    if (this.imageImports) { this.error('Wait for the images to finish attaching.', this.busy); return; }
    const text = this.input.value.trim();
    if (!text && !this.attachments.length) return;
    if (this.state === 'disconnected') { this.actions.pair(); return; }
    this.submitting = true;
    try {
      await this.actions.send(text || 'Please look at the attached context.', [...this.attachments]);
      this.input.value = ''; this.input.style.removeProperty('--edge-input-height'); this.attachments = []; this.renderAttachments();
      this.setBusy(true); this.typingText.textContent = this.state === 'ready' ? 'Thinking…' : 'Waiting for connection…';
    } catch (error) { this.error((error as Error).message); } finally { this.submitting = false; }
  }
  statusChanged(state: string, detail: string): void {
    this.state = state; this.status.textContent = detail; this.status.title = detail; this.status.dataset.state = state;
    this.renderChatState();
    if (state === 'error') this.setBusy(false);
  }
  private renderChatState(): void {
    this.chatState.textContent = this.activity.dataset.error === 'true' ? 'Error' : this.state === 'ready' ? this.busy ? 'Running' : 'Idle' : this.state === 'connecting' || this.state === 'reconnecting' ? 'Connecting…' : 'Offline';
    this.chatState.dataset.running = String(this.state === 'ready' && this.busy);
  }
  setBusy(value: boolean): void {
    const started = value && !this.busy;
    const keepError = !value && this.activity.dataset.error === 'true';
    if (!keepError) delete this.activity.dataset.error;
    this.busy = value; this.typing.hidden = !value; this.permissions.disabled = value;
    this.renderChatState();
    this.activity.hidden = !keepError;
    if (value) this.empty.hidden = true;
    if (started) { this.typingText.textContent = 'Thinking…'; this.transcript.scrollTop = this.transcript.scrollHeight; }
    this.sendButton.disabled = this.imageImports > 0; this.stopButton.classList.toggle('edge-stop-inactive', !value); this.stopButton.disabled = !value;
    if (!value && !keepError) this.activity.textContent = '';
  }
  setModels(models: ModelEntry[], current = ''): void {
    this.model.replaceChildren();
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const model of models) {
      const provider = model.provider || model.id.split('/')[0];
      if (!groups.has(provider)) { const group = node('optgroup'); group.label = provider; groups.set(provider, group); this.model.append(group); }
      const name = model.name.replace(provider + ' / ', '');
      groups.get(provider)!.append(new Option(name, model.id));
    }
    if (current && !models.some(model => model.id === current)) this.model.prepend(new Option(current, current));
    if (current) this.model.value = current;
    if (!models.length) this.model.add(new Option('No models available', ''));
    this.model.disabled = !models.length;
  }
  setEffortLevels(levels: string[]): void {
    const current = this.effort.value; this.effort.replaceChildren();
    for (const level of levels) this.effort.add(new Option(level.charAt(0).toUpperCase() + level.slice(1), level));
    this.effort.disabled = levels.length <= 1; this.effort.hidden = !levels.some(level => level !== 'off');
    if (levels.includes(current)) this.effort.value = current;
  }
  setEffort(level: string): void { if (level && [...this.effort.options].some(option => option.value === level)) this.effort.value = level; }
  setCurrentModel(model: string): void {
    if (!model) return;
    if (![...this.model.options].some(option => option.value === model)) this.model.add(new Option(model, model));
    this.model.value = model;
  }
  handle(event: AgentEvent | ErrorPacket): void {
    if (event.kind === 'message' && (event.role === 'user' || event.role === 'assistant')) {
      if (event.role === 'assistant' && !event.final) this.typingText.textContent = 'Responding…';
      if (event.text || event.images?.length) this.upsert({ id: event.id, role: event.role, text: event.text, final: !!event.final, images: event.images });
    } else if (event.kind === 'history') {
      this.restore(event.messages); this.actions.changed([...this.messages]);
    } else if (event.kind === 'run.started') this.setBusy(true);
    else if (event.kind === 'run.finished') this.setBusy(false);
    else if (event.kind === 'tool') {
      this.typingText.textContent = `${event.name || 'Tool'} · ${event.phase}`;
      const message = toolMessage(event);
      const previous = this.messages.find(item => item.id === message.id);
      this.upsert({ ...message, tool: { ...previous?.tool, ...message.tool } });
    }
    else if (event.kind === 'state') { this.setCurrentModel(event.model); if (event.reasoning === false) this.effort.hidden = true; this.setEffort(event.effort); this.setBusy(event.busy); }
    else if (event.kind === 'model') this.setCurrentModel(event.model);
    else if (event.kind === 'effort.levels') this.setEffortLevels(event.levels);
    else if (event.kind === 'models') this.setModels(event.models, this.model.value);
    else if (event.kind === 'session.new') this.restore([]);
    else if (event.kind === 'error' || event.type === 'edge.error') this.error(event.message);
  }
  private upsert(message: ChatMessage, notify = true): void {
    if (this.disposed) return;
    this.empty.hidden = true;
    const atBottom = this.transcript.scrollHeight - this.transcript.scrollTop - this.transcript.clientHeight < 100;
    let row = this.rows.get(message.id);
    if (!row) {
      const element = node('article', `edge-message edge-${message.role}${message.tool ? ' edge-tool-message' : ''}`);
      element.append(node('div', 'edge-message-label', message.tool ? 'Tool' : message.role === 'user' ? 'You' : 'Pi'));
      const body = node('div', 'edge-message-body'); element.append(body);
      element.append(this.iconButton('Copy', message.role === 'user' ? 'Copy message' : 'Copy response', () => { const text = this.rows.get(message.id)?.text || ''; void navigator.clipboard.writeText(message.role === 'user' ? userMessage(text).text : text).catch(() => this.error('Could not copy. Select the text to copy it.')); }, 'copy', 'edge-copy'));
      this.transcript.insertBefore(element, this.typing); row = { row: element, body, text: '', final: false }; this.rows.set(message.id, row);
    }
    if (message.tool || row.text !== message.text || row.final !== message.final || row.images !== message.images) {
      row.text = message.text; row.final = message.final; row.row.classList.toggle('is-streaming', !message.final);
      row.images = message.images;
      row.body.replaceChildren();
      const label = row.row.querySelector('.edge-message-label');
      if (label && message.role === 'user') label.textContent = message.delivery === 'queued' ? 'You · Queued for next turn' : message.delivery === 'sending' ? 'You · Sending…' : message.delivery === 'failed' ? 'You · Not sent' : 'You';
      const content = userMessage(message.text);
      const display = message.role === 'user' ? content.text : message.text;
      if (message.tool) {
        const details = node('details', 'edge-tool-details');
        details.append(node('summary', '', `${message.tool.name} · ${message.tool.phase}`));
        for (const [label, value] of [['Input', message.tool.input], ['Result', message.tool.output]]) {
          if (value) { details.append(node('div', 'edge-tool-label', label), node('pre', 'edge-tool-content', value)); }
        }
        if (!message.tool.input && !message.tool.output) details.append(node('p', '', message.tool.phase === 'running' ? 'Waiting for tool details. Older bridges do not send inputs or results.' : 'No inputs or results were received for this call. Update and restart the computer bridge to enable detailed records.'));
        row.body.append(details);
      }
      else if (message.final && message.role === 'assistant') this.actions.markdown(display, row.body);
      else row.body.textContent = display;
      if (message.images?.length) {
        const images = node('div', 'edge-message-images');
        for (const [index, image] of message.images.entries()) {
          const source = imageSource(image);
          if (!source) continue;
          const label = `Attached image ${index + 1}`;
          const preview = button('', `Open ${label.toLowerCase()}`, () => this.openImage(source, label), 'edge-message-image');
          const img = node('img'); img.src = source; img.alt = label; img.loading = 'lazy';
          img.addEventListener('load', () => { if (atBottom) this.transcript.scrollTop = this.transcript.scrollHeight; }, { once: true });
          preview.append(img); images.append(preview);
        }
        row.body.append(images);
      }
      if (message.role === 'user' && content.references.length) {
        const links = node('div', 'edge-message-references');
        for (const reference of content.references) {
          const link = node('a', 'internal-link edge-note-reference', reference.name);
          link.href = reference.path; link.dataset.href = reference.path;
          link.addEventListener('click', event => { event.preventDefault(); this.actions.openNote?.(reference.path); });
          links.append(link);
        }
        row.body.append(links);
      }
    }
    const index = this.messages.findIndex(item => item.id === message.id);
    if (index >= 0) this.messages[index] = message; else this.messages.push(message);
    if (notify && message.final) this.actions.changed([...this.messages]);
    if (atBottom || message.role === 'user') this.transcript.scrollTop = this.transcript.scrollHeight;
  }
  setOutbox(messages: ChatMessage[], dismiss: (id: string) => void): void {
    const key = JSON.stringify(messages.map(message => [message.id, message.delivery]));
    if (this.outboxKey === key) return;
    this.outboxKey = key;
    this.outbox.replaceChildren(); this.outbox.hidden = !messages.length;
    for (const message of messages) {
      const details = node('details', 'edge-outbox-item');
      const label = message.delivery === 'queued' ? 'Queued for next turn' : message.delivery === 'accepted' ? 'Accepted · awaiting history sync' : message.delivery === 'failed' ? 'Failed or cancelled' : message.delivery === 'unconfirmed' ? 'Delivery unconfirmed · check conversation before retrying' : 'Sending…';
      const text = userMessage(message.text).text;
      details.append(node('summary', '', `${label}: ${text.slice(0, 60) || 'Image message'}`));
      details.append(node('pre', 'edge-outbox-text', text));
      if (message.images?.length) details.append(node('p', '', `${message.images.length} attached image(s)`));
      details.append(button('Copy', 'Copy outgoing message', () => { void navigator.clipboard.writeText(text).catch(() => this.error('Could not copy message.')); }));
      if (message.delivery === 'failed' || message.delivery === 'unconfirmed') details.append(button('Dismiss', 'Dismiss outgoing message', () => dismiss(message.id)));
      this.outbox.append(details);
    }
  }
  restore(messages: ChatMessage[]): void {
    this.messages = []; this.rows.clear(); this.transcript.replaceChildren(this.empty, this.typing); this.empty.hidden = messages.length > 0;
    for (const message of messages) this.upsert(message, false);
    this.transcript.scrollTop = this.transcript.scrollHeight;
  }
  error(message: string, busy = false): void { this.setBusy(busy); this.activity.hidden = false; this.activity.textContent = message; this.activity.dataset.error = 'true'; this.renderChatState(); }
  addAttachment(attachment: Attachment): void {
    if (this.disposed) return;
    if (this.attachments.length >= 6) return this.error('Attach up to six items per message.');
    this.attachments = this.attachments.filter(item => item.id !== attachment.id); this.attachments.push(attachment); this.renderAttachments();
  }
  private renderAttachments(): void {
    this.chips.replaceChildren();
    for (const item of this.attachments) {
      const chip = button(`${item.data ? '' : '↗ '}${item.name} ×`, `Remove ${item.name}`, () => { this.attachments = this.attachments.filter(other => other.id !== item.id); this.renderAttachments(); }, 'edge-attachment');
      const source = item.data && item.mimeType ? imageSource({ data: item.data, mimeType: item.mimeType }) : undefined;
      if (source) { const img = node('img', 'edge-attachment-preview'); img.src = source; img.alt = ''; chip.prepend(img); }
      this.chips.append(chip);
    }
  }
  private openImage(source: string, label: string): void {
    this.imageDialog?.close();
    const dialog = node('dialog', 'edge-image-dialog');
    dialog.setAttribute('aria-label', label);
    const img = node('img'); img.src = source; img.alt = label;
    dialog.append(button('Close', 'Close image', () => dialog.close()), img);
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => { dialog.remove(); if (this.imageDialog === dialog) this.imageDialog = undefined; }, { once: true });
    this.root.append(dialog); this.imageDialog = dialog; dialog.showModal();
  }
  private pasteImage(): Promise<void> {
    // Invoke the clipboard API during the user's gesture, before awaiting work.
    return this.addImages(readClipboardImages());
  }
  private addImages(files: File[] | Promise<File[]>): Promise<void> {
    this.imageImports++; this.sendButton.disabled = true;
    const ready = Promise.resolve(files);
    // Clipboard access may reject while an earlier import is still reading.
    void ready.catch(() => {});
    this.imageQueue = this.imageQueue.then(async () => { await this.importImages(await ready); }).catch((error: unknown) => {
      this.error(error instanceof Error ? error.message : 'Could not read the clipboard image. Use the image picker.', this.busy);
    }).finally(() => { this.imageImports--; if (!this.disposed) this.sendButton.disabled = this.imageImports > 0; });
    return this.imageQueue;
  }
  private async importImages(files: File[]): Promise<void> {
    for (const file of files) {
      if (this.disposed) return;
      if (!IMAGE_TYPES.includes(file.type)) { this.error('Choose a PNG, JPEG, WebP or GIF image.', this.busy); continue; }
      if (this.attachments.length >= 6) { this.error('Attach up to six items per message.', this.busy); break; }
      const imageBytes = this.attachments.reduce((total, item) => total + (item.data?.length || 0) * 0.75, 0);
      if (file.size > 4_000_000 || file.size + imageBytes > 4_000_000) { this.error('Keep images below 4 MB in total per message.'); continue; }
      try {
        const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Could not read the image.')); reader.readAsDataURL(file); });
        this.addAttachment({ id: crypto.randomUUID(), name: file.name || 'Pasted image', data, mimeType: file.type });
      } catch (error) { this.error((error as Error).message); }
    }
  }
  dispose(): void { this.disposed = true; this.imageDialog?.close(); this.viewportCleanup?.(); }
}
