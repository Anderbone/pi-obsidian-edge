import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import type { App } from 'obsidian';
import type { UpgradeModal } from '../src/upgrade';

class ElementHost {
  text = '';
  children: ElementHost[] = [];
  setText(text: string): void { this.text = text; }
  createEl(_tag: string, options?: { text?: string }): ElementHost {
    const child = new ElementHost(); child.text = options?.text ?? ''; this.children.push(child); return child;
  }
  empty(): void { this.children = []; }
}

function loadUpgrade() {
  const device = new Map<string, unknown>();
  const buttons = new Map<string, () => void>();
  let closed = false;
  const app = {
    loadLocalStorage: (key: string) => device.get(key),
    saveLocalStorage: (key: string, value: unknown) => device.set(key, value)
  } as unknown as App;
  class ModalHost {
    contentEl = new ElementHost(); titleEl = new ElementHost();
    constructor(public app: App) {}
    close(): void { closed = true; }
  }
  class SettingHost {
    addButton(render: (control: { setButtonText: (text: string) => unknown }) => void): void {
      let label = '';
      const control = {
        setButtonText(text: string) { label = text; return control; },
        setCta() { return control; },
        onClick(handler: () => void) { buttons.set(label, handler); return control; }
      };
      render(control);
    }
  }
  const code = buildSync({ entryPoints: ['src/upgrade.ts'], bundle: true, platform: 'browser', format: 'cjs', external: ['obsidian'], write: false }).outputFiles[0].text;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, require: () => ({ Modal: ModalHost, Setting: SettingHost, Notice: class {} }) });
  const exports = module.exports as { needsUpgradeNotice: (app: App) => boolean; UpgradeModal: typeof UpgradeModal; BRIDGE_VERSION: string; BRIDGE_COMMAND: string };
  return { app, device, buttons, exports, closed: () => closed };
}

test('upgrade acknowledgement stays on this device and closing alone does not acknowledge it', () => {
  const host = loadUpgrade();
  assert.equal(host.exports.needsUpgradeNotice(host.app), true);
  const modal = new host.exports.UpgradeModal(host.app);
  modal.onOpen();
  assert.equal(host.exports.needsUpgradeNotice(host.app), true);
  modal.onClose();
  assert.equal(host.exports.needsUpgradeNotice(host.app), true);
  modal.onOpen();
  host.buttons.get('I’ve read these steps')!();
  assert.equal(host.closed(), true);
  assert.equal(host.exports.needsUpgradeNotice(host.app), false);
  const otherDevice = loadUpgrade();
  assert.equal(otherDevice.exports.needsUpgradeNotice(otherDevice.app), true);
  // A later checklist is independent of this acknowledgement.
  host.device.clear();
  host.device.set('pi-edge:upgrade:0.3.1', true);
  assert.equal(host.exports.needsUpgradeNotice(host.app), true);
});

test('copyable bridge command matches the published plugin version', () => {
  const { exports } = loadUpgrade();
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8')) as { version: string };
  assert.equal(exports.BRIDGE_VERSION, manifest.version);
  assert.ok(exports.BRIDGE_COMMAND.includes(`/bridge-${manifest.version}/pi-edge-bridge.tgz`));
  assert.ok(exports.BRIDGE_COMMAND.endsWith('--cwd "/path/to/your/vault"'));
});
