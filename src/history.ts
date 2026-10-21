import type { ChatMessage } from './panel';

export interface Conversation { id: string; title: string; messages: ChatMessage[]; updated: number; }
export interface HistoryLimits { historyMaxConversations: number; historyMaxMB: number; }
export const DEFAULT_HISTORY_LIMITS: HistoryLimits = { historyMaxConversations: 500, historyMaxMB: 50 };

export function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return;
  const number = Number(value);
  if (Number.isSafeInteger(number) && number > 0 && number <= Number.MAX_SAFE_INTEGER / 1_000_000) return number;
}

export function historyLimits(value: Partial<HistoryLimits>): HistoryLimits {
  return {
    historyMaxConversations: positiveInteger(value.historyMaxConversations) ?? DEFAULT_HISTORY_LIMITS.historyMaxConversations,
    historyMaxMB: positiveInteger(value.historyMaxMB) ?? DEFAULT_HISTORY_LIMITS.historyMaxMB
  };
}

export function pruneHistory(conversations: Conversation[], active: string, limits: HistoryLimits): Conversation[] {
  const sorted = [...conversations].sort((a, b) => b.updated - a.updated);
  const kept = sorted.slice(0, limits.historyMaxConversations);
  const current = sorted.find(conversation => conversation.id === active);
  if (current && !kept.includes(current)) kept[kept.length - 1] = current;
  const encoder = new TextEncoder();
  const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
  const sizes = new Map(kept.map(conversation => [conversation, bytes(conversation)]));
  let total = 2 + Math.max(0, kept.length - 1) + [...sizes.values()].reduce((sum, size) => sum + size, 0);
  const maximum = limits.historyMaxMB * 1_000_000;
  while (total > maximum && kept.length > 1) {
    const index = kept[kept.length - 1].id === active ? kept.length - 2 : kept.length - 1;
    total -= sizes.get(kept[index])! + 1;
    kept.splice(index, 1);
  }
  if (total > maximum && kept.length) {
    const conversation = kept[0];
    let used = 2 + bytes({ ...conversation, messages: [] });
    let start = conversation.messages.length;
    while (start > 0) {
      const size = bytes(conversation.messages[start - 1]) + (start < conversation.messages.length ? 1 : 0);
      if (used + size > maximum) break;
      used += size; start--;
    }
    conversation.messages = conversation.messages.slice(start);
  }
  return kept;
}
