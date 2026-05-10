# chrome-fcm-ts

TypeScript port of the Rust `chrome-fcm` receiver — a from-scratch Chrome FCM
web-push receiver wired specifically for Twitter (x.com) notifications.

The two implementations are **wire-compatible** and **state-file
compatible**: either binary reads the same `state.json`, sends the same
on-the-wire bytes for `LoginRequest` / `HeartbeatPing` / `IqStanza` / etc.,
and decrypts the same `aes128gcm` and `aesgcm` Web Push payloads.

## Quickstart

Requires Bun 1.2+ and `protoc` (e.g. `brew install protobuf`).

```bash
bun install
bun run build      # protoc -> ts-proto -> patch encoder default-elision
bun test           # 44 tests across crypto, framing, login, http, state, session
```

Create `accounts.toml` (in this directory or wherever):

```toml
[[account]]
label      = "main"
auth_token = "<auth_token cookie value>"
ct0        = "<ct0 cookie value>"
```

Run:

```bash
bun run src/index.ts run --config accounts.toml
```

Stderr prints structured logs; stdout emits one JSON line per received
notification, identical in shape to the Rust port:

```json
{"account":"main","received_at":"2026-05-09T19:00:00.000Z","persistent_id":"0:1714…","payload":{"title":"…","body":"…", …}}
```

## CLI

```text
chrome-fcm-ts validate [--config <path>]
chrome-fcm-ts run      [--config <path>] [--resubscribe]
chrome-fcm-ts test-push --account <label> [--config <path>] [--message <text>] [--contact <mailto>]
```

`test-push` sends a properly-signed Web Push (VAPID + RFC 8030 `aesgcm`) to
your own FCM endpoint as a diagnostic — if a separately-running `run`
receives and decrypts it, the FCM/MCS pipeline is healthy independent of
Twitter.

## Architecture

| File | Mirrors Rust |
|---|---|
| `src/crypto.ts` | `src/crypto.rs` — RFC 8291 + RFC 8030 decrypt |
| `src/mcs/frame.ts` | `src/mcs/frame.rs` — framing codec |
| `src/mcs/login.ts` | `src/mcs/login.rs` — LoginRequest / SelectiveAck builders |
| `src/mcs/stream.ts` | `src/mcs/stream.rs` — RMQ2 session loop |
| `src/checkin.ts` | `src/checkin.rs` |
| `src/register.ts` | `src/register.rs` |
| `src/twitter.ts` | `src/twitter.rs` (incl. Twitter VAPID public key) |
| `src/account.ts` | `src/account.rs` — orchestrator |
| `src/state.ts` | `src/state.rs` — atomic JSON write |
| `src/config.ts` | `src/config.rs` — TOML parsing |
| `src/emit.ts` | `src/emit.rs` |
| `src/index.ts` | `src/main.rs` — clap → commander |

The `.proto` schemas live in `proto/` alongside `src/`. `bun run proto:gen`
regenerates `gen/*.ts` from them via `ts-proto`, then post-processes the
encoder branches to strip ts-proto's proto3-style default-value elision (see
`scripts/patch-proto-encoders.ts` for why — proto2 `optional` semantics
require explicit-set fields to round-trip on the wire, otherwise MCS won't
treat us as a complete client).

## Testing parity

Same test surface as the Rust crate:

- `crypto.test.ts` — RFC 8291 §5 worked example decrypts to the expected
  plaintext byte-for-byte.
- `frame.test.ts` — version-byte handling, varint encoding, partial-decode
  semantics, round-trip across realistic payload sizes.
- `login.test.ts` — `LoginRequest` shape + SelectiveAck IQ structure.
- `twitter.test.ts` — exact request snapshot vs the captured DevTools fetch
  (headers, body fields).
- `checkin_register.test.ts` — `fetch` interception verifies request bytes
  and asserts decoded protobuf fields.
- `config_state.test.ts` — TOML round-trip, ring-buffer dedup, atomic write,
  `mode = 0o600`.
- `mcs_session.test.ts` — full handshake + heartbeat-ack + DataMessage +
  SelectiveAck round-trip across an in-memory `Duplex` pair.

## Why Bun

- Native TypeScript execution (no build step for `bun test` / `bun run src/index.ts`).
- Drop-in `node:tls`, `node:crypto`, `node:net`, `fetch`.
- Faster startup than `node` for what is essentially an always-on daemon.
