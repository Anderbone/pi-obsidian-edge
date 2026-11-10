# Durable backend validation

Pi Edge 0.3.0 keeps protocol 1 and the Obsidian client. The default bridge backend uses Pi Durable 1.5.1, Pi's existing model runtime, and the same seven coding tools. `--backend cli` retains the previous subprocess backend.

| Behavior | Previous CLI backend | Durable backend |
| --- | --- | --- |
| Phone disconnect while working | Process continues while bridge survives | Work continues independently of socket |
| Bridge killed mid-generation | No automatic unfinished-task recovery | SQLite checkpoints; unfinished chats resume at bridge startup |
| Duplicate prompt after restart | In-memory transport deduplication lost | Persisted submission request ID |
| Saved CLI context | Reopens Pi session file | Atomic, one-time import when creating the Durable root |
| Interrupted filesystem writes or shell commands | No framework recovery policy | Unsafe tools are not blindly replayed |
| Tool permissions | Per-process tool list | Per-conversation allow-list, including startup recovery |
| Silent socket failure | Foreground probe | Foreground probe plus periodic client probes and server pong deadlines |
| Reconnection | Event replay plus history snapshot | Same compatible transport; live updates emit only newly committed entries and current progress |

Automated coverage in `tests/durable.test.ts` includes persisted image input and history, submission deduplication across reopen, thinking-level persistence, CLI history import without running a model, interrupted-generation recovery, queue cancellation and stopping, all seven real tools, WebSocket reconnect/history/permission changes, and recovery after an actual SIGKILL before a phone connects. Existing tests cover composer, history, sessions, delivery reconciliation, settings, attachments and connection recovery. Packaging tests install the archive offline and over HTTP, then authenticate and perform the default Durable handshake.

A real authenticated WebSocket smoke test measured 79 ms to first readiness and 13 ms on reconnect on this computer, then verified the restored reply. These local measurements exclude mobile network wake-up. A real request using the existing OpenAI credentials returned the requested `DURABLE_OK` response. The connected Fold reached the computer's Tailscale address with 0/3 packet loss and 3.6–7.3 ms round-trip latency during development. This is a point-in-time network observation, not a guarantee about other networks or Android suspension behavior.

SQLite databases and active-work markers live outside the vault, scoped by the canonical vault path. Markers preserve the original tool permissions and are flushed before admission; the database owns task recovery and deduplication. Original CLI session files and phone history are retained. Graceful bridge shutdown waits for the stores to close. Read-only tools are replay-safe; write/edit/bash are unsafe. Recovery does not imply exactly-once external side effects.

Pi Durable is experimental. Keep the storage directory when upgrading and run only one bridge against it. Going back to `--backend cli` does not export Durable conversations into CLI files. The bundled bridge archive is larger because it now carries the framework and provider dependencies, including ESM resources and licenses.
