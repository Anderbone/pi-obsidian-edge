import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import type { App, PluginManifest, PluginSettingTab, Setting, SettingDefinition, SettingGroup } from 'obsidian';
import type EdgePlugin from '../main';

// Only the host's chainable setting controls are faked; both UI paths execute
// the plugin's real row renderers and listener lifecycle.
class ControlHost {
  inputEl = { type: '', min: '', step: '', setAttribute: (_name: string, _value: string) => {} };
  setValue(_value: string): this { return this; }
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
  addDropdown(render: (control: ControlHost) => void): this { render(new ControlHost()); return this; }
}

// Load the real plugin against a small Obsidian host, without Electron or Pi.
const code = buildSync({ entryPoints: ['main.ts'], bundle: true, platform: 'browser', format: 'cjs', external: ['obsidian'], write: false }).outputFiles[0].text;
async function loadPlugin(modernSettings = true) {
  let updates = 0;
  let tab: PluginSettingTab | undefined;
  let saved: unknown;
  const device = new Map<string, unknown>();
  const oldDevice = new Map([['pi-edge:Test vault:.obsidian:token', 'existing-pairing-token']]);
  class PluginHost {
    constructor(public app: App, public manifest: PluginManifest) {}
    register(): void {}
    registerView(): void {}
    registerEvent(): void {}
    registerObsidianProtocolHandler(): void {}
    addRibbonIcon(): void {}
    addCommand(): void {}
    addSettingTab(value: PluginSettingTab): void { tab = value; }
    async loadData(): Promise<unknown> { return { url: 'ws://127.0.0.1:8771' }; }
    async saveData(data: unknown): Promise<void> { saved = structuredClone(data); }
  }
  class SettingTabHost {
    containerEl = new ContainerHost();
    constructor(public app: App, public plugin: PluginHost) {}
    update(): void { updates++; }
  }
  const module: { exports: { default?: unknown } } = { exports: {} };
  runInNewContext(code, {
    module, exports: module.exports, TextEncoder,
    require: (name: string) => {
      assert.equal(name, 'obsidian');
      return { Setting: SettingHost, requireApiVersion: () => modernSettings, Plugin: PluginHost, PluginSettingTab: SettingTabHost, ItemView: class {}, Modal: class {}, FuzzySuggestModal: class {}, MarkdownView: class {} };
    },
    window: { localStorage: { getItem: (key: string) => oldDevice.get(key) ?? null, removeItem: (key: string) => oldDevice.delete(key) } }
  });
  const Plugin = module.exports.default as typeof EdgePlugin;
  const app = {
    vault: { getName: () => 'Test vault', configDir: '.obsidian' },
    loadLocalStorage: (key: string): unknown => device.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => { if (value === null) device.delete(key); else device.set(key, value); },
    workspace: { getActiveFile: () => null, getActiveViewOfType: () => null, on: () => ({}) }
  } as unknown as App;
  const plugin = new Plugin(app, { id: 'pi-edge' } as PluginManifest);
  await plugin.onload();
  assert.ok(tab);
  return { plugin, tab, device, oldDevice, saved: () => saved, updates: () => updates };
}
function rows(tab: PluginSettingTab): SettingDefinition[] {
  return tab.getSettingDefinitions().flatMap(item => 'items' in item ? item.items || [] : []).filter((item): item is SettingDefinition => !('type' in item));
}

test('plugin settings expose searchable connection and history controls while preserving pairing', async () => {
  const { plugin, tab, oldDevice, saved } = await loadPlugin();
  const names = rows(tab).map(row => row.name);
  for (const name of ['Pair computer', 'Bridge address', 'Bridge token', 'Connection test', 'Default model', 'Permissions', 'Maximum conversations', 'Maximum history size']) assert.ok(names.includes(name), name);
  assert.equal(plugin.token(), 'existing-pairing-token');
  assert.equal(oldDevice.size, 0);
  await plugin.saveSettings();
  assert.ok(!JSON.stringify(saved()).includes('existing-pairing-token'), 'credentials must stay outside synced plugin data');
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


test('model catalog changes refresh modern settings and leave hidden legacy tabs alone', async () => {
  const modern = await loadPlugin();
  modern.plugin.updateCatalog({ kind: 'effort.levels', levels: ['off', 'high'] });
  assert.equal(modern.updates(), 1);
  assert.ok(rows(modern.tab).some(row => row.name === 'Reasoning effort'));
  const legacy = await loadPlugin(false);
  legacy.plugin.updateCatalog({ kind: 'effort.levels', levels: ['off', 'high'] });
  assert.equal(legacy.updates(), 0);
  assert.equal(legacy.plugin.connectionListeners.size, 0);
});


test('older Obsidian renders the shared settings and cleans up on refresh and close', async () => {
  const { plugin, tab } = await loadPlugin(false);
  tab.display();
  const container = tab.containerEl as unknown as ContainerHost;
  for (const name of ['Pair computer', 'Connection test', 'Default model', 'Permissions', 'Maximum conversations']) {
    assert.ok(container.rows.some(row => row.name === name), name);
  }
  assert.equal(plugin.connectionListeners.size, 1);
  plugin.updateCatalog({ kind: 'effort.levels', levels: ['off', 'high'] });
  assert.ok(container.rows.some(row => row.name === 'Reasoning effort'));
  assert.equal(plugin.connectionListeners.size, 1, 'refresh must dispose the previous connection row');
  tab.hide();
  assert.equal(plugin.connectionListeners.size, 0);
  plugin.updateCatalog({ kind: 'effort.levels', levels: ['off'] });
  assert.equal(plugin.connectionListeners.size, 0, 'hidden legacy settings must not mount new listeners');
});
