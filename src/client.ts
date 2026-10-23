import type { Pairing } from './pairing';
import { isRecord, type ClientCommand, type ClientEvent, type CommandFields, type CommandType, type HelloPacket, type PermissionId, type ServerPacket } from '../shared/protocol';
export type ConnectionStatus = 'disconnected' | 'connecting' | 'ready' | 'reconnecting' | 'error';
export interface SocketLike {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}
export interface ClientHooks {
  status: (state: ConnectionStatus, detail: string) => void;
  event: (event: ClientEvent) => void;
}
export class EdgeClient {
  private socket?: SocketLike;
  private pending: ClientCommand[] = [];
  private timer?: ReturnType<Window['setTimeout']>;
  private deadline?: ReturnType<Window['setTimeout']>;
  private stopped = true;
  private ready = false;
  private attempts = 0;
  private sequence = 0;
  private seen = new Set<string>();
  constructor(private pairing: Pairing, private clientId: string, private hooks: ClientHooks,
    private createSocket: (url: string) => SocketLike = url => new WebSocket(url) as unknown as SocketLike, private permissions: PermissionId = 'full') {}
  connect(): void {
    this.stopped = false;
    if (this.socket && this.socket.readyState < 2) return;
    this.hooks.status(this.attempts ? 'reconnecting' : 'connecting', this.attempts ? 'Reconnecting…' : 'Connecting…');
    const socket = this.createSocket(`${this.pairing.url}/rpc?token=${encodeURIComponent(this.pairing.token)}`);
    this.socket = socket;
    this.ready = false;
    const current = () => this.socket === socket;
    this.deadline = window.setTimeout(() => { if (current() && !this.ready) socket.close(); }, 12000);
    socket.onopen = () => {
      if (current()) socket.send(JSON.stringify({ type: 'edge.hello', protocol: 1, clientId: this.clientId, agent: 'pi', permissions: this.permissions } satisfies HelloPacket));
    };
    socket.onmessage = event => {
      if (!current()) return;
      let parsed: unknown;
      try { parsed = JSON.parse(String(event.data)); } catch { return; }
      if (!isRecord(parsed)) return;
      const message = parsed as unknown as ServerPacket;
      if (message.type === 'edge.ready') {
        window.clearTimeout(this.deadline);
        this.ready = true;
        this.attempts = 0;
        this.permissions = message.permissions || this.permissions;
        this.hooks.status('ready', 'Connected');
        this.hooks.event(message);
        for (const command of this.pending.splice(0)) socket.send(JSON.stringify(command));
      } else if (message.type === 'edge.event') {
        const key = `${message.sessionId}:${message.seq}`;
        if (this.seen.has(key)) return;
        this.seen.add(key);
        if (this.seen.size > 4096) this.seen.delete(this.seen.values().next().value!);
        this.hooks.event(message.event);
      } else if (message.type === 'edge.error') {
        this.hooks.event(message);
      }
    };
    socket.onerror = () => { if (current()) this.hooks.status('error', 'Could not reach the computer. Check its bridge address and network connection.'); };
    socket.onclose = event => {
      if (!current()) return;
      this.ready = false;
      this.socket = undefined;
      window.clearTimeout(this.deadline);
      if (this.stopped) return;
      if (event.code === 4001 || event.code === 4003 || event.code === 4009) {
        this.pending = [];
        this.hooks.status('error', event.code === 4001 ? 'Pairing expired. Paste a new connection code.' : 'Connection rejected. Reopen the panel to try again.');
        return;
      }
      this.hooks.status('reconnecting', 'Connection lost. Reconnecting…');
      this.timer = window.setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.attempts++, 15000));
    };
  }
  send<K extends CommandType>(type: K, ...[fields]: CommandFields[K] extends undefined ? [fields?: undefined] : [fields: CommandFields[K]]): string {
    const id = `${this.clientId}-${Date.now()}-${++this.sequence}`;
    const command = { ...fields, type, id } as ClientCommand;
    if (this.ready && this.socket?.readyState === 1) this.socket.send(JSON.stringify(command));
    else {
      if (this.pending.length >= 10) throw new Error('Too many queued commands. Wait for the connection.');
      this.pending.push(command);
      this.connect();
    }
    return id;
  }
  disconnect(): void {
    this.stopped = true;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.deadline);
    this.pending = [];
    const socket = this.socket;
    this.socket = undefined;
    this.ready = false;
    socket?.close();
    this.hooks.status('disconnected', 'Disconnected');
  }
}
