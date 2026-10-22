import { panelHeight } from './viewport';
import { userMessage } from './references';
import { isPermissionId, type AgentEvent, type ChatMessage, type ErrorPacket, type ModelEntry, type PermissionId, type PermissionMode } from '../shared/protocol';
export type { ChatMessage } from '../shared/protocol';
export interface Attachment { id: string; name: string; path?: string; text?: string; data?: string; mimeType?: string; }
export interface PanelActions {
  send(text: string, attachments: Attachment[]): void;
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
  markdown(text: string, element: HTMLElement): void;
  changed(messages: ChatMessage[]): void;
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.className = cls; element.textContent = text; return element;
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
  private attachments: Attachment[] = [];
  private rows = new Map<string, { row: HTMLElement; body: HTMLElement; text: string; final: boolean }>();
  private messages: ChatMessage[] = [];
  private disposed = false;
  private busy = false;
  private state: string = 'disconnected';
  constructor(private root: HTMLElement, private actions: PanelActions, paired: boolean) {
    root.replaceChildren(); root.classList.add('edge-panel');
    const header = node('header', 'edge-header');
    const heading = node('div', 'edge-heading');
    heading.append(node('span', 'edge-mark', 'π'), node('h2', '', 'Pi Edge'));
    const controls = node('div', 'edge-header-actions');
    controls.append(this.iconButton('+', 'New conversation', actions.fresh, 'plus'), this.iconButton('History', 'Conversation history', actions.history, 'history'), this.iconButton('Settings', 'Open settings', actions.settings, 'settings'));
    header.append(heading, controls);
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
    this.transcript = node('div', 'edge-transcript'); this.transcript.setAttribute('role', 'log'); this.transcript.setAttribute('aria-label', 'Conversation');
    this.empty = node('section', 'edge-empty');
    this.empty.append(node('h3', '', paired ? 'Start a conversation' : 'Connect your computer'),
      node('p', '', paired ? 'Ask Pi or attach a note to begin.' : 'Start the bridge on your computer, then paste its connection code here.'));
    if (!paired) this.empty.append(button('Pair computer', 'Paste a connection code', actions.pair, 'mod-cta'));
    this.typing = node('div', 'edge-typing'); this.typing.hidden = true; this.typing.setAttribute('role', 'status');
    const dots = node('span', 'edge-typing-dots'); dots.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 3; index++) dots.append(node('i'));
    this.typingText = node('span', 'edge-typing-text', 'Thinking…'); this.typing.append(dots, this.typingText);
    this.transcript.append(this.empty, this.typing);
    this.activity = node('div', 'edge-activity'); this.activity.setAttribute('role', 'status'); this.activity.hidden = true;
    const composer = node('form', 'edge-composer');
    this.chips = node('div', 'edge-attachments');
    this.input = node('textarea', 'edge-input'); this.input.placeholder = 'Ask Pi…'; this.input.rows = 2; this.input.setAttribute('aria-label', 'Message');
    this.input.addEventListener('input', () => { this.input.style.removeProperty('--edge-input-height'); this.input.style.setProperty('--edge-input-height', Math.min(140, this.input.scrollHeight) + 'px'); });
    this.input.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); this.submit(); } });
    this.input.addEventListener('paste', event => {
      const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
      if (files.length) { event.preventDefault(); void this.addImages(files); }
    });
    composer.addEventListener('dragover', event => event.preventDefault());
    composer.addEventListener('drop', event => {
      const files = [...(event.dataTransfer?.files || [])].filter(file => file.type.startsWith('image/'));
      if (files.length) { event.preventDefault(); void this.addImages(files); }
    });
    const toolbar = node('div', 'edge-toolbar');
    const references = node('div', 'edge-reference-actions');
    for (const [label, kind, title, icon] of [['Note', 'note', 'Attach current note', 'file-text'], ['Selection', 'selection', 'Attach selected text', 'text-select'], ['Browse', 'browse', 'Choose a note', 'search']] as const) {
      references.append(this.iconButton(label, title, () => { void actions.attach(kind).then(item => { if (item) this.addAttachment(item); }).catch(error => this.error(error.message)); }, icon));
    }
    const upload = node('input'); upload.type = 'file'; upload.accept = 'image/png,image/jpeg,image/webp,image/gif'; upload.multiple = true; upload.hidden = true;
    upload.addEventListener('change', () => { void this.addImages([...(upload.files || [])]); upload.value = ''; });
    references.append(this.iconButton('Image', 'Attach images', () => upload.click(), 'image'));
    this.permissions = node('select', 'edge-permissions'); this.permissions.setAttribute('aria-label', 'Permissions'); this.permissions.title = 'Tool permissions';
    this.setPermissions('full', [{ id: 'read', label: 'Read only' }, { id: 'edit', label: 'Read & write' }, { id: 'full', label: 'Full access' }]);
    this.permissions.addEventListener('change', () => { const selected = this.permissions.value; this.permissions.value = this.currentPermissions; if (isPermissionId(selected)) actions.permissions(selected); });
    const primary = node('div', 'edge-primary-actions');
    this.stopButton = this.iconButton('Stop', 'Stop generation', actions.stop, 'square'); this.stopButton.hidden = true;
    this.sendButton = this.iconButton('↑', 'Send message', () => this.submit(), 'arrow-up', 'mod-cta edge-send-button');
    this.sendButton.append(node('span', 'edge-send-label', 'Send'));
    primary.append(this.stopButton, this.sendButton); toolbar.append(references, this.permissions, primary);
    composer.append(this.chips, this.input, upload, toolbar);
    composer.addEventListener('submit', event => { event.preventDefault(); this.submit(); });
    root.append(header, connection, this.transcript, this.activity, composer);
    this.trackViewport();
  }
  private iconButton(label: string, title: string, action: () => void, icon: string, cls = ''): HTMLButtonElement {
    const element = button(label, title, action, `edge-icon-button ${cls}`); this.actions.icon?.(element, icon); return element;
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
  private submit(): void {
    const text = this.input.value.trim();
    if (this.busy || (!text && !this.attachments.length)) return;
    if (this.state === 'disconnected') { this.actions.pair(); return; }
    try {
      this.actions.send(text || 'Please look at the attached context.', [...this.attachments]);
      this.input.value = ''; this.input.style.removeProperty('--edge-input-height'); this.attachments = []; this.renderAttachments();
      this.setBusy(true); this.typingText.textContent = this.state === 'ready' ? 'Thinking…' : 'Waiting for connection…';
    } catch (error) { this.error((error as Error).message); }
  }
  statusChanged(state: string, detail: string): void {
    this.state = state; this.status.textContent = detail; this.status.title = detail; this.status.dataset.state = state;
    if (state === 'error') this.setBusy(false);
  }
  setBusy(value: boolean): void {
    delete this.activity.dataset.error;
    this.busy = value; this.typing.hidden = !value; this.permissions.disabled = value;
    this.activity.hidden = true;
    if (value) { this.empty.hidden = true; this.typingText.textContent = 'Thinking…'; this.transcript.scrollTop = this.transcript.scrollHeight; }
    this.sendButton.disabled = value; this.stopButton.hidden = !value;
    if (!value) this.activity.textContent = '';
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
      if (event.text) this.upsert({ id: event.id, role: event.role, text: event.text, final: !!event.final });
    } else if (event.kind === 'history') {
      this.restore(event.messages); this.actions.changed([...this.messages]);
    } else if (event.kind === 'run.started') this.setBusy(true);
    else if (event.kind === 'run.finished') this.setBusy(false);
    else if (event.kind === 'tool') this.typingText.textContent = `${event.name} · ${event.phase}`;
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
      const element = node('article', `edge-message edge-${message.role}`);
      element.append(node('div', 'edge-message-label', message.role === 'user' ? 'You' : 'Pi'));
      const body = node('div', 'edge-message-body'); element.append(body);
      element.append(this.iconButton('Copy', message.role === 'user' ? 'Copy message' : 'Copy response', () => { const text = this.rows.get(message.id)?.text || ''; void navigator.clipboard.writeText(message.role === 'user' ? userMessage(text).text : text).catch(() => this.error('Could not copy. Select the text to copy it.')); }, 'copy', 'edge-copy'));
      this.transcript.insertBefore(element, this.typing); row = { row: element, body, text: '', final: false }; this.rows.set(message.id, row);
    }
    if (row.text !== message.text || row.final !== message.final) {
      row.text = message.text; row.final = message.final; row.row.classList.toggle('is-streaming', !message.final);
      row.body.replaceChildren();
      const content = userMessage(message.text);
      const display = message.role === 'user' ? content.text : message.text;
      if (message.final && message.role === 'assistant') this.actions.markdown(display, row.body);
      else row.body.textContent = display;
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
  restore(messages: ChatMessage[]): void {
    this.messages = []; this.rows.clear(); this.transcript.replaceChildren(this.empty, this.typing); this.empty.hidden = messages.length > 0;
    for (const message of messages) this.upsert(message, false);
    this.transcript.scrollTop = this.transcript.scrollHeight;
  }
  error(message: string): void { this.setBusy(false); this.activity.hidden = false; this.activity.textContent = message; this.activity.dataset.error = 'true'; }
  addAttachment(attachment: Attachment): void {
    if (this.disposed) return;
    if (this.attachments.length >= 6) return this.error('Attach up to six items per message.');
    this.attachments = this.attachments.filter(item => item.id !== attachment.id); this.attachments.push(attachment); this.renderAttachments();
  }
  private renderAttachments(): void {
    this.chips.replaceChildren();
    for (const item of this.attachments) this.chips.append(button(`${item.data ? '▧' : '↗'} ${item.name} ×`, `Remove ${item.name}`, () => { this.attachments = this.attachments.filter(other => other.id !== item.id); this.renderAttachments(); }, 'edge-attachment'));
  }
  private async addImages(files: File[]): Promise<void> {
    for (const file of files) {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) { this.error('Choose a PNG, JPEG, WebP or GIF image.'); continue; }
      const imageBytes = this.attachments.reduce((total, item) => total + (item.data?.length || 0) * 0.75, 0);
      if (file.size > 4_000_000 || file.size + imageBytes > 4_000_000) { this.error('Keep images below 4 MB in total per message.'); continue; }
      try {
        const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Could not read the image.')); reader.readAsDataURL(file); });
        this.addAttachment({ id: crypto.randomUUID(), name: file.name || 'Pasted image', data, mimeType: file.type });
      } catch (error) { this.error((error as Error).message); }
    }
  }
  dispose(): void { this.disposed = true; this.viewportCleanup?.(); }
}
