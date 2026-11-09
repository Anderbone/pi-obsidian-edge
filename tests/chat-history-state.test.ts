import test from 'node:test';
import assert from 'node:assert/strict';
import { chatHistoryState } from '../src/chat-history-state';
import type { Conversation } from '../src/history';
const conversation: Conversation = { id: 'chat', title: 'Chat', updated: 1, messages: [
  { id: 'reply', role: 'assistant', text: 'Done', final: true }
] };
const ready = { busy: false, error: '', status: 'ready' as const, hasKnownState: true };
test('running, completed and archived sessions have distinct feedback', () => {
  assert.equal(chatHistoryState(conversation, { ...ready, busy: true }).tone, 'running');
  assert.equal(chatHistoryState(conversation, ready).tone, 'complete');
  assert.equal(chatHistoryState(conversation).tone, 'inactive');
});
test('errors and connection loss cannot be shown as successful completion', () => {
  assert.equal(chatHistoryState(conversation, { ...ready, error: 'Failed' }).tone, 'attention');
  assert.equal(chatHistoryState(conversation, { ...ready, busy: true, status: 'reconnecting', hasKnownState: false }).tone, 'attention');
  assert.equal(chatHistoryState(conversation, { ...ready, hasKnownState: false }).tone, 'inactive');
  assert.equal(chatHistoryState({ ...conversation, outbox: [{ id: 'pending', role: 'user', text: 'Help', final: true, delivery: 'unconfirmed' }] }, ready).tone, 'attention');
});
