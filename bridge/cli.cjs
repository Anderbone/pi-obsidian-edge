#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createBridge } = require('./server.cjs');
const qr = require('qrcode-terminal');

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log('Pi Edge bridge\n\nUsage: npm run bridge -- --cwd /path/to/vault [--host IP] [--port 8771] [--pi /path/to/pi] [--model provider/id] [--tools read,grep,find,ls]\n\nUses your Tailscale IPv4 address. Keep Tailscale running on both devices.\nPairing credentials stay in ~/.config/pi-obsidian-edge/token.'); return;
  }
  const args = {};
  const known = new Set(['--cwd', '--host', '--port', '--pi', '--model', '--tools']);
  for (let i = 0; i < argv.length; i += 2) {
    if (!known.has(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Invalid option: ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.cwd) throw new Error('Provide --cwd /path/to/vault.');
  const cwd = fs.realpathSync(args.cwd);
  if (!fs.statSync(cwd).isDirectory()) throw new Error('Working directory must be a folder.');
  let host = args.host;
  if (!host) {
    try { host = execFileSync('tailscale', ['ip', '-4'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0]; } catch {}
    if (!host) throw new Error('Start Tailscale on this computer, then try again.');
  }
  if (!/^100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.(?:[0-9]{1,3})\.(?:[0-9]{1,3})$/.test(host)) throw new Error('Use the computer Tailscale IPv4 address (100.64.0.0/10).');
  const port = Number(args.port || 8771);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
  const config = path.join(os.homedir(), '.config', 'pi-obsidian-edge');
  fs.mkdirSync(config, { recursive: true, mode: 0o700 });
  const tokenFile = path.join(config, 'token');
  try { fs.writeFileSync(tokenFile, crypto.randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  fs.chmodSync(tokenFile, 0o600);
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  const bridge = createBridge({ token, cwd, pi: args.pi, model: args.model, tools: args.tools });
  await bridge.listen(port, host);
  const url = `ws://${host}:${port}`;
  const code = 'pi-edge:v1:' + Buffer.from(JSON.stringify({ url, token })).toString('base64url');
  const link = 'obsidian://pi-edge?code=' + encodeURIComponent(code);
  console.log(`\nPi Edge is ready at ${url}\nWorking directory: ${cwd}\nTools: ${args.tools || 'read,grep,find,ls'}\n`);
  const codeFile = path.join(config, 'connection-code.txt');
  fs.writeFileSync(codeFile, code + '\n', { mode: 0o600 });
  fs.chmodSync(codeFile, 0o600);
  if (process.stdout.isTTY) {
    qr.generate(link, { small: true });
    console.log(`Paste this connection code into Pi Edge on your phone:\n\n${code}\n\nOr open this link on the paired device:\n${link}\n\nKeep this code private. Ctrl+C stops the bridge.\n`);
  } else console.log(`Connection code saved privately to ${codeFile}.`);
  const stop = async () => { await bridge.close(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
main().catch(error => { console.error(`Pi Edge: ${error.message}`); process.exitCode = 1; });
