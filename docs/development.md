# Development

[← Back to Pi Edge](../README.md)

```sh
npm ci
npm run lint
npm test
npm run build
npm run build:bridge
npm run test:bridge-package
npm run preview
```

The UI preview runs on `http://127.0.0.1:8781`, uses the real panel component, and simulates a reply without contacting a model. It is not a live agent demonstration. Use `/?demo` for sample conversations, `/?demo&desktop` for a wider panel, or `/?unpaired` for the pairing entry screen. README screenshots use these previews at desktop and phone viewport sizes; they are not captures from the installed Obsidian app.

- `main.ts`: Obsidian integration, pairing, settings, notes, and local history.
- `src/client.ts`: readiness, queueing, reconnection, and replay deduplication.
- `src/panel.ts`: mobile-friendly chat UI, attachments, and Markdown rendering callbacks.
- `bridge/server.cjs`: authentication, session lifetime, host policy, and WebSocket transport.
- `bridge/agents.cjs`: Pi CLI launch and translation to provider-independent events.
- `bridge/cli.cjs`: bridge startup, credential generation, QR code, and pairing code.
- `bridge/network.cjs`: optional Tailscale discovery, bind address, and client URL.
- `dev/build-bridge.mjs`: standalone bridge packaging with bundled runtime dependencies.

Tests use a local fake Pi process and do not send model requests. They cover authentication, first-message ordering, image transport, reconnection, command deduplication, and pairing validation. GitHub Actions runs Obsidian-specific lint checks, tests and the production build.

## Running from source

```sh
npm run bridge -- --cwd "/path/to/vault" --host 127.0.0.1
```

No bridge compilation is required when running from source after `npm ci`.

## Standalone bridge distribution

`npm run build:bridge` creates `dist/pi-edge-bridge.tgz`, containing the CLI, bundled runtime dependencies, and license notices. Pi and Node.js remain separate prerequisites. Users run it using `npx`; the package has no install scripts or runtime npm dependencies and does not require an npm registry publication.

`npm run test:bridge-package` installs the archive with npm in offline mode and a fresh temporary cache, starts the installed CLI outside the repository with isolated credentials, and checks authentication and the Pi handshake using the fake Pi process. It does not contact a model or change the developer’s pairing data.

CI uploads the package as the `pi-edge-bridge` artifact. The release workflow builds, verifies, and attaches the archive together with the plugin’s three files when a version tag matching `package.json` and `manifest.json` is pushed. The README uses the GitHub `releases/latest/download` archive, so bridge distribution needs no npm registry account. Version 0.2.2 is the first release containing the archive.

## Source provenance

This repository began empty. No plugin implementation or source history was imported from Pi Panel, Pi Agent, or pi-obsidian. Their public feature descriptions informed the product requirements:

- [Pi Agent](https://community.obsidian.md/plugins/pi-agent): note-aware chat and agent controls.
- [pi-obsidian](https://pi.dev/packages/pi-obsidian): examples of vault-oriented agent capabilities.

The subprocess integration follows the official [Pi RPC documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md). Pi itself and the bridge's `ws` and `qrcode-terminal` dependencies remain separately licensed third-party software.
