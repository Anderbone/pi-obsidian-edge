const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { WebSocketServer } = require('ws');
const { getAgent, listAgents } = require('./agents.cjs');
const { availableModes, toolsFor, FULL_TOOLS } = require('./permissions.cjs');

const COMMANDS = new Set(['prompt', 'abort', 'get_state', 'get_messages', 'get_session_stats',
  'get_available_models', 'get_available_thinking_levels', 'set_model', 'set_thinking_level', 'new_session']);

function createBridge(options) {
  if (typeof options.token !== 'string' || options.token.length < 24) throw new Error('A token of at least 24 characters is required.');
  const sessions = new Map();
  const tools = options.tools || FULL_TOOLS;
  const modes = availableModes(tools);
  if (!modes.length) throw new Error('The tool ceiling must allow at least the read-only preset.');
  const graceMs = options.graceMs ?? 120000;
  const launch = options.spawn || spawn;
  let shuttingDown = false;
  const send = (ws, data) => {
    if (ws?.readyState === 1) {
      if (ws.bufferedAmount > 2 * 1024 * 1024) return ws.close(1013, 'Slow connection');
      ws.send(JSON.stringify(data));
    }
  };
  function removeSession(session) {
    clearTimeout(session.expiry);
    sessions.delete(session.clientId);
    session.child.stdin?.end();
    session.child.kill();
    const kill = setTimeout(() => { if (session.child.exitCode === null) session.child.kill('SIGKILL'); }, 2000);
    kill.unref();
  }
  function attach(session, ws) {
    clearTimeout(session.expiry);
    if (session.socket && session.socket !== ws) session.socket.close(4009, 'Connected elsewhere');
    session.socket = ws;
    ws.session = session;
    const announce = () => {
      if (session.socket !== ws || ws.readyState !== 1) return;
      send(ws, { type: 'edge.ready', protocol: 1, sessionId: session.id, agent: session.adapter.id, agents: listAgents(), tools: session.tools, permissions: session.permissions, permissionModes: modes, cwdLabel: options.label || 'Computer vault' });
      for (const event of session.events) send(ws, event);
      session.child.stdin.write(JSON.stringify({ type: 'get_state' }) + '\n');
      session.child.stdin.write(JSON.stringify({ type: 'get_messages' }) + '\n');
    };
    if (session.started) announce(); else session.child.once('spawn', announce);
  }
  function startSession(clientId, ws, adapter, permissions) {
    const sessionTools = toolsFor(permissions, tools);
    const command = adapter.launch({ ...options, tools: sessionTools, sessionId: clientId });
    const child = launch(command.executable, command.args, { cwd: options.cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const session = { id: crypto.randomUUID(), clientId, child, adapter, tools: sessionTools, permissions, busy: false, started: false, socket: undefined,
      events: [], bytes: 0, sequence: 0, seen: new Set(), expiry: undefined };
    sessions.set(clientId, session);
    child.once('spawn', () => { session.started = true; });
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 2 * 1024 * 1024) {
        send(session.socket, { type: 'edge.error', message: 'Pi produced an oversized event. Reconnect to start a new session.' });
        removeSession(session);
        session.socket?.close(1011, 'Oversized event');
        return;
      }
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        for (const normalized of adapter.normalize(event)) {
          if (normalized.kind === 'run.started') session.busy = true;
          if (normalized.kind === 'run.finished') session.busy = false;
          if (normalized.kind === 'state') session.busy = normalized.busy;
          const packet = { type: 'edge.event', sessionId: session.id, seq: ++session.sequence, event: normalized };
          const size = Buffer.byteLength(JSON.stringify(packet));
          session.events.push(packet); session.bytes += size;
          while (session.bytes > 768 * 1024 && session.events.length > 1) {
            session.bytes -= Buffer.byteLength(JSON.stringify(session.events.shift()));
          }
          send(session.socket, packet);
        }
      }
    });
    // Diagnostics may include private context. Do not mirror stderr to network or logs.
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.once('error', () => {
      send(session.socket, { type: 'edge.error', message: 'Could not start Pi. Check the executable path on your computer.' });
      session.socket?.close(1011, 'Pi startup failed');
      clearTimeout(session.expiry);
      sessions.delete(clientId);
    });
    child.once('exit', (code) => {
      clearTimeout(session.expiry);
      if (sessions.get(clientId) === session) sessions.delete(clientId);
      if (!shuttingDown) send(session.socket, { type: 'edge.error', message: `Pi stopped (${code ?? 'signal'}). The next connection starts a new session.` });
      session.socket?.close(1011, 'Pi stopped');
    });
    attach(session, ws);
  }
  const expected = Buffer.from(options.token);
  function authorized(req) {
    const received = Buffer.from(new URL(req.url, 'http://localhost').searchParams.get('token') || '');
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  }
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (!authorized(req)) { res.writeHead(401); return res.end('{"error":"Unauthorized"}'); }
    if (new URL(req.url, 'http://localhost').pathname === '/health') return res.end(JSON.stringify({ ok: true, protocol: 1, tools, agents: listAgents() }));
    res.writeHead(404); res.end('{"error":"Not found"}');
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 6 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://localhost').pathname !== '/rpc') return socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
    // Complete the handshake so browser clients receive an actionable auth close code.
    wss.handleUpgrade(req, socket, head, ws => {
      if (!authorized(req)) return ws.close(4001, 'Invalid pairing');
      wss.emit('connection', ws);
    });
  });
  wss.on('connection', ws => {
    const deadline = setTimeout(() => ws.close(4003, 'Pairing timeout'), 10000);
    ws.on('error', () => {});
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return ws.close(4003, 'Invalid JSON'); }
      if (!message || typeof message !== 'object') return ws.close(4003, 'Invalid message');
      if (message.type === 'edge.ping' && message.protocol === 1) {
        return send(ws, { type: 'edge.pong', protocol: 1 });
      }
      if (!ws.session) {
        if (message.type !== 'edge.hello' || message.protocol !== 1 ||
            typeof message.clientId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(message.clientId)) return ws.close(4003, 'Unsupported handshake');
        clearTimeout(deadline);
        let adapter;
        try { adapter = getAgent(message.agent || 'pi'); } catch { return ws.close(4003, 'Agent unavailable'); }
        const existing = sessions.get(message.clientId);
        if (existing && existing.adapter.id !== adapter.id) return ws.close(4003, 'Choose a new conversation to switch agent');
        if (existing) attach(existing, ws);
        else if (sessions.size >= 8) ws.close(1013, 'Too many sessions');
        else {
          const permissions = modes.some(mode => mode.id === message.permissions) ? message.permissions : modes.at(-1).id;
          startSession(message.clientId, ws, adapter, permissions);
        }
        return;
      }
      const session = ws.session;
      if (session.socket !== ws || !session.child.stdin.writable) return;
      if (message.type === 'edge.permissions') {
        if (session.busy) return send(ws, { type: 'edge.error', message: 'Stop the current run before changing permissions.' });
        try { toolsFor(message.mode, tools); } catch (error) { return send(ws, { type: 'edge.error', message: error.message }); }
        if (message.mode === session.permissions) return;
        // Reopen the same saved Pi session with the requested tool list.
        session.socket = undefined;
        removeSession(session);
        startSession(session.clientId, ws, session.adapter, message.mode);
        return;
      }
      if (!COMMANDS.has(message.type)) return send(ws, { type: 'edge.error', message: 'That command is not available.' });
      if (typeof message.id !== 'string' || message.id.length > 180) return ws.close(4003, 'Command ID required');
      if (message.type === 'prompt' && (typeof message.message !== 'string' || message.message.length > 150000)) {
        return send(ws, { type: 'edge.error', message: 'Prompt must be text shorter than 150,000 characters.' });
      }
      if (session.seen.has(message.id)) return;
      if (session.child.stdin.writableLength > 6 * 1024 * 1024) return ws.close(1013, 'Pi is busy');
      session.seen.add(message.id);
      if (session.seen.size > 1024) session.seen.delete(session.seen.values().next().value);
      // Only documented command fields cross into Pi; the client cannot choose launch args or cwd.
      const command = { type: message.type, id: message.id };
      for (const key of ['message', 'provider', 'modelId', 'level']) if (typeof message[key] === 'string') command[key] = message[key];
      if (message.type === 'prompt' && message.images !== undefined) {
        if (!Array.isArray(message.images) || message.images.length > 6) return send(ws, { type: 'edge.error', message: 'Attach at most six images.' });
        let imageBytes = 0;
        command.images = [];
        for (const image of message.images) {
          if (!image || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image.mimeType) ||
              typeof image.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)) {
            return send(ws, { type: 'edge.error', message: 'Invalid image attachment.' });
          }
          imageBytes += Buffer.from(image.data, 'base64').length;
          if (imageBytes > 4000000) return send(ws, { type: 'edge.error', message: 'Images exceed the 4 MB limit.' });
          command.images.push({ type: 'image', mimeType: image.mimeType, data: image.data });
        }
      }
      session.child.stdin.write(JSON.stringify(command) + '\n');
    });
    ws.on('close', () => {
      clearTimeout(deadline);
      const session = ws.session;
      if (session?.socket === ws) {
        session.socket = undefined;
        session.expiry = setTimeout(() => removeSession(session), graceMs);
        session.expiry.unref();
      }
    });
  });
  const heartbeat = setInterval(() => { for (const ws of wss.clients) if (ws.readyState === 1) ws.ping(); }, 10000);
  heartbeat.unref();
  return {
    server,
    listen: (port = 8771, host = '127.0.0.1') => new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(port, host, () => { server.removeListener('error', reject); resolve(server.address()); });
    }),
    close: () => new Promise(resolve => {
      shuttingDown = true; clearInterval(heartbeat);
      for (const session of [...sessions.values()]) removeSession(session);
      for (const ws of wss.clients) ws.terminate();
      wss.close(); server.close(resolve);
    })
  };
}
module.exports = { createBridge };
