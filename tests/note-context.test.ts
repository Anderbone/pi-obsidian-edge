import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import type { Attachment } from '../src/panel';
import { userMessage } from '../src/references';

const code = buildSync({
  entryPoints: ['main.ts'], bundle: true, platform: 'browser', format: 'cjs',
  external: ['obsidian'], write: false, footer: { js: 'module.exports.EdgeView = EdgeView;' }
}).outputFiles[0].text;

function noteHost(text = '') {
  const file = { path: 'folder/Test.md' };
  const conversation: { messages: unknown[]; notePath?: string } = { messages: [] };
  const sent: string[] = [];
  class Host {}
  const module = { exports: {} as { EdgeView: new (leaf: unknown, plugin: unknown) => {
    app: unknown; conversation: unknown; session: unknown;
    attach(kind: 'note' | 'selection' | 'browse'): Promise<Attachment>;
    send(text: string, attachments: Attachment[]): Promise<void>;
  } } };
  runInNewContext(code, {
    module, exports: module.exports,
    require: () => ({ Plugin: Host, ItemView: Host, Modal: Host, FuzzySuggestModal: Host, PluginSettingTab: Host })
  });
  const plugin = { lastFile: file, settings: { autoAttachCurrentNote: true }, lastMarkdown: { editor: { getSelection: () => '' } } };
  const view = new module.exports.EdgeView({}, plugin);
  view.app = { vault: { cachedRead: async () => text } };
  view.conversation = conversation;
  view.session = { conversation, send: (message: string) => { sent.push(message); } };
  return { view, conversation, sent, plugin, file };
}

test('an empty current note is automatically sent with its path and remains a history reference', async () => {
  const { view, conversation, sent, file } = noteHost();
  await view.send('Make this a pretty example', []);
  assert.equal(conversation.notePath, file.path);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Source: folder\/Test.md\n/);
  assert.deepEqual(userMessage(sent[0]), {
    text: 'Make this a pretty example', references: [{ name: file.path, path: file.path }]
  });
});

test('a manually attached empty note is retained alongside populated notes and images', async () => {
  const { view, sent, file } = noteHost();
  const empty = await view.attach('note');
  assert.equal(empty.text, '');
  await view.send('Fill this note using the example', [empty,
    { id: 'example', name: 'Example.md', path: 'Example.md', text: 'Example contents' },
    { id: 'image', name: 'Image.png', data: 'aW1hZ2U=', mimeType: 'image/png' }
  ]);
  assert.deepEqual(userMessage(sent[0]).references, [
    { name: file.path, path: file.path }, { name: 'Example.md', path: 'Example.md' }
  ]);
  assert.match(sent[0], /Source: Example.md\nExample contents/);
  assert.equal(sent[0].match(/Source: folder\/Test.md/g)?.length, 1);
});

test('missing or empty selections still require selecting text', async () => {
  const { view, plugin } = noteHost('Existing note contents');
  await assert.rejects(view.attach('selection'), /Select some text in a note first/);
  Reflect.deleteProperty(plugin, 'lastMarkdown');
  await assert.rejects(view.attach('selection'), /Select some text in a note first/);
});
