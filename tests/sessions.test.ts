import './browser-timers';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConversationSession } from '../src/sessions';
import type { Conversation } from '../src/history';
import type { SocketLike } from '../src/client';
import type { AgentEvent, ClientPacket, ReadyPacket } from '../shared/protocol';

class Socket implements SocketLike {
  readyState = 0; sent: ClientPacket[] = []; closes = 0;
  onopen: SocketLike['onopen'] = null; onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null; onerror: SocketLike['onerror'] = null;
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.closes++; this.readyState = 3; this.onclose?.({ code: 1000 }); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
function setup(id: string, saved: Partial<Conversation> = {}) {
  const sockets: Socket[] = [];
  let saves = 0, sequence = 0;
  const conversation: Conversation = { id, title: id, updated: 0, messages: [], ...saved };
  const session = new ConversationSession(conversation, {
    pairing: { url: 'ws://127.0.0.1:8771', token: 'test-token-for-multiple-chats' },
    permissions: 'full', model: 'default/model', effort: 'medium', changed: () => { saves++; }, status() {},
    createSocket: () => { const socket = new Socket(); sockets.push(socket); return socket; }
  });
  session.connect(); const socket = sockets[0];
  socket.readyState = 1; socket.onopen?.();
  const ready: ReadyPacket = { type: 'edge.ready', protocol: 1, sessionId: id, agent: 'pi', agents: [], tools: 'read', permissions: 'read',
    permissionModes: [{ id: 'read', label: 'Read only' }], cwdLabel: 'test', sessionControl: true, steering: true };
  socket.message(ready);
  const event = (event: AgentEvent) => socket.message({ type: 'edge.event', sessionId: id, seq: ++sequence, event });
  return { session, conversation, socket, sockets, event, saves: () => saves };
}

test('background chats retain independent context, streaming results, settings and drafts after view listeners detach', t => {
  const a = setup('chat-a'), b = setup('chat-b');
  t.after(() => { a.session.dispose(); b.session.dispose(); });
  const view = () => {};
  a.session.listeners.add(view);
  a.session.draft = { text: 'A follow-up', attachments: [{ id: 'note-a', name: 'A.md', text: 'Context A' }] };
  b.session.draft = { text: 'B follow-up', attachments: [] };
  a.session.send('Work on A', []); b.session.send('Work on B', []);
  a.session.listeners.delete(view);
  a.event({ kind: 'message', id: 'same-user-id', role: 'user', text: (a.socket.sent.find(command => command.type === 'prompt') as Extract<ClientPacket, { type: 'prompt' }>).message, final: true });
  b.event({ kind: 'message', id: 'same-user-id', role: 'user', text: (b.socket.sent.find(command => command.type === 'prompt') as Extract<ClientPacket, { type: 'prompt' }>).message, final: true });
  a.event({ kind: 'message', id: 'same-reply-id', role: 'assistant', text: 'partial', final: false });
  assert.equal(a.conversation.messages.at(-1)?.text, 'partial');
  a.event({ kind: 'message', id: 'same-reply-id', role: 'assistant', text: 'Finished A', final: true });
  a.event({ kind: 'run.finished' });
  b.event({ kind: 'model', model: 'b/model' });
  assert.equal(a.session.busy, false); assert.equal(b.session.busy, true);
  assert.deepEqual(a.conversation.messages.filter(message => !message.delivery).map(message => message.text), [(a.socket.sent.find(command => command.type === 'prompt') as Extract<ClientPacket, { type: 'prompt' }>).message, 'Finished A']);
  assert.deepEqual(b.conversation.messages.filter(message => !message.delivery).map(message => message.text), [(b.socket.sent.find(command => command.type === 'prompt') as Extract<ClientPacket, { type: 'prompt' }>).message]);
  assert.notEqual(a.session.model, b.session.model);
  assert.equal(a.session.draft.attachments[0].name, 'A.md'); assert.equal(b.session.draft.text, 'B follow-up');
  assert.ok(a.saves() >= 4); assert.equal(a.socket.closes, 0); assert.equal(b.socket.closes, 0);
  a.session.stop();
  assert.equal(a.socket.sent.at(-1)?.type, 'abort');
  assert.equal(b.socket.sent.at(-1)?.type, 'prompt');
});

test('reopening a saved chat leaves its Pi model and effort intact, including while replaying a busy run', t => {
  const chat = setup('saved-chat', { model: 'saved/model', effort: 'high', bridgeSessionId: 'saved-chat' }); t.after(() => chat.session.dispose());
  chat.event({ kind: 'state', busy: false, model: 'saved/model', effort: 'high', reasoning: true });
  chat.event({ kind: 'run.started' });
  chat.event({ kind: 'state', busy: true, model: 'saved/model', effort: 'high', reasoning: true });
  assert.equal(chat.session.busy, true);
  assert.equal(chat.session.model, 'saved/model'); assert.equal(chat.session.effort, 'high');
  assert.ok(!chat.socket.sent.some(command => command.type === 'set_model' || command.type === 'set_thinking_level'));
  chat.event({ kind: 'error', message: 'Settings rejected' });
  assert.equal(chat.session.busy, true);
  assert.equal(chat.socket.sent.at(-1)?.type, 'get_state');
  chat.event({ kind: 'error', message: 'State unavailable' });
  assert.equal(chat.socket.sent.filter(command => command.type === 'get_state').length, 1, 'failed state queries must not loop');
});

test('a fresh Pi process restores the chat preferences instead of another chat’s defaults', t => {
  const chat = setup('saved-chat', { model: 'saved/model', effort: 'high', bridgeSessionId: 'previous-process' });
  t.after(() => chat.session.dispose());
  chat.event({ kind: 'state', busy: false, model: 'host/default', effort: 'off', reasoning: true });
  const model = chat.socket.sent.find(command => command.type === 'set_model');
  assert.ok(model?.type === 'set_model'); assert.equal(model.provider, 'saved'); assert.equal(model.modelId, 'model');
  const effort = chat.socket.sent.find(command => command.type === 'set_thinking_level');
  assert.ok(effort?.type === 'set_thinking_level'); assert.equal(effort.level, 'high');
});

test('ending one chat releases its supported bridge session without disconnecting another chat', t => {
  const a = setup('end-chat-a'), b = setup('keep-chat-b'); t.after(() => b.session.dispose());
  a.session.dispose(true);
  assert.equal(a.socket.sent.at(-1)?.type, 'edge.session.close');
  assert.equal(a.socket.closes, 1); assert.equal(b.socket.closes, 0);
});

test('tool calls retain inputs, final status and position through background execution and older bridge history', t => {
  const chat = setup('tool-chat'); t.after(() => chat.session.dispose());
  chat.session.send('Update the plan', []);
  const prompt = chat.socket.sent.at(-1);
  assert.ok(prompt?.type === 'prompt');
  assert.match(prompt.message, /list the files actually created/);
  chat.event({ kind: 'message', id: 'u', role: 'user', text: prompt.message, final: true });
  chat.event({ kind: 'tool', id: 'call-1', name: 'edit', input: '{"path":"计划.md"}', phase: 'running' });
  chat.event({ kind: 'tool', id: 'call-1', name: 'edit', output: 'Updated', phase: 'completed' });
  chat.event({ kind: 'message', id: 'a', role: 'assistant', text: 'Updated 计划.md', final: true });
  const history = chat.conversation.messages.filter(message => !message.tool);
  chat.event({ kind: 'history', messages: history });
  chat.event({ kind: 'history', messages: history });
  assert.deepEqual(chat.conversation.messages.map(message => message.id), ['u', 'tool:call-1', 'a']);
  assert.deepEqual(chat.conversation.messages[1].tool, { name: 'edit', phase: 'completed', input: '{"path":"计划.md"}', output: 'Updated' });
});

test('steering remains visible while queued, survives history refresh, and becomes one delivered message', t => {
  const chat = setup('steering'); t.after(() => chat.session.dispose());
  chat.event({ kind: 'run.started' });
  chat.session.send('Change the scope', [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }]);
  const command = chat.socket.sent.at(-1);
  assert.ok(command?.type === 'prompt'); assert.equal(command.streamingBehavior, 'steer');
  assert.equal(command.images?.length, 1);
  assert.deepEqual(chat.conversation.outbox?.at(-1)?.images, command.images);
  assert.equal(chat.conversation.outbox?.at(-1)?.delivery, 'sending');
  chat.event({ kind: 'prompt.status', requestId: command.id, disposition: 'queued' });
  assert.equal(chat.conversation.outbox?.at(-1)?.delivery, 'queued');
  chat.event({ kind: 'history', messages: [] });
  assert.equal(chat.conversation.outbox?.at(-1)?.delivery, 'queued');
  assert.equal(chat.session.busy, true);
  chat.event({ kind: 'message', id: 'delivered', role: 'user', text: command.message, final: true });
  assert.equal(chat.conversation.messages.length, 1);
  assert.equal(chat.conversation.messages[0].delivery, undefined);
  assert.deepEqual(chat.conversation.messages[0].images, command.images, 'older bridge echoes must retain the local image');
  chat.event({ kind: 'history', messages: [{ id: 'delivered', role: 'user', text: command.message, final: true }] });
  assert.deepEqual(chat.conversation.messages[0].images, command.images, 'older bridge history must retain the local image');
  chat.event({ kind: 'run.finished' }); assert.equal(chat.session.busy, false);
  const query = chat.socket.sent.at(-1); assert.ok(query?.type === 'get_messages');
  chat.event({ kind: 'history', requestId: query.id, messages: [{ id: 'delivered', role: 'user', text: command.message, final: true, images: command.images }, { id: 'reply', role: 'assistant', text: 'Done', final: true }] });
  assert.equal(chat.conversation.outbox?.length, 0);
});

test('history can deliver an image-only message and reconcile images before the live echo', t => {
  const chat = setup('image-history'); t.after(() => chat.session.dispose());
  const images = [{ type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png' }];
  chat.session.send('Look at this', images);
  const command = chat.socket.sent.at(-1); assert.ok(command?.type === 'prompt');
  chat.event({ kind: 'history', messages: [{ id: 'delivered', role: 'user', text: command.message, final: true }] });
  assert.equal(chat.conversation.messages.length, 1);
  assert.deepEqual(chat.conversation.messages[0].images, images);
  chat.event({ kind: 'message', id: 'image-only', role: 'user', text: '', final: true, images });
  assert.deepEqual(chat.conversation.messages.at(-1)?.images, images);
  const saved = JSON.parse(JSON.stringify(chat.conversation)) as Conversation;
  const restored = setup('image-restored', saved); t.after(() => restored.session.dispose());
  assert.deepEqual(restored.conversation.messages.map(message => message.images), [images, images]);
});

test('failed or cancelled steering stays recoverable without marking other running work idle', t => {
  const chat = setup('failed-steering'); t.after(() => chat.session.dispose());
  chat.event({ kind: 'run.started' }); chat.session.send('Adjust this', []);
  const command = chat.socket.sent.at(-1); assert.ok(command?.type === 'prompt');
  chat.event({ kind: 'prompt.status', requestId: command.id, disposition: 'failed', error: 'Rejected' });
  assert.equal(chat.conversation.outbox?.at(-1)?.delivery, 'failed');
  assert.equal(chat.session.error, 'Rejected'); assert.equal(chat.session.busy, true);
  chat.session.send('Another adjustment', []);
  const second = chat.socket.sent.at(-1); assert.ok(second?.type === 'prompt');
  chat.event({ kind: 'prompt.status', requestId: second.id, disposition: 'queued' });
  chat.session.stop();
  assert.deepEqual(chat.socket.sent.slice(-2).map(command => command.type), ['clear_queue', 'abort']);
  chat.event({ kind: 'queue.cleared', messages: [second.message] });
  assert.equal(chat.conversation.outbox?.at(-1)?.delivery, 'failed');
});

test('older bridges reject steering before clearing the composer or mutating history', t => {
  const chat = setup('old-bridge'); t.after(() => chat.session.dispose());
  chat.socket.message({ type: 'edge.ready', protocol: 1, sessionId: 'old-bridge', agent: 'pi', agents: [], tools: 'read', permissions: 'read', permissionModes: [], cwdLabel: 'test' });
  chat.event({ kind: 'run.started' });
  assert.throws(() => chat.session.send('Adjust', []), /restart the computer bridge/);
  assert.equal(chat.conversation.messages.length, 0);
});

test('retrying the same text keeps the failed attempt and reconciles the new delivered attempt', t => {
  const chat = setup('retry-steering'); t.after(() => chat.session.dispose());
  chat.event({ kind: 'run.started' }); chat.session.send('Adjust', []);
  const failed = chat.socket.sent.at(-1); assert.ok(failed?.type === 'prompt');
  chat.event({ kind: 'prompt.status', requestId: failed.id, disposition: 'failed', error: 'Try again' });
  chat.session.send('Adjust', []);
  const retry = chat.socket.sent.at(-1); assert.ok(retry?.type === 'prompt');
  chat.event({ kind: 'prompt.status', requestId: retry.id, disposition: 'started' });
  chat.event({ kind: 'message', id: 'retry-delivered', role: 'user', text: retry.message, final: true });
  chat.event({ kind: 'run.finished' });
  const query = chat.socket.sent.at(-1); assert.ok(query?.type === 'get_messages');
  chat.event({ kind: 'history', requestId: query.id, messages: [{ id: 'retry-delivered', role: 'user', text: retry.message, final: true }, { id: 'reply', role: 'assistant', text: 'Done', final: true }] });
  assert.equal(chat.conversation.messages.length, 2);
  assert.equal(chat.conversation.messages[0].id, 'retry-delivered');
  assert.equal(chat.conversation.outbox?.length, 1);
  assert.equal(chat.conversation.outbox?.[0].delivery, 'failed');
});

test('idle expiry waits for confirmed state, preserves work and drafts, and ignores history refresh', t => {
  const chat = setup('expired', { updated: Date.now() - 25 * 60 * 60 * 1000 });
  t.after(() => chat.session.dispose());
  assert.equal(chat.session.isExpired(), false, 'wait for bridge state before closing');
  chat.event({ kind: 'state', busy: false, model: 'saved/model', effort: 'off', reasoning: true });
  chat.event({ kind: 'history', messages: [] });
  assert.equal(chat.session.isExpired(), true, 'history replay must not reset activity');
  chat.session.draft.text = 'unsent';
  assert.equal(chat.session.isExpired(), false);
  chat.session.draft.text = '';
  chat.session.draft.attachments = [{ id: 'note', name: 'note', text: 'context' }];
  assert.equal(chat.session.isExpired(), false);
  chat.session.draft.attachments = [];
  chat.event({ kind: 'state', busy: true, model: 'saved/model', effort: 'off', reasoning: true });
  assert.equal(chat.session.isExpired(), false);
  chat.event({ kind: 'run.finished' });
  assert.equal(chat.session.isExpired(), false, 'completion starts a fresh idle window');
  const lastActivity = chat.conversation.lastActivity!;
  assert.equal(chat.session.isExpired(lastActivity + 24 * 60 * 60 * 1000 - 1), false);
  assert.equal(chat.session.isExpired(lastActivity + 24 * 60 * 60 * 1000), true);
});

test('history refresh and task completion preserve last message time', t => {
  const chat = setup('message-time', { updated: 123 });
  t.after(() => chat.session.dispose());
  chat.event({ kind: 'history', messages: [] });
  chat.event({ kind: 'run.finished' });
  assert.equal(chat.conversation.updated, 123);
  chat.event({ kind: 'message', id: 'reply', role: 'assistant', text: 'Answer', final: true });
  assert.ok(chat.conversation.updated > 123);
});

test('Pi image resize hints reconcile a prompt through live echo and history refresh', t => {
  for (const viaHistory of [false, true]) {
    const chat = setup(`resized-image-${viaHistory}`); t.after(() => chat.session.dispose());
    const images = [{ type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png' }];
    chat.session.send('Update the plan\n\n<note-context>\nSource: plan.md\nPlan contents\n</note-context>', images);
    const command = chat.socket.sent.at(-1); assert.ok(command?.type === 'prompt');
    chat.event({ kind: 'prompt.status', requestId: command.id, disposition: 'started' });
    const user = { images, id: 'resized-user', role: 'user' as const, text: command.message + '\n\n[Image: original 1080x2520, displayed at 857x2000. Multiply coordinates by 1.26 to map to original image.]', final: true };
    if (viaHistory) chat.event({ kind: 'history', messages: [user] });
    else chat.event({ kind: 'message', ...user });
    assert.equal(chat.conversation.messages.length, 1);
    assert.equal(chat.conversation.messages[0].delivery, undefined);
    assert.deepEqual(chat.conversation.messages[0].images, images);
    const reply = { id: 'answer', role: 'assistant' as const, text: 'Plan updated', final: true };
    chat.event({ kind: 'message', ...reply });
    chat.event({ kind: 'run.finished' });
    const query = chat.socket.sent.at(-1); assert.ok(query?.type === 'get_messages');
    chat.event({ kind: 'history', requestId: query.id, messages: [user, reply] });
    assert.equal(chat.conversation.outbox?.length, 0);
    assert.deepEqual(chat.conversation.messages.map(message => message.id), ['resized-user', 'answer']);
    assert.deepEqual(chat.conversation.messages[0].images, images);
    assert.equal(chat.socket.sent.filter(command => command.type === 'prompt').length, 1);
  }
});

test('legacy optimistic bubbles migrate out of history without guessing from timestamps', t => {
  const text = 'Image prompt';
  const images = [{ type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png' }];
  const user = { id: 'user:2000', role: 'user' as const, text: text + '\n\n[Image: original 1080x2520, displayed at 857x2000. Multiply coordinates by 1.26 to map to original image.]', final: true };
  for (const sentAt of [1000, 3000]) {
    const pending = { id: `pending:chat-${sentAt}-1`, requestId: `chat-${sentAt}-1`, delivery: 'sending' as const, role: 'user' as const, text, images, final: true };
    const chat = setup(`archive-${sentAt}`, { messages: [user, pending] }); t.after(() => chat.session.dispose());
    chat.event({ kind: 'history', messages: [user] });
    assert.equal(chat.conversation.messages.length, 1);
    assert.equal(chat.conversation.outbox?.length, 1);
    assert.equal(chat.conversation.outbox?.[0].delivery, 'unconfirmed');
    assert.deepEqual(chat.conversation.outbox?.[0].images, images);
  }
});

test('rewritten prompts live in an outbox, not the authoritative transcript, and settle by snapshot', t => {
  const chat = setup('rewritten'); t.after(() => chat.session.dispose());
  chat.session.send('Expand this template', []);
  const prompt = chat.socket.sent.at(-1); assert.ok(prompt?.type === 'prompt');
  assert.equal(chat.conversation.messages.length, 0, 'sending must not write a second source of chat history');
  chat.event({ kind: 'prompt.status', requestId: prompt.id, disposition: 'started' });
  const user = { id: 'u', role: 'user' as const, text: 'Completely expanded template', final: true };
  const reply = { id: 'a', role: 'assistant' as const, text: 'Done', final: true };
  chat.event({ kind: 'message', ...user }); chat.event({ kind: 'message', ...reply });
  chat.event({ kind: 'run.finished' });
  const query = chat.socket.sent.at(-1); assert.ok(query?.type === 'get_messages');
  chat.event({ kind: 'history', requestId: query.id, messages: [user, reply] } as AgentEvent);
  assert.deepEqual(chat.conversation.messages.map(message => message.id), ['u', 'a']);
  assert.equal((chat.conversation as Conversation & { outbox?: unknown[] }).outbox?.length, 0);
});

test('a completed snapshot cannot clear a new send or lose a later live reply', t => {
  const chat = setup('snapshot-race'); t.after(() => chat.session.dispose());
  chat.session.send('Same', []);
  const first = chat.socket.sent.at(-1); assert.ok(first?.type === 'prompt');
  chat.event({ kind: 'prompt.status', requestId: first.id, disposition: 'started' });
  chat.event({ kind: 'run.finished' });
  const query = chat.socket.sent.at(-1); assert.ok(query?.type === 'get_messages');
  chat.session.send('Same', []);
  const second = chat.socket.sent.at(-1); assert.ok(second?.type === 'prompt');
  const user = { id: 'u2', role: 'user' as const, text: 'Expanded same', final: true };
  chat.event({ kind: 'message', ...user });
  chat.event({ kind: 'history', requestId: query.id, messages: [{ id: 'u1', role: 'user', text: 'Expanded same', final: true }, { id: 'a1', role: 'assistant', text: 'Done', final: true }] } as AgentEvent);
  assert.equal(chat.conversation.messages.at(-1)?.id, 'u2');
  const outbox = (chat.conversation as Conversation & { outbox?: { requestId?: string }[] }).outbox;
  assert.deepEqual(outbox?.map(item => item.requestId), [second.id]);
});

test('identical submissions with different images remain two real turns through replay', t => {
  const chat = setup('identical'); t.after(() => chat.session.dispose());
  const users = [];
  const replies: import('../shared/protocol').ChatMessage[] = [];
  for (let index = 0; index < 2; index++) {
    const images = [{ type: 'image' as const, data: index ? 'dHdv' : 'b25l', mimeType: 'image/png' }];
    chat.session.send('Same text', images);
    const command = chat.socket.sent.at(-1); assert.ok(command?.type === 'prompt');
    chat.event({ kind: 'prompt.status', requestId: command.id, disposition: 'started' });
    const user = { id: `user-${index}`, role: 'user' as const, text: 'Rewritten same text', final: true, images };
    const reply = { id: `reply-${index}`, role: 'assistant' as const, text: `Reply ${index}`, final: true };
    users.push(user); replies.push(reply);
    // Replaying an older turn must not acknowledge this new equal-text send.
    if (index) chat.event({ kind: 'message', ...users[0] });
    chat.event({ kind: 'message', ...user }); chat.event({ kind: 'message', ...reply });
    chat.event({ kind: 'run.finished' });
    const query = chat.socket.sent.at(-1); assert.ok(query?.type === 'get_messages');
    chat.event({ kind: 'history', requestId: query.id, messages: users.flatMap((item, at) => [item, replies[at]]) });
    assert.equal(chat.conversation.outbox?.length, 0);
  }
  assert.deepEqual(chat.conversation.messages.filter(message => message.role === 'user').map(message => message.images), users.map(message => message.images));
  assert.equal(chat.conversation.messages.length, 4);
  assert.equal(chat.socket.sent.filter(command => command.type === 'prompt').length, 2);
});

test('a run without a reply retains recoverable content and explains the missing response', t => {
  const chat = setup('no-reply'); t.after(() => chat.session.dispose());
  chat.session.send('Do work', []);
  const command = chat.socket.sent.at(-1); assert.ok(command?.type === 'prompt');
  chat.event({ kind: 'prompt.status', requestId: command.id, disposition: 'started' });
  chat.event({ kind: 'run.finished' });
  const query = chat.socket.sent.at(-1); assert.ok(query?.type === 'get_messages');
  chat.event({ kind: 'history', requestId: query.id, messages: [] });
  assert.equal(chat.conversation.messages.length, 0);
  assert.equal(chat.conversation.outbox?.[0].delivery, 'unconfirmed');
  assert.equal(chat.conversation.outbox?.[0].text, command.message);
  assert.match(chat.session.error, /without a confirmed reply/);
});

test('queue cancellation uses request identity despite rewritten text and excludes later sends', t => {
  const chat = setup('cancel-race'); t.after(() => chat.session.dispose());
  chat.event({ kind: 'run.started' });
  chat.session.send('Same', []);
  const first = chat.socket.sent.at(-1); assert.ok(first?.type === 'prompt');
  chat.event({ kind: 'prompt.status', requestId: first.id, disposition: 'queued' });
  chat.session.stop();
  const clear = chat.socket.sent.at(-2); assert.ok(clear?.type === 'clear_queue');
  chat.session.send('Same', []);
  const second = chat.socket.sent.at(-1); assert.ok(second?.type === 'prompt');
  chat.event({ kind: 'prompt.status', requestId: second.id, disposition: 'queued' });
  chat.event({ kind: 'queue.cleared', requestId: clear.id, messages: ['Rewritten input'] });
  assert.deepEqual(chat.conversation.outbox?.map(message => [message.requestId, message.delivery]), [[first.id, 'failed'], [second.id, 'queued']]);
});

test('out-of-order history responses cannot restore old state', t => {
  const chat = setup('snapshot-order'); t.after(() => chat.session.dispose());
  chat.event({ kind: 'run.finished' });
  const first = chat.socket.sent.at(-1); assert.ok(first?.type === 'get_messages');
  chat.event({ kind: 'run.finished' });
  const second = chat.socket.sent.at(-1); assert.ok(second?.type === 'get_messages');
  const reply = { id: 'new', role: 'assistant' as const, text: 'Latest', final: true };
  chat.event({ kind: 'history', requestId: second.id, messages: [reply] });
  chat.event({ kind: 'history', requestId: first.id, messages: [] });
  assert.deepEqual(chat.conversation.messages, [reply]);
});

test('reconnection reconciles accepted sends while preserving a new send made during reconnect', t => {
  const old = { id: 'pending:old', requestId: 'old', role: 'user' as const, text: 'Original', final: true, delivery: 'accepted' as const };
  const chat = setup('reconnect-outbox', { outbox: [old] }); t.after(() => chat.session.dispose());
  chat.session.send('New', []);
  const next = chat.socket.sent.at(-1); assert.ok(next?.type === 'prompt');
  chat.event({ kind: 'state', busy: false, reasoning: false, model: 'test/model', effort: 'off' });
  const query = [...chat.socket.sent].reverse().find(command => command.type === 'get_messages'); assert.ok(query?.type === 'get_messages');
  chat.event({ kind: 'history', requestId: query.id, messages: [{ id: 'u', role: 'user', text: 'Expanded original', final: true }, { id: 'a', role: 'assistant', text: 'Done', final: true }] });
  assert.deepEqual(chat.conversation.outbox?.map(message => message.requestId), [next.id]);
});
