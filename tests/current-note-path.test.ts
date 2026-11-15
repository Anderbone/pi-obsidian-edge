import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';

const code = buildSync({
  entryPoints: ['main.ts'], bundle: true, platform: 'browser', format: 'cjs',
  external: ['obsidian', './src/panel'], write: false,
  footer: { js: 'module.exports.EdgeView = EdgeView;' }
}).outputFiles[0].text;

test('current note remains the header path when viewing and updating another note’s chat', () => {
  const conversation = { title: 'Old task', notePath: 'projects/demo/Old.md', messages: [{ role: 'user', text: 'Previous task' }] };
  const listeners = new Set<() => void>();
  const session = {
    conversation, listeners, draft: {}, models: [], effortLevels: [], permissionModes: [], busy: false
  };
  let headerPath: string | undefined;
  const panel = {
    setConversation: (_title: string, path?: string) => { headerPath = path; },
    setAutoAttachment() {}, setToolDetails() {}, restore() {}, setResumeHint() {},
    restoreDraft() {}, setOutbox() {}, statusChanged() {}, setModels() {},
    setEffortLevels() {}, setEffort() {}, setBusy() {}, setActiveCount() {},
    getDraft: () => ({}), dispose() {}
  };
  class Host {}
  const module = { exports: {} as { EdgeView: new (leaf: unknown, plugin: unknown) => { render(): void } } };
  runInNewContext(code, {
    module, exports: module.exports,
    require: (name: string) => {
      if (name === './src/panel') return { ChatPanel: class { constructor() { return panel; } } };
      assert.equal(name, 'obsidian');
      return { Plugin: Host, ItemView: Host, Modal: Host, FuzzySuggestModal: Host, PluginSettingTab: Host };
    }
  });
  const plugin: { lastFile?: { path: string } } & Record<string, unknown> = {
    lastFile: { path: 'Test.md' }, settings: { autoAttachCurrentNote: true },
    activeConversation: () => conversation, pairing: () => ({}), previousNoteConversation() {},
    restoreSessions() {}, sessionFor: () => session, syncCatalog() {},
    sessionListeners: new Set(), sessions: new Map([['old', session]])
  };
  const view = new module.exports.EdgeView({}, plugin);
  view.render();
  assert.equal(headerPath, 'Test.md');
  for (const update of listeners) update();
  assert.equal(headerPath, 'Test.md', 'session updates must not restore the historical note path');

  plugin.lastFile = { path: 'notes/Next.md' };
  view.render();
  assert.equal(headerPath, 'notes/Next.md');
  plugin.lastFile.path = 'notes/Renamed.md';
  view.render();
  assert.equal(headerPath, 'notes/Renamed.md');
  plugin.lastFile = undefined;
  view.render();
  assert.equal(headerPath, undefined, 'no current note must not fall back to the historical path');
  assert.equal(conversation.notePath, 'projects/demo/Old.md', 'displaying the current note must preserve history binding');
});
