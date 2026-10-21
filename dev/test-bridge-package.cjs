const assert = require('node:assert/strict');
const { execFile, execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { promisify } = require('node:util');
const { WebSocket } = require('ws');

async function main() {
  const root = path.join(__dirname, '..');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-edge-package-test-'));
  let child, socket;
  try {
    const archive = path.resolve(process.argv[2] || path.join(root, 'dist/pi-edge-bridge.tgz'));
    const cache = path.join(temporary, 'npm-cache');
    const npx = path.join(path.dirname(process.env.npm_execpath), 'npx-cli.js');
    const help = execFileSync(process.execPath, [npx, '--offline', '--yes', '--cache', cache, '--package', archive, 'pi-edge-bridge', '--help'], {
      cwd: temporary, encoding: 'utf8', timeout: 30000
    });
    assert.match(help, /Usage: pi-edge-bridge/);
    const installs = await fs.readdir(path.join(cache, '_npx'));
    assert.equal(installs.length, 1);
    const installed = path.join(cache, '_npx', installs[0], 'node_modules/pi-edge-bridge');
    const metadata = JSON.parse(await fs.readFile(path.join(installed, 'package.json'), 'utf8'));
    assert.equal(metadata.dependencies, undefined);
    await fs.access(path.join(installed, 'THIRD-PARTY-LICENSES.txt'));
    const archiveBytes = await fs.readFile(archive);
    const download = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/octet-stream'); res.end(archiveBytes); });
    download.listen(0, '127.0.0.1'); await once(download, 'listening');
    try {
      const remote = await promisify(execFile)(process.execPath, [npx, '--yes', '--cache', path.join(temporary, 'download-cache'),
        `http://127.0.0.1:${download.address().port}/pi-edge-bridge.tgz`, '--help'], {
        cwd: temporary, encoding: 'utf8', timeout: 30000, env: { ...process.env, npm_config_update_notifier: 'false' }
      });
      assert.match(remote.stdout, /Usage: pi-edge-bridge/);
    } finally { await new Promise(resolve => download.close(resolve)); }
    const preload = path.join(temporary, 'isolate-config.cjs');
    await fs.writeFile(preload, `require('node:os').homedir = () => ${JSON.stringify(temporary)};\n`);
    const fakePi = path.join(temporary, 'fake-pi');
    await fs.copyFile(path.join(root, 'tests/fake-pi.cjs'), fakePi);
    await fs.chmod(fakePi, 0o755);
    const reservation = net.createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    child = spawn(process.execPath, ['--require', preload, path.join(installed, 'cli.cjs'), '--cwd', temporary,
      '--host', '127.0.0.1', '--port', String(port), '--pi', fakePi], { cwd: temporary, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = once(child, 'exit');
    // Drain output without ever printing a connection code.
    child.stderr.resume();
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Packaged bridge startup timed out')), 10000);
      let output = '';
      child.stdout.on('data', chunk => {
        output += chunk;
        if (output.includes('Connection code saved privately')) { clearTimeout(deadline); resolve(); }
      });
      child.once('exit', () => { clearTimeout(deadline); reject(new Error('Packaged bridge exited before readiness')); });
      child.once('error', error => { clearTimeout(deadline); reject(error); });
    });
    const code = await fs.readFile(path.join(temporary, '.config/pi-obsidian-edge/connection-code.txt'), 'utf8');
    const pairing = JSON.parse(Buffer.from(code.trim().slice('pi-edge:v1:'.length), 'base64url').toString());
    assert.equal(pairing.url, `ws://127.0.0.1:${port}`);
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 401);
    socket = new WebSocket(`${pairing.url}/rpc?token=${encodeURIComponent(pairing.token)}`);
    await once(socket, 'open');
    const pong = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'edge.ping', protocol: 1 }));
    assert.equal(JSON.parse((await pong)[0]).type, 'edge.pong');
    const ready = new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Packaged bridge handshake timed out')), 10000);
      socket.on('message', raw => {
        const message = JSON.parse(raw);
        if (message.type === 'edge.ready') { clearTimeout(deadline); resolve(message); }
      });
    });
    socket.send(JSON.stringify({ type: 'edge.hello', protocol: 1, clientId: 'packaged-bridge-test', agent: 'pi' }));
    assert.equal((await ready).agent, 'pi');
    socket.terminate();
    child.kill('SIGTERM');
    assert.equal((await exited)[0], 0);
    console.log('Packaged bridge: offline and URL npx install, isolated startup, connection test, token authentication, and Pi handshake passed.');
  } finally {
    socket?.terminate();
    if (child && child.exitCode === null) child.kill('SIGKILL');
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
