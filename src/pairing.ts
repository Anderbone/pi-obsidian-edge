export interface Pairing { url: string; token: string; }
export function validatePairing(value: unknown): Pairing {
  if (!value || typeof value !== 'object') throw new Error('Invalid connection code.');
  const { url, token } = value as Record<string, unknown>;
  if (typeof url !== 'string' || typeof token !== 'string' || token.length < 24) {
    throw new Error('A bridge address and a valid token are required.');
  }
  const parsed = new URL(url);
  if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      parsed.search || parsed.hash || ['0.0.0.0', '[::]'].includes(parsed.hostname)) {
    throw new Error('Use a ws:// or wss:// bridge address without credentials or query parameters.');
  }
  return { url: parsed.href.replace(/\/+$/, '').replace(/\/rpc$/, ''), token };
}
export function parsePairing(input: string): Pairing {
  let code = input.trim();
  if (code.startsWith('obsidian://pi-edge')) code = new URL(code).searchParams.get('code') || '';
  if (!code.startsWith('pi-edge:v1:')) throw new Error('Paste the full Pi Edge connection code.');
  const body = code.slice('pi-edge:v1:'.length).replace(/-/g, '+').replace(/_/g, '/');
  try {
    const bytes = Uint8Array.from(atob(body.padEnd(Math.ceil(body.length / 4) * 4, '=')), c => c.charCodeAt(0));
    return validatePairing(JSON.parse(new TextDecoder().decode(bytes)));
  } catch { throw new Error('This connection code is invalid. Copy it again from your computer.'); }
}
