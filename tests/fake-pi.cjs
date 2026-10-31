let input = '';
let busy = false, pending;
const messages = [];
const queued = [];
const response = (command, disposition) => emit({ type: 'response', id: command.id, command: command.type, success: true, data: { disposition } });
const userMessage = command => {
  const user = { role: 'user', content: [{ type: 'text', text: command.message }, ...(command.images || []).map(image => ({ ...image, type: 'image' }))], timestamp: ++timestamp };
  messages.push(user); emit({ type: 'message_start', message: user });
};
let timestamp = Date.now();
process.stdin.setEncoding('utf8');
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
process.stdin.on('data', chunk => {
  input += chunk; let newline;
  while ((newline = input.indexOf('\n')) >= 0) {
    const command = JSON.parse(input.slice(0, newline)); input = input.slice(newline + 1);
    if (command.type === 'get_state') emit({ type: 'response', command: 'get_state', success: true, data: { model: { provider: 'test', id: 'model' }, isStreaming: busy } });
    else if (command.type === 'get_messages') emit({ type: 'response', command: 'get_messages', success: true, data: { messages } });
    else if (command.type === 'clear_queue') { const steering = queued.splice(0).map(item => item.message); emit({ type: 'response', command: 'clear_queue', success: true, data: { steering, followUp: [] } }); }
    else if (command.type === 'abort') { clearTimeout(pending); busy = false; queued.length = 0; emit({ type: 'agent_end' }); emit({ type: 'agent_settled', aborted: true }); }
    else if (command.type === 'get_available_models') emit({ type: 'response', command: command.type, success: true, data: { models: [{ provider: 'test', id: 'model' }] } });
    else if (command.type === 'get_available_thinking_levels') emit({ type: 'response', command: command.type, success: true, data: { levels: ['off'] } });
    else if (command.type === 'prompt') {
      if (busy) {
        if (command.streamingBehavior !== 'steer') { emit({ type: 'response', id: command.id, command: 'prompt', success: false, error: 'Streaming behavior required' }); continue; }
        queued.push(command); response(command, 'queued'); continue;
      }
      busy = true;
      emit({ type: 'agent_start' });
      response(command, 'started'); userMessage(command);
      if (command.message === 'hold') continue;
      const finish = () => {
        const assistant = { role: 'assistant', content: [{ type: 'text', text: command.images ? 'Received image' : 'OK\u2028still one event' }], timestamp: ++timestamp };
        messages.push(assistant); emit({ type: 'message_end', message: assistant });
        emit({ type: 'agent_end' });
        if (queued.length) {
          emit({ type: 'agent_start' });
          for (const steering of queued.splice(0)) userMessage(steering);
          const adjusted = { role: 'assistant', content: [{ type: 'text', text: 'Adjusted task' }], timestamp: ++timestamp };
          messages.push(adjusted); emit({ type: 'message_end', message: adjusted });
          emit({ type: 'agent_end' });
        }
        busy = false; emit({ type: 'agent_settled', aborted: false });
      };
      if (command.message === 'delayed') pending = setTimeout(finish, 250);
      else finish();
    }
  }
});
