import type { Pairing } from './pairing';
import type { SocketLike } from './client';

export function checkConnection(pairing: Pairing, signal?: AbortSignal,
  createSocket: (url: string) => SocketLike = url => new WebSocket(url) as unknown as SocketLike,
  timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    let socket: SocketLike | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let finished = false;
    const complete = (error?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
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
    timer = setTimeout(() => complete('Connection timed out. Check that the computer and bridge are running.'), timeoutMs);
    try { socket = createSocket(`${pairing.url}/rpc?token=${encodeURIComponent(pairing.token)}`); }
    catch { return complete('Could not open the bridge address. Check the address and network connection.'); }
    socket.onopen = () => socket?.send(JSON.stringify({ type: 'edge.ping', protocol: 1 }));
    socket.onmessage = event => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message?.type === 'edge.pong' && message.protocol === 1) complete();
    };
    socket.onerror = () => complete('Could not reach the computer. Check the bridge address and network connection.');
    socket.onclose = event => complete(event.code === 4001 ? 'Pairing expired. Paste a new connection code.'
      : event.code === 4003 ? 'Update the computer bridge and try again.' : 'The bridge closed the connection. Try again.');
  });
}
