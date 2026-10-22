import type { EdgeClient } from '../src/client';
import type { ClientCommand, HelloPacket, ServerPacket } from '../shared/protocol';

// Compiled by npm run typecheck; never executed. A weaker contract makes an
// expected-error directive unused and fails CI, guarding the migration's benefit.
export function checkProtocolTypes(client: EdgeClient): void {
  client.send('prompt', { message: 'Review this note.' });
  client.send('set_model', { provider: 'example', modelId: 'chat' });
  client.send('edge.permissions', { mode: 'read' });
  client.send('abort');
  // @ts-expect-error Prompt text is required.
  client.send('prompt');
  // @ts-expect-error Provider is required when selecting a model.
  client.send('set_model', { modelId: 'chat' });
  // @ts-expect-error Tool permissions have a closed set of presets.
  client.send('edge.permissions', { mode: 'admin' });
  // @ts-expect-error Clients cannot add subprocess launch arguments to a prompt.
  client.send('prompt', { message: 'Hello', args: ['--tools', 'bash'] });
  // @ts-expect-error Arbitrary subprocess commands are not part of protocol 1.
  client.send('spawn', { executable: 'sh' });
}

// @ts-expect-error A model command requires both modelId and provider.
export const invalidCommand: ClientCommand = { type: 'set_model', id: 'bad', modelId: 'chat' };
// @ts-expect-error Pairing must use the existing supported protocol version.
export const invalidHello: HelloPacket = { type: 'edge.hello', protocol: 2, clientId: 'test-client', agent: 'pi', permissions: 'read' };
// @ts-expect-error A state event must carry the typed busy/model/effort fields.
export const invalidEvent: ServerPacket = { type: 'edge.event', sessionId: 'test', seq: 1, event: { kind: 'state', busy: 'yes' } };
