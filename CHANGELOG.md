# Changelog

## 0.3.3

**Action required: update the bridge on your computer too.** Updating only the Obsidian plugin does not update a running computer bridge or switch it to Pi Durable.

1. Wait for running tasks to finish, then stop the old bridge (Ctrl+C, or stop its background service).
2. With Node.js 22.19+, run this on the computer, replacing the vault path with the same folder as before:

   ```sh
   npx --yes https://github.com/Anderbone/pi-obsidian-edge/releases/download/bridge-0.3.3/pi-edge-bridge.tgz --cwd "/path/to/your/vault"
   ```

3. Keep your existing network, tools and state-directory options; omit `--backend cli` to use Pi Durable. For a background service, replace its launch command and restart it. Source-checkout users: pull, run `npm ci`, and restart the existing service. Run only one bridge for the same vault and state directory.
4. Open Pi Edge settings → Test connection, then resume a chat from History and send a message. Connected verifies reachability and pairing, not the installed bridge version. If you already run bridge 0.3.3, no reinstall is needed.

Keep the same computer account, vault path, `~/.config/pi-obsidian-edge/`, any custom state directory, and `~/.pi/agent/`. Pairing and history are retained; pair again only if the address or token changed. Existing CLI chat context imports when first opened. Durable-only conversations cannot be continued with `--backend cli`.

- Preserve relative dependency symlinks when packaging the bridge on Node.js 22.
- Show the computer-update checklist on first enable of this release on each device. Acknowledge it locally and reopen it from settings or the command palette at any time.
- Include the Pi Durable migration and OAuth/run-error fixes described below, with a matching prebuilt computer bridge.
- Improve Android keyboard image pasting with a rich editing host while keeping pasted text plain.
- Refine the mobile layout, preserve conversations when notes move, allow dismissing automatic note attachments, and keep the running phase visible during repeated status updates.
- Fix duplicate outgoing chat state, reconnection and chat-slot recovery, and keep saved note conversations resumable.

## 0.3.1

- Fix lazy OAuth refresh in the source-checkout service launcher by avoiding scoped module URL queries.
- Keep run failures visible across idle/state updates and replay the saved failure when reopening chat history. Show Error instead of Idle after a failed run.

## 0.3.0

- Run the bridge on Pi Durable with private SQLite storage, persistent submission IDs, automatic recovery of unfinished work after restart, and one-time import of existing Pi chat context. Keep the previous CLI runtime available with `--backend cli`.
- Detect silent connections on both ends, probe immediately on foreground/network recovery, and reconnect without waiting for a stuck WebSocket close event.
- Keep the existing mobile protocol, tools, permissions, model selection, images, steering and history. Ship runtime dependencies in the bridge archive for offline installation.

## 0.2.10

- Show conversations in chat history only after you send a message. Hide unused chats created by opening the panel or browsing notes, including existing empty entries.

## 0.2.9

- Merge active chats and saved conversations into one searchable History list, with running tasks first, Stop controls, note links, and last message dates. Resume the original context from any saved chat.
- Automatically close connections after 24 hours of inactivity while preserving history, running tasks, and unsent drafts. Release safe idle connections when another chat needs a slot.
- Keep last message times and idle timers unchanged when viewing chats or restoring history.
- Start independent context when switching notes or reopening the plugin, preserving previous chats and background tasks in History. Show the full source-note path in the chat header.

## 0.2.8

- Copy the document's vault-root path (for example, `/plannow/note.md`) directly when tapping its chat title, without a selection menu or device storage prefix.
- Accept item-only clipboard image pastes and mobile paste input, with a clipboard image button where supported. Preview attachments and prevent sending before image imports finish.
- Preserve sent images in messages and saved history, including queued sends, older bridge echoes and Pi session history. Show thumbnails with a larger image viewer.
- Send steering instructions, notes and images while a chat runs. Show pending/queued messages and retain failed sends; Stop clears queued instructions before aborting.
- Track Pi completion using agent_settled and reconstruct delta-only streaming independently for each session.

- Add a compact/detail chat preference in the top-right settings. Preserve expandable tool calls, status, and bounded text inputs/results across history and background chats.
- Ask Pi to finish requested edits, verify saved files, and explicitly report changed file paths or no changes in every final reply.

- Keep up to eight independent Pi chats active, with an Active chats picker, per-chat model/effort/permissions, note labels, and in-memory composer drafts.
- Receive and save background replies while switching chats or closing the panel. Remember active chat IDs on this device and reconnect them when reopening the panel.
- Preserve live conversations when pruning or clearing local history. Stop and end individual chats without affecting other tasks.
- Let disconnected Pi tasks finish before starting the bridge's idle retention timer. Add optional immediate session cleanup while keeping protocol 1 compatibility with existing bridges.

## 0.2.7

- Remove the redundant nullable type reported by the community review.
- Keep the legacy settings entry point while refreshing it through a private renderer instead of calling the deprecated Obsidian display API.
- Enforce redundant-type and deprecated-API checks in plugin lint to prevent these warnings recurring.

## 0.2.6

- Make plugin settings searchable through Obsidian 1.13+ declarative settings, with shared rendering for earlier versions and the chat settings modal.
- Store pairing tokens through the official vault-scoped device-local storage API, migrating existing credentials without syncing them or requiring pairing again. Minimum Obsidian version is now 1.8.7.
- Publish the computer bridge as a separate signed release so plugin releases contain only supported plugin files. Update the npx setup command to the versioned bridge archive.
- Preserve note browsing, copy/paste, and their expected capability disclosures.

## 0.2.5

- Fix the static-style assignment flagged by the community review and remove CSS important/duplicate-background warnings.
- Use explicit ESM TypeScript extensions for standalone computer tools so the directory does not scan them as mobile plugin code; all remain type-checked.
- Use browser window timers, safe JSON narrowing, and bound callbacks in the plugin, with stricter lint checks to prevent regressions.
- Verify the mobile build does not import standalone bridge tools or Node.js dependencies.
- Generate GitHub build-provenance attestations for plugin and bridge release assets.

## 0.2.4

- Migrate bridge application modules and their tests to TypeScript, with shared protocol, message, and permission types.
- Strictly type-check the plugin, bridge, shared types, tests, and preview in CI; reject explicit any in those sources.
- Preserve protocol 1, the standalone npx package, and existing source-checkout service commands.
- Add compile-time contract checks, real client/bridge integration coverage, and regression checks for runtime validation.

## 0.2.3

- Fix a false connection-test failure with older bridges while normal chat still works.
- Fall back to the existing authenticated health endpoint when a bridge does not support the newer WebSocket probe.
- Keep connection tests independent of active chat sessions and model requests; older bridges do not need to be restarted.

## 0.2.2

- Standalone bridge package runnable with npx, without cloning the repository or compiling.
- Automatically select a Tailscale or private LAN address for one-command setup.
- Add a settings connection test with a green connected result and no model requests.
- Increase local history defaults to 500 conversations / 50 MB, add configurable limits, and remove the 150-message cap.
- Add a copyable agent setup prompt to the shorter README.
- Support LAN, loopback, other VPNs, IPv6, and custom ws/wss pairing addresses; Tailscale is optional.
- Separate bind and pairing addresses with `--host` and `--url`, including TLS reverse proxies with path prefixes.
- Shorter README with desktop/phone UI previews, a Community Plugins entrypoint, and separate user/development guides.
- Verify standalone package installation and authentication in CI; attach it to future tagged releases.

## 0.2.1

- First stable GitHub release, prepared for community-directory submission.
- Clickable attached-note links in user messages and the conversation history picker, including older chats.
- Recover moved notes by exact filename within the original project; ask when multiple files match.
- Copy user messages without including the hidden attached-note content.
- Preserve mobile viewport and composer behavior with dynamic CSS properties.
- Add Obsidian-specific lint checks to CI and regression coverage for note references and moved files.

## 0.2.0

- Compact Obsidian-themed layout, right-aligned user bubbles and left-aligned Pi replies.
- Native icons, a smaller composer, tighter Markdown spacing and animated thinking dots.
- Model dropdowns in both chat and settings use the computer Pi model registry.
- Reasoning effort appears only when the model offers a non-off level.
- Mobile permission presets: Read only, Read & write and Full access. Full access is the default, including shell tools.
- Permission changes reopen the same saved session and are blocked during an active run. An explicit computer tool ceiling remains enforced.

## 0.1.1

- Keep the composer and Send button above overlay keyboards and resized mobile viewports.
- Show reasoning effort beside the model and allow changing it from the panel.
- Read actual effort and supported levels from Pi; disable switching for non-reasoning models.
- Add keyboard-layout and effort-state regression tests.

## 0.1.0

Initial independently written prototype.

- English mobile and desktop remote chat with Pi over Tailscale.
- QR/link and connection-code pairing, plus manual settings.
- Readiness queue, heartbeat, reconnect, and bounded event replay.
- Image, current-note, selected-text, and note-picker attachments.
- Markdown, copy, model selection, thinking level, stop, history, and new conversations.
- Device-local bridge token and content-free connection diagnostics.
- Host-controlled tools and persistent Pi session IDs.

Only Pi is implemented. Community-directory submission and full extension interactions are not included.
