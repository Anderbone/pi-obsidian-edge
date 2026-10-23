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
- `bridge/server.mts`: authentication, session lifetime, host policy, and WebSocket transport.
- `bridge/agents.mts`: Pi CLI launch and translation to provider-independent events.
- `bridge/cli.mts`: bridge startup, credential generation, QR code, and pairing code.
- `shared/protocol.ts`: messages, commands, models, and permission types used by the plugin and bridge.
- `bridge/network.mts`: optional Tailscale discovery, bind address, and client URL.
- `dev/build-bridge.mjs`: standalone bridge packaging with bundled runtime dependencies.

Tests use a local fake Pi process and do not send model requests. They cover authentication, first-message ordering, image transport, reconnection, command deduplication, and pairing validation. GitHub Actions runs Obsidian-specific lint checks, tests and the production build.

## Running from source

```sh
npm run bridge -- --cwd "/path/to/vault" --host 127.0.0.1
```

The bridge source runs through the development dependency `tsx` after `npm ci`. The small `bridge/cli.cjs` compatibility launcher keeps existing source-checkout service commands working; its application code is in `bridge/cli.mts`. The standalone release bundles that TypeScript entry into plain JavaScript and does not depend on `tsx` or TypeScript at runtime.

## Type checking and protocol compatibility

`npm run typecheck` uses strict TypeScript checking for the plugin, shared protocol, bridge, TypeScript tests, and UI preview, including `.mts` standalone tools. `npm run lint` covers the same source groups and disallows explicit `any`. Build/configuration scripts stay JavaScript, and `tests/fake-pi.cjs` remains a plain Node subprocess fixture so package tests verify a runtime with no TypeScript dependency.

`shared/protocol.ts` defines protocol 1 commands, events, models, messages, and permission presets. The bridge keeps its runtime authentication, command allow-list, and image validation; static types do not validate incoming JSON. Compile-time tests in `tests/protocol.types.ts` reject invalid commands and fields. Integration tests exchange messages between the real client and bridge and retain legacy connection-test coverage.

CI installs with `npm ci --no-audit --no-fund` so an unavailable npm advisory service does not block builds. Dependency audits can be run separately with `npm audit`.

## Community review scope

The directory's documented scanner exclusions include `.mts` ESM modules and the test/development file conventions listed in its [FAQ](https://docs.obsidian.md/community-directory/faq). The standalone computer bridge and browser preview use `.mts` because they are separate tools, not code running in the mobile plugin. They remain part of strict TypeScript checking and local lint. The production build also checks its dependency graph and rejects standalone tool code or external imports other than Obsidian.

The plugin uses vault enumeration for the note picker and clipboard APIs for explicit copy/paste actions. Those behavior disclosures describe required features. Settings use searchable definitions on Obsidian 1.13+, sharing the same row renderers with earlier versions and the in-panel settings modal. Pairing tokens use the official vault-scoped device-local storage API (Obsidian 1.8.7+), outside synced plugin data. A one-time legacy storage read migrates existing tokens, deleting the old key only after a successful write; that migration can still be disclosed as local-storage access by the scanner.

The plugin release contains only `main.js`, `manifest.json`, and `styles.css`. The separate `bridge-<version>` release contains the npx archive and is marked as a prerelease so Obsidian and GitHub's latest-release link continue selecting the plugin release.

## Standalone bridge distribution

`npm run build:bridge` creates `dist/pi-edge-bridge.tgz`, containing the CLI, bundled runtime dependencies, and license notices. Pi and Node.js remain separate prerequisites. Users run it using `npx`; the package has no install scripts or runtime npm dependencies and does not require an npm registry publication.

`npm run test:bridge-package` installs the archive with npm in offline mode and a fresh temporary cache, starts the installed CLI outside the repository with isolated credentials, and checks authentication and the Pi handshake using the fake Pi process. It does not contact a model or change the developer’s pairing data.

CI uploads the package as the `pi-edge-bridge` artifact. On a version tag matching `package.json` and `manifest.json`, the release workflow builds and verifies all assets, publishes the separate bridge release first, then publishes the plugin release. All four assets receive signed GitHub build-provenance attestations, verifiable with `gh attestation verify <downloaded-file> --repo Anderbone/pi-obsidian-edge`. The README points to the versioned `bridge-<version>` release archive, so bridge distribution needs no npm registry account. Earlier plugin releases retain their existing archives; already running bridges and saved pairing credentials are unaffected.

## Source provenance

This repository began empty. No plugin implementation or source history was imported from Pi Panel, Pi Agent, or pi-obsidian. Their public feature descriptions informed the product requirements:

- [Pi Agent](https://community.obsidian.md/plugins/pi-agent): note-aware chat and agent controls.
- [pi-obsidian](https://pi.dev/packages/pi-obsidian): examples of vault-oriented agent capabilities.

The subprocess integration follows the official [Pi RPC documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md). Pi itself and the bridge's `ws` and `qrcode-terminal` dependencies remain separately licensed third-party software.
