# Changelog

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
