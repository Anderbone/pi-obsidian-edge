# Pi Edge

A new, independently written Obsidian plugin for using **Pi on your computer from your phone**. Pair once, keep Tailscale running, and chat beside your notes. The interface and default folders are English throughout.

Repository: **pi-obsidian-edge** · Plugin ID: **pi-edge** · License: **MIT**

## What works in the prototype

- Desktop and mobile use the same remote client; no Node.js or Pi process runs inside mobile Obsidian.
- One connection code fills the bridge address and token. Manual address/token settings are also available.
- Tailscale transport with token authentication, connection status, automatic reconnect, and initial-message queuing.
- A two-minute reconnection window keeps the computer process alive. Command IDs prevent duplicate execution within a live bridge session.
- Markdown responses, copy response, model picker, thinking level, stop, and new conversations.
- Attach the current note, selected text, another note from the vault, or images from a picker, clipboard, or drag-and-drop.
- Local conversation history, saved Pi sessions on the computer, and connection-only diagnostics that exclude prompts and tokens.

This first version supports **Pi only**. The bridge has an agent adapter boundary and a common event format, but Codex and OpenCode adapters are not implemented.

## Requirements

- Obsidian 1.7.2 or newer on your phone or desktop.
- Tailscale installed and connected on your phone and computer.
- Node.js 22 or newer on the computer.
- A separately installed, authenticated Pi CLI. Tested with Pi 1.2.0.
- Your model provider must support images to use image attachments.

The computer must remain awake and reachable. Its Obsidian app does not need to stay open.

## Start the computer bridge

```sh
git clone https://github.com/Anderbone/pi-obsidian-edge.git
cd pi-obsidian-edge
npm ci
npm run bridge -- --cwd /absolute/path/to/your/vault
```

The bridge detects your computer's Tailscale IPv4 address, listens on port **8771**, and prints a QR code and connection code in an interactive terminal. It does not fall back to a LAN or public bind address when Tailscale is unavailable.

Pi's own model and authentication settings are used by default. Optional flags:

```sh
npm run bridge -- \
  --cwd /absolute/path/to/your/vault \
  --pi /absolute/path/to/pi \
  --model provider/model \
  --port 8771
```

See `npm run bridge -- --help` for all options. Keep the bridge running, or run the same command using your operating system's service manager.

Private bridge credentials are generated outside your vault in `~/.config/pi-obsidian-edge/token`. The connection code is also saved as `~/.config/pi-obsidian-edge/connection-code.txt` with owner-only permissions. Non-interactive service output does not print the token or connection code.

## Install the plugin

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest GitHub release](https://github.com/Anderbone/pi-obsidian-edge/releases), or run `npm run build` to create `main.js` locally.
2. Copy all three files into `<vault>/.obsidian/plugins/pi-edge/`.
3. Restart Obsidian and enable **Pi Edge** in Community plugins.
4. Open **Pi Edge: Pair computer** and paste the connection code from the computer.
5. Open **Pi Edge: Open chat**.

You can also scan the terminal QR code on a device that supports opening `obsidian://` links. It opens a pairing confirmation dialog. The copy-and-paste code is available when QR deep links are unsupported.

This is an independent prototype, not an update to Pi Panel, Pi Agent, or any other plugin. Existing plugins and their settings are not migrated or overwritten. This project has not been submitted to the Obsidian Community directory.

## Attachments and settings

**Note** attaches the last active note. **Selection** attaches text selected in that note's editor. **Browse** lets you pick another Markdown note. Each text attachment is limited to 80,000 characters; the combined prompt is limited to 150,000 characters. Oversized content is rejected rather than truncated.

**Image** opens the device image picker. Pasting and dropping images are supported where the device provides these APIs. PNG, JPEG, WebP, and GIF are accepted. Up to six attachments are allowed, with images limited to 4,000,000 bytes total per prompt. Images are sent at their original quality and are not saved as vault attachments by the plugin.

Settings include the bridge connection, default model, thinking level, local history, and connection diagnostics. The token is saved in device-local WebView storage, outside synced plugin `data.json`; pair each device separately. This is local storage, not a secure hardware credential vault.

The computer bridge controls tools. The default is `read,grep,find,ls`. To allow note edits, explicitly start it with:

```sh
npm run bridge -- --cwd /path/to/vault --tools read,grep,find,ls,write,edit
```

Adding `bash` permits shell commands. Tool selection is not a filesystem sandbox; read tools can access files outside the selected vault if instructed. Automatic extension, skill, and MCP discovery are disabled in this prototype. Full Pi extension interactions are not supported.

## Sessions and reconnecting

The bridge fixes the working directory and maximum tools on the computer; clients cannot override launch arguments or the working directory. Each conversation has an application-owned UUID. The Pi adapter uses that UUID for a saved Pi session.

A dropped socket retains the running process for two minutes. A reconnect uses the same process and replays bounded, normalized events. After the retention window, the next connection starts Pi with the same saved session ID. Pi history is reloaded into the panel. A computer or bridge restart can interrupt active work; inspect results before repeating an action.

Messages queued before readiness are sent once the bridge is ready. Already-sent prompts are not blindly replayed after a disconnect. The bridge deduplicates command IDs while a session process remains alive; it does not promise durable exactly-once execution across a server restart.

Up to 30 conversations are stored in plugin data, with at most 150 messages per conversation and a total cap of 2,000,000 bytes. Old copies are evicted when these limits are reached. Pi's own sessions remain separate on the computer. Images are absent from the plugin's local history, but may be present in Pi's session files.

## Privacy

There is no analytics, telemetry, advertising, hosted relay, or bundled model account. Model access may require a paid account or API key configured separately in Pi.

Messages, attached notes and images travel to your computer over your Tailscale connection, then through Pi to the model provider you configure. The provider's processing, retention, pricing, and account policies apply. The bridge's WebSocket authentication token is supplied during the handshake, so use the intended private Tailscale route rather than a public unencrypted endpoint.

The plugin writes conversation text, attached note context and preferences into its own vault plugin `data.json`. These may be synced by your vault synchronization settings. The bridge token stays in device-local storage and in the computer credential file. Treat the printed pairing code as a secret.

Pi runs as a subprocess outside Obsidian. It reads its configuration, credentials and sessions under `~/.pi/agent/` and may access files outside the vault according to its permissions. The bridge stores bounded events in memory and does not log prompts, images, tokens, or tool output. The plugin's diagnostics contain connection-state transitions only.

## Development

```sh
npm ci
npm test
npm run build
npm run preview
```

The UI preview runs on `http://127.0.0.1:8781`, uses the real panel component, and simulates a reply without contacting a model. It is not a live agent demonstration.

- `main.ts`: Obsidian integration, pairing, settings, notes, and local history.
- `src/client.ts`: readiness, queueing, reconnection, and replay deduplication.
- `src/panel.ts`: mobile-friendly chat UI, attachments, and Markdown rendering callbacks.
- `bridge/server.cjs`: authentication, session lifetime, host policy, and WebSocket transport.
- `bridge/agents.cjs`: Pi CLI launch and translation to provider-independent events.
- `bridge/cli.cjs`: Tailscale discovery, credential generation, QR code, and pairing code.

Tests use a local fake Pi process and do not send model requests. They cover authentication, first-message ordering, image transport, reconnection, command deduplication, and pairing validation. GitHub Actions runs tests and the production build.

## Source provenance

This repository began empty. No plugin implementation or source history was imported from Pi Panel, Pi Agent, or pi-obsidian. Their public feature descriptions informed the product requirements:

- [Pi Agent](https://community.obsidian.md/plugins/pi-agent): note-aware chat and agent controls.
- [pi-obsidian](https://pi.dev/packages/pi-obsidian): examples of vault-oriented agent capabilities.

The subprocess integration follows the official [Pi RPC documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md). Pi itself and the bridge's `ws` and `qrcode-terminal` dependencies remain separately licensed third-party software.
