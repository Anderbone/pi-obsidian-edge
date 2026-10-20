let input = '';
process.stdin.setEncoding('utf8');
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
process.stdin.on('data', chunk => {
  input += chunk; let newline;
  while ((newline = input.indexOf('\n')) >= 0) {
    const command = JSON.parse(input.slice(0, newline)); input = input.slice(newline + 1);
    if (command.type === 'get_state') emit({ type: 'response', command: 'get_state', success: true, data: { model: { provider: 'test', id: 'model' }, isStreaming: false } });
    else if (command.type === 'get_messages') emit({ type: 'response', command: 'get_messages', success: true, data: { messages: [] } });
    else if (command.type === 'abort') emit({ type: 'agent_end' });
    else if (command.type === 'prompt') {
      emit({ type: 'agent_start' });
      if (command.message === 'hold') continue;
      emit({ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: command.message }], timestamp: Date.now() } });
      emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: command.images ? 'Received image' : 'OK\u2028still one event' }], timestamp: Date.now() } });
      emit({ type: 'agent_end' });
    }
  }
});
