# Changelog

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
