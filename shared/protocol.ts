// Protocol 1 stays wire-compatible with existing plugin and bridge releases.
export type PermissionId = 'read' | 'edit' | 'full';
export interface PermissionMode { id: PermissionId; label: string; }
export function isPermissionId(value: unknown): value is PermissionId {
  return value === 'read' || value === 'edit' || value === 'full';
}
export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; final: boolean; }
export interface ModelEntry { id: string; name: string; provider?: string; modelId?: string; }
export interface ImageInput { data: string; mimeType: string; type?: 'image'; }
export interface AgentInfo {
  id: string; label: string;
  capabilities: { models: boolean; cancel: boolean; tools: boolean; newSession: boolean; };
}

export type AgentEvent = (
  | ({ kind: 'message' } & ChatMessage)
  | { kind: 'history'; messages: ChatMessage[] }
  | { kind: 'run.started' }
  | { kind: 'run.finished' }
  | { kind: 'tool'; id?: string; name?: string; phase: 'running' | 'completed' | 'failed' }
  | { kind: 'state'; busy: boolean; reasoning: boolean; effort: string; model: string }
  | { kind: 'model'; model: string }
  | { kind: 'effort.levels'; levels: string[] }
  | { kind: 'models'; models: ModelEntry[] }
  | { kind: 'state.refresh' }
  | { kind: 'session.new' }
  | { kind: 'error'; message: string }
) & { type?: never };

export interface ReadyPacket {
  type: 'edge.ready'; kind?: never; protocol: 1; sessionId: string; agent: string;
  agents: AgentInfo[]; tools: string; permissions: PermissionId;
  permissionModes: PermissionMode[]; cwdLabel: string;
}
export interface ErrorPacket { type: 'edge.error'; kind?: never; message: string; }
export interface EventPacket { type: 'edge.event'; sessionId: string; seq: number; event: AgentEvent; }
export interface PongPacket { type: 'edge.pong'; protocol: 1; }
export type ServerPacket = ReadyPacket | ErrorPacket | EventPacket | PongPacket;
export type ClientEvent = ReadyPacket | ErrorPacket | AgentEvent;

export interface CommandFields {
  prompt: { message: string; images?: ImageInput[] };
  abort: undefined;
  get_state: undefined;
  get_messages: undefined;
  get_session_stats: undefined;
  get_available_models: undefined;
  get_available_thinking_levels: undefined;
  set_model: { provider: string; modelId: string };
  set_thinking_level: { level: string };
  new_session: undefined;
  'edge.permissions': { mode: PermissionId };
}
export type CommandType = keyof CommandFields;
export type ClientCommand = {
  [K in CommandType]: { type: K; id: string } & (CommandFields[K] extends undefined ? object : CommandFields[K])
}[CommandType];
export interface HelloPacket { type: 'edge.hello'; protocol: 1; clientId: string; agent: string; permissions: PermissionId; }
export interface PingPacket { type: 'edge.ping'; protocol: 1; }
export type ClientPacket = ClientCommand | HelloPacket | PingPacket;

export const RPC_COMMANDS = ['prompt', 'abort', 'get_state', 'get_messages', 'get_session_stats',
  'get_available_models', 'get_available_thinking_levels', 'set_model', 'set_thinking_level', 'new_session'] as const satisfies readonly CommandType[];
export type RpcCommandType = typeof RPC_COMMANDS[number];
// Commands from untrusted clients retain the existing allow-list validation;
// Pi itself handles missing model/effort arguments, rather than trusting a TS cast.
export type PiRequest = { type: RpcCommandType; id?: string } & Partial<
  CommandFields['prompt'] & CommandFields['set_model'] & CommandFields['set_thinking_level']
>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
