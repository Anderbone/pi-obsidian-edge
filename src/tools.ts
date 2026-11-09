import type { AgentEvent, ChatMessage, ToolDetails } from '../shared/protocol';

export function toolMessage(event: Extract<AgentEvent, { kind: 'tool' }>): ChatMessage & { tool: ToolDetails } {
  const tool = { name: event.name || 'Tool', phase: event.phase,
    ...(event.input !== undefined ? { input: event.input } : {}),
    ...(event.output !== undefined ? { output: event.output } : {}) };
  return { id: `tool:${event.id || event.name || 'unknown'}`, role: 'assistant', text: `${tool.name} · ${tool.phase}`, final: event.phase !== 'running', tool };
}

// Older bridges omit tool records in get_messages. Keep locally observed calls
// beside their preceding message, without duplicating calls on replay.
export function mergeToolHistory(previous: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const messages = incoming.map(message => {
    const saved = previous.find(item => item.id === message.id);
    return !message.images?.length && saved?.images?.length ? { ...message, images: saved.images } : message;
  });
  let anchor: string | undefined;
  for (const message of previous) {
    if (message.tool && !messages.some(item => item.id === message.id)) {
      const at = anchor ? messages.findIndex(item => item.id === anchor) : -1;
      messages.splice(at + 1, 0, message);
    }
    anchor = message.id;
  }
  return messages;
}
