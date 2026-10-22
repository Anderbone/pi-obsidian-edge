# Changelog

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
