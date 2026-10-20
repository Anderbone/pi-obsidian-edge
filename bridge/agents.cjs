// Adapter-owned CLI arguments and event translation. No provider protocol reaches the UI.
function text(message) {
  if (typeof message?.content === 'string') return message.content;
  return (message?.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
}
const pi = {
  id: 'pi', label: 'Pi', capabilities: { models: true, cancel: true, tools: true, newSession: true },
  launch(options) {
    const args = ['--mode', 'rpc', '--tools', options.tools, '--no-extensions', '--no-mcp', '--no-skills', '--no-approve'];
    if (options.sessionId) args.push('--session-id', options.sessionId);
    if (options.model) args.push('--model', options.model);
    return { executable: options.pi || 'pi', args };
  },
  normalize(event) {
    const key = message => `${message?.role}:${message?.timestamp || message?.id || 'current'}`;
    switch (event.type) {
      case 'agent_start': return [{ kind: 'run.started' }];
      case 'agent_settled':
      case 'agent_end': return [{ kind: 'run.finished' }];
      case 'message_start':
        if (event.message?.role === 'user') return [{ kind: 'message', id: key(event.message), role: 'user', text: text(event.message), final: true }];
        return [];
      case 'message_update':
        return event.assistantMessageEvent?.type === 'text_delta'
          ? [{ kind: 'message', id: key(event.message), role: 'assistant', text: text(event.message), final: false }] : [];
      case 'message_end':
        if (event.message?.role !== 'assistant') return [];
        return [{ kind: 'message', id: key(event.message), role: 'assistant', text: text(event.message), final: true },
          ...(event.message.errorMessage ? [{ kind: 'error', message: event.message.errorMessage }] : [])];
      case 'tool_execution_start': return [{ kind: 'tool', id: event.toolCallId, name: event.toolName, phase: 'running' }];
      case 'tool_execution_end': return [{ kind: 'tool', id: event.toolCallId, name: event.toolName, phase: event.isError ? 'failed' : 'completed' }];
      case 'extension_ui_request': return [{ kind: 'error', message: 'This agent requested an unsupported interaction. Complete it on the computer or stop the run.' }];
      case 'response':
        if (event.success === false) return [{ kind: 'error', message: event.error || 'Agent command failed.' }];
        if (event.command === 'get_state') return [{ kind: 'state', busy: !!event.data?.isStreaming,
          effort: event.data?.thinkingLevel || 'off', model: event.data?.model ? `${event.data.model.provider}/${event.data.model.id}` : '' }];
        if (event.command === 'get_available_thinking_levels') return [{ kind: 'effort.levels', levels: event.data?.levels || ['off'] }];
        if (event.command === 'set_thinking_level') return [{ kind: 'state.refresh' }];
        if (event.command === 'set_model' && event.data) { const model = event.data.model || event.data; return [{ kind: 'model', model: `${model.provider}/${model.id}` }, { kind: 'state.refresh' }]; }
        if (event.command === 'get_messages') return [{ kind: 'history', messages: (event.data?.messages || []).filter(message => ['user', 'assistant'].includes(message.role) && text(message)).map(message => ({ id: key(message), role: message.role, text: text(message), final: true })) }];
        if (event.command === 'get_available_models') return [{ kind: 'models', models: (event.data?.models || []).map(model => ({
          id: `${model.provider}/${model.id}`, name: `${model.provider} / ${model.name || model.id}`, provider: model.provider, modelId: model.id })) }];
        if (event.command === 'new_session') return [{ kind: 'session.new' }];
        return [];
      default: return [];
    }
  }
};
const agents = new Map([[pi.id, pi]]);
module.exports = {
  getAgent(id) { const adapter = agents.get(id); if (!adapter) throw new Error('Agent is not enabled on this computer.'); return adapter; },
  listAgents() { return [...agents.values()].map(({ id, label, capabilities }) => ({ id, label, capabilities })); }
};
