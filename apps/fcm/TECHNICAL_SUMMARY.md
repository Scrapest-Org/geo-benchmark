# chrome-fcm-ts — Technical Summary

## 1. What the App Does

`chrome-fcm-ts` is a headless daemon that receives Twitter (X.com) notifications in real time by impersonating a Chrome browser's Firebase Cloud Messaging (FCM) client. It opens a persistent TLS connection to Google's `mtalk.google.com:5228` (the Mobile Connection Server / MCS), authenticates as a Chrome desktop browser via Android checkin + FCM registration, subscribes to Twitter's push notification endpoint, and decrypts incoming Web Push messages. Each decrypted notification is emitted as a JSON line to stdout. The app is a from-scratch TypeScript port of the Rust `chrome-fcm` receiver and is byte-for-byte wire compatible with it.

## 2. Architecture Overview

The app is a single-process, single-threaded async daemon written in TypeScript for Bun. There is no HTTP server, no framework — it's a persistent TCP client only.

```
┌─────────────────────────────────────────────────────────────────┐
│  CLI entry point (src/index.ts)                                 │
│  commander-based: validate | run | test-push                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  config.ts    │  │  state.ts    │  │  account.ts          │  │
│  │  TOML parser  │  │  JSON state  │  │  per-account runner  │  │
│  │  ↕            │  │  ↕           │  │  ┌────────────────┐  │  │
│  │  accounts.toml│  │  state.json  │  │  │  checkin.ts     │  │  │
│  └──────────────┘  └──────────────┘  │  │  Google checkin  │  │  │
│                                       │  ├────────────────┤  │  │
│                                       │  │  register.ts    │  │  │
│                                       │  │  FCM register3  │  │  │
│                                       │  ├────────────────┤  │  │
│                                       │  │  twitter.ts     │  │  │
│                                       │  │  X subscribe    │  │  │
│                                       │  ├────────────────┤  │  │
│                                       │  │  crypto.ts      │  │  │
│                                       │  │  Web Push decr. │  │  │
│                                       │  ├────────────────┤  │  │
│                                       │  │  mcs/           │  │  │
│                                       │  │  ├ frame.ts     │  │  │
│                                       │  │  ├ login.ts     │  │  │
│                                       │  │  └ stream.ts    │  │  │
│                                       │  └────────────────┘  │  │
│                                       └──────────────────────┘  │
│                                                                │
│  ┌──────────────┐                                              │
│  │  test-push.ts│  standalone VAPID + aesgcm encrypt & POST    │
│  └──────────────┘                                              │
│                                                                │
│  ┌──────────┐  stdout: JSON-L notifications                    │
│  │  emit.ts │  stderr: structured logs                         │
│  └──────────┘                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key design decisions:**
- **One TLS connection per account** — each `[[account]]` in config gets its own async loop (`runAccount()` → `receiveForever()` → `runOneSession()` → `Session.login()` → `nextData()` loop)
- **State file is Rust-compatible** — the same `state.json` can be swapped between `chrome-fcm-ts` and the Rust `chrome-fcm` binary
- **Wire-level parity** — every protobuf encoder branch preserves `optional` semantics (proto2 presence, not proto3 default-elision) so the wire bytes match the Rust port exactly

## 3. Data Flow

### Startup

1. **Config load** — `src/config.ts` reads `accounts.toml` (TOML via `smol-toml`), parses `[[account]]` entries (label, auth_token, ct0) and `[options]` (state_path, heartbeat_interval_secs, mtalk_host, locale). Validates no duplicate labels, at least one account.

2. **State load** — `src/state.ts` reads `state.json` (or returns `{ accounts: {} }` if absent). The state contains per-account FCM credentials, ECDH keys, and a ring buffer of recent `persistent_id` values (max 10). This is the sole persistent store for long-lived credentials.

3. **Per-account bootstrap** (if no state exists for the account):

   a. **Checkin** (`src/checkin.ts`) — POSTs a protobuf `AndroidCheckinRequest` to `https://android.clients.google.com/checkin`, impersonating Chrome on Mac. The request encodes `DeviceType.DEVICE_CHROME_BROWSER`, Chrome 147, Mac platform, stable channel. Google responds with `(android_id, security_token)` — a device identity pair that is long-lived.

   b. **ECDH key generation** — generates a P-256 keypair for the Web Push encryption envelope, plus a 16-byte auth secret. These are the "subscriber" keys.

   c. **FCM Registration** (`src/register.ts`) — POSTs a form-urlencoded body to `https://android.clients.google.com/c2dm/register3` with `app=org.chromium.linux`, the android_id/security_token as `AidLogin` auth, and Twitter's VAPID public key as the `sender`. FCM binds the registration to this sender key and returns an FCM token (opaque string).

   d. **Twitter subscription** (`src/twitter.ts`) — POSTs to `https://x.com/i/api/1.1/notifications/settings/login.json` with the FCM endpoint URL, ECDH public key, and auth secret. Sends Twitter auth cookies (`auth_token`, `ct0`), the Twitter bearer token, and CSRF headers. Twitter links its push system to the FCM token.

   e. **State save** — all credentials are written to `state.json` atomically (write to `.tmp`, fsync, rename).

4. **MCS session** (`receiveForever` per account):

   a. Opens TLS to `mtalk.google.com:5228` (configurable via `mtalk_host`)

   b. Builds `LoginRequest` protobuf with the android_id, security_token, and the account's `received_persistent_ids` (so MCS knows which messages the client already has)

   c. Sends as MCS frame `[version=41][tag=2][varint payload_len][LoginRequest proto]`

   d. Awaits `LoginResponse` — if successful, the session is established

### Receiving a Notification

1. MCS sends a `DataMessageStanza` frame (tag=8) with:
   - `persistent_id` — opaque ack token like `"0:1714000000000%<hex>"`
   - `app_data` — key-value pairs: `"content-encoding"`, `"encryption"`, `"crypto-key"`, `"subtype"`, etc.
   - `raw_data` — the encrypted Web Push payload bytes

2. **SelectiveAck** — the session immediately sends an `IqStanza` with extension id=12 (`kSelectiveAck`) containing the persistent_id, telling MCS not to redeliver.

3. **Decryption** (`src/crypto.ts`):

   a. If `content-encoding` is `aes128gcm` (RFC 8291) — parse the self-describing header from `raw_data`: salt (16) || record-size (4) || key-id-length (1) || sender-public-key (65) || ciphertext+tag. ECDH shared secret is computed between subscriber private key and sender public key. Two-pass HKDF derives the AES-GCM key and nonce, then decrypts and strips RFC 8188 padding.

   b. If `content-encoding` is `aesgcm` (RFC 8030 draft-04) — salt and sender public key come from HTTP-style `encryption` and `crypto-key` headers in the app_data. Two-pass HKDF with "P-256\0" context (exactly 6 bytes, not 7). Decrypts and strips u16-be padding length.

4. **Emission** (`src/emit.ts`) — parses the decrypted plaintext as JSON. If valid, emits `{"account","received_at","persistent_id","payload":{...}}` to stdout. If not JSON, emits `payload_b64` with base64url of the raw bytes.

5. **State update** — the persistent_id is appended to the account's ring buffer (max 10, deduped) and `state.json` is rewritten atomically.

### Heartbeat & Session Management

- The `Session` class (`src/mcs/stream.ts`) tracks RMQ2 stream IDs (`stream_id_out` starts at 1 for LoginRequest, increments per outbound frame)
- Every inbound frame increments `last_stream_id_received`
- When `last_stream_id_received - last_stream_id_received_acked >= 10`, a `StreamAck` IQ (extension id=13) is sent
- HeartbeatPings are sent at the interval suggested by the server's `LoginResponse.heartbeat_config` (minimum 30s)
- If a HeartbeatAck isn't received within 30s of sending a ping, the connection is considered dead and the session throws, triggering reconnection with exponential backoff (1s → 2s → 4s → ... → max 300s)
- On any error, `receiveForever` catches, sleeps, and reconnects

## 4. Key Data Structures

### `AccountConfig` (from `config.ts`)
```typescript
{ label: string; authToken: string; ct0: string }
```
The user-provided config per account. `authToken` and `ct0` are Twitter session cookies.

### `AccountState` (from `state.ts`)
```typescript
{
  android_id: string;           // from Google checkin
  security_token: string;       // from Google checkin
  fcm_token: string;            // from FCM register3
  ecdh_private_b64: string;     // 32-byte P-256 private key, base64url
  ecdh_public_b64: string;      // 65-byte uncompressed SEC1, base64url
  auth_secret_b64: string;      // 16-byte auth secret, base64url
  subtype_uuid: string;         // "wp:<uuid>"
  twitter_subscribed: boolean;  // has Twitter subscription been done
  received_persistent_ids: string[];  // ring buffer, max 10
}
```
Written/read from `state.json`. Field names match the Rust port exactly.

### `CheckinCredentials` (from `checkin.ts`)
```typescript
{ androidId: bigint; securityToken: bigint }
```
The output of the checkin handshake.

### `Subscriber` (from `crypto.ts`)
```typescript
{ uaPrivate: Uint8Array; uaPublic: Uint8Array; authSecret: Uint8Array }
```
The "user agent" (subscriber) cryptographic identity — private key (32 bytes), public key (65 bytes uncompressed SEC1 with leading 0x04), auth secret (16 bytes).

### `InboundDataMessage` (from `mcs/stream.ts`)
```typescript
{ persistentId: string; rawData: Uint8Array; headers: Record<string, string> }
```
A decrypted notification from MCS before Web Push decryption.

### `McsFrame` (from `mcs/frame.ts`)
```typescript
{ tag: number; payload: Uint8Array }
```
A decoded MCS frame after version-byte stripping and varint-length parsing.

### `SharedState` (from `account.ts`)
```typescript
{ state: State; statePath: string; options: Options; saveLock: { busy: boolean; queue: Array<() => void> } }
```
Shared mutable state across account tasks with a serializing save lock to prevent concurrent state.json writes.

### `State` (from `state.ts`)
```typescript
{ accounts: Record<string, AccountState> }
```
Keyed by account label.

### Proto-generated types (via ts-proto from `proto/checkin.proto` + `proto/mcs.proto`):

| Type | File | Purpose |
|---|---|---|
| `AndroidCheckinRequest` | `gen/checkin.ts` | Checkin HTTP body |
| `AndroidCheckinResponse` | `gen/checkin.ts` | Checkin HTTP response |
| `LoginRequest` | `gen/mcs.ts` | MCS login (tag 2) |
| `LoginResponse` | `gen/mcs.ts` | MCS login response (tag 3) |
| `DataMessageStanza` | `gen/mcs.ts` | Push notification (tag 8) |
| `IqStanza` | `gen/mcs.ts` | SelectiveAck / StreamAck (tag 7) |
| `HeartbeatPing` / `HeartbeatAck` | `gen/mcs.ts` | Heartbeat frames (tag 0/1) |
| `SelectiveAck` | `gen/mcs.ts` | Inner payload for IqStanza extension id=12 |
| `Extension` | `gen/mcs.ts` | Extension wrapper inside IqStanza |
| `AppData` | `gen/mcs.ts` | Key-value headers within DataMessageStanza |
| `ChromeBuildProto` / `AndroidCheckinProto` | `gen/checkin.ts` | Nested messages inside checkin request |

## 5. External Dependencies

| Service/Protocol | What the app does | Endpoint | Credentials |
|---|---|---|---|
| **Google Android Checkin** | Bootstraps device identity. POSTs a protobuf `AndroidCheckinRequest` pretending to be Chrome/Mac. Gets back `(android_id, security_token)`. | `https://android.clients.google.com/checkin` | None (anonymous) |
| **Google FCM Register** | Registers for push messages bound to Twitter's VAPID key. POSTs form-urlencoded body with `AidLogin` auth header. Gets back an FCM token. | `https://android.clients.google.com/c2dm/register3` | `android_id`, `security_token` (from checkin) |
| **Google MCS (mtalk)** | Persistent TLS connection for receiving push messages. Custom framed-protobuf protocol over TLS. | `mtalk.google.com:5228` (default, configurable) | `android_id`, `security_token`, `received_persistent_ids` |
| **Twitter (X.com)** | Subscribes the FCM endpoint to Twitter's push notification system. POSTs JSON to login.json with cookies. | `https://x.com/i/api/1.1/notifications/settings/login.json` | `auth_token` cookie, `ct0` cookie (from user's browser session), Twitter hardcoded bearer token |
| **Twitter VAPID Public Key** | Hardcoded in `src/twitter.ts` — MUST match what Twitter's service worker advertises, otherwise FCM rejects pushes | Used as `sender=` in FCM register3 | Hardcoded constant (not user-specific) |

**Hardcoded credentials baked into the binary:**
- `TWITTER_BEARER` — `"AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"` (Twitter's public API bearer token)
- `TWITTER_VAPID_PUBLIC_KEY` — extracted from Twitter's service worker JS
- `FCM_APP_ID` — `"org.chromium.linux"` (the app identifier Chrome sends, despite running on any desktop platform)
- `CHROME_VERSION` — `"147.0.7390.65"`
- `USER_AGENT` — Chrome/Mac user-agent string

## 6. Config and Startup

### `accounts.toml`

Located at platform-specific config directory:
- macOS: `~/Library/Application Support/chrome-fcm/accounts.toml`
- Linux: `~/.config/chrome-fcm/accounts.toml`
- Windows: `%APPDATA%/chrome-fcm/accounts.toml`

```toml
[[account]]
label      = "main"
auth_token = "<value of auth_token cookie from x.com>"
ct0        = "<value of ct0 cookie from x.com>"

[options]
state_path                = "/custom/path/state.json"   # optional
heartbeat_interval_secs   = 120                          # optional, default 60
mtalk_host                = "mtalk4.google.com:5228"     # optional
locale                    = "ja"                         # optional, default "en"
```

At least one `[[account]]` is required. Multiple accounts are supported (parallel connections).

### `state.json`

Auto-created in the same config directory. Contains FCM credentials per account label. This file is the long-lived identity — losing it forces a re-checkin (the app regenerates it automatically). The file is written atomically (`write → .tmp → fsync → rename`) with mode `0o600`.

### Required user input

The user must supply valid Twitter session cookies (`auth_token` + `ct0`) from an authenticated browser session. These expire periodically and must be refreshed. Everything else (checkin, FCM registration, Twitter subscription) happens automatically on first run.

### CLI

```
bun run src/index.ts validate [--config <path>]     # verify config + state load
bun run src/index.ts run      [--config <path>] [--resubscribe]  # start daemon
bun run src/index.ts test-push --account <label> [--config <path>] [--message <text>] [--contact <mailto>]
```

## 7. Output

**stdout** — one JSON line per received notification:
```json
{"account":"main","received_at":"2026-05-09T19:00:00.000Z","persistent_id":"0:1714…","payload":{…}}
```
If the decrypted payload is valid JSON, it goes in `payload`. If not, `payload_b64` contains the base64url-encoded raw bytes instead.

**stderr** — structured log lines:
```
2026-05-09T19:00:00.000Z INFO  MCS login complete heartbeatIntervalMs=30000
2026-05-09T19:00:00.000Z ERROR MCS session error label="main" error="…"
2026-05-09T19:00:00.000Z WARN  decrypt failed; skipping label="main" persistent_id="0:…" error="…"
```

Log level respects `RUST_LOG` env var (debug output enabled if set to `"debug"`) or `DEBUG=true`.

## 8. Scripts

### `scripts/patch-proto-encoders.ts`

Post-processes the generated protobuf encoder files (`gen/mcs.ts`, `gen/checkin.ts`) after `ts-proto` runs.

**The problem it solves:** `ts-proto` generates encoder branches like:
```typescript
if (message.foo !== undefined && message.foo !== false) { writer.uint32(96).bool(message.foo); }
```
This is proto3-style default-value elision — it skips writing a field if its value equals the protobuf-declared default (false for bool, 0 for int, empty string for string). For a proto2 schema with explicit `optional` keywords (which the checkin and MCS protos use), this is wrong. Proto2 `optional` means the field should be *present* — the wire format distinguishes "not set" from "set to default value." The Rust port (using `prost`) correctly preserves all set fields regardless of value.

The script uses a regex to rewrite:
```
if (message.X !== undefined && message.X !== <constant>) { writer.… }
```
to:
```
if (message.X !== undefined) { writer.… }
```

This ensures byte-level wire compatibility with the Rust port — without it, the MCS server would reject our `LoginRequest` because fields like `adaptive_heartbeat = false` and `use_rmq2 = true` would be silently elided, making the client appear incomplete.
