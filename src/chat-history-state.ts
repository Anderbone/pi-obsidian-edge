import type { Conversation } from './history';
import type { ConversationSession } from './sessions';

type LiveState = Pick<ConversationSession, 'busy' | 'error' | 'status' | 'hasKnownState'>;
export function chatHistoryState(conversation: Conversation, session?: LiveState): {
  tone: 'running' | 'complete' | 'attention' | 'inactive'; label: string;
} {
  if (session?.error || conversation.outbox?.some(message => message.delivery === 'failed' || message.delivery === 'unconfirmed')) {
    return { tone: 'attention', label: 'Needs attention' };
  }
  if (!session) return { tone: 'inactive', label: 'Closed · saved history' };
  if (session.status !== 'ready' || !session.hasKnownState) {
    return { tone: session.busy || session.status === 'error' ? 'attention' : 'inactive',
      label: session.busy ? 'Connection lost · run status unknown' : session.status === 'ready' ? 'Checking session' : 'Disconnected · run status unknown' };
  }
  if (session.busy) return { tone: 'running', label: 'Running' };
  const lastReply = conversation.messages.filter(message => !message.tool && (message.role === 'user' || message.role === 'assistant')).at(-1);
  if (lastReply?.role === 'assistant' && lastReply.final && !conversation.outbox?.length) return { tone: 'complete', label: 'Completed · session retained' };
  return { tone: 'inactive', label: 'Idle · session retained' };
}
