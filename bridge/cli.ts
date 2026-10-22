#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createBridge } from './server';
import { resolveNetwork } from './network';
import qr from 'qrcode-terminal';
import { FULL_TOOLS } from './permissions';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log('Pi Edge bridge\n\nUsage: pi-edge-bridge --cwd /path/to/vault [--host IP-or-hostname] [--port 8771] [--url ws[s]://address] [--pi /path/to/pi] [--model provider/id] [--tools read,grep,find,ls]\n\nAutomatically uses Tailscale, then a private LAN address, otherwise localhost. Use --host to choose another interface.\n--url sets the pairing address for a TLS reverse proxy or a different public address; it does not enable TLS on the bridge.\nPairing credentials stay in ~/.config/pi-obsidian-edge/token.'); return;
  }
  const args: Record<string, string> = {};
  const known = new Set(['--cwd', '--host', '--port', '--url', '--pi', '--model', '--tools']);
  for (let i = 0; i < argv.length; i += 2) {
    if (!known.has(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Invalid option: ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.cwd) throw new Error('Provide --cwd /path/to/vault.');
  const cwd = fs.realpathSync(args.cwd);
  if (!fs.statSync(cwd).isDirectory()) throw new Error('Working directory must be a folder.');
  const { host, port, url } = resolveNetwork(args);
  const config = path.join(os.homedir(), '.config', 'pi-obsidian-edge');
  fs.mkdirSync(config, { recursive: true, mode: 0o700 });
  const tokenFile = path.join(config, 'token');
  try { fs.writeFileSync(tokenFile, crypto.randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error; }
  fs.chmodSync(tokenFile, 0o600);
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  const bridge = createBridge({ token, cwd, pi: args.pi, model: args.model, tools: args.tools });
  await bridge.listen(port, host);
  const code = 'pi-edge:v1:' + Buffer.from(JSON.stringify({ url, token })).toString('base64url');
  const link = 'obsidian://pi-edge?code=' + encodeURIComponent(code);
  console.log(`\nPi Edge is ready at ${url}\nListening on: ${host}:${port}\nWorking directory: ${cwd}\nTools: ${args.tools || FULL_TOOLS}\n`);
  if (['127.0.0.1', '::1', 'localhost'].includes(host) && !args.url) console.log('Local connections only. For phone access, restart with --host <computer-address>.\n');
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
