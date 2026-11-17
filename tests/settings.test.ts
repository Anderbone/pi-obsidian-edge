import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import type { App, PluginManifest, PluginSettingTab, Setting, SettingDefinition, SettingGroup, TFile, WorkspaceLeaf } from 'obsidian';
import type EdgePlugin from '../main';
import type { SocketLike } from '../src/client';
import type { AgentEvent, ClientPacket } from '../shared/protocol';

// Only the host's chainable setting controls are faked; both UI paths execute
// the plugin's real row renderers and listener lifecycle.
class ControlHost {
  inputEl = { type: '', min: '', step: '', setAttribute: (_name: string, _value: string) => {} };
  setValue(_value: string | boolean): this { return this; }
  setPlaceholder(_value: string): this { return this; }
  setButtonText(_value: string): this { return this; }
  setDisabled(_value: boolean): this { return this; }
  addOption(_key: string, _value: string): this { return this; }
  onChange(_handler: (value: string) => void): this { return this; }
  onClick(_handler: () => void): this { return this; }
}
class ContainerHost {
  rows: SettingHost[] = [];
  empty(): void { this.rows = []; }
}
class SettingHost {
  name = '';
  descEl = { createDiv: () => ({ dataset: {}, setText: (_value: string) => {} }) };
  constructor(container: ContainerHost) { container.rows.push(this); }
  setName(value: string): this { this.name = value; return this; }
  setDesc(_value: string): this { return this; }
  setHeading(): this { return this; }
  addButton(render: (control: ControlHost) => void): this { render(new ControlHost()); return this; }
  addText(render: (control: ControlHost) => void): this { render(new ControlHost()); return this; }
  addToggle(render: (control: ControlHost) => void): this { render(new ControlHost()); return this; }
  addDropdown(render: (control: ControlHost) => void): this { render(new ControlHost()); return this; }
}

// Load the real plugin against a small Obsidian host, without Electron or Pi.
const code = buildSync({ entryPoints: ['main.ts'], bundle: true, platform: 'browser', format: 'cjs', external: ['obsidian'], write: false }).outputFiles[0].text;
async function loadPlugin(modernSettings = true, initial?: { settings: unknown; activeIds: string[]; file?: TFile; files?: TFile[]; unpaired?: boolean }) {
  let updates = 0;
  const intervals = new Map<number, { callback: () => void; delay: number }>();
  let intervalId = 0;
  const visibility = { visibilityState: 'visible' };
  let layoutReady = () => {};
  let modalOpens = 0;
  const modalTypes: string[] = [];
  let tab: PluginSettingTab | undefined;
  let viewFactory: ((leaf: unknown) => { render(): void }) | undefined;
  let saved: unknown;
  const device = new Map<string, unknown>(initial ? [['pi-edge:active-chats', initial.activeIds]] : []);
  const sockets: SocketHost[] = [];
  const workspaceEvents = new Map<string, (...args: unknown[]) => void>();
  let activeFile = initial?.file ?? null;
  const files = initial?.files ?? (activeFile ? [activeFile] : []);
  class MarkdownHost { constructor(public file: TFile) {} }
  class SocketHost implements SocketLike {
    readyState = 0; sent: ClientPacket[] = []; closes = 0;
    onopen: SocketLike['onopen'] = null; onmessage: SocketLike['onmessage'] = null;
    onclose: SocketLike['onclose'] = null; onerror: SocketLike['onerror'] = null;
    constructor() { sockets.push(this); }
    send(value: string) { this.sent.push(JSON.parse(value)); }
    close() { this.closes++; this.readyState = 3; this.onclose?.({ code: 1000 }); }
  }
  const oldDevice = new Map(initial?.unpaired ? [] : [['pi-edge:Test vault:.obsidian:token', 'existing-pairing-token-for-test']]);
  class PluginHost {
    constructor(public app: App, public manifest: PluginManifest) {}
    register(): void {}
    registerView(_type: string, factory: typeof viewFactory): void { viewFactory = factory; }
    registerEvent(): void {}
    registerDomEvent(): void {}
    registerObsidianProtocolHandler(): void {}
    addRibbonIcon(): void {}
    addCommand(): void {}
    addSettingTab(value: PluginSettingTab): void { tab = value; }
    async loadData(): Promise<unknown> { return initial ? initial.settings : { url: 'ws://127.0.0.1:8771' }; }
    async saveData(data: unknown): Promise<void> { saved = structuredClone(data); }
  }
  class SettingTabHost {
    containerEl = new ContainerHost();
    constructor(public app: App, public plugin: PluginHost) {}
    update(): void { updates++; }
  }
  const module: { exports: { default?: unknown } } = { exports: {} };
  runInNewContext(code, {
    module, exports: module.exports, TextEncoder, URL, crypto: globalThis.crypto, WebSocket: SocketHost, AbortController, document: visibility,
    require: (name: string) => {
      assert.equal(name, 'obsidian');
      return { Setting: SettingHost, requireApiVersion: () => modernSettings, Plugin: PluginHost, PluginSettingTab: SettingTabHost, ItemView: class {}, Modal: class { open() { modalOpens++; modalTypes.push(this.constructor.name); } close() {} }, FuzzySuggestModal: class {}, MarkdownView: MarkdownHost, Notice: class {} };
    },
    window: { setInterval: (callback: () => void, delay: number) => { intervals.set(++intervalId, { callback, delay }); return intervalId; }, clearInterval: (id: number) => { intervals.delete(id); }, setTimeout, clearTimeout, localStorage: { getItem: (key: string) => oldDevice.get(key) ?? null, removeItem: (key: string) => oldDevice.delete(key) } }
  });
  const Plugin = module.exports.default as typeof EdgePlugin;
  const app = {
    vault: { getName: () => 'Test vault', configDir: '.obsidian', getMarkdownFiles: () => files,
      on: (event: string, handler: (...args: unknown[]) => void) => { workspaceEvents.set(event, handler); return {}; } },
    loadLocalStorage: (key: string): unknown => device.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => { if (value === null) device.delete(key); else device.set(key, value); },
    workspace: {
      rightSplit: { collapsed: true },
      onLayoutReady: (callback: () => void) => { layoutReady = callback; },
      getLeavesOfType: () => [], getActiveFile: () => activeFile, getActiveViewOfType: () => null,
      on: (event: string, handler: (...args: unknown[]) => void) => { workspaceEvents.set(event, handler); return {}; }
    }
  } as unknown as App;
  const plugin = new Plugin(app, { id: 'pi-edge' } as PluginManifest);
  await plugin.onload();
  assert.ok(tab);
  let sequence = 0;
  const emit = (event: AgentEvent) => {
    const conversation = plugin.activeConversation();
    const session = plugin.sessionFor(conversation);
    const socket = sockets[[...plugin.sessions.values()].indexOf(session)];
    socket.onmessage?.({ data: JSON.stringify({ type: 'edge.event', sessionId: conversation.id, seq: ++sequence, event }) });
  };
  const openFile = (file: TFile, firstEvent: 'active-leaf-change' | 'file-open' = 'active-leaf-change') => {
    activeFile = file;
    if (!files.some(item => item.path === file.path)) files.push(file);
    const leaf = { view: new MarkdownHost(file) };
    workspaceEvents.get(firstEvent)?.(firstEvent === 'file-open' ? file : leaf);
    workspaceEvents.get(firstEvent === 'file-open' ? 'active-leaf-change' : 'file-open')?.(firstEvent === 'file-open' ? leaf : file);
  };
  return { intervals, visibility, modalTypes, layoutReady: () => layoutReady(), modalOpens: () => modalOpens, plugin, tab, device, oldDevice, sockets, emit, openFile, workspaceEvents, createView: () => viewFactory!({}), saved: () => saved, updates: () => updates };
}
function rows(tab: PluginSettingTab): SettingDefinition[] {
  return tab.getSettingDefinitions().flatMap(item => 'items' in item ? item.items || [] : []).filter((item): item is SettingDefinition => !('type' in item));
}

test('plugin settings expose searchable connection and history controls while preserving pairing', async () => {
  const { plugin, tab, oldDevice, saved } = await loadPlugin();
  const names = rows(tab).map(row => row.name);
  for (const name of ['Computer connection', 'Bridge address', 'Bridge token', 'Default model', 'Permissions', 'Maximum conversations', 'Maximum history size']) assert.ok(names.includes(name), name);
  assert.equal(plugin.token(), 'existing-pairing-token-for-test');
  assert.equal(oldDevice.size, 0);
  await plugin.saveSettings();
  assert.ok(!JSON.stringify(saved()).includes('existing-pairing-token-for-test'), 'credentials must stay outside synced plugin data');
  assert.ok(!names.includes('Reasoning effort'));
  plugin.effortLevels = ['off', 'low', 'high'];
  assert.ok(rows(tab).some(row => row.name === 'Reasoning effort'));
});

test('connection summary checks automatically, reflects success and failure, and stops polling on close', async () => {
  const { plugin, tab, intervals, visibility } = await loadPlugin();
  let checks = 0;
  plugin.testConnection = async () => { checks++; };
  const row = rows(tab)[0];
  assert.ok(row?.render);
  assert.ok(!rows(tab).some(row => row.name === 'Connection test'));
  const status = { text: '', dataset: { state: '' }, setText(value: string) { this.text = value; } };
  let name = '';
  let label = '';
  const button = {
    setButtonText: (value: string) => { label = value; return button; },
    onClick: () => button
  };
  const setting = {
    setName: (value: string) => { name = value; return setting; },
    descEl: { createDiv: () => status },
    addButton: (render: (value: typeof button) => void) => { render(button); }
  };
  const dispose = row.render(setting as unknown as Setting, {} as SettingGroup);
  assert.equal(checks, 1, 'opening settings checks the bridge immediately');
  assert.equal(label, 'Pair again');
  assert.equal(plugin.connectionListeners.size, 1);
  const poll = [...intervals.values()].find(timer => timer.delay === 15_000);
  assert.ok(poll);
  poll.callback();
  assert.equal(checks, 2);
  visibility.visibilityState = 'hidden';
  poll.callback();
  assert.equal(checks, 2, 'hidden app does not poll');
  visibility.visibilityState = 'visible';
  plugin.connectionState = { state: 'connected', message: 'Connected' };
  for (const refresh of plugin.connectionListeners) refresh();
  assert.equal(name, 'Connected');
  assert.equal(status.dataset.state, 'connected');
  assert.equal(status.text, 'Connected');
  plugin.connectionState = { state: 'error', message: 'Computer is offline' };
  for (const refresh of plugin.connectionListeners) refresh();
  assert.equal(name, 'Computer connection');
  assert.equal(status.dataset.state, 'error');
  assert.equal(status.text, 'Computer is offline');
  assert.equal(typeof dispose, 'function');
  if (dispose) dispose();
  assert.equal(plugin.connectionListeners.size, 0);
  assert.ok(![...intervals.values()].some(timer => timer.delay === 15_000));
});

test('model catalog changes refresh modern settings and leave hidden legacy tabs alone', async t => {
  const modern = await loadPlugin();
  t.after(() => modern.plugin.onunload());
  modern.emit({ kind: 'effort.levels', levels: ['off', 'high'] });
  assert.ok(modern.updates() >= 1);
  assert.ok(rows(modern.tab).some(row => row.name === 'Reasoning effort'));
  const legacy = await loadPlugin(false);
  t.after(() => legacy.plugin.onunload());
  legacy.emit({ kind: 'effort.levels', levels: ['off', 'high'] });
  assert.equal(legacy.updates(), 0);
  assert.equal(legacy.plugin.connectionListeners.size, 0);
});


test('older Obsidian renders the shared settings and cleans up on refresh and close', async t => {
  const { plugin, tab, emit } = await loadPlugin(false);
  plugin.testConnection = async () => {};
  t.after(() => plugin.onunload());
  tab.display();
  const container = tab.containerEl as unknown as ContainerHost;
  for (const name of ['Computer connection', 'Default model', 'Permissions', 'Maximum conversations']) {
    assert.ok(container.rows.some(row => row.name === name), name);
  }
  assert.equal(plugin.connectionListeners.size, 1);
  emit({ kind: 'effort.levels', levels: ['off', 'high'] });
  assert.ok(container.rows.some(row => row.name === 'Reasoning effort'));
  assert.equal(plugin.connectionListeners.size, 1, 'refresh must dispose the previous connection row');
  tab.hide();
  assert.equal(plugin.connectionListeners.size, 0);
  emit({ kind: 'effort.levels', levels: ['off'] });
  assert.equal(plugin.connectionListeners.size, 0, 'hidden legacy settings must not mount new listeners');
});

test('plugin keeps background sessions alive, protects their history and restores device-local active IDs', async t => {
  const { plugin, sockets, device, saved } = await loadPlugin(); t.after(() => plugin.onunload());
  const a = plugin.activeConversation(); plugin.sessionFor(a);
  plugin.newConversation(); const b = plugin.activeConversation(); plugin.sessionFor(b);
  assert.equal(plugin.sessions.size, 2);
  plugin.chooseConversation(a.id);
  assert.equal(plugin.settings.active, a.id);
  assert.ok(sockets.every(socket => socket.closes === 0));
  plugin.settings.historyMaxConversations = 1; await plugin.saveSettings();
  assert.equal(plugin.settings.conversations.length, 2);
  assert.deepEqual(Array.from(device.get('pi-edge:active-chats') as string[]), [a.id, b.id]);
  const restored = await loadPlugin(true, { settings: saved(), activeIds: [a.id, b.id] });
  t.after(() => restored.plugin.onunload());
  restored.plugin.settings.conversations.push({ id: 'archived', title: 'Archive', updated: 0, messages: [] });
  await restored.plugin.clearHistory();
  assert.equal(restored.plugin.settings.conversations.length, 2, 'clearing before reconnecting must preserve device-local active chats');
  assert.equal(restored.sockets.length, 0);
  restored.plugin.restoreSessions();
  assert.deepEqual(Array.from(restored.plugin.sessions.keys()), [a.id, b.id]);
  assert.equal(restored.sockets.length, 2);
  plugin.endConversation(b.id);
  assert.equal(sockets[1].closes, 1); assert.equal(sockets[0].closes, 0);
  assert.equal(plugin.sessions.size, 1);
  assert.deepEqual(Array.from(device.get('pi-edge:active-chats') as string[]), [a.id]);
});

test('plugin prevents a ninth active chat without changing the current conversation', async t => {
  const { plugin, sockets } = await loadPlugin(); t.after(() => plugin.onunload());
  for (let i = 0; i < 8; i++) { plugin.newConversation(); plugin.sessionFor(plugin.activeConversation()).busy = true; }
  const active = plugin.settings.active;
  plugin.newConversation();
  assert.equal(plugin.sessions.size, 8); assert.equal(sockets.length, 8);
  assert.equal(plugin.settings.active, active);
});

test('opening another note starts independent context while preserving earlier chats, drafts and running tasks', async t => {
  const { plugin, openFile, sockets, emit, workspaceEvents } = await loadPlugin();
  t.after(() => plugin.onunload());
  openFile({ path: 'projects/A.md' } as TFile);
  const a = plugin.activeConversation(); const sessionA = plugin.sessionFor(a);
  sessionA.send('Work on A', []);
  sessionA.draft = { text: 'Follow-up for A', attachments: [{ id: 'A', name: 'A.md', text: 'Only for A' }] };
  openFile({ path: 'projects/B.md' } as TFile, 'file-open');
  const b = plugin.activeConversation(); const sessionB = plugin.sessionFor(b);
  assert.notEqual(b.id, a.id);
  assert.equal(b.notePath, 'projects/B.md');
  assert.equal(b.messages.length, 0);
  assert.equal(b.bridgeSessionId, undefined);
  assert.equal(sessionB.draft.text, ''); assert.equal(sessionB.draft.attachments.length, 0);
  assert.equal(sessionA.busy, true); assert.equal(sockets[0].closes, 0);
  assert.equal(sessionA.draft.attachments[0].text, 'Only for A');
  emit({ kind: 'message', id: 'reply-b', role: 'assistant', text: 'Only B', final: true });
  assert.ok(!a.messages.some(message => message.text === 'Only B'));
  // Focusing the same note or the sidebar must not reset the composer again.
  openFile({ path: 'projects/B.md' } as TFile);
  workspaceEvents.get('active-leaf-change')?.({ view: {} });
  workspaceEvents.get('file-open')?.(null);
  assert.equal(plugin.activeConversation().id, b.id);
  // History remains an explicit way to resume A, even while B is open.
  plugin.chooseConversation(a.id);
  assert.equal(plugin.activeConversation().id, a.id);
  openFile({ path: 'projects/B.md' } as TFile);
  assert.equal(plugin.activeConversation().id, b.id);
});

test('browsing notes releases unused connections but keeps drafts and completed history', async t => {
  const { plugin, openFile, sockets } = await loadPlugin();
  t.after(() => plugin.onunload());
  for (let i = 0; i < 12; i++) {
    openFile({ path: `notes/${i}.md` } as TFile);
    plugin.sessionFor(plugin.activeConversation());
    assert.equal(plugin.sessions.size, 1);
  }
  assert.ok(sockets.slice(0, -1).every(socket => socket.closes === 1));
  const draftChat = plugin.activeConversation(); const draftSession = plugin.sessionFor(draftChat);
  draftSession.draft = { text: '', attachments: [{ id: 'image', name: 'image.png', data: 'aGVsbG8=', mimeType: 'image/png' }] };
  openFile({ path: 'notes/completed.md' } as TFile);
  const completed = plugin.activeConversation(); const completedSession = plugin.sessionFor(completed);
  completed.messages.push({ id: 'done', role: 'assistant', text: 'Finished', final: true });
  openFile({ path: 'notes/next.md' } as TFile);
  assert.equal(plugin.sessions.get(draftChat.id), draftSession);
  assert.equal(plugin.sessions.get(completed.id), completedSession);
  assert.equal(plugin.lastFile?.path, 'notes/next.md');
});

test('plugin reload defaults to a new chat for the current file while retaining saved sessions', async t => {
  const old = { id: 'old-chat', title: 'Old task', notePath: 'Old.md', messages: [{ id: 'old-message', role: 'user', text: 'Old context', final: true }], updated: 1 };
  const { plugin } = await loadPlugin(true, {
    settings: { url: 'ws://127.0.0.1:8771', active: old.id, conversations: [old] },
    activeIds: [old.id], file: { path: 'projects/Current.md' } as TFile
  });
  t.after(() => plugin.onunload());
  const fresh = plugin.activeConversation();
  assert.notEqual(fresh.id, old.id); assert.equal(fresh.notePath, 'projects/Current.md');
  assert.equal(fresh.messages.length, 0);
  plugin.restoreSessions();
  assert.equal(plugin.sessions.get(old.id)?.conversation.messages[0].text, 'Old context');
  plugin.chooseConversation(old.id);
  assert.equal(plugin.activeConversation().id, old.id);
});

test('reconnecting all chats preserves their drafts and keeps settings for background chats separate', async t => {
  const { plugin, sockets, emit } = await loadPlugin(); t.after(() => plugin.onunload());
  const a = plugin.activeConversation(); const sessionA = plugin.sessionFor(a);
  sessionA.draft = { text: 'Draft A', attachments: [{ id: 'A.md', name: 'A.md', text: 'Note A' }] };
  plugin.newConversation(); const b = plugin.activeConversation(); const sessionB = plugin.sessionFor(b);
  sessionB.draft = { text: 'Draft B', attachments: [] };
  emit({ kind: 'state', busy: true, model: 'b/model', effort: 'high', reasoning: true });
  assert.equal(plugin.busy, true); assert.equal(sessionA.busy, false);
  plugin.reconnectSessions();
  assert.equal(sockets.length, 4);
  assert.equal(sockets[0].closes, 1); assert.equal(sockets[1].closes, 1);
  assert.equal(plugin.sessions.get(a.id)?.draft.attachments[0].text, 'Note A');
  assert.equal(plugin.sessions.get(b.id)?.draft.text, 'Draft B');
  assert.equal(plugin.settings.active, b.id);
});

test('tool detail preference defaults to compact and persists changes through the shared settings control', async t => {
  const { plugin, tab, saved } = await loadPlugin(); t.after(() => plugin.onunload());
  assert.equal(plugin.settings.showToolDetails, false);
  const row = rows(tab).find(row => row.name === 'Show tool call details');
  assert.ok(row?.render);
  let change: ((value: boolean) => void) | undefined;
  const toggle = { setValue(value: boolean) { assert.equal(value, false); return toggle; }, onChange(handler: (value: boolean) => void) { change = handler; return toggle; } };
  row.render({ addToggle(render: (control: typeof toggle) => void) { render(toggle); } } as unknown as Setting, {} as SettingGroup);
  assert.ok(change); change(true);
  await plugin.saveSettings();
  assert.equal((saved() as { showToolDetails: boolean }).showToolDetails, true);
});

test('automatic idle cleanup releases active slots and retains resumable history', async () => {
  const { plugin, emit, sockets, device } = await loadPlugin();
  const conversation = plugin.activeConversation();
  const session = plugin.sessionFor(conversation);
  emit({ kind: 'state', busy: false, model: 'test/model', effort: 'off', reasoning: true });
  // The host socket has not performed the ready handshake yet.
  session.status = 'ready';
  conversation.lastActivity = Date.now() - 25 * 60 * 60 * 1000;
  plugin.expireIdleConversations();
  assert.equal(plugin.sessions.has(conversation.id), false);
  assert.ok(plugin.settings.conversations.some(item => item.id === conversation.id));
  assert.equal(sockets[0].closes, 1);
  assert.ok(!JSON.stringify(device.get('pi-edge:active-chats')).includes(conversation.id));
  plugin.chooseConversation(conversation.id);
  assert.equal(plugin.settings.active, conversation.id);
  const resumed = plugin.sessionFor(conversation);
  assert.equal(resumed.conversation.id, conversation.id);
  plugin.onunload();
});

test('viewing saved chats preserves both the message time and idle timer', async () => {
  const { plugin } = await loadPlugin();
  const conversation = plugin.activeConversation();
  conversation.updated = 123;
  conversation.lastActivity = 456;
  plugin.chooseConversation(conversation.id);
  assert.equal(conversation.updated, 123);
  assert.equal(conversation.lastActivity, 456);
  plugin.onunload();
});

test('opening a chat automatically releases a confirmed idle connection at the slot limit', async () => {
  const { plugin, emit } = await loadPlugin();
  const first = plugin.activeConversation();
  const idle = plugin.sessionFor(first);
  emit({ kind: 'state', busy: false, model: 'test/model', effort: 'off', reasoning: true });
  idle.status = 'ready';
  for (let i = 1; i < 8; i++) {
    plugin.newConversation();
    plugin.sessionFor(plugin.activeConversation()).busy = true;
  }
  plugin.newConversation();
  assert.notEqual(plugin.settings.active, first.id);
  assert.equal(plugin.sessions.has(first.id), false);
  assert.ok(plugin.settings.conversations.some(item => item.id === first.id));
  plugin.onunload();
});


test('returning to a note resumes recent history without refreshing activity', async t => {
  const { plugin, openFile } = await loadPlugin();
  t.after(() => plugin.onunload());
  openFile({ path: 'A.md' } as TFile);
  const a = plugin.activeConversation();
  a.updated = a.lastActivity = Date.now() - 60_000;
  a.messages.push({ id: 'a', role: 'user', text: 'Hello', final: true });
  const activity = a.lastActivity;
  openFile({ path: 'B.md' } as TFile);
  const b = plugin.activeConversation();
  assert.notEqual(b.id, a.id);
  assert.equal(b.notePath, 'B.md');
  assert.equal(b.messages.length, 0);
  openFile({ path: 'A.md' } as TFile);
  assert.equal(plugin.activeConversation().id, a.id);
  assert.equal(a.lastActivity, activity);
  a.updated = a.lastActivity = Date.now() - 24 * 60 * 60 * 1000;
  openFile({ path: 'B.md' } as TFile);
  openFile({ path: 'A.md' } as TFile);
  const fresh = plugin.activeConversation();
  assert.notEqual(fresh.id, a.id);
  assert.equal(plugin.previousNoteConversation(fresh)?.id, a.id);
  plugin.chooseConversation(a.id);
  assert.equal(plugin.activeConversation().id, a.id);
});

test('running work and drafts survive the resume window, while explicit new chat takes priority', async t => {
  const { plugin, openFile } = await loadPlugin();
  t.after(() => plugin.onunload());
  openFile({ path: 'A.md' } as TFile);
  const a = plugin.activeConversation();
  const session = plugin.sessionFor(a);
  a.updated = a.lastActivity = Date.now() - 25 * 60 * 60 * 1000;
  session.busy = true;
  openFile({ path: 'B.md' } as TFile);
  openFile({ path: 'A.md' } as TFile);
  assert.equal(plugin.activeConversation().id, a.id);
  session.busy = false;
  session.draft.text = 'Unsent';
  openFile({ path: 'B.md' } as TFile);
  openFile({ path: 'A.md' } as TFile);
  assert.equal(plugin.activeConversation().id, a.id);
  plugin.newConversation();
  const fresh = plugin.activeConversation();
  openFile({ path: 'B.md' } as TFile);
  openFile({ path: 'A.md' } as TFile);
  assert.equal(plugin.activeConversation().id, fresh.id);
  assert.equal(session.draft.text, 'Unsent');
});


test('reloading the plugin restores recent chat for the current file', async t => {
  const recent = { id: 'recent', title: 'Recent', notePath: 'A.md', messages: [], updated: Date.now() - 1000 };
  const { plugin } = await loadPlugin(true, { settings: { conversations: [recent] }, activeIds: [], file: { path: 'A.md' } as TFile });
  t.after(() => plugin.onunload());
  assert.equal(plugin.activeConversation().id, recent.id);
});


test('unused connections yield a slot instead of reporting every session busy', async t => {
  const { plugin, sockets } = await loadPlugin(); t.after(() => plugin.onunload());
  for (let i = 0; i < 8; i++) { plugin.newConversation(); plugin.sessionFor(plugin.activeConversation()); }
  plugin.newConversation();
  plugin.sessionFor(plugin.activeConversation());
  assert.equal(plugin.sessions.size, 8);
  assert.equal(sockets.length, 9);
  assert.equal(sockets[0].closes, 1);
});

test('restoring eight disconnected chats still allows the current note to open', async t => {
  const conversations = Array.from({ length: 8 }, (_, i) => ({
    id: `restored-${i}`, title: `Saved ${i}`, notePath: `Old-${i}.md`, updated: i + 1,
    messages: [{ id: `message-${i}`, role: 'user', text: 'Earlier conversation', final: true }]
  }));
  const { plugin, sockets } = await loadPlugin(true, {
    settings: { url: 'ws://127.0.0.1:8771', conversations },
    activeIds: conversations.map(chat => chat.id), file: { path: 'Current.md' } as TFile
  });
  t.after(() => plugin.onunload());
  plugin.restoreSessions();
  const current = plugin.activeConversation();
  assert.equal(current.notePath, 'Current.md');
  const session = plugin.sessionFor(current);
  assert.equal(plugin.sessions.get(current.id), session);
  assert.equal(plugin.sessions.size, 8);
  assert.equal(sockets[0].closes, 1);
  assert.equal(plugin.settings.conversations.filter(chat => chat.id.startsWith('restored-')).length, 8);
  assert.equal(sockets[0].sent.some(command => command.type === 'edge.session.close'), false);
});

test('switching notes retains a chat with an unconfirmed outgoing message', async t => {
  const { plugin, openFile, sockets } = await loadPlugin();
  t.after(() => plugin.onunload());
  openFile({ path: 'A.md' } as TFile);
  const conversation = plugin.activeConversation();
  const session = plugin.sessionFor(conversation);
  conversation.outbox!.push({ id: 'pending', role: 'user', text: 'Keep this', final: true, delivery: 'unconfirmed' });
  openFile({ path: 'B.md' } as TFile);
  assert.equal(plugin.sessions.get(conversation.id), session);
  assert.equal(sockets[0].closes, 0);
  openFile({ path: 'A.md' } as TFile);
  assert.equal(plugin.activeConversation().id, conversation.id);
  assert.equal(conversation.outbox![0].text, 'Keep this');
});

test('recent messages win over a newer automatically created empty chat for the same note', async t => {
  const now = Date.now();
  const recent = { id: 'recent-content', title: 'Recent', notePath: 'A.md', updated: now - 180_000,
    messages: [{ id: 'user', role: 'user', text: 'Continue this', final: true }] };
  const empty = { id: 'empty', title: 'New conversation', notePath: 'A.md', updated: now - 1000, messages: [] };
  const { plugin, openFile } = await loadPlugin(true, { settings: { conversations: [recent, empty] }, activeIds: [], file: { path: 'A.md' } as TFile });
  t.after(() => plugin.onunload());
  assert.equal(plugin.activeConversation().id, recent.id);
  openFile({ path: 'B.md' } as TFile);
  openFile({ path: 'A.md' } as TFile);
  assert.equal(plugin.activeConversation().id, recent.id);
});

test('a different path never inherits recent history from a same-named missing note', async t => {
  const path = 'projects/demo/In-progress/plan/Task.md';
  const old = { id: 'history', title: 'Task', notePath: 'projects/demo/plan/Task.md', updated: Date.now() - 1000,
    messages: [{ id: 'hello', role: 'user', text: 'Continue this task', final: true }] };
  const empty = { id: 'empty', title: 'New conversation', notePath: path, updated: Date.now(), messages: [] };
  const { plugin } = await loadPlugin(true, {
    settings: { conversations: [empty, old], active: empty.id }, activeIds: [], file: { path } as TFile
  });
  t.after(() => plugin.onunload());
  assert.equal(plugin.activeConversation().id, empty.id);
  assert.equal(plugin.activeConversation().messages.length, 0);
  assert.equal(old.notePath, 'projects/demo/plan/Task.md');
});

test('automatic resume never merges different note paths', async t => {
  const path = 'projects/demo/In-progress/Task.md';
  for (const paths of [
    [path, 'projects/demo/Task.md'],
    [path, 'projects/demo/done/Task.md'],
    ['projects/other/Task.md']
  ]) {
    const old = { id: 'history', title: 'Task', notePath: paths[0].startsWith('projects/other') ? paths[0] : 'projects/demo/Task.md', updated: Date.now(),
      messages: [{ id: 'hello', role: 'user', text: 'Separate task', final: true }] };
    const { plugin } = await loadPlugin(true, {
      settings: { conversations: [old] }, activeIds: [], file: { path } as TFile,
      files: paths.map(path => ({ path } as TFile))
    });
    t.after(() => plugin.onunload());
    assert.notEqual(plugin.activeConversation().id, old.id);
  }
});

test('reload retains the selected history when workspace has no active file yet', async t => {
  const old = { id: 'history', title: 'Task', notePath: 'A.md', updated: Date.now(), messages: [] };
  const { plugin } = await loadPlugin(true, { settings: { conversations: [old], active: old.id }, activeIds: [] });
  t.after(() => plugin.onunload());
  assert.equal(plugin.activeConversation().id, old.id);
});

test('live note renames retain the selected conversation and session', async t => {
  const { plugin, openFile, workspaceEvents } = await loadPlugin();
  t.after(() => plugin.onunload());
  const file = { path: 'projects/demo/Task.md' } as TFile;
  openFile(file);
  const conversation = plugin.activeConversation();
  const session = plugin.sessionFor(conversation);
  file.path = 'projects/demo/done/Task.md';
  workspaceEvents.get('rename')?.(file, 'projects/demo/Task.md');
  openFile(file);
  assert.equal(plugin.activeConversation().id, conversation.id);
  assert.equal(conversation.notePath, file.path);
  assert.equal(plugin.sessions.get(conversation.id), session);
});

test('moving a folder updates chats bound to its descendant notes', async t => {
  const { plugin, openFile, workspaceEvents } = await loadPlugin();
  t.after(() => plugin.onunload());
  openFile({ path: 'projects/demo/plan/Task.md' } as TFile);
  const conversation = plugin.activeConversation();
  workspaceEvents.get('rename')?.({ path: 'projects/demo/In-progress/plan' }, 'projects/demo/plan');
  assert.equal(conversation.notePath, 'projects/demo/In-progress/plan/Task.md');
});

test('paired device never opens setup automatically, even without version acknowledgement', async t => {
  const host = await loadPlugin();
  t.after(() => host.plugin.onunload());
  assert.equal(host.modalOpens(), 0);
  host.layoutReady();
  assert.equal(host.modalOpens(), 0, 'existing pairing must suppress the setup dialog');
  host.device.set('pi-edge:upgrade:0.3.7', true);
  host.layoutReady();
  assert.equal(host.modalOpens(), 0);
  host.plugin.openUpgradeNotes();
  assert.equal(host.modalOpens(), 1, 'setup steps remain manually available');
});

for (const settings of [null, { url: 'ws://127.0.0.1:8771' }]) {
  test(`unpaired device opens pairing instead of upgrade steps (${settings ? 'synced settings' : 'fresh install'})`, async t => {
    const host = await loadPlugin(true, { settings, activeIds: [], unpaired: true });
    t.after(() => host.plugin.onunload());
    assert.equal(host.modalOpens(), 0);
    host.layoutReady();
    assert.deepEqual(host.modalTypes, ['PairModal']);
    assert.equal(host.device.get('pi-edge:upgrade:0.3.7'), true, 'new setup must not receive a migration notice after pairing');
    assert.equal(rows(host.tab)[0].name, 'Pair computer');
    assert.ok(!rows(host.tab).some(row => /update/i.test(row.name || '')), 'setup settings must not present a separate upgrade entry');
    host.plugin.openUpgradeNotes();
    assert.deepEqual(host.modalTypes, ['PairModal', 'UpgradeModal'], 'migration instructions remain manually available');
  });
}

test('reopening the same note replaces an automatic blank chat with recent history', async t => {
  const { plugin, openFile, workspaceEvents, createView } = await loadPlugin();
  t.after(() => plugin.onunload());
  openFile({ path: 'A.md' } as TFile);
  const blank = plugin.activeConversation();
  const recent = { id: 'recovered', title: 'Earlier chat', notePath: 'A.md', updated: Date.now() - 60_000,
    messages: [{ id: 'question', role: 'user' as const, text: 'Edit this note', final: true }] };
  plugin.settings.conversations.push(recent);
  const view = createView();
  let displayed: string | undefined;
  view.render = () => { displayed = plugin.activeConversation().id; };
  workspaceEvents.get('active-leaf-change')?.({ view });
  assert.equal(displayed, recent.id, 'a retained mobile panel must recheck history even without a file-open event');
  assert.equal(blank.messages.length, 0);
});

test('an automatic blank chat with a draft is never replaced when recent history appears', async t => {
  const { plugin, openFile } = await loadPlugin();
  t.after(() => plugin.onunload());
  openFile({ path: 'A.md' } as TFile);
  const blank = plugin.activeConversation();
  plugin.sessionFor(blank).draft.text = 'Keep typing';
  plugin.settings.conversations.push({ id: 'recovered', title: 'Earlier chat', notePath: 'A.md', updated: Date.now(),
    messages: [{ id: 'question', role: 'user', text: 'Edit this note', final: true }] });
  assert.equal(plugin.activeConversation().id, blank.id);
});

test('swiping open the right drawer restores history without changing the active leaf', async t => {
  const { plugin, openFile, workspaceEvents, createView } = await loadPlugin();
  t.after(() => plugin.onunload());
  openFile({ path: 'A.md' } as TFile);
  plugin.activeConversation();
  plugin.settings.conversations.push({ id: 'drawer-history', title: 'Earlier work', notePath: 'A.md', updated: Date.now() - 60_000,
    messages: [{ id: 'question', role: 'user', text: 'Edit this note', final: true }] });
  const view = createView();
  let displayed: string | undefined;
  let renders = 0;
  view.render = () => { displayed = plugin.activeConversation().id; renders++; };
  plugin.app.workspace.getLeavesOfType = () => [{ view } as unknown as WorkspaceLeaf];
  plugin.app.workspace.rightSplit.collapsed = false;
  workspaceEvents.get('layout-change')?.();
  assert.equal(displayed, 'drawer-history');
  workspaceEvents.get('layout-change')?.();
  assert.equal(renders, 1, 'ordinary layout changes must not rebuild the chat');
});

test('a stale explicit new-chat preference cannot hide more recent conversation activity', async t => {
  const now = Date.now();
  const blank = { id: 'blank', title: 'New conversation', notePath: 'A.md', updated: now - 120_000, resumePreferred: true, messages: [] };
  const recent = { id: 'recent', title: 'Latest work', notePath: 'A.md', updated: now - 60_000,
    messages: [{ id: 'question', role: 'user', text: 'Latest edit', final: true }] };
  const { plugin } = await loadPlugin(true, { settings: { conversations: [blank, recent] }, activeIds: [], file: { path: 'A.md' } as TFile });
  t.after(() => plugin.onunload());
  assert.equal(plugin.activeConversation().id, recent.id);
});

test('continuing an older chat takes priority over a previous explicit blank chat on return', async t => {
  const { plugin, openFile } = await loadPlugin();
  t.after(() => plugin.onunload());
  openFile({ path: 'A.md' } as TFile);
  const old = plugin.activeConversation();
  old.messages.push({ id: 'question', role: 'user', text: 'Earlier work', final: true });
  old.updated = Date.now() - 30 * 24 * 60 * 60 * 1000;
  plugin.newConversation();
  const fresh = plugin.activeConversation();
  assert.equal(plugin.previousNoteConversation(fresh)?.id, old.id, 'continue has no arbitrary age cutoff');
  plugin.chooseConversation(old.id);
  assert.equal(old.updated < Date.now() - 29 * 24 * 60 * 60 * 1000, true, 'selection must not count as conversation activity');
  openFile({ path: 'B.md' } as TFile);
  openFile({ path: 'A.md' } as TFile);
  assert.equal(fresh.resumePreferred, false, 'a superseded new-chat preference must be cleared');
  assert.notEqual(plugin.activeConversation().id, old.id, 'older history still requires an explicit continue');
  assert.equal(plugin.previousNoteConversation(plugin.activeConversation())?.id, old.id);
});

test('reopening the current file rejects a stale selection belonging to another file', async t => {
  const { plugin, openFile } = await loadPlugin();
  t.after(() => plugin.onunload());
  openFile({ path: 'Test.md' } as TFile);
  const old = plugin.activeConversation();
  old.messages.push({ id: 'old', role: 'user', text: 'Old chat', final: true });
  const file = { path: 'inbox/night feeding/2026-11-15.md' } as TFile;
  openFile(file);
  plugin.settings.active = old.id;
  openFile(file);
  const current = plugin.activeConversation();
  assert.notEqual(current.id, old.id);
  assert.equal(current.notePath, file.path);
  assert.equal(current.messages.length, 0);
});
