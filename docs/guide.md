# User guide

[← Back to Pi Edge](../README.md)

## Requirements

- Obsidian 1.8.7 or newer on your phone or desktop.
- A network route from the phone or desktop client to the computer: the same Wi-Fi/local network, a VPN such as [Tailscale](https://tailscale.com/docs/install), or a TLS reverse proxy. Tailscale is optional; to use it, install it on both devices and sign in to the same Tailscale account.
- [Node.js](https://nodejs.org/en/download) 22.19 or newer on the computer; choose the LTS installer if you are new to Node.js.
- A separately installed [Pi CLI](https://pi.dev/docs/latest/quickstart), connected to a model provider. Follow Pi’s quickstart and send a message in `pi` on the computer first. The bundled Durable runtime uses Pi 1.5.1.
- Your model provider must support images to use image attachments.

The computer must remain awake and reachable. Its Obsidian app does not need to stay open.

## Start the computer bridge

```sh
npx --yes https://github.com/Anderbone/pi-obsidian-edge/releases/download/bridge-0.3.3/pi-edge-bridge.tgz --cwd "/path/to/your/vault"
```

The standalone package bundles its dependencies; Git and build tools are not needed. If you already downloaded `pi-edge-bridge.tgz`, use `npx --yes --package ./pi-edge-bridge.tgz pi-edge-bridge --cwd "/path/to/your/vault"`. Source builds remain available in the [development guide](development.md).

Use the vault path on the computer, not the phone. The bridge uses Pi’s existing model and authentication settings. It listens on port **8771** and prints a QR code and connection code in an interactive terminal. Keep it running, or run the same command using your operating system’s service manager.

Optional flags include `--pi /absolute/path/to/pi`, `--model provider/model`, `--port 8771`, and `--tools read,grep,find,ls`. Add `--help` to see all options.

Private credentials are stored outside the vault in `~/.config/pi-obsidian-edge/token`. The connection code is also saved as `~/.config/pi-obsidian-edge/connection-code.txt` with owner-only permissions. Non-interactive service output does not print the token or connection code.

## Updating an existing installation

Follow the [0.3.3 upgrade steps](../README.md#upgrading-to-033) on the computer, including updating and restarting any background service. Updating the phone plugin alone does not update the bridge. Keep your existing pairing credentials, vault path and private state directory. Reopen the in-app checklist from **Pi Edge settings → Computer bridge update**.

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

**Image** opens the device image picker. You can also paste an image into the message box or drop it there. Where clipboard image access is available, **Paste image from clipboard** provides another way to attach a copied image; allow clipboard access if prompted. PNG, JPEG, WebP, and GIF are accepted. Up to six attachments are allowed, with images limited to 4,000,000 bytes total per prompt. Wait for the thumbnail to appear before sending.

Sent images appear as thumbnails in your message. Tap one to view it larger. Images are sent at their original quality and saved with conversation history in plugin data, so they remain visible when you reopen a chat and count toward its history size limit. They may sync with plugin data; they are not created as separate vault attachment files. Images missing from older local history can be recovered when the updated computer bridge loads them from the original Pi session, if that session is still available.

Open the top-right gear and enable **Show tool call details** to display each tool call and its running/completed/failed status. Leave it unchecked for compact chat. Expand a call to inspect inputs and text results (up to 6,000 characters each); older bridges provide names and status only until updated and restarted. This preference applies to saved and background chats too. Tool records are stored with local conversation history and may sync with plugin data.

Each new request asks Pi to complete and verify requested edits, then finish with the actual changed file paths and a short description, or explicitly state that no files changed. This is an instruction to the model, not independent filesystem verification; failed or unfinished work must be identified in the reply.

Settings include the bridge connection, a default-model dropdown populated from the computer Pi registry, reasoning effort when supported, permission presets, local history, and connection diagnostics. Pi providers configured on the computer are shown as model groups. Separately installed agent CLIs such as Codex or OpenCode are not automatically imported into Pi’s model registry. The panel shows the current reasoning effort and supported levels only for models with a non-off reasoning level. The composer adapts to Obsidian keyboard-height changes and viewport resizing so typing remains visible. The token is saved in device-local WebView storage, outside synced plugin `data.json`; pair each device separately. This is local storage, not a secure hardware credential vault.

While Pi is running, keep typing and click the same **Send** button to send an instruction that changes the current task. Pi reads it after the current assistant turn finishes its tool calls, before the next model call. The instruction appears immediately, is marked **Queued for next turn** after Pi accepts it, and becomes a normal message when Pi consumes it. Notes and images work here too. This requires the updated computer bridge; an older bridge shows an update/restart message and leaves the composer intact.

**Stop** clears queued adjustments before aborting the task. Unsent or cleared instructions stay in the conversation as **Not sent** so their text can be copied and retried. Pi remains **Running** until its session-level `agent_settled` event, including any automatic continuation.

Choose **Read only**, **Read & write**, or **Full access** directly in the mobile composer or settings. The default is **Full access**, including read, write, edit, search and shell tools. Permission changes reopen the same saved Pi session; stop a running agent before changing them.

The computer can impose an optional maximum using `--tools`. For example, this ceiling permits note edits but prevents the phone from enabling shell access:

```sh
npx --yes https://github.com/Anderbone/pi-obsidian-edge/releases/download/bridge-0.3.3/pi-edge-bridge.tgz --cwd "/path/to/vault" --tools read,grep,find,ls,write,edit
```

Without an explicit `--tools` ceiling, all built-in tools are available and the phone can switch between all three permission presets. Tool selection is not a filesystem sandbox; read tools can access files outside the selected vault if instructed. Automatic extension, skill, and MCP discovery are disabled. Full Pi extension interactions are not supported.

## Note links in conversations

Tap the document title above a chat to copy its path from the Obsidian vault root directly, such as `/plannow/note.md`. The copied path starts with `/` and excludes the device storage directory.

Attached Markdown notes appear as clickable links in your messages and in the history picker. Old conversations with embedded note sources also show links. Copying your own message copies the text you entered, excluding the hidden note context sent to Pi.

Links first use the original vault path. If the file has moved, Pi Edge looks for the exact same filename within `projects/<project>/`. For other layouts, it stays within the original top-level folder; notes originally at the vault root search the vault. One match opens directly, multiple matches show a chooser, and no match shows a notice without creating an empty note. A renamed file cannot be recovered by this filename fallback. Files must have synced to the current device before they can be opened. No note IDs or changes to note properties are required.

## Sessions and reconnecting

Use **＋** to start another independent chat. For example, attach note A and start a task, open note B, swipe back to Pi Edge, choose **＋**, and attach note B. Both tasks run with separate Pi contexts. Switching the open note alone leaves the selected chat unchanged.

The **History** button opens one searchable chat list. Running chats appear first with a **Stop** button, followed by chats ordered by their last message time. Each row shows its source note and date/time; select any chat to continue its saved context. Viewing a chat or loading history does not change its last message time or idle timer. Idle connections automatically close after 24 hours without activity, checked once a minute while Obsidian runs; running tasks and unsent drafts stay active. The plugin automatically releases an idle connection when it needs another slot. If all eight connections are busy or protected, wait for a task to finish or stop one. Each chat keeps its model, reasoning effort and permissions. Drafts survive chat switches in memory but not an app/plugin restart. Contexts are separate, while all agents work in the same computer vault.

Closing the panel leaves active chats connected and continues saving background replies. Active chat IDs are stored only on this device, and reopening the panel reconnects them after a plugin reload. History lists saved conversations; opening an archived conversation makes it active again.

The bridge fixes the working directory and any explicit tool ceiling on the computer. Clients select a permission preset within that ceiling; they cannot override arbitrary launch arguments or the working directory. Each conversation has an application-owned UUID. The Pi adapter uses that UUID for a saved Pi session.

A dropped socket leaves running work alive. Once work finishes, an idle disconnected process is retained for two minutes. A reconnect uses the same process and replays bounded, normalized events. After the retention window, the next connection starts Pi with the same saved session ID. Pi history is reloaded into the panel. These retention changes and immediate idle connection cleanup require the updated bridge; older bridges still support concurrent connected chats, but expire disconnected processes after two minutes and release ended chats after that timeout. Restart a source bridge after updating when its current tasks have finished. A computer or bridge restart can interrupt active work; inspect results before repeating an action.

Messages queued before readiness are sent once the bridge is ready. Already-sent prompts are not blindly replayed after a disconnect. The bridge deduplicates command IDs while a session process remains alive; it does not promise durable exactly-once execution across a server restart.

Local history defaults to **500 conversations** and **50 MB** (50,000,000 bytes). Set **Maximum conversations** and **Maximum history size** in Pi Edge settings, then click **Apply** for each change. Both accept positive whole numbers; you can increase either limit. There is no fixed per-conversation message cap. When a limit is reached, the oldest archived conversations are removed first. Live chats and their complete messages stay protected, so they may temporarily exceed these limits until ended. **Clear history** removes archived chats and keeps live chats. Pi's own sessions remain separate on the computer. Images count toward local history limits and may also be present in Pi's session files.

## Privacy

There is no analytics, telemetry, advertising, hosted relay, or bundled model account. Model access may require a paid account or API key configured separately in Pi.

Messages, attached notes and images travel to your computer over your chosen network connection, then through Pi to the model provider you configure. The provider's processing, retention, pricing, and account policies apply. The bridge's WebSocket authentication token is supplied during the handshake, so use a trusted private network or VPN for `ws://`, or a TLS reverse proxy for `wss://` over untrusted networks.

The plugin writes conversation text, attached note context and preferences into its own vault plugin `data.json`. These may be synced by your vault synchronization settings. The bridge token stays in device-local storage and in the computer credential file. Treat the printed pairing code as a secret.

Pi runs as a subprocess outside Obsidian. It reads its configuration, credentials and sessions under `~/.pi/agent/` and may access files outside the vault according to its permissions. The bridge stores bounded events in memory and does not log prompts, images, tokens, or tool output. The plugin's diagnostics contain connection-state transitions only.

