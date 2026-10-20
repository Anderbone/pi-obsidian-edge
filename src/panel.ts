export interface Attachment { id: string; name: string; text?: string; data?: string; mimeType?: string; }
export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; final: boolean; }
export interface PanelActions {
  send(text: string, attachments: Attachment[]): void;
  stop(): void;
  pair(): void;
  settings(): void;
  fresh(): void;
  history(): void;
  attach(kind: 'note' | 'selection' | 'browse'): Promise<Attachment | undefined>;
  model(id: string): void;
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
    controls.append(button('+', 'New conversation', actions.fresh), button('History', 'Conversation history', actions.history), button('Settings', 'Open settings', actions.settings));
    header.append(heading, controls);
    const connection = node('div', 'edge-connection');
    this.status = node('span', 'edge-status', paired ? 'Connecting…' : 'Computer not paired'); this.status.setAttribute('role', 'status');
    this.model = node('select', 'edge-model'); this.model.setAttribute('aria-label', 'Model');
    this.model.append(new Option('Pi · model on computer', ''));
    this.model.addEventListener('change', () => actions.model(this.model.value));
    connection.append(this.status, this.model);
    this.transcript = node('div', 'edge-transcript'); this.transcript.setAttribute('role', 'log'); this.transcript.setAttribute('aria-label', 'Conversation');
    this.empty = node('section', 'edge-empty');
    this.empty.append(node('span', 'edge-eyebrow', 'YOUR NOTES, IN CONTEXT'), node('h3', '', paired ? 'What are you working on?' : 'Bring Pi to your notes.'),
      node('p', '', paired ? 'Ask a question or attach a note. Pi runs on your computer.' : 'Start the bridge on your computer, then paste its connection code here.'));
    if (!paired) this.empty.append(button('Pair computer', 'Paste a connection code', actions.pair, 'mod-cta'));
    this.transcript.append(this.empty);
    this.activity = node('div', 'edge-activity'); this.activity.setAttribute('role', 'status');
    const composer = node('form', 'edge-composer');
    this.chips = node('div', 'edge-attachments');
    this.input = node('textarea', 'edge-input'); this.input.placeholder = 'Ask Pi…'; this.input.rows = 3; this.input.setAttribute('aria-label', 'Message');
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
    for (const [label, kind, title] of [['Note', 'note', 'Attach current note'], ['Selection', 'selection', 'Attach selected text'], ['Browse', 'browse', 'Choose a note']] as const) {
      references.append(button(label, title, () => { void actions.attach(kind).then(item => { if (item) this.addAttachment(item); }).catch(error => this.error(error.message)); }));
    }
    const upload = node('input'); upload.type = 'file'; upload.accept = 'image/png,image/jpeg,image/webp,image/gif'; upload.multiple = true; upload.hidden = true;
    upload.addEventListener('change', () => { void this.addImages([...(upload.files || [])]); upload.value = ''; });
    references.append(button('Image', 'Attach images', () => upload.click()));
    const primary = node('div', 'edge-primary-actions');
    this.stopButton = button('Stop', 'Stop generation', actions.stop); this.stopButton.hidden = true;
    this.sendButton = button('Send ↑', 'Send message', () => this.submit(), 'mod-cta');
    primary.append(this.stopButton, this.sendButton); toolbar.append(references, primary);
    composer.append(this.chips, this.input, upload, toolbar);
    composer.addEventListener('submit', event => { event.preventDefault(); this.submit(); });
    root.append(header, connection, this.transcript, this.activity, composer);
  }
  private submit(): void {
    const text = this.input.value.trim();
    if (this.busy || (!text && !this.attachments.length)) return;
    if (this.state === 'disconnected') { this.actions.pair(); return; }
    try {
      this.actions.send(text || 'Please look at the attached context.', [...this.attachments]);
      this.input.value = ''; this.attachments = []; this.renderAttachments();
      this.setBusy(true); this.activity.textContent = this.state === 'ready' ? 'Waiting for Pi…' : 'Queued until the computer connects…';
    } catch (error) { this.error((error as Error).message); }
  }
  statusChanged(state: string, detail: string): void {
    this.state = state; this.status.textContent = detail; this.status.dataset.state = state;
    if (state === 'error') this.setBusy(false);
  }
  setBusy(value: boolean): void {
    delete this.activity.dataset.error;
    this.busy = value; this.sendButton.disabled = value; this.stopButton.hidden = !value;
    if (!value) this.activity.textContent = '';
  }
  setModels(models: { id: string; name: string }[], current = ''): void {
    this.model.replaceChildren(new Option(current || 'Choose model', current));
    for (const model of models) if (model.id !== current) this.model.append(new Option(model.name, model.id));
  }
  setCurrentModel(model: string): void {
    if (!model) return;
    if (![...this.model.options].some(option => option.value === model)) this.model.add(new Option(model, model));
    this.model.value = model;
  }
  handle(event: any): void {
    if (event.kind === 'message' && (event.role === 'user' || event.role === 'assistant')) {
      if (event.text) this.upsert({ id: event.id, role: event.role, text: event.text, final: !!event.final });
    } else if (event.kind === 'history') {
      this.restore(event.messages); this.actions.changed([...this.messages]);
    } else if (event.kind === 'run.started') this.setBusy(true);
    else if (event.kind === 'run.finished') this.setBusy(false);
    else if (event.kind === 'tool') this.activity.textContent = `${event.name} · ${event.phase}`;
    else if (event.kind === 'state') { this.setCurrentModel(event.model); this.setBusy(event.busy); }
    else if (event.kind === 'model') this.setCurrentModel(event.model);
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
      if (message.role === 'assistant') element.append(button('Copy', 'Copy response', () => { void navigator.clipboard.writeText(this.rows.get(message.id)?.text || '').catch(() => this.error('Could not copy. Select the text to copy it.')); }, 'edge-copy'));
      this.transcript.append(element); row = { row: element, body, text: '', final: false }; this.rows.set(message.id, row);
    }
    if (row.text !== message.text || row.final !== message.final) {
      row.text = message.text; row.final = message.final;
      row.body.replaceChildren();
      const display = message.role === 'user' ? message.text.split('\n\n<note-context>')[0] : message.text;
      if (message.final && message.role === 'assistant') this.actions.markdown(display, row.body);
      else row.body.textContent = display;
    }
    const index = this.messages.findIndex(item => item.id === message.id);
    if (index >= 0) this.messages[index] = message; else this.messages.push(message);
    if (notify && message.final) this.actions.changed([...this.messages]);
    if (atBottom || message.role === 'user') this.transcript.scrollTop = this.transcript.scrollHeight;
  }
  restore(messages: ChatMessage[]): void {
    this.messages = []; this.rows.clear(); this.transcript.replaceChildren(this.empty); this.empty.hidden = messages.length > 0;
    for (const message of messages) this.upsert(message, false);
    this.transcript.scrollTop = this.transcript.scrollHeight;
  }
  error(message: string): void { this.setBusy(false); this.activity.textContent = message; this.activity.dataset.error = 'true'; }
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
  dispose(): void { this.disposed = true; }
}
