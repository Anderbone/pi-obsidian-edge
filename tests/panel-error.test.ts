import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatPanel } from '../src/panel';

test('repeated busy updates preserve the current phase and reading position', () => {
  const typingText = { textContent: '' };
  const transcript = { scrollTop: 0, scrollHeight: 100 };
  const panel = Object.assign(Object.create(ChatPanel.prototype) as object, {
    busy: false, activity: { dataset: {} }, chatState: { dataset: {} }, state: 'ready', imageImports: 0,
    typing: {}, permissions: {}, empty: {}, typingText, transcript, sendButton: {}, stopButton: { classList: { toggle() {} } }
  }) as unknown as ChatPanel;
  panel.setBusy(true);
  assert.equal(typingText.textContent, 'Thinking…');
  for (const phase of ['Responding…', 'read · started']) {
    typingText.textContent = phase;
    transcript.scrollTop = 20;
    panel.setBusy(true);
    assert.equal(typingText.textContent, phase);
    assert.equal(transcript.scrollTop, 20);
  }
  panel.setBusy(false);
  panel.setBusy(true);
  assert.equal(typingText.textContent, 'Thinking…');
  assert.equal(transcript.scrollTop, 100);
});

test('idle state updates preserve a visible error until a new run begins', () => {
  const activity = { dataset: {} as Record<string, string>, hidden: true, textContent: '' };
  const chatState = { dataset: {}, textContent: '' };
  const panel = Object.assign(Object.create(ChatPanel.prototype) as object, {
    activity, chatState, state: 'ready', imageImports: 0,
    typing: {}, permissions: {}, empty: {}, typingText: {},
    transcript: { scrollTop: 0, scrollHeight: 10 }, sendButton: {}, stopButton: { classList: { toggle() {} } },
    status: { dataset: {} }
  }) as unknown as ChatPanel;
  panel.error('OAuth refresh failed');
  panel.setBusy(false);
  panel.statusChanged('ready', 'Connected');
  assert.equal(activity.hidden, false);
  assert.equal(activity.textContent, 'OAuth refresh failed');
  assert.equal(chatState.textContent, 'Error');
  panel.setBusy(true);
  assert.equal(activity.hidden, true);
  assert.equal(activity.dataset.error, undefined);
  assert.equal(chatState.textContent, 'Running');
});
