import { Plugin, ItemView, WorkspaceLeaf, PluginSettingTab, Setting, Modal, Notice, MarkdownView,
  MarkdownRenderer, FuzzySuggestModal, TFile, setIcon, requestUrl, requireApiVersion, type SettingDefinitionItem } from 'obsidian';
import { EdgeClient } from './src/client';
import { DeviceToken } from './src/device-token';
import { parsePairing, validatePairing, type Pairing } from './src/pairing';
import { ChatPanel, type Attachment } from './src/panel';
import { checkConnection } from './src/connection';
import { DEFAULT_HISTORY_LIMITS, historyLimits, positiveInteger, pruneHistory, type Conversation, type HistoryLimits } from './src/history';
import { isPermissionId, isRecord, type ClientEvent, type ModelEntry, type PermissionId, type PermissionMode } from './shared/protocol';

import { noteCandidates, userMessage } from './src/references';

const VIEW = 'pi-edge-chat';
const PERMISSIONS: PermissionMode[] = [{ id: 'read', label: 'Read only' }, { id: 'edit', label: 'Read & write' }, { id: 'full', label: 'Full access' }];
interface Settings extends HistoryLimits { permissions: PermissionId; url: string; defaultModel: string; thinking: string; conversations: Conversation[]; active: string; }
const DEFAULTS: Settings = { ...DEFAULT_HISTORY_LIMITS, permissions: 'full', url: '', defaultModel: '', thinking: 'medium', conversations: [], active: '' };

class PairModal extends Modal {
  constructor(private plugin: EdgePlugin, private initial = '') { super(plugin.app); }
  onOpen(): void {
    this.titleEl.setText('Pair your computer');
    this.contentEl.createEl('p', { text: 'Paste the connection code printed by the Pi Edge bridge on your computer. This device must be able to reach the bridge address.' });
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
  onClose(): void { window.setTimeout(() => this.done(), 0); }
}
class MovedNotePicker extends FuzzySuggestModal<TFile> {
  constructor(private plugin: EdgePlugin, private files: TFile[]) {
    super(plugin.app); this.setPlaceholder('Several notes have this name. Choose the file to open.');
  }
  getItems(): TFile[] { return this.files; }
  getItemText(file: TFile): string { return file.path; }
  onChooseItem(file: TFile): void { void this.plugin.openNote(file.path); }
}
class HistoryPicker extends FuzzySuggestModal<Conversation> {
  constructor(private plugin: EdgePlugin) { super(plugin.app); this.setPlaceholder('Open a conversation'); }
  getItems(): Conversation[] { return [...this.plugin.settings.conversations].sort((a, b) => b.updated - a.updated); }
  getItemText(item: Conversation): string { return (item.title || 'New conversation') + ' ' + this.references(item).map(ref => ref.name).join(' '); }
  private references(item: Conversation) {
    return [...new Map(item.messages.filter(message => message.role === 'user').flatMap(message => userMessage(message.text).references).map(ref => [ref.path, ref])).values()];
  }
  renderSuggestion(value: { item: Conversation }, el: HTMLElement): void {
    el.createDiv({ text: value.item.title || 'New conversation' });
    const links = el.createDiv({ cls: 'edge-message-references' });
    for (const ref of this.references(value.item)) {
      const link = links.createEl('a', { text: ref.name, cls: 'internal-link edge-note-reference', href: ref.path });
      link.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation(); this.close();
        void this.plugin.openNote(ref.path);
      });
    }
  }
  onChooseItem(item: Conversation): void { this.plugin.settings.active = item.id; void this.plugin.saveSettings().then(() => this.plugin.reloadViews()); }
}
class EdgeSettings extends PluginSettingTab {
  private visible = false;
  private renderCleanup?: () => void;
  constructor(private plugin: EdgePlugin) {
    super(plugin.app, plugin);
    const refresh = () => {
      if (requireApiVersion('1.13.0')) this.update();
      else if (this.visible) this.display();
    };
    plugin.catalogListeners.add(refresh);
    plugin.register(() => plugin.catalogListeners.delete(refresh));
  }
  getSettingDefinitions(): SettingDefinitionItem[] { return settingsDefinitions(this.plugin); }
  // Obsidian before 1.13 uses the same rows through the imperative renderer.
  display(): void { this.visible = true; this.renderCleanup?.(); this.renderCleanup = renderSettings(this.containerEl, this.plugin); }
  hide(): void { this.visible = false; this.renderCleanup?.(); this.renderCleanup = undefined; }
}
interface SettingsRow { name: string; desc: string; render: (setting: Setting) => void | (() => void); }
interface SettingsGroup { type: 'group'; heading: string; items: SettingsRow[]; }
function settingsDefinitions(plugin: EdgePlugin): SettingsGroup[] {
  const groups: SettingsGroup[] = [];
  const group = (heading: string) => { groups.push({ type: 'group', heading, items: [] }); };
  const row = (name: string, desc: string, render?: SettingsRow['render']) => {
    groups[groups.length - 1].items.push({ name, desc, render: render || (() => {}) });
  };
  group('Computer connection');
  row('Pair computer', 'Paste one code to fill in the bridge address and token.', setting => { setting.addButton(button => button.setButtonText('Paste code').onClick(() => new PairModal(plugin).open())); });
  row('Bridge address', 'An address reachable from this device, starting with ws:// or wss://.', setting => { setting.addText(text => text.setValue(plugin.settings.url).setPlaceholder('ws://192.168.1.20:8771').onChange(value => { plugin.settings.url = value.trim(); plugin.invalidateConnectionTest(); void plugin.saveSettings(); })); });
  row('Bridge token', 'Stored on this device only, outside synced plugin settings.', setting => { setting.addText(text => {
    text.inputEl.type = 'password'; text.setValue(plugin.token()).onChange(value => plugin.setToken(value.trim()));
  }); });
  row('Connection test', 'Checks the bridge address and pairing token without sending a prompt.', connection => {
    const connectionStatus = connection.descEl.createDiv({ cls: 'edge-connection-test', attr: { role: 'status' } });
    let refreshConnection = () => {};
    connection.addButton(button => {
      button.setButtonText('Test connection').onClick(() => { void plugin.testConnection(); });
      refreshConnection = () => {
        button.setDisabled(plugin.connectionState.state === 'testing');
        connectionStatus.setText(plugin.connectionState.message);
        connectionStatus.dataset.state = plugin.connectionState.state;
      };
    });
    refreshConnection(); plugin.connectionListeners.add(refreshConnection);
    return () => plugin.connectionListeners.delete(refreshConnection);
  });
  row('Reconnect', 'Apply a changed address or token.', setting => { setting.addButton(button => button.setButtonText('Reconnect').onClick(() => plugin.reloadViews())); });
  row('Connection diagnostics', 'Connection transitions only; excludes tokens, prompts and note content.', setting => { setting.addButton(button => button.setButtonText('View').onClick(() => { const modal = new Modal(plugin.app); modal.titleEl.setText('Connection diagnostics'); modal.contentEl.createEl('pre', { text: plugin.diagnostics.join('\n') || 'No connection events yet.', cls: 'edge-diagnostics' }); modal.open(); })); });
  group('Pi preferences');
  row('Default model', 'Models provided by Pi on your computer.', setting => { setting.addDropdown(dropdown => {
    dropdown.addOption('', 'Computer default');
    for (const model of plugin.models) dropdown.addOption(model.id, model.name);
    dropdown.setValue(plugin.settings.defaultModel).setDisabled(!plugin.models.length).onChange(value => {
      plugin.settings.defaultModel = value; void plugin.saveSettings(); if (value) plugin.selectModel(value);
    });
  }); });
  if (!plugin.models.length) row('Models unavailable', 'Connect to your computer to load models.');
  if (plugin.effortLevels.some(level => level !== 'off')) row('Reasoning effort', 'Levels supported by the current model.', setting => { setting.addDropdown(dropdown => {
    for (const level of plugin.effortLevels) dropdown.addOption(level, level.charAt(0).toUpperCase() + level.slice(1));
    dropdown.setValue(plugin.settings.thinking).onChange(value => plugin.setEffort(value));
  }); });
  row('Permissions', 'Applies to this conversation. Full access includes read, write, edit and shell tools.', setting => { setting.addDropdown(dropdown => {
    for (const mode of plugin.permissionModes) dropdown.addOption(mode.id, mode.label);
    dropdown.setValue(plugin.settings.permissions).setDisabled(plugin.busy).onChange(value => { if (isPermissionId(value)) plugin.setPermissions(value); });
  }); });
  group('Conversation history');
  row('Local history', 'Saved on this device in plugin data and may sync with your vault. Images are not stored in local history.');
  for (const [key, name, description] of [
    ['historyMaxConversations', 'Maximum conversations', 'Default: 500. Oldest conversations are removed when the limit is reached.'],
    ['historyMaxMB', 'Maximum history size', 'Default: 50 MB. Increase this to keep more conversation text.']
  ] as const) {
    let value = String(plugin.settings[key]);
    row(name, description, setting => { setting.addText(text => {
      text.setValue(value).setPlaceholder(String(DEFAULT_HISTORY_LIMITS[key])).onChange(next => { value = next; });
      text.inputEl.type = 'number'; text.inputEl.min = '1'; text.inputEl.step = '1';
      text.inputEl.setAttribute('aria-label', name);
    }).addButton(button => button.setButtonText('Apply').onClick(async () => {
      const limit = positiveInteger(value);
      if (!limit) { new Notice('Enter a positive whole number.'); return; }
      plugin.settings[key] = limit; await plugin.saveSettings(); new Notice('History limit saved.');
    })); });
  }
  row('Clear local history', 'Removes this plugin’s saved chat copies. Pi sessions on the computer remain separate.', setting => { setting.addButton(button => button.setButtonText('Clear history').onClick(async () => { plugin.settings.conversations = []; plugin.settings.active = ''; await plugin.saveSettings(); plugin.reloadViews(); })); });
  return groups;
}
function renderSettings(container: HTMLElement, plugin: EdgePlugin): () => void {
  container.empty();
  const cleanups: (() => void)[] = [];
  for (const group of settingsDefinitions(plugin)) {
    new Setting(container).setName(group.heading).setHeading();
    for (const item of group.items) {
      const setting = new Setting(container).setName(item.name).setDesc(item.desc);
      const cleanup = item.render(setting);
      if (cleanup) cleanups.push(cleanup);
    }
  }
  return () => { for (const cleanup of cleanups) cleanup(); };
}
class SettingsModal extends Modal {
  private renderCleanup?: () => void;
  constructor(private plugin: EdgePlugin) { super(plugin.app); }
  private refresh = () => { this.renderCleanup?.(); this.renderCleanup = renderSettings(this.contentEl, this.plugin); };
  onOpen(): void { this.titleEl.setText('Pi Edge settings'); this.refresh(); this.plugin.catalogListeners.add(this.refresh); }
  onClose(): void { this.plugin.catalogListeners.delete(this.refresh); this.renderCleanup?.(); }
}

class EdgeView extends ItemView {
  private panel?: ChatPanel;
  private client?: EdgeClient;
  private conversation?: Conversation;
  private saveTimer?: number;
  constructor(leaf: WorkspaceLeaf, private plugin: EdgePlugin) { super(leaf); }
  getViewType(): string { return VIEW; }
  getDisplayText(): string { return 'Pi Edge'; }
  getIcon(): string { return 'messages-square'; }
  async onOpen(): Promise<void> { this.render(); }
  render(): void {
    this.client?.disconnect(); this.panel?.dispose(); window.clearTimeout(this.saveTimer);
    this.conversation = this.plugin.activeConversation();
    const pairing = this.plugin.pairing();
    this.panel = new ChatPanel(this.contentEl, {
      send: (text, attachments) => this.send(text, attachments), stop: () => this.client?.send('abort'),
      pair: () => new PairModal(this.plugin).open(), settings: () => this.plugin.openSettings(),
      fresh: () => { this.plugin.settings.active = ''; void this.plugin.saveSettings().then(() => this.render()); },
      history: () => new HistoryPicker(this.plugin).open(),
      attach: kind => this.attach(kind),
      model: id => this.selectModel(id),
      effort: level => this.plugin.setEffort(level),
      permissions: mode => this.plugin.setPermissions(mode),
      icon: (element, name) => setIcon(element, name),
      openNote: path => { void this.plugin.openNote(path); },
      markdown: (text, element) => { void MarkdownRenderer.render(this.app, text, element, this.plugin.lastFile?.path || '', this); },
      changed: messages => {
        if (!this.conversation) return;
        this.conversation.messages = messages; this.conversation.updated = Date.now();
        const firstUser = messages.find(message => message.role === 'user');
        if (firstUser) this.conversation.title = userMessage(firstUser.text).text.slice(0, 70);
        window.clearTimeout(this.saveTimer); this.saveTimer = window.setTimeout(() => { void this.plugin.saveSettings(); }, 400);
      }
    }, !!pairing);
    this.panel.restore(this.conversation.messages);
    if (!pairing) return;
    this.client = new EdgeClient(pairing, this.conversation.id, {
      status: (state, detail) => { this.plugin.recordStatus(state); this.panel?.statusChanged(state, detail); },
      event: event => {
        this.plugin.updateCatalog(event);
        if (event.type === 'edge.ready') {
          this.panel?.setPermissions(event.permissions || 'full', event.permissionModes || PERMISSIONS);
          this.client?.send('get_available_models');
          this.client?.send('get_available_thinking_levels');
          this.client?.send('set_thinking_level', { level: this.plugin.settings.thinking });
          if (this.plugin.settings.defaultModel) this.selectModel(this.plugin.settings.defaultModel);
        } else if (event.kind === 'state.refresh') { this.client?.send('get_state'); this.client?.send('get_available_thinking_levels'); }
        else this.panel?.handle(event);
      }
    }, undefined, this.plugin.settings.permissions);
    this.client.connect();
  }
  selectModel(id: string): void {
    const separator = id.indexOf('/'); if (separator < 1) return;
    this.client?.send('set_model', { provider: id.slice(0, separator), modelId: id.slice(separator + 1) });
    this.plugin.settings.defaultModel = id; void this.plugin.saveSettings();
  }
  setEffort(level: string): void { this.client?.send('set_thinking_level', { level }); }
  setPermissions(mode: PermissionId): void { this.client?.send('edge.permissions', { mode }); }
  private send(text: string, attachments: Attachment[]): void {
    if (!this.client) throw new Error('Pair your computer before sending a message.');
    const context = attachments.filter(item => item.text).map(item => `Source: ${item.name}\n${item.text}`).join('\n\n');
    const references = attachments.filter(item => item.text).map(item => ({ name: item.name, path: item.path || item.name.replace(/ \(selection\)$/, '') }));
    const message = text + (context ? '\n\n<note-context>\nThe following notes are reference material supplied by the user.\nReferences: ' + JSON.stringify(references) + '\n' + context + '\n</note-context>' : '');
    if (message.length > 150000) throw new Error('The message and notes are too long. Attach a smaller selection.');
    const images = attachments.filter(item => item.data).map(item => ({ type: 'image' as const, data: item.data!, mimeType: item.mimeType! }));
    this.client.send('prompt', { message, ...(images.length ? { images } : {}) });
  }
  private async attach(kind: 'note' | 'selection' | 'browse'): Promise<Attachment | undefined> {
    let file = this.plugin.lastFile;
    if (kind === 'browse') file = await new Promise<TFile | undefined>(resolve => new NotePicker(this.plugin, resolve).open());
    if (!file) throw new Error('Open a note first, or choose Browse.');
    const text = kind === 'selection' ? this.plugin.lastMarkdown?.editor.getSelection() : await this.app.vault.cachedRead(file);
    if (!text) throw new Error(kind === 'selection' ? 'Select some text in a note first.' : 'This note is empty.');
    if (text.length > 80000) throw new Error('This note is large. Attach a selection instead.');
    return { id: file.path + ':' + kind, path: file.path, name: kind === 'selection' ? `${file.path} (selection)` : file.path, text };
  }
  async onClose(): Promise<void> {
    this.client?.disconnect(); this.panel?.dispose(); window.clearTimeout(this.saveTimer); await this.plugin.saveSettings();
  }
}
export default class EdgePlugin extends Plugin {
  async openNote(path: string): Promise<void> {
    const files = noteCandidates(path, this.app.vault.getMarkdownFiles());
    if (!files.length) { new Notice('Note not found in its project. It may not have synced yet: ' + path); return; }
    if (files.length > 1) { new MovedNotePicker(this, files).open(); return; }
    try {
      await this.app.workspace.getLeaf(false).openFile(files[0]);
    } catch { new Notice('Could not open note: ' + files[0].path); }
  }
  settings: Settings = { ...DEFAULTS }; diagnostics: string[] = [];
  connectionState: { state: 'idle' | 'testing' | 'connected' | 'error'; message: string } = { state: 'idle', message: 'Not tested' };
  connectionListeners = new Set<() => void>();
  private connectionTest?: AbortController;
  private connectionResult(state: typeof this.connectionState.state, message: string): void {
    this.connectionState = { state, message };
    for (const listener of this.connectionListeners) listener();
  }
  invalidateConnectionTest(): void {
    const pending = this.connectionTest; this.connectionTest = undefined; pending?.abort();
    this.connectionResult('idle', 'Not tested');
  }
  async testConnection(): Promise<void> {
    if (this.connectionTest) return;
    let pairing: Pairing;
    try { pairing = validatePairing({ url: this.settings.url, token: this.token() }); }
    catch { this.connectionResult('error', 'Pair your computer or check the bridge address and token.'); return; }
    const controller = new AbortController(); this.connectionTest = controller;
    this.connectionResult('testing', 'Testing…');
    try {
      await checkConnection(pairing, controller.signal, undefined, 8000, url => requestUrl({ url, throw: false }));
      if (this.connectionTest === controller) this.connectionResult('connected', 'Connected');
    } catch (error) {
      if (this.connectionTest === controller) this.connectionResult('error', (error as Error).message);
    } finally {
      if (this.connectionTest === controller) this.connectionTest = undefined;
    }
  }
  recordStatus(state: string): void { this.diagnostics.push(`${new Date().toISOString()} ${state}`); this.diagnostics = this.diagnostics.slice(-60); }
  models: ModelEntry[] = [];
  effortLevels: string[] = [];
  permissionModes: PermissionMode[] = PERMISSIONS;
  catalogListeners = new Set<() => void>();
  busy = false;
  private activeView(): EdgeView | undefined { return this.app.workspace.getLeavesOfType(VIEW)[0]?.view as EdgeView | undefined; }
  selectModel(id: string): void { this.activeView()?.selectModel(id); }
  setEffort(level: string): void { this.settings.thinking = level; void this.saveSettings(); this.activeView()?.setEffort(level); }
  setPermissions(mode: PermissionId): void { this.activeView()?.setPermissions(mode); }
  updateCatalog(event: ClientEvent): void {
    let changed = false;
    if (event.type === 'edge.ready') { this.settings.permissions = event.permissions || 'full'; this.permissionModes = event.permissionModes || PERMISSIONS; void this.saveSettings(); changed = true; }
    if (event.kind === 'models') { this.models = event.models; changed = true; }
    if (event.kind === 'effort.levels') { this.effortLevels = event.levels; changed = true; }
    if (event.kind === 'state') { this.busy = event.busy; this.settings.thinking = event.effort || 'off'; changed = true; }
    if (event.kind === 'run.started') { this.busy = true; changed = true; }
    if (event.kind === 'run.finished') { this.busy = false; changed = true; }
    if (changed) for (const listener of this.catalogListeners) listener();
  }
  lastFile?: TFile; lastMarkdown?: MarkdownView;
  private deviceToken?: DeviceToken;
  token(): string { return this.deviceToken?.get() || ''; }
  setToken(token: string): void { this.deviceToken!.set(token); this.invalidateConnectionTest(); }
  pairing(): Pairing | undefined { try { return validatePairing({ url: this.settings.url, token: this.token() }); } catch { return undefined; } }
  async pair(pairing: Pairing): Promise<void> { this.settings.url = pairing.url; this.setToken(pairing.token); await this.saveSettings(); this.reloadViews(); await this.openPanel(); new Notice('Computer paired.'); }
  activeConversation(): Conversation {
    let conversation = this.settings.conversations.find(item => item.id === this.settings.active);
    if (!conversation) { conversation = { id: crypto.randomUUID(), title: 'New conversation', messages: [], updated: Date.now() }; this.settings.conversations.push(conversation); this.settings.active = conversation.id; }
    return conversation;
  }
  async saveSettings(): Promise<void> {
    this.settings.conversations = pruneHistory(this.settings.conversations, this.settings.active, this.settings);
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
    // Read the pre-0.2.6 device key once to preserve existing pairings. All new
    // reads and writes use the official vault-scoped API, outside synced data.
    this.deviceToken = new DeviceToken(this.app);
    this.deviceToken.migrate(window.localStorage, `pi-edge:${this.app.vault.getName()}:${this.app.vault.configDir}:token`);
    const saved: unknown = await this.loadData();
    this.settings = { ...DEFAULTS, ...(isRecord(saved) ? saved : {}) };
    Object.assign(this.settings, historyLimits(this.settings));
    this.register(() => this.invalidateConnectionTest());
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
