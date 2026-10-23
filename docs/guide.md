# User guide

[← Back to Pi Edge](../README.md)

## Requirements

- Obsidian 1.8.7 or newer on your phone or desktop.
- A network route from the phone or desktop client to the computer: the same LAN, a VPN, or a TLS reverse proxy.
- Node.js 22 or newer on the computer.
- A separately installed, authenticated Pi CLI. Tested with Pi 1.2.0.
- Your model provider must support images to use image attachments.

The computer must remain awake and reachable. Its Obsidian app does not need to stay open.

## Start the computer bridge

```sh
npx --yes https://github.com/Anderbone/pi-obsidian-edge/releases/download/bridge-0.2.6/pi-edge-bridge.tgz --cwd "/path/to/your/vault"
```

The standalone package bundles its dependencies; Git and build tools are not needed. If you already downloaded `pi-edge-bridge.tgz`, use `npx --yes --package ./pi-edge-bridge.tgz pi-edge-bridge --cwd "/path/to/your/vault"`. Source builds remain available in the [development guide](development.md).

Use the vault path on the computer, not the phone. The bridge uses Pi’s existing model and authentication settings. It listens on port **8771** and prints a QR code and connection code in an interactive terminal. Keep it running, or run the same command using your operating system’s service manager.

Optional flags include `--pi /absolute/path/to/pi`, `--model provider/model`, `--port 8771`, and `--tools read,grep,find,ls`. Add `--help` to see all options.

Private credentials are stored outside the vault in `~/.config/pi-obsidian-edge/token`. The connection code is also saved as `~/.config/pi-obsidian-edge/connection-code.txt` with owner-only permissions. Non-interactive service output does not print the token or connection code.

## Connection options

Append these flags to the bridge command:

| Connection | Flags | Client address |
| --- | --- | --- |
| Same computer | `--host 127.0.0.1` | `ws://127.0.0.1:8771` |
| Same Wi-Fi / LAN | `--host 192.168.1.20` | `ws://192.168.1.20:8771` |
| Tailscale or another VPN | `--host 100.64.0.7` | `ws://100.64.0.7:8771` |
| IPv6 | `--host fd00::1` | `ws://[fd00::1]:8771` |
| TLS reverse proxy | `--host 127.0.0.1 --url wss://pi.example.com` | `wss://pi.example.com` |

Replace example addresses with your own. Without `--host`, the bridge uses an available Tailscale IPv4 address, then the first private LAN IPv4 address, otherwise `127.0.0.1`. Tailscale is optional. Use `--host` if your computer has several networks and the chosen address is not reachable from the phone. The client must be able to reach whichever address is in the connection code; localhost refers to the device opening the connection, so a phone cannot use the computer’s localhost address.

`--host` chooses the local listening interface. `--url` chooses the address embedded in the connection code. Use `--url` when a proxy, hostname, or forwarded port differs from the listening address. When binding to `0.0.0.0` or `::`, you must supply a reachable `--url`; wildcard addresses cannot be used by clients.

For `wss://`, configure a TLS reverse proxy that forwards WebSocket upgrades to the bridge’s `/rpc` endpoint. `--url` does not add TLS to the bridge itself. A path prefix such as `wss://pi.example.com/edge` is supported if the proxy maps `/edge/rpc` to `/rpc`. Use `ws://` only on a trusted private network or VPN; use `wss://` over untrusted networks. Token authentication is always required.

## Install and pair

Open [Pi Edge in Community Plugins](https://community.obsidian.md/plugins/pi-edge), choose **Add to Obsidian**, then install and enable it on each device.

Run **Pi Edge: Pair computer**, paste the connection code from the computer, then run **Pi Edge: Open chat**. Pair each device separately because the token is stored locally. Scanning the QR code opens a pairing confirmation dialog on devices that support `obsidian://` links.

### Manual plugin installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Anderbone/pi-obsidian-edge/releases/latest).
2. Copy them into `<vault>/.obsidian/plugins/pi-edge/`.
3. Restart Obsidian and enable **Pi Edge** in Community plugins, then pair as above.

## Connection help

In Pi Edge settings, click **Test connection**. Green **Connected** confirms that the WebSocket bridge accepts your pairing token. The test does not start a Pi session or send a model request. Older bridges are checked using their existing authenticated health endpoint, so the test does not require a computer bridge restart.

- **No connection code:** run the bridge in an interactive terminal. If it runs as a service, read `~/.config/pi-obsidian-edge/connection-code.txt` on the computer.
- **Cannot connect:** check that the bridge address is reachable, the computer is awake, and the bridge is still running. On a LAN, check the computer firewall and whether the Wi-Fi isolates devices. For VPN access, connect both devices to that VPN. Pair the device again if the address or token changed.
- **Models missing:** confirm Pi is authenticated and has models configured on the computer, then reconnect. Pi Edge uses Pi’s model registry.
- **Need more detail:** open Pi Edge settings → **Connection diagnostics** to see connection-state changes without prompts or tokens.

## Attachments and settings

**Note** attaches the last active note. **Selection** attaches text selected in that note's editor. **Browse** lets you pick another Markdown note. Each text attachment is limited to 80,000 characters; the combined prompt is limited to 150,000 characters. Oversized content is rejected rather than truncated.

**Image** opens the device image picker. Pasting and dropping images are supported where the device provides these APIs. PNG, JPEG, WebP, and GIF are accepted. Up to six attachments are allowed, with images limited to 4,000,000 bytes total per prompt. Images are sent at their original quality and are not saved as vault attachments by the plugin.

Settings include the bridge connection, a default-model dropdown populated from the computer Pi registry, reasoning effort when supported, permission presets, local history, and connection diagnostics. Pi providers configured on the computer are shown as model groups. Separately installed agent CLIs such as Codex or OpenCode are not automatically imported into Pi’s model registry. The panel shows the current reasoning effort and supported levels only for models with a non-off reasoning level. The composer adapts to Obsidian keyboard-height changes and viewport resizing so typing remains visible. The token is saved in device-local WebView storage, outside synced plugin `data.json`; pair each device separately. This is local storage, not a secure hardware credential vault.

Choose **Read only**, **Read & write**, or **Full access** directly in the mobile composer or settings. The default is **Full access**, including read, write, edit, search and shell tools. Permission changes reopen the same saved Pi session; stop a running agent before changing them.

The computer can impose an optional maximum using `--tools`. For example, this ceiling permits note edits but prevents the phone from enabling shell access:

```sh
npx --yes https://github.com/Anderbone/pi-obsidian-edge/releases/download/bridge-0.2.6/pi-edge-bridge.tgz --cwd "/path/to/vault" --tools read,grep,find,ls,write,edit
```

Without an explicit `--tools` ceiling, all built-in tools are available and the phone can switch between all three permission presets. Tool selection is not a filesystem sandbox; read tools can access files outside the selected vault if instructed. Automatic extension, skill, and MCP discovery are disabled. Full Pi extension interactions are not supported.

## Note links in conversations

Attached Markdown notes appear as clickable links in your messages and in the history picker. Old conversations with embedded note sources also show links. Copying your own message copies the text you entered, excluding the hidden note context sent to Pi.

Links first use the original vault path. If the file has moved, Pi Edge looks for the exact same filename within `projects/<project>/`. For other layouts, it stays within the original top-level folder; notes originally at the vault root search the vault. One match opens directly, multiple matches show a chooser, and no match shows a notice without creating an empty note. A renamed file cannot be recovered by this filename fallback. Files must have synced to the current device before they can be opened. No note IDs or changes to note properties are required.

## Sessions and reconnecting

The bridge fixes the working directory and any explicit tool ceiling on the computer. Clients select a permission preset within that ceiling; they cannot override arbitrary launch arguments or the working directory. Each conversation has an application-owned UUID. The Pi adapter uses that UUID for a saved Pi session.

A dropped socket retains the running process for two minutes. A reconnect uses the same process and replays bounded, normalized events. After the retention window, the next connection starts Pi with the same saved session ID. Pi history is reloaded into the panel. A computer or bridge restart can interrupt active work; inspect results before repeating an action.

Messages queued before readiness are sent once the bridge is ready. Already-sent prompts are not blindly replayed after a disconnect. The bridge deduplicates command IDs while a session process remains alive; it does not promise durable exactly-once execution across a server restart.

Local history defaults to **500 conversations** and **50 MB** (50,000,000 bytes). Set **Maximum conversations** and **Maximum history size** in Pi Edge settings, then click **Apply** for each change. Both accept positive whole numbers; you can increase either limit. There is no fixed per-conversation message cap. When a limit is reached, the oldest inactive conversations are removed first. If the active conversation alone exceeds the size limit, its oldest messages are removed from the local copy. Lowering a limit applies this cleanup immediately. Pi's own sessions remain separate on the computer. Images are absent from the plugin's local history, but may be present in Pi's session files.

## Privacy

There is no analytics, telemetry, advertising, hosted relay, or bundled model account. Model access may require a paid account or API key configured separately in Pi.

Messages, attached notes and images travel to your computer over your chosen network connection, then through Pi to the model provider you configure. The provider's processing, retention, pricing, and account policies apply. The bridge's WebSocket authentication token is supplied during the handshake, so use a trusted private network or VPN for `ws://`, or a TLS reverse proxy for `wss://` over untrusted networks.

The plugin writes conversation text, attached note context and preferences into its own vault plugin `data.json`. These may be synced by your vault synchronization settings. The bridge token stays in device-local storage and in the computer credential file. Treat the printed pairing code as a secret.

Pi runs as a subprocess outside Obsidian. It reads its configuration, credentials and sessions under `~/.pi/agent/` and may access files outside the vault according to its permissions. The bridge stores bounded events in memory and does not log prompts, images, tokens, or tool output. The plugin's diagnostics contain connection-state transitions only.

