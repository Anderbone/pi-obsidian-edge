# Development

[← Back to Pi Edge](../README.md)

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run build:bridge
npm run test:bridge-package
npm run preview
```

The UI preview runs on `http://127.0.0.1:8781`, uses the real panel component, and simulates a reply without contacting a model. It is not a live agent demonstration. Use `/?demo` for sample conversations, `/?demo&desktop` for a wider panel, or `/?unpaired` for the pairing entry screen. README screenshots are actual user-provided Galaxy Fold captures with the Android status bar cropped out.

- `main.ts`: Obsidian integration, pairing, settings, notes, and local history.
- `src/client.ts`: readiness, queueing, reconnection, and replay deduplication.
- `src/panel.ts`: mobile-friendly chat UI, attachments, and Markdown rendering callbacks.
- `bridge/server.ts`: authentication, session lifetime, host policy, and WebSocket transport.
- `bridge/agents.ts`: Pi CLI launch and translation to provider-independent events.
- `bridge/cli.ts`: bridge startup, credential generation, QR code, and pairing code.
- `shared/protocol.ts`: messages, commands, models, and permission types used by the plugin and bridge.
- `bridge/network.ts`: optional Tailscale discovery, bind address, and client URL.
- `dev/build-bridge.mjs`: standalone bridge packaging with bundled runtime dependencies.

Tests use a local fake Pi process and do not send model requests. They cover authentication, first-message ordering, image transport, reconnection, command deduplication, and pairing validation. GitHub Actions runs Obsidian-specific lint checks, tests and the production build.

## Running from source

```sh
npm run bridge -- --cwd "/path/to/vault" --host 127.0.0.1
```

The bridge source runs through the development dependency `tsx` after `npm ci`. The small `bridge/cli.cjs` compatibility launcher keeps existing source-checkout service commands working; its application code is in `bridge/cli.ts`. The standalone release bundles that TypeScript entry into plain JavaScript and does not depend on `tsx` or TypeScript at runtime.

## Type checking and protocol compatibility

`npm run typecheck` uses strict TypeScript checking for the plugin, shared protocol, bridge, TypeScript tests, and UI preview. `npm run lint` covers the same source groups and disallows explicit `any`. Build/configuration scripts stay JavaScript, and `tests/fake-pi.cjs` remains a plain Node subprocess fixture so package tests verify a runtime with no TypeScript dependency.

`shared/protocol.ts` defines protocol 1 commands, events, models, messages, and permission presets. The bridge keeps its runtime authentication, command allow-list, and image validation; static types do not validate incoming JSON. Compile-time tests in `tests/protocol.types.ts` reject invalid commands and fields. Integration tests exchange messages between the real client and bridge and retain legacy connection-test coverage.

CI installs with `npm ci --no-audit --no-fund` so an unavailable npm advisory service does not block builds. Dependency audits can be run separately with `npm audit`.

## Standalone bridge distribution

`npm run build:bridge` creates `dist/pi-edge-bridge.tgz`, containing the CLI, bundled runtime dependencies, and license notices. Pi and Node.js remain separate prerequisites. Users run it using `npx`; the package has no install scripts or runtime npm dependencies and does not require an npm registry publication.

`npm run test:bridge-package` installs the archive with npm in offline mode and a fresh temporary cache, starts the installed CLI outside the repository with isolated credentials, and checks authentication and the Pi handshake using the fake Pi process. It does not contact a model or change the developer’s pairing data.

CI uploads the package as the `pi-edge-bridge` artifact. The release workflow builds, verifies, and attaches the archive together with the plugin’s three files when a version tag matching `package.json` and `manifest.json` is pushed. The README uses the GitHub `releases/latest/download` archive, so bridge distribution needs no npm registry account. Version 0.2.2 is the first release containing the archive.

## Source provenance

This repository began empty. No plugin implementation or source history was imported from Pi Panel, Pi Agent, or pi-obsidian. Their public feature descriptions informed the product requirements:

- [Pi Agent](https://community.obsidian.md/plugins/pi-agent): note-aware chat and agent controls.
- [pi-obsidian](https://pi.dev/packages/pi-obsidian): examples of vault-oriented agent capabilities.

The subprocess integration follows the official [Pi RPC documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md). Pi itself and the bridge's `ws` and `qrcode-terminal` dependencies remain separately licensed third-party software.
