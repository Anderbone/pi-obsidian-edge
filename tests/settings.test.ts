import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import type { App, PluginManifest, PluginSettingTab, Setting, SettingDefinition, SettingGroup } from 'obsidian';
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
async function loadPlugin(modernSettings = true, initial?: { settings: unknown; activeIds: string[] }) {
  let updates = 0;
  let tab: PluginSettingTab | undefined;
  let saved: unknown;
  const device = new Map<string, unknown>(initial ? [['pi-edge:active-chats', initial.activeIds]] : []);
  const sockets: SocketHost[] = [];
  class SocketHost implements SocketLike {
    readyState = 0; sent: ClientPacket[] = []; closes = 0;
    onopen: SocketLike['onopen'] = null; onmessage: SocketLike['onmessage'] = null;
    onclose: SocketLike['onclose'] = null; onerror: SocketLike['onerror'] = null;
    constructor() { sockets.push(this); }
    send(value: string) { this.sent.push(JSON.parse(value)); }
    close() { this.closes++; this.readyState = 3; this.onclose?.({ code: 1000 }); }
  }
  const oldDevice = new Map([['pi-edge:Test vault:.obsidian:token', 'existing-pairing-token-for-test']]);
  class PluginHost {
    constructor(public app: App, public manifest: PluginManifest) {}
    register(): void {}
    registerView(): void {}
    registerEvent(): void {}
    registerObsidianProtocolHandler(): void {}
    addRibbonIcon(): void {}
    addCommand(): void {}
    addSettingTab(value: PluginSettingTab): void { tab = value; }
    async loadData(): Promise<unknown> { return initial?.settings ?? { url: 'ws://127.0.0.1:8771' }; }
    async saveData(data: unknown): Promise<void> { saved = structuredClone(data); }
  }
  class SettingTabHost {
    containerEl = new ContainerHost();
    constructor(public app: App, public plugin: PluginHost) {}
    update(): void { updates++; }
  }
  const module: { exports: { default?: unknown } } = { exports: {} };
  runInNewContext(code, {
    module, exports: module.exports, TextEncoder, URL, crypto: globalThis.crypto, WebSocket: SocketHost,
    require: (name: string) => {
      assert.equal(name, 'obsidian');
      return { Setting: SettingHost, requireApiVersion: () => modernSettings, Plugin: PluginHost, PluginSettingTab: SettingTabHost, ItemView: class {}, Modal: class {}, FuzzySuggestModal: class {}, MarkdownView: class {}, Notice: class {} };
    },
    window: { setTimeout, clearTimeout, localStorage: { getItem: (key: string) => oldDevice.get(key) ?? null, removeItem: (key: string) => oldDevice.delete(key) } }
  });
  const Plugin = module.exports.default as typeof EdgePlugin;
  const app = {
    vault: { getName: () => 'Test vault', configDir: '.obsidian' },
    loadLocalStorage: (key: string): unknown => device.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => { if (value === null) device.delete(key); else device.set(key, value); },
    workspace: { getLeavesOfType: () => [], getActiveFile: () => null, getActiveViewOfType: () => null, on: () => ({}) }
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
  return { plugin, tab, device, oldDevice, sockets, emit, saved: () => saved, updates: () => updates };
}
function rows(tab: PluginSettingTab): SettingDefinition[] {
  return tab.getSettingDefinitions().flatMap(item => 'items' in item ? item.items || [] : []).filter((item): item is SettingDefinition => !('type' in item));
}

test('plugin settings expose searchable connection and history controls while preserving pairing', async () => {
  const { plugin, tab, oldDevice, saved } = await loadPlugin();
  const names = rows(tab).map(row => row.name);
  for (const name of ['Pair computer', 'Bridge address', 'Bridge token', 'Connection test', 'Default model', 'Permissions', 'Maximum conversations', 'Maximum history size']) assert.ok(names.includes(name), name);
  assert.equal(plugin.token(), 'existing-pairing-token-for-test');
  assert.equal(oldDevice.size, 0);
  await plugin.saveSettings();
  assert.ok(!JSON.stringify(saved()).includes('existing-pairing-token-for-test'), 'credentials must stay outside synced plugin data');
  assert.ok(!names.includes('Reasoning effort'));
  plugin.effortLevels = ['off', 'low', 'high'];
  assert.ok(rows(tab).some(row => row.name === 'Reasoning effort'));
});

test('declarative connection test updates status and releases its listener when the row closes', async () => {
  const { plugin, tab } = await loadPlugin();
  const row = rows(tab).find(row => row.name === 'Connection test');
  assert.ok(row?.render);
  const status = { text: '', dataset: { state: '' }, setText(value: string) { this.text = value; } };
  let click: (() => void) | undefined;
  let disabled = false;
  const button = {
    setButtonText: () => button,
    onClick: (handler: () => void) => { click = handler; return button; },
    setDisabled: (value: boolean) => { disabled = value; return button; }
  };
  const setting = { descEl: { createDiv: () => status }, addButton: (render: (value: typeof button) => void) => { render(button); } };
  const dispose = row.render(setting as unknown as Setting, {} as SettingGroup);
  assert.equal(status.text, 'Not tested');
  assert.equal(plugin.connectionListeners.size, 1);
  let checks = 0;
  plugin.testConnection = async () => { checks++; };
  click!();
  assert.equal(checks, 1);
  plugin.connectionState = { state: 'testing', message: 'Testing…' };
  for (const refresh of plugin.connectionListeners) refresh();
  assert.equal(disabled, true);
  plugin.connectionState = { state: 'connected', message: 'Connected' };
  for (const refresh of plugin.connectionListeners) refresh();
  assert.equal(disabled, false);
  assert.equal(status.dataset.state, 'connected');
  assert.equal(status.text, 'Connected');
  assert.equal(typeof dispose, 'function');
  if (dispose) dispose();
  assert.equal(plugin.connectionListeners.size, 0);
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
  t.after(() => plugin.onunload());
  tab.display();
  const container = tab.containerEl as unknown as ContainerHost;
  for (const name of ['Pair computer', 'Connection test', 'Default model', 'Permissions', 'Maximum conversations']) {
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
  for (let i = 0; i < 8; i++) { plugin.newConversation(); plugin.sessionFor(plugin.activeConversation()); }
  const active = plugin.settings.active;
  plugin.newConversation();
  assert.equal(plugin.sessions.size, 8); assert.equal(sockets.length, 8);
  assert.equal(plugin.settings.active, active);
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
