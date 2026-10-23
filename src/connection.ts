import type { Pairing } from './pairing';
import type { SocketLike } from './client';
import { isRecord, type PingPacket } from '../shared/protocol';

export type HealthCheck = (url: string) => Promise<{ status: number; json: unknown }>;

export function checkConnection(pairing: Pairing, signal?: AbortSignal,
  createSocket: (url: string) => SocketLike = url => new WebSocket(url) as unknown as SocketLike,
  timeoutMs = 8000, healthCheck?: HealthCheck): Promise<void> {
  return new Promise((resolve, reject) => {
    let socket: SocketLike | undefined;
    let timer: ReturnType<Window['setTimeout']>;
    let finished = false;
    const complete = (error?: string) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      if (socket) {
        socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
        socket.close();
      }
      if (error) reject(new Error(error)); else resolve();
    };
    const aborted = () => complete('Connection test cancelled.');
    if (signal?.aborted) return aborted();
    signal?.addEventListener('abort', aborted, { once: true });
    timer = window.setTimeout(() => complete('Connection timed out. Check that the computer and bridge are running.'), timeoutMs);
    try { socket = createSocket(`${pairing.url}/rpc?token=${encodeURIComponent(pairing.token)}`); }
    catch { return complete('Could not open the bridge address. Check the address and network connection.'); }
    socket.onopen = () => socket?.send(JSON.stringify({ type: 'edge.ping', protocol: 1 } satisfies PingPacket));
    socket.onmessage = event => {
      let message: unknown;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (isRecord(message) && message.type === 'edge.pong' && message.protocol === 1) complete();
    };
    socket.onerror = () => complete('Could not reach the computer. Check the bridge address and network connection.');
    socket.onclose = event => {
      if (event.code === 4003 && healthCheck) {
        // Older bridges reject edge.ping but expose the same authenticated health endpoint.
        const url = new URL(`${pairing.url}/health`);
        url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
        url.searchParams.set('token', pairing.token);
        void healthCheck(url.href).then(response => {
          const health = response.json as { ok?: unknown; protocol?: unknown } | null;
          if (response.status === 401) complete('Pairing expired. Paste a new connection code.');
          else if (response.status === 200 && health?.ok === true && health.protocol === 1) complete();
          else complete('The bridge did not return a valid connection test response.');
        }).catch(() => complete('Could not verify the bridge. Check the bridge address and network connection.'));
        return;
      }
      complete(event.code === 4001 ? 'Pairing expired. Paste a new connection code.' : 'The bridge closed the connection. Try again.');
    };
  });
}
