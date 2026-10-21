import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HISTORY_LIMITS, historyLimits, positiveInteger, pruneHistory, type Conversation } from '../src/history';

function conversation(id: string, updated: number, text = 'Hello', count = 1): Conversation {
  return { id, title: id, updated, messages: Array.from({ length: count }, (_, index) => ({ id: String(index), role: 'user', text, final: true })) };
}
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

test('old settings receive 500 conversations and 50 MB without losing custom limits', () => {
  assert.deepEqual(historyLimits({}), DEFAULT_HISTORY_LIMITS);
  assert.deepEqual(historyLimits({ historyMaxConversations: 2000, historyMaxMB: 500 }), { historyMaxConversations: 2000, historyMaxMB: 500 });
  assert.deepEqual(historyLimits({ historyMaxConversations: -1, historyMaxMB: NaN }), DEFAULT_HISTORY_LIMITS);
  for (const value of ['', '0', '-1', '1.2', 'Infinity', true, null]) assert.equal(positiveInteger(value), undefined);
});

test('count limit removes oldest conversations while protecting the active conversation', () => {
  const input = Array.from({ length: 600 }, (_, index) => conversation(String(index), index));
  const kept = pruneHistory(input, '0', DEFAULT_HISTORY_LIMITS);
  assert.equal(kept.length, 500);
  assert.equal(kept[0].id, '599');
  assert.equal(kept.at(-1), input[0]);
  assert.ok(!kept.some(item => item.id === '1'));
  assert.equal(input.length, 600);
});

test('larger custom count limits and long conversations have no old 30/150 cap', () => {
  const input = Array.from({ length: 800 }, (_, index) => conversation(String(index), index));
  assert.equal(pruneHistory(input, '', { historyMaxConversations: 1000, historyMaxMB: 50 }).length, 800);
  const long = conversation('long', 0, 'Hello', 1000);
  assert.equal(pruneHistory([long], long.id, DEFAULT_HISTORY_LIMITS)[0].messages.length, 1000);
});

test('size limit measures UTF-8 bytes and removes oldest inactive conversations first', () => {
  const active = conversation('active', 0, '你'.repeat(180000));
  const newest = conversation('new', 2, '你'.repeat(180000));
  const old = conversation('old', 1, '你'.repeat(180000));
  const kept = pruneHistory([active, old, newest], active.id, { historyMaxConversations: 500, historyMaxMB: 1 });
  assert.deepEqual(kept, [active]);
  assert.ok(bytes(kept) <= 1_000_000);
});

test('oversized active conversations keep the newest complete messages within the byte budget', () => {
  const active = conversation('active', 0, '你'.repeat(100000), 6);
  const kept = pruneHistory([active], active.id, { historyMaxConversations: 500, historyMaxMB: 1 });
  assert.deepEqual(kept[0].messages.map(message => message.id), ['3', '4', '5']);
  assert.ok(bytes(kept) <= 1_000_000);
  assert.deepEqual(pruneHistory([], '', DEFAULT_HISTORY_LIMITS), []);
});
