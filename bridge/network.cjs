const { execFileSync } = require('node:child_process');
const { isIP } = require('node:net');
const { networkInterfaces } = require('node:os');

function tailscaleAddress() {
  try {
    const address = execFileSync('tailscale', ['ip', '-4'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0];
    return isIP(address) === 4 ? address : undefined;
  } catch { return undefined; }
}

function lanAddress(interfaces = networkInterfaces()) {
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (/^(docker|br-|veth|virbr|vboxnet|vmnet|tun|tap|wg|tailscale)/i.test(name)) continue;
    for (const entry of addresses || []) {
      if (!entry.internal && entry.family === 'IPv4' &&
          /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(entry.address)) return entry.address;
    }
  }
}

function resolveNetwork(args, discover = tailscaleAddress, discoverLan = lanAddress) {
  const port = Number(args.port || 8771);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
  const host = (args.host || (args.url ? undefined : discover() || discoverLan()) || '127.0.0.1').replace(/^\[(.*)\]$/, '$1');
  const hostname = host.length <= 253 && host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
  if (!isIP(host) && !hostname) throw new Error('Use an IP address or hostname for --host.');
  if (['0.0.0.0', '::'].includes(host) && !args.url) {
    throw new Error('Add --url ws://<computer-address>:<port> when listening on all interfaces.');
  }
  const url = new URL(args.url || `ws://${isIP(host) === 6 ? `[${host}]` : host}:${port}`);
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      ['0.0.0.0', '[::]'].includes(url.hostname)) {
    throw new Error('Use a reachable ws:// or wss:// address for --url, without credentials or query parameters.');
  }
  return { host, port, url: url.href.replace(/\/+$/, '').replace(/\/rpc$/, '') };
}

module.exports = { resolveNetwork, lanAddress };
