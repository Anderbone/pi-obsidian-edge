import { Plugin, ItemView, WorkspaceLeaf, PluginSettingTab, Setting, Modal, Notice, MarkdownView,
  MarkdownRenderer, FuzzySuggestModal, TFile, setIcon, requestUrl, requireApiVersion, type SettingDefinitionItem } from 'obsidian';
import { ConversationSession, MAX_ACTIVE_CHATS } from './src/sessions';
import { DeviceToken } from './src/device-token';
import { parsePairing, validatePairing, type Pairing } from './src/pairing';
import { ChatPanel, type Attachment } from './src/panel';
import { checkConnection } from './src/connection';
import { DEFAULT_HISTORY_LIMITS, historyLimits, positiveInteger, pruneHistory, type Conversation, type HistoryLimits } from './src/history';
import { isPermissionId, isRecord, type ClientEvent, type ModelEntry, type PermissionId, type PermissionMode } from './shared/protocol';

import { noteCandidates, userMessage } from './src/references';

const VIEW = 'pi-edge-chat';
function lastActivityLabel(conversation: Conversation): string {
  const time = conversation.updated;
  return Number.isFinite(time) ? 'Last message: ' + new Date(time).toLocaleString(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }) : 'Last message: unknown';
}
const PERMISSIONS: PermissionMode[] = [{ id: 'read', label: 'Read only' }, { id: 'edit', label: 'Read & write' }, { id: 'full', label: 'Full access' }];
interface Settings extends HistoryLimits { showToolDetails: boolean; permissions: PermissionId; url: string; defaultModel: string; thinking: string; conversations: Conversation[]; active: string; }
const DEFAULTS: Settings = { ...DEFAULT_HISTORY_LIMITS, showToolDetails: false, permissions: 'full', url: '', defaultModel: '', thinking: 'medium', conversations: [], active: '' };

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
class ChatHistoryModal extends Modal {
  private query = '';
  private rows!: HTMLElement;
  constructor(private plugin: EdgePlugin) { super(plugin.app); }
  private refresh = () => {
    this.rows.empty();
    const query = this.query.toLocaleLowerCase();
    const conversations = [...this.plugin.settings.conversations].filter(item =>
      item.messages.length || this.plugin.sessions.has(item.id)).sort((a, b) =>
      Number(!!this.plugin.sessions.get(b.id)?.busy) - Number(!!this.plugin.sessions.get(a.id)?.busy) || b.updated - a.updated);
    for (const conversation of conversations) {
      if (![conversation.title, conversation.notePath].join(' ').toLocaleLowerCase().includes(query)) continue;
      const session = this.plugin.sessions.get(conversation.id);
      const description = [session?.busy ? 'Running' : '', lastActivityLabel(conversation), conversation.notePath,
        conversation.id === this.plugin.settings.active ? 'Current chat' : ''].filter(Boolean).join(' · ');
      const row = new Setting(this.rows).setName(conversation.title || 'New conversation').setDesc(description);
      row.settingEl.addClass('edge-active-chat-row');
      row.settingEl.tabIndex = 0;
      row.settingEl.setAttribute('role', 'link');
      row.settingEl.setAttribute('aria-label', `Open ${conversation.title || 'New conversation'}`);
      const open = () => { this.close(); this.plugin.chooseConversation(conversation.id); };
      row.settingEl.addEventListener('click', open);
      row.settingEl.addEventListener('keydown', event => {
        if (event.target === row.settingEl && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(); }
      });
      const references = [...new Map(conversation.messages.filter(message => message.role === 'user')
        .flatMap(message => userMessage(message.text).references).map(ref => [ref.path, ref])).values()];
      if (references.length) {
        const links = row.descEl.createDiv({ cls: 'edge-message-references' });
        for (const ref of references) {
          const link = links.createEl('a', { text: ref.name, cls: 'internal-link edge-note-reference', href: ref.path });
          link.addEventListener('click', event => {
            event.preventDefault(); event.stopPropagation(); this.close(); void this.plugin.openNote(ref.path);
          });
        }
      }
      row.controlEl.addEventListener('click', event => event.stopPropagation());
      if (session?.busy) row.addButton(button => button.setButtonText('Stop').onClick(() => session.stop()));
    }
    if (!this.rows.childElementCount) this.rows.createEl('p', { text: 'No chats found.' });
  };
  onOpen(): void {
    this.titleEl.setText('Chat history');
    const search = this.contentEl.createEl('input', { type: 'search', attr: { placeholder: 'Search chats', 'aria-label': 'Search chats' } });
    search.addEventListener('input', () => { this.query = search.value; this.refresh(); });
    this.rows = this.contentEl.createDiv();
    this.refresh(); this.plugin.sessionListeners.add(this.refresh);
  }
  onClose(): void { this.plugin.sessionListeners.delete(this.refresh); }
}
class EdgeSettings extends PluginSettingTab {
  private visible = false;
  private renderCleanup?: () => void;
  constructor(private plugin: EdgePlugin) {
    super(plugin.app, plugin);
    const refresh = () => {
      if (requireApiVersion('1.13.0')) this.update();
      else if (this.visible) this.renderLegacy();
    };
    plugin.catalogListeners.add(refresh);
    plugin.register(() => plugin.catalogListeners.delete(refresh));
  }
  getSettingDefinitions(): SettingDefinitionItem[] { return settingsDefinitions(this.plugin); }
  // Obsidian before 1.13 uses the same rows through the imperative renderer.
  display(): void { this.renderLegacy(); }
  private renderLegacy(): void { this.visible = true; this.renderCleanup?.(); this.renderCleanup = renderSettings(this.containerEl, this.plugin); }
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
  row('Reconnect', 'Apply a changed address or token to all active chats.', setting => { setting.addButton(button => button.setButtonText('Reconnect').onClick(() => plugin.reconnectSessions())); });
  row('Connection diagnostics', 'Connection transitions only; excludes tokens, prompts and note content.', setting => { setting.addButton(button => button.setButtonText('View').onClick(() => { const modal = new Modal(plugin.app); modal.titleEl.setText('Connection diagnostics'); modal.contentEl.createEl('pre', { text: plugin.diagnostics.join('\n') || 'No connection events yet.', cls: 'edge-diagnostics' }); modal.open(); })); });
  group('Chat display');
  row('Show tool call details', 'Unchecked: compact chat. Checked: show each tool call, its status, inputs and results when available.', setting => {
    setting.addToggle(toggle => toggle.setValue(plugin.settings.showToolDetails).onChange(value => {
      plugin.settings.showToolDetails = value; void plugin.saveSettings(); plugin.reloadViews();
    }));
  });
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
  row('Local history', 'Messages and attached images are saved in plugin data and may sync with your vault.');
  for (const [key, name, description] of [
    ['historyMaxConversations', 'Maximum conversations', 'Default: 500. Oldest conversations are removed when the limit is reached.'],
    ['historyMaxMB', 'Maximum history size', 'Default: 50 MB. Increase this to keep more messages and images.']
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
  row('Clear local history', 'Removes saved chats that have no current connection. Connected chats are kept.', setting => {
    setting.addButton(button => button.setButtonText('Clear history').onClick(() => { void plugin.clearHistory(); }));
  });
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
  private session?: ConversationSession;
  private conversation?: Conversation;
  private unsubscribe?: () => void;
  constructor(leaf: WorkspaceLeaf, private plugin: EdgePlugin) { super(leaf); }
  getViewType(): string { return VIEW; }
  getDisplayText(): string { return 'Pi Edge'; }
  getIcon(): string { return 'messages-square'; }
  async onOpen(): Promise<void> { this.render(); }
  captureDraft(): void {
    if (this.session && this.panel) this.session.draft = this.panel.getDraft();
  }
  private detach(): void {
    this.captureDraft();
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.plugin.sessionListeners.delete(this.updateCount);
    this.panel?.dispose(); this.session = undefined;
  }
  private updateCount = () => { this.panel?.setActiveCount(this.plugin.sessions.size, [...this.plugin.sessions.values()].filter(session => session.busy).length); };
  render(): void {
    this.detach();
    this.conversation = this.plugin.activeConversation();
    const pairing = this.plugin.pairing();
    this.panel = new ChatPanel(this.contentEl, {
      send: (text, attachments) => this.send(text, attachments), stop: () => this.session?.stop(),
      pair: () => new PairModal(this.plugin).open(), settings: () => this.plugin.openSettings(),
      fresh: () => this.plugin.newConversation(),
      history: () => new ChatHistoryModal(this.plugin).open(),
      attach: kind => this.attach(kind),
      model: id => this.plugin.selectModel(id),
      effort: level => this.plugin.setEffort(level),
      permissions: mode => this.plugin.setPermissions(mode),
      icon: (element, name) => setIcon(element, name),
      openNote: path => { void this.plugin.openNote(path); },
      copyNotePath: path => { void this.plugin.copyNotePath(path); },
      markdown: (text, element) => { void MarkdownRenderer.render(this.app, text, element, this.conversation?.notePath || '', this); },
      changed: () => {}
    }, !!pairing);
    this.panel.setToolDetails(this.plugin.settings.showToolDetails);
    this.panel.restore(this.conversation.messages);
    this.panel.setConversation(this.conversation.title, this.conversation.notePath);
    if (!pairing) return;
    this.plugin.restoreSessions();
    try { this.session = this.plugin.sessionFor(this.conversation); }
    catch (error) { this.panel.error((error as Error).message); return; }
    const session = this.session;
    this.panel.restoreDraft(session.draft);
    const update = (event?: ClientEvent) => {
      if (event?.kind === 'error' || event?.type === 'edge.error') this.panel?.error(event.message, session.busy);
      else if (event && event.type !== 'edge.ready') this.panel?.handle(event);
      if (!event) { this.panel?.statusChanged(session.status, session.detail); this.panel?.setBusy(session.busy); }
      if (event?.type === 'edge.ready') this.panel?.setPermissions(session.permissions, session.permissionModes);
      this.panel?.setConversation(session.conversation.title, session.conversation.notePath);
      this.plugin.syncCatalog(session);
    };
    session.listeners.add(update);
    this.unsubscribe = () => session.listeners.delete(update);
    this.panel.statusChanged(session.status, session.detail);
    this.panel.setModels(session.models, session.model);
    this.panel.setEffortLevels(session.effortLevels);
    this.panel.setEffort(session.effort);
    if (session.permissionModes.length) this.panel.setPermissions(session.permissions, session.permissionModes);
    this.panel.setBusy(session.busy);
    if (session.error) this.panel.error(session.error, session.busy);
    this.plugin.syncCatalog(session);
    this.plugin.sessionListeners.add(this.updateCount); this.updateCount();
  }
  private send(text: string, attachments: Attachment[]): void {
    if (!this.session) throw new Error('Pair your computer before sending a message.');
    const context = attachments.filter(item => item.text).map(item => `Source: ${item.name}\n${item.text}`).join('\n\n');
    const references = attachments.filter(item => item.text).map(item => ({ name: item.name, path: item.path || item.name.replace(/ \(selection\)$/, '') }));
    const message = text + (context ? '\n\n<note-context>\nThe following notes are reference material supplied by the user.\nReferences: ' + JSON.stringify(references) + '\n' + context + '\n</note-context>' : '');
    if (message.length > 150000) throw new Error('The message and notes are too long. Attach a smaller selection.');
    const images = attachments.filter(item => item.data).map(item => ({ type: 'image' as const, data: item.data!, mimeType: item.mimeType! }));
    this.session.send(message, images);
  }
  private async attach(kind: 'note' | 'selection' | 'browse'): Promise<Attachment | undefined> {
    const conversation = this.conversation;
    let file = this.plugin.lastFile;
    if (kind === 'browse') file = await new Promise<TFile | undefined>(resolve => new NotePicker(this.plugin, resolve).open());
    if (!file) throw new Error('Open a note first, or choose Browse.');
    const text = kind === 'selection' ? this.plugin.lastMarkdown?.editor.getSelection() : await this.app.vault.cachedRead(file);
    if (!text) throw new Error(kind === 'selection' ? 'Select some text in a note first.' : 'This note is empty.');
    if (text.length > 80000) throw new Error('This note is large. Attach a selection instead.');
    if (conversation && !conversation.notePath) conversation.notePath = file.path;
    return { id: file.path + ':' + kind, path: file.path, name: kind === 'selection' ? `${file.path} (selection)` : file.path, text };
  }
  async onClose(): Promise<void> { this.detach(); await this.plugin.saveSettings(); }
}
export default class EdgePlugin extends Plugin {
  async copyNotePath(path: string): Promise<void> {
    try {
      await navigator.clipboard.writeText('/' + path.replace(/^\/+/, ''));
      new Notice('已复制仓库内路径');
    } catch {
      new Notice('复制失败，请检查剪贴板权限后重试');
    }
  }
  async openNote(path: string): Promise<void> {
    const files = noteCandidates(path, this.app.vault.getMarkdownFiles());
    if (!files.length) { new Notice('Note not found in its project. It may not have synced yet: ' + path); return; }
    if (files.length > 1) { new MovedNotePicker(this, files).open(); return; }
    try {
      await this.app.workspace.getLeaf(false).openFile(files[0]);
    } catch { new Notice('Could not open note: ' + files[0].path); }
  }
  settings: Settings = { ...DEFAULTS }; diagnostics: string[] = [];
  sessions = new Map<string, ConversationSession>();
  sessionListeners = new Set<() => void>();
  private restoredSessions = false;
  private dormantSessionIds = new Set<string>();
  private savedSessionIds: string[] = [];
  private saveTimer?: number;
  private scheduleSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => { void this.saveSettings(); }, 400);
  }
  private rememberSessions(): void {
    this.savedSessionIds = [...this.sessions.keys()];
    this.app.saveLocalStorage('pi-edge:active-chats', this.savedSessionIds);
    for (const listener of this.sessionListeners) listener();
  }
  sessionFor(conversation: Conversation): ConversationSession {
    const existing = this.sessions.get(conversation.id);
    if (existing) return existing;
    this.releaseIdleSlot();
    if (this.sessions.size >= MAX_ACTIVE_CHATS) throw new Error('All chat connections are busy. Wait for a task to finish, or stop one in chat history.');
    const pairing = this.pairing();
    if (!pairing) throw new Error('Pair your computer before starting a chat.');
    const session = new ConversationSession(conversation, {
      pairing, permissions: this.settings.permissions, model: this.settings.defaultModel, effort: this.settings.thinking,
      changed: () => {
        this.scheduleSave();
        if (this.settings.active === conversation.id) this.syncCatalog(session);
        for (const listener of this.sessionListeners) listener();
      },
      status: state => { this.recordStatus(state); for (const listener of this.sessionListeners) listener(); }
    });
    this.sessions.set(conversation.id, session); this.rememberSessions();
    this.scheduleSave(); if (!this.dormantSessionIds.has(conversation.id)) session.connect(); return session;
  }
  restoreSessions(): void {
    if (this.restoredSessions) return;
    this.restoredSessions = true;
    const ids = [...this.savedSessionIds];
    for (const id of ids.slice(0, MAX_ACTIVE_CHATS)) {
      const conversation = this.settings.conversations.find(item => item.id === id);
      if (conversation) this.sessionFor(conversation);
    }
  }
  private releaseIdleSlot(): void {
    if (this.sessions.size < MAX_ACTIVE_CHATS) return;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) (leaf.view as EdgeView).captureDraft();
    const idle = [...this.sessions.values()].filter(session => session.canRelease()).sort((a, b) =>
      (a.conversation.lastActivity ?? a.conversation.updated) - (b.conversation.lastActivity ?? b.conversation.updated))[0];
    if (idle) { idle.dispose(true); this.sessions.delete(idle.conversation.id); this.rememberSessions(); }
  }
  chooseConversation(id: string): void {
    if (this.pairing()) this.restoreSessions();
    if (!this.sessions.has(id)) this.releaseIdleSlot();
    if (!this.sessions.has(id) && this.pairing() && this.sessions.size >= MAX_ACTIVE_CHATS) {
      new Notice('All chat connections are busy. Wait for a task to finish, or stop one in chat history.'); return;
    }
    this.settings.active = id; this.reloadViews(); void this.saveSettings();
  }
  newConversation(): void {
    if (this.pairing()) this.restoreSessions();
    this.releaseIdleSlot();
    if (this.sessions.size >= MAX_ACTIVE_CHATS) { new Notice('All chat connections are busy. Wait for a task to finish, or stop one in chat history.'); return; }
    this.settings.active = ''; this.activeConversation(); this.reloadViews(); void this.saveSettings();
  }
  expireIdleConversations(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) (leaf.view as EdgeView).captureDraft();
    const expired = [...this.sessions.values()].filter(session => session.isExpired());
    if (!expired.length) return;
    for (const session of expired) { this.dormantSessionIds.add(session.conversation.id); session.dispose(true); this.sessions.delete(session.conversation.id); }
    this.rememberSessions();
    if (expired.some(session => session.conversation.id === this.settings.active)) {
      this.reloadViews();
    }
    void this.saveSettings();
  }
  endConversation(id: string): void {
    const session = this.sessions.get(id); if (!session || session.busy) return;
    session.dispose(true); this.sessions.delete(id); this.rememberSessions();
    if (this.settings.active === id) this.settings.active = this.sessions.keys().next().value || '';
    this.reloadViews(); void this.saveSettings();
  }
  reconnectSessions(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) (leaf.view as EdgeView).captureDraft();
    this.savedSessionIds = [...new Set([...this.savedSessionIds, ...this.sessions.keys()])];
    const drafts = new Map([...this.sessions].map(([id, session]) => [id, session.draft]));
    for (const session of this.sessions.values()) session.dispose();
    this.sessions.clear(); this.restoredSessions = false;
    if (this.pairing()) this.restoreSessions();
    for (const [id, draft] of drafts) { const session = this.sessions.get(id); if (session) session.draft = draft; }
    this.reloadViews();
  }
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
  selectModel(id: string): void { this.settings.defaultModel = id; void this.saveSettings(); this.sessions.get(this.settings.active)?.selectModel(id); }
  setEffort(level: string): void { this.settings.thinking = level; void this.saveSettings(); this.sessions.get(this.settings.active)?.setEffort(level); }
  setPermissions(mode: PermissionId): void { this.sessions.get(this.settings.active)?.setPermissions(mode); }
  syncCatalog(session: ConversationSession): void {
    const changed = this.models !== session.models || this.effortLevels !== session.effortLevels || this.permissionModes !== session.permissionModes ||
      this.busy !== session.busy || this.settings.permissions !== session.permissions || this.settings.thinking !== session.effort;
    this.models = session.models; this.effortLevels = session.effortLevels; this.busy = session.busy;
    if (session.permissionModes.length) this.permissionModes = session.permissionModes;
    this.settings.permissions = session.permissions; this.settings.thinking = session.effort;
    if (changed) for (const listener of this.catalogListeners) listener();
  }
  lastFile?: TFile; lastMarkdown?: MarkdownView;
  private followFile(file: TFile): void {
    const previousPath = this.lastFile?.path;
    this.lastFile = file;
    if (previousPath === file.path) return;
    // Merely browsing notes should not fill the active-chat slots with unused
    // connections. Keep any chat that has messages, work, or a composer draft.
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) (leaf.view as EdgeView).captureDraft();
    const previous = this.sessions.get(this.settings.active);
    if (previous && !previous.busy && !previous.conversation.messages.length &&
      !previous.draft.text && !previous.draft.attachments.length) {
      previous.dispose(true); this.sessions.delete(previous.conversation.id); this.rememberSessions();
    }
    this.settings.active = '';
    this.reloadViews(); this.scheduleSave();
  }
  private deviceToken?: DeviceToken;
  token(): string { return this.deviceToken?.get() || ''; }
  setToken(token: string): void { this.deviceToken!.set(token); this.invalidateConnectionTest(); }
  pairing(): Pairing | undefined { try { return validatePairing({ url: this.settings.url, token: this.token() }); } catch { return undefined; } }
  async pair(pairing: Pairing): Promise<void> { this.settings.url = pairing.url; this.setToken(pairing.token); await this.saveSettings(); this.reconnectSessions(); await this.openPanel(); new Notice('Computer paired.'); }
  activeConversation(): Conversation {
    let conversation = this.settings.conversations.find(item => item.id === this.settings.active);
    if (!conversation) { conversation = { id: crypto.randomUUID(), title: 'New conversation', messages: [], updated: Date.now(), notePath: this.lastFile?.path }; this.settings.conversations.push(conversation); this.settings.active = conversation.id; }
    return conversation;
  }
  private liveConversationIds(): Set<string> { return new Set([...this.savedSessionIds, ...this.sessions.keys()]); }
  async saveSettings(): Promise<void> {
    this.settings.conversations = pruneHistory(this.settings.conversations, this.settings.active, this.settings, this.liveConversationIds());
    await this.saveData(this.settings);
  }
  async clearHistory(): Promise<void> {
    const live = this.liveConversationIds();
    this.settings.conversations = this.settings.conversations.filter(conversation => live.has(conversation.id));
    await this.saveSettings();
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
    // Opening the sidebar after a reload starts fresh; saved chats remain
    // available through History and device-local background sessions.
    this.settings.active = '';
    Object.assign(this.settings, historyLimits(this.settings));
    const sessionIds: unknown = this.app.loadLocalStorage('pi-edge:active-chats');
    this.savedSessionIds = Array.isArray(sessionIds) ? sessionIds.filter((id): id is string => typeof id === 'string') : [];
    this.register(() => this.invalidateConnectionTest());
    const idleTimer = window.setInterval(() => this.expireIdleConversations(), 60_000);
    this.register(() => window.clearInterval(idleTimer));
    this.lastFile = this.app.workspace.getActiveFile() || undefined;
    this.lastMarkdown = this.app.workspace.getActiveViewOfType(MarkdownView) || undefined;
    this.registerView(VIEW, leaf => new EdgeView(leaf, this));
    this.addRibbonIcon('messages-square', 'Pi Edge', () => { void this.openPanel(); });
    this.addCommand({ id: 'open', name: 'Open chat', callback: () => { void this.openPanel(); } });
    this.addCommand({ id: 'new-chat', name: 'New chat', callback: () => { this.newConversation(); void this.openPanel(); } });
    this.addCommand({ id: 'active-chats', name: 'Chat history', callback: () => { void this.openPanel().then(() => new ChatHistoryModal(this).open()); } });
    this.addCommand({ id: 'pair', name: 'Pair computer', callback: () => new PairModal(this).open() });
    this.addSettingTab(new EdgeSettings(this));
    this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => {
      if (leaf?.view instanceof MarkdownView) {
        this.lastMarkdown = leaf.view;
        if (leaf.view.file) this.followFile(leaf.view.file);
      }
    }));
    this.registerEvent(this.app.workspace.on('file-open', file => { if (file) this.followFile(file); }));
    this.registerObsidianProtocolHandler('pi-edge', parameters => { if (parameters.code) new PairModal(this, parameters.code).open(); else void this.openPanel(); });
  }
  onunload(): void {
    window.clearTimeout(this.saveTimer);
    for (const session of this.sessions.values()) session.dispose();
    void this.saveSettings();
  }
}
