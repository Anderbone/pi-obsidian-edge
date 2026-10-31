import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';

const code = buildSync({ entryPoints: ['main.ts'], bundle: true, platform: 'browser', format: 'cjs', external: ['obsidian'], write: false }).outputFiles[0].text;

test('note title copies a vault-root path directly without a device prefix or selection menu', async () => {
  const copied: string[] = [];
  const notices: string[] = [];
  class Host {}
  const module = { exports: {} as { default: new () => { app: unknown; copyNotePath(path: string): Promise<void> } } };
  runInNewContext(code, {
    module, exports: module.exports,
    navigator: { clipboard: { writeText: async (text: string) => { copied.push(text); } } },
    require: () => ({ Plugin: Host, ItemView: Host, Modal: Host, FuzzySuggestModal: Host, PluginSettingTab: Host,
      Notice: class { constructor(text: string) { notices.push(text); } } })
  });
  const plugin = new module.exports.default();
  plugin.app = { vault: { adapter: { getFullPath: () => { throw new Error('Device paths must not be used'); } } } };
  const path = 'plannow/2026-09-08-ai-website-requests-cloud-queue-and-local-codex-runner.md';
  const paths = [path, '/plannow/中文 plan #1.md', 'Inbox.md'];
  const expected = ['/' + path, '/plannow/中文 plan #1.md', '/Inbox.md'];
  for (const path of paths) await plugin.copyNotePath(path);
  assert.deepEqual(copied, expected);
  assert.deepEqual(notices, expected.map(() => '已复制仓库内路径'));
});
