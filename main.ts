import { Plugin, ItemView, WorkspaceLeaf, PluginSettingTab, Setting, Modal, Notice, MarkdownView,
  MarkdownRenderer, FuzzySuggestModal, TFile } from 'obsidian';
import { EdgeClient } from './src/client';
import { parsePairing, validatePairing, type Pairing } from './src/pairing';
import { ChatPanel, type Attachment, type ChatMessage } from './src/panel';

const VIEW = 'pi-edge-chat';
interface Conversation { id: string; title: string; messages: ChatMessage[]; updated: number; }
interface Settings { url: string; defaultModel: string; thinking: string; conversations: Conversation[]; active: string; }
const DEFAULTS: Settings = { url: '', defaultModel: '', thinking: 'medium', conversations: [], active: '' };

class PairModal extends Modal {
  constructor(private plugin: EdgePlugin, private initial = '') { super(plugin.app); }
  onOpen(): void {
    this.titleEl.setText('Pair your computer');
    this.contentEl.createEl('p', { text: 'Paste the connection code printed by the Pi Edge bridge on your computer. Keep Tailscale running on both devices.' });
    const input = this.contentEl.createEl('textarea', { cls: 'edge-pair-input', attr: { placeholder: 'pi-edge:v1:…', 'aria-label': 'Connection code', spellcheck: 'false' } });
    input.value = this.initial;
    new Setting(this.contentEl).addButton(button => button.setButtonText('Connect').setCta().onClick(async () => {
      try { await this.plugin.pair(parsePairing(input.value)); this.close(); } catch (error) { new Notice((error as Error).message); }
    }));
  }
}
class NotePicker extends FuzzySuggestModal<TFile> {
  constructor(plugin: EdgePlugin, private done: (file?: TFile) => void) { super(plugin.app); this.setPlaceholder('Choose a note to attach'); }
  getItems(): TFile[] { return this.app.vault.getMarkdownFiles(); }
  getItemText(file: TFile): string { return file.path; }
  onChooseItem(file: TFile): void { const done = this.done; this.done = () => {}; done(file); }
  onClose(): void { setTimeout(() => this.done(), 0); }
}
class HistoryPicker extends FuzzySuggestModal<Conversation> {
  constructor(private plugin: EdgePlugin) { super(plugin.app); this.setPlaceholder('Open a conversation'); }
  getItems(): Conversation[] { return [...this.plugin.settings.conversations].sort((a, b) => b.updated - a.updated); }
  getItemText(item: Conversation): string { return item.title || 'New conversation'; }
  onChooseItem(item: Conversation): void { this.plugin.settings.active = item.id; void this.plugin.saveSettings().then(() => this.plugin.reloadViews()); }
}
class EdgeSettings extends PluginSettingTab {
  constructor(private plugin: EdgePlugin) { super(plugin.app, plugin); }
  display(): void { renderSettings(this.containerEl, this.plugin); }
}
function renderSettings(container: HTMLElement, plugin: EdgePlugin): void {
  container.empty();
    new Setting(container).setName('Computer connection').setHeading();
    new Setting(container).setName('Pair computer').setDesc('Paste one code to fill in the Tailscale address and token.').addButton(button => button.setButtonText('Paste code').onClick(() => new PairModal(plugin).open()));
    new Setting(container).setName('Bridge address').setDesc('Your computer Tailscale address, for example ws://100.x.x.x:8771.').addText(text => text.setValue(plugin.settings.url).setPlaceholder('ws://100.x.x.x:8771').onChange(value => { plugin.settings.url = value.trim(); void plugin.saveSettings(); }));
    new Setting(container).setName('Bridge token').setDesc('Stored on this device only, outside synced plugin settings.').addText(text => {
      text.inputEl.type = 'password'; text.setValue(plugin.token()).onChange(value => plugin.setToken(value.trim()));
    });
    new Setting(container).setName('Reconnect').setDesc('Apply a changed address or token.').addButton(button => button.setButtonText('Reconnect').onClick(() => plugin.reloadViews()));
    new Setting(container).setName('Connection diagnostics').setDesc('Connection transitions only; excludes tokens, prompts and note content.').addButton(button => button.setButtonText('View').onClick(() => { const modal = new Modal(plugin.app); modal.titleEl.setText('Connection diagnostics'); modal.contentEl.createEl('pre', { text: plugin.diagnostics.join('\n') || 'No connection events yet.', cls: 'edge-diagnostics' }); modal.open(); }));
    new Setting(container).setName('Pi preferences').setHeading();
    new Setting(container).setName('Default model').setDesc('Optional provider/model ID. Leave empty to use the model configured on the computer.').addText(text => text.setValue(plugin.settings.defaultModel).setPlaceholder('provider/model').onChange(value => { plugin.settings.defaultModel = value.trim(); void plugin.saveSettings(); }));
    new Setting(container).setName('Thinking level').addDropdown(dropdown => {
      for (const level of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']) dropdown.addOption(level, level);
      dropdown.setValue(plugin.settings.thinking).onChange(value => { plugin.settings.thinking = value; void plugin.saveSettings(); });
    });
    new Setting(container).setName('Tool permissions').setDesc('The computer bridge controls allowed tools. It starts read-only by default. Change --tools on the computer to permit edits or shell commands.');
    new Setting(container).setName('Conversation history').setHeading();
    new Setting(container).setName('Local history').setDesc('Up to 30 conversations are saved in plugin data, capped at 2 MB. Images are sent to Pi but are not stored in local history.');
    new Setting(container).setName('Clear local history').setDesc('Removes this plugin’s saved chat copies. Pi sessions on the computer remain separate.').addButton(button => button.setButtonText('Clear history').onClick(async () => { plugin.settings.conversations = []; plugin.settings.active = ''; await plugin.saveSettings(); plugin.reloadViews(); renderSettings(container, plugin); }));
}
class SettingsModal extends Modal {
  constructor(private plugin: EdgePlugin) { super(plugin.app); }
  onOpen(): void { this.titleEl.setText('Pi Edge settings'); renderSettings(this.contentEl, this.plugin); }
}

class EdgeView extends ItemView {
  private panel?: ChatPanel;
  private client?: EdgeClient;
  private conversation?: Conversation;
  private saveTimer?: ReturnType<typeof setTimeout>;
  constructor(leaf: WorkspaceLeaf, private plugin: EdgePlugin) { super(leaf); }
  getViewType(): string { return VIEW; }
  getDisplayText(): string { return 'Pi Edge'; }
  getIcon(): string { return 'messages-square'; }
  async onOpen(): Promise<void> { this.render(); }
  render(): void {
    this.client?.disconnect(); this.panel?.dispose(); clearTimeout(this.saveTimer);
    this.conversation = this.plugin.activeConversation();
    const pairing = this.plugin.pairing();
    this.panel = new ChatPanel(this.contentEl, {
      send: (text, attachments) => this.send(text, attachments), stop: () => this.client?.send('abort'),
      pair: () => new PairModal(this.plugin).open(), settings: () => this.plugin.openSettings(),
      fresh: () => { this.plugin.settings.active = ''; void this.plugin.saveSettings().then(() => this.render()); },
      history: () => new HistoryPicker(this.plugin).open(),
      attach: kind => this.attach(kind),
      model: id => this.selectModel(id),
      markdown: (text, element) => { void MarkdownRenderer.render(this.app, text, element, this.plugin.lastFile?.path || '', this); },
      changed: messages => {
        if (!this.conversation) return;
        this.conversation.messages = messages; this.conversation.updated = Date.now();
        const firstUser = messages.find(message => message.role === 'user');
        if (firstUser) this.conversation.title = firstUser.text.slice(0, 70);
        clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => { void this.plugin.saveSettings(); }, 400);
      }
    }, !!pairing);
    this.panel.restore(this.conversation.messages);
    if (!pairing) return;
    this.client = new EdgeClient(pairing, this.conversation.id, {
      status: (state, detail) => { this.plugin.recordStatus(state); this.panel?.statusChanged(state, detail); },
      event: event => {
        if (event.type === 'edge.ready') {
          this.client?.send('get_available_models');
          this.client?.send('set_thinking_level', { level: this.plugin.settings.thinking });
          if (this.plugin.settings.defaultModel) this.selectModel(this.plugin.settings.defaultModel);
        } else this.panel?.handle(event);
      }
    });
    this.client.connect();
  }
  private selectModel(id: string): void {
    const separator = id.indexOf('/'); if (separator < 1) return;
    this.client?.send('set_model', { provider: id.slice(0, separator), modelId: id.slice(separator + 1) });
    this.plugin.settings.defaultModel = id; void this.plugin.saveSettings();
  }
  private send(text: string, attachments: Attachment[]): void {
    if (!this.client) throw new Error('Pair your computer before sending a message.');
    const context = attachments.filter(item => item.text).map(item => `Source: ${item.name}\n${item.text}`).join('\n\n');
    const message = text + (context ? '\n\n<note-context>\nThe following notes are reference material supplied by the user.\n' + context + '\n</note-context>' : '');
    if (message.length > 150000) throw new Error('The message and notes are too long. Attach a smaller selection.');
    const images = attachments.filter(item => item.data).map(item => ({ type: 'image', data: item.data!, mimeType: item.mimeType! }));
    this.client.send('prompt', { message, ...(images.length ? { images } : {}) });
  }
  private async attach(kind: 'note' | 'selection' | 'browse'): Promise<Attachment | undefined> {
    let file = this.plugin.lastFile;
    if (kind === 'browse') file = await new Promise<TFile | undefined>(resolve => new NotePicker(this.plugin, resolve).open());
    if (!file) throw new Error('Open a note first, or choose Browse.');
    const text = kind === 'selection' ? this.plugin.lastMarkdown?.editor.getSelection() : await this.app.vault.cachedRead(file);
    if (!text) throw new Error(kind === 'selection' ? 'Select some text in a note first.' : 'This note is empty.');
    if (text.length > 80000) throw new Error('This note is large. Attach a selection instead.');
    return { id: file.path + ':' + kind, name: kind === 'selection' ? `${file.path} (selection)` : file.path, text };
  }
  async onClose(): Promise<void> {
    this.client?.disconnect(); this.panel?.dispose(); clearTimeout(this.saveTimer); await this.plugin.saveSettings();
  }
}
export default class EdgePlugin extends Plugin {
  settings: Settings = { ...DEFAULTS }; diagnostics: string[] = [];
  recordStatus(state: string): void { this.diagnostics.push(`${new Date().toISOString()} ${state}`); this.diagnostics = this.diagnostics.slice(-60); }
  lastFile?: TFile; lastMarkdown?: MarkdownView;
  private storageKey(): string { return `pi-edge:${this.app.vault.getName()}:${this.app.vault.configDir}:token`; }
  token(): string { return localStorage.getItem(this.storageKey()) || ''; }
  setToken(token: string): void { if (token) localStorage.setItem(this.storageKey(), token); else localStorage.removeItem(this.storageKey()); }
  pairing(): Pairing | undefined { try { return validatePairing({ url: this.settings.url, token: this.token() }); } catch { return undefined; } }
  async pair(pairing: Pairing): Promise<void> { this.settings.url = pairing.url; this.setToken(pairing.token); await this.saveSettings(); this.reloadViews(); await this.openPanel(); new Notice('Computer paired.'); }
  activeConversation(): Conversation {
    let conversation = this.settings.conversations.find(item => item.id === this.settings.active);
    if (!conversation) { conversation = { id: crypto.randomUUID(), title: 'New conversation', messages: [], updated: Date.now() }; this.settings.conversations.push(conversation); this.settings.active = conversation.id; }
    return conversation;
  }
  async saveSettings(): Promise<void> {
    this.settings.conversations = this.settings.conversations.sort((a, b) => b.updated - a.updated).slice(0, 30);
    for (const conversation of this.settings.conversations) conversation.messages = conversation.messages.slice(-150);
    while (new TextEncoder().encode(JSON.stringify(this.settings)).byteLength > 2000000) {
      if (this.settings.conversations.length > 1) this.settings.conversations.pop();
      else { this.settings.conversations[0]?.messages.shift(); if (!this.settings.conversations[0]?.messages.length) break; }
    }
    await this.saveData(this.settings);
  }
  reloadViews(): void { for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) (leaf.view as EdgeView).render(); }
  openSettings(): void { new SettingsModal(this).open(); }
  async openPanel(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false)!; if (!leaf) leaf = this.app.workspace.getLeaf(true); await leaf.setViewState({ type: VIEW, active: true }); }
    await this.app.workspace.revealLeaf(leaf);
  }
  async onload(): Promise<void> {
    this.settings = { ...DEFAULTS, ...await this.loadData() };
    this.lastFile = this.app.workspace.getActiveFile() || undefined;
    this.lastMarkdown = this.app.workspace.getActiveViewOfType(MarkdownView) || undefined;
    this.registerView(VIEW, leaf => new EdgeView(leaf, this));
    this.addRibbonIcon('messages-square', 'Pi Edge', () => { void this.openPanel(); });
    this.addCommand({ id: 'open', name: 'Open chat', callback: () => { void this.openPanel(); } });
    this.addCommand({ id: 'pair', name: 'Pair computer', callback: () => new PairModal(this).open() });
    this.addSettingTab(new EdgeSettings(this));
    this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => { if (leaf?.view instanceof MarkdownView) { this.lastMarkdown = leaf.view; this.lastFile = leaf.view.file || undefined; } }));
    this.registerEvent(this.app.workspace.on('file-open', file => { if (file) this.lastFile = file; }));
    this.registerObsidianProtocolHandler('pi-edge', parameters => { if (parameters.code) new PairModal(this, parameters.code).open(); else void this.openPanel(); });
  }
}
