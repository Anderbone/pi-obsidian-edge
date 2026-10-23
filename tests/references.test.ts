import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteCandidates, userMessage } from '../src/references';

test('opens the original path before considering same-name notes', () => {
  const files = [{ path: 'projects/demo/plan/X.md' }, { path: 'projects/demo/ai-done/X.md' }];
  assert.deepEqual(noteCandidates(files[0].path, files), [files[0]]);
});
test('finds moved notes only in the original project, including ambiguous matches', () => {
  const moved = { path: 'projects/demo/ai-done/plan/X.md' };
  const duplicate = { path: 'projects/demo/In-progress/plan/X.md' };
  const foreign = { path: 'projects/other/plan/X.md' };
  const prefix = { path: 'projects/demo-copy/plan/X.md' };
  const path = 'projects/demo/plan/X.md';
  assert.deepEqual(noteCandidates(path, [foreign, moved, prefix]), [moved]);
  assert.deepEqual(noteCandidates(path, [foreign, moved, duplicate]), [moved, duplicate]);
  assert.deepEqual(noteCandidates(path, [foreign, prefix]), []);
});
test('other folder layouts remain scoped and renamed notes do not match', () => {
  const files = [{ path: 'Work/done/X.md' }, { path: 'Personal/X.md' }, { path: 'Work/plan/Y.md' }];
  assert.deepEqual(noteCandidates('Work/plan/X.md', files), [files[0]]);
  assert.deepEqual(noteCandidates('Work/plan/Z.md', files), []);
});

test('reference manifest preserves exact paths across saved and replayed messages', () => {
  const references = [{ name: '项目/笔记.md (selection)', path: '项目/笔记.md' }];
  const text = '看看这个\n\n<note-context>\nReferences: ' + JSON.stringify(references) + '\nSource: 项目/笔记.md (selection)\nSource: misleading note content\n</note-context>';
  assert.deepEqual(userMessage(JSON.parse(JSON.stringify(text))), { text: '看看这个', references });
});
test('legacy chats recover note links and selection paths', () => {
  assert.deepEqual(userMessage('Question\n\n<note-context>\nSource: folder/note.md (selection)\nExcerpt\n</note-context>'), {
    text: 'Question', references: [{ name: 'folder/note.md (selection)', path: 'folder/note.md' }]
  });
  assert.deepEqual(userMessage('Plain message'), { text: 'Plain message', references: [] });
});
test('malformed reference manifests fall back to source names without trusting unknown fields', () => {
  const text = 'Question\n\n<note-context>\nReferences: [null,{"name":"bad","path":42}]\nSource: folder/note.md\nExcerpt\n</note-context>';
  assert.deepEqual(userMessage(text), { text: 'Question', references: [{ name: 'folder/note.md', path: 'folder/note.md' }] });
});
