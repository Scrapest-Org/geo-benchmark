# @scrapest/web-push — Technical Summary

## 1. What the App Does

This is a headless Bun daemon that receives real-time Twitter (X.com) push notifications through Mozilla's Autopush service (the Firefox-equivalent of FCM), decrypts them, and broadcasts the resulting events to downstream consumers over a TCP pub/sub channel. It impersonates a Firefox desktop browser by connecting to `wss://push.services.mozilla.com/` with the `push-notification` protocol, registers a VAPID key with Mozilla, links that endpoint to X via Twitter's notification API, and maintains the session with periodic check-ins. When a notification arrives, it decrypts the HTTP-E encrypted payload, extracts the tweet data, and immediately pushes it via `@scrapest/tcp-rpc` broadcast. A separate event emitter triggers a secondary path that fetches the full tweet payload via X GraphQL and broadcasts the enriched event. The service also manages user tracking (follow/unfollow) and session updates via BullMQ background workers.

## 2. Architecture Overview

The app is a single-process, single-threaded async daemon. It has no HTTP server of its own — it is a client to three external services (Mozilla Push, X/Twitter, Redis) and a server for TCP pub/sub.

```
┌──────────────────────────────────────────────────────────────────┐
│                         main.ts                                  │
│  entry point: init singletons, warm cache, start loop            │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────┐    ┌──────────────────────────────┐    │
│  │  webpush.ts         │    │  helpers.ts                  │    │
│  │  setup() / teardown │    │  UserCache (LRU + Redis)    │    │
│  │  - X auth           │    │  webpushQueue (BullMQ)       │    │
│  │  - WS init          │    └──────────────────────────────┘    │
│  │  - VAPID register   │                                        │
│  │  - X checkin loop   │    ┌──────────────────────────────┐    │
│  └─────────┬───────────┘    │  rpc.ts                      │    │
│            │                │  TcpRpcServer (port 4001)    │    │
│            ▼                │  EventEmitter (setMax 0)     │    │
│  ┌─────────────────────┐    └──────────────────────────────┘    │
│  │  ws.ts              │           │                           │
│  │  Mozilla WS client  │           │                           │
│  │  decryptData() emit │           │ broadcast / emit          │
│  └─────────┬───────────┘           │                           │
│            │                       ▼                           │
│            │           ┌──────────────────────────────┐        │
│            │           │  worker.ts                   │        │
│            │           │  internalEmitter.on()        │        │
│            │           │  → fetchXPost()              │        │
│            │           │  → broadcast full event      │        │
│            │           │                              │        │
│            │           │  mgmtWorker (BullMQ)         │        │
│            │           │  follow / unfollow / session │        │
│            └───────────┴──────────────────────────────┘        │
│                                                                  │
│  ┌─────────────────────┐                                         │
│  │  orchestration.ts   │                                         │
│  │  loginToX()         │                                         │
│  │  setupXPushConfig() │                                         │
│  └─────────────────────┘                                         │
│                                                                  │
│  External connections:                                            │
│    → wss://push.services.mozilla.com/  (Mozilla Autopush)        │
│    → https://x.com/                     (X API)                  │
│    → Redis                             (config, cache, queues)   │
│    ← TCP :4001                         (tcp-rpc clients)         │
└──────────────────────────────────────────────────────────────────┘
```

**Key design patterns:**
- **Singleton exports** — `tcpRpcServer` and `internalEmitter` are module-level singletons in `rpc.ts`, imported by both `ws.ts` and `worker.ts` so they share one TCP server and one EventEmitter within the same process
- **Fire-and-forget notification processing** — the Mozilla WS's `decryptData()` is called without `await` (via `.catch()`), and the downstream full-post fetch is driven by an EventEmitter rather than blocking the notification path
- **VM-scoped isolation** — each service instance is named via `VM_NAME` env var, which prefixes BullMQ queues (`{vm}-webpush`) and Redis keys (`config:{vm}`, `health:{vm}`, `claim:{vm}`)
- **Concurrency-limited webhooks** — downstream webhook delivery is rate-limited to 5 concurrent calls via `p-limit`

## 3. Data Flow

### Startup

1. **Module initialization** (`main.ts`):
   - `GuestTokenManager` and `XGraphQL` are instantiated for guest-based GraphQL queries
   - `AccountPoolManager` is created to claim X accounts from the pool
   - `TcpRpcServer` starts listening on port 4001 (via `rpc.ts` module-level `tcpRpcServer.listen()`)
   - `buildWorkers(gql, xRef)` registers the `internalEmitter.on("new-tweet")` listener and creates the `mgmtWorker` BullMQ worker for `${vm}-webpush` queue

2. **`main()` function**:
   - `await userCache.warmup()` — SCANs Redis for `uname_id:*` keys, bulk-fetches values via `mget`, populates the LRU cache
   - `await gtm.start()` — initializes guest token acquisition for X GraphQL
   - `await runWithAccount()` — claims an X account from the pool (with up to 5 retries), then calls `setup()`

3. **`setup()`** (`webpush.ts`):
   - Creates a `Config` instance (loads config from Redis key `config:{instanceId}`)
   - Initializes `Decrypt` with JWK + auth key from config (generates new ones if missing)
   - Creates `X` instance with stored cookies; if auth tokens missing, calls `loginToX()` which performs credential-based login to X and saves cookies
   - Creates `WS` instance and calls `initWebsocket()` to connect to Mozilla

4. **Mozilla WebSocket handshake** (`ws.ts`):
   - Connects to `wss://push.services.mozilla.com/` with `push-notification` protocol
   - On `open`: sends `hello` message with `uaid` (if resuming) or empty for new session
   - On `hello` response: captures `uaid` from server
   - Sends `register` message with VAPID public key
   - On `register` response: captures `pushEndpoint` (the FCM-style URL) and `channelID`

5. **X registration** (`webpush.ts` → `orchestration.ts`):
   - Once endpoint is received from Mozilla, calls `setupXPushConfig(x, ws, decrypt)` which POSTs to `x.com/i/api/1.1/notifications/login.json` with the endpoint, ECDH public key, and auth secret
   - Registers with X's periodic check-in system via `x.postNotificationsCheckin()` which keeps the push channel alive

6. **Health heartbeat** (`webpush.ts`):
   - Every 10 minutes, writes a JSON health status to Redis key `health:{instanceId}` with connection state, registration status, X auth status

### Receiving a Notification

1. **Mozilla WebSocket message** (`ws.ts` `onMessage`):
   - Receives `notification` message type containing encrypted payload, headers (`crypto_key`, `encryption`, `data`, `conftype`, `enc`), and metadata (`channelID`, `version`)

2. **Acknowledge** — sends `ack` message to Mozilla with channelID + version

3. **Decryption** (`ws.ts` `decryptData`):
   - Parses `crypto_key` header to extract ECDH public key (`dh`)
   - Parses `encryption` header to extract salt
   - Calls `decrypt.get_cek_and_nonce(dh, salt)` to derive the Content Encryption Key and nonce via ECDH + HKDF
   - Calls `decrypt.decrypt(CEK, NONCE, encryptedData)` to produce plaintext
   - Parses plaintext as JSON → `XPostData` with `tag`, `body`, `title`, `icon`, `data.uri`, `lang`, `timestamp`

4. **Tweet ID extraction**:
   - Strips non-digit prefix from `tag` (e.g. `"tweet-1234"` → `"1234"`) → `tweetId`
   - Computes snowflake timestamp from tweet ID: `(tweetId >> 22) & 0x1FFFFFFFFFF + 1288834974657` → `serverFrozenTime`

5. **Staleness check**: skips tweets older than 5 minutes

6. **User cache lookup**: calls `userCache.get(uname)` to resolve the author's X user ID (from LRU cache, warmed from Redis at startup)

7. **Build notification object** (`XPostNotification`):
   ```typescript
   { id, text, author: { name, screen_name, profile_image_url, id }, timestamp, url, lang }
   ```

8. **Fast dispatch** (`ws.ts`):
   - Creates `SourceEvent("fast-x", tweet, vm, sft)` — a minimal event with just the notification data
   - `tcpRpcServer.broadcast("dispatch-events", { payload: [tweetEvent] })` — pushes to all connected TCP-RPC clients immediately

9. **Full-post fetch trigger** (`ws.ts` → `worker.ts`):
   - `internalEmitter.emit("new-tweet", { tag, rcv: sft })` — fires the EventEmitter
   - The `internalEmitter.on("new-tweet")` listener (registered in `worker.ts` via `buildWorkers`) calls `gql.fetchXPost(tag)` using X GraphQL to retrieve the full tweet data
   - Creates `SourceEvent("x", fullTweet, vm, rcv)` with the complete payload
   - `tcpRpcServer.broadcast("dispatch-events", { payload: [se] })` — pushes the enriched event

### Management Operations (BullMQ)

The `mgmtWorker` processes jobs from the `${vm}-webpush` BullMQ queue:

- **`follow-user`** — called when an API consumer requests to track a new Twitter user: stores `username → id` in `UserCache` and Redis
- **`unfollow-user`** — calls `x.unfollowUser(id)` and `x.turnOffNotifications(id)` on X, removes from `UserCache`
- **`update-session`** — updates the in-memory X instance with fresh cookies

### Shutdown

- `SIGINT`/`SIGTERM` → `cleanup()`:
  1. Tears down Mozilla WS (unregisters, closes)
  2. Closes BullMQ workers and queues
  3. Stops TCP-RPC server
  4. Quits Redis
  5. Stops guest token manager
  6. Cleans up Redis keys (`health:{vm}`, `config:{vm}`, `claim:{vm}`, `in_use:{login}`)

## 4. Key Data Structures

### `SourceEvent` (from `@scrapest/core/resolvers`)
```typescript
{
  mid: string | number;       // message/tweet ID
  sid: string | number;       // source/author ID
  source: "x" | "fast-x";     // "fast-x" = minimal notification, "x" = full GraphQL fetch
  vmName: string;             // VM name for multi-region deployment
  timestamp: number;          // ms since epoch (server frozen time or receive time)
  payload: XPostNotification | ResolvedXPost;
}
```

### `XPostNotification` (from Mozilla push, decrypted)
```typescript
{
  id: string;
  text: string;
  author: { name, screen_name, profile_image_url, id };
  timestamp: number;
  url: string;                // "https://x.com/{user}/status/{id}"
  lang: string;
}
```

### `XPostData` (raw decrypted push payload)
```typescript
{
  tag: string;                // "tweet-{id}" or "tweet-{id}-{nonce}"
  body: string;               // tweet text
  title: string;              // author display name
  icon: string;               // profile image URL
  data: { uri, lang, impression_id, scribe_target, ... };
  timestamp: string;          // Unix ms as string
}
```

### `UserCache` (in-memory LRU + Redis dual-write)
```typescript
class UserCache {
  private cache: LRUCache<string, string>;  // max 50,000 entries
  // Key format: "uname_id:{lowercase_username}" → X user ID string
  // get(): checks LRU cache only (warmed via warmup())
  // set(): writes to both LRU and Redis
  // warmup(): SCANs Redis for "uname_id:*", populates LRU
}
```

### `AccountPoolManager` result
```typescript
{
  login: string;              // X screen name / login email
  // Contains X auth cookies, proxy config, instance metadata
}
```

### `Config` (from `@scrapest/config`)
```typescript
{
  config: {
    x: {
      cookies: { auth_token, ct0 };
      screen_name, password, authentication_secret, retry;
    };
    jwk: JsonWebKey;          // ECDH keys for push decryption
    auth: string;             // auth secret for push decryption
    autopush: {
      uaid, endpoint, channel_id, remote_settings__monitor_changes;
    };
  }
}
```

### Health check payload (Redis `health:{instanceId}`)
```typescript
{
  status: string;             // "indexing" | "syncing_mozilla" | "error_*"
  last_checkin: ISO string;
  next_checkin: ISO string;
  is_registered: boolean;
  ws_connected: boolean;
  x_authenticated: boolean;
  instance_id: string;
}
```

## 5. External Dependencies

| Service/Protocol | What the app does | Endpoint | Credentials |
|---|---|---|---|
| **Mozilla Autopush** | Persistent WebSocket for receiving push notifications. Protocol: `push-notification` over WSS. Messages: `hello`/`register`/`notification`/`ack`/`broadcast`. | `wss://push.services.mozilla.com/` | None (anonymous) — VAPID public key sent at register time |
| **X/Twitter API** | 4 distinct endpoints: (1) `login.json` — subscribe push endpoint to X, (2) `checkin.json` — periodic session keep-alive, (3) `logout.json` — unregister on shutdown, (4) GraphQL API — fetch full tweet data (`fetchXPost`), manage follows | `https://x.com/i/api/1.1/notifications/settings/login.json` + GraphQL endpoint | `auth_token` and `ct0` session cookies; hardcoded `TWITTER_BEARER` token |
| **X/Twitter (GraphQL)** | Guest-mode and authenticated GraphQL queries for fetching full tweet data, user profiles, community info | `https://x.com/i/api/graphql/...` | Guest token from `GuestTokenManager` or auth cookies from session |
| **X/Twitter (login)** | Credential-based login when session cookies expire | `https://x.com/i/api/...` | Username + password + optional authentication secret |
| **Redis** | Config storage (`config:{vm}`), health status (`health:{vm}`), user cache (`uname_id:*`), account claims (`claim:{vm}`, `in_use:{login}`), BullMQ queue backend | Local or configured via `@scrapest/config` | Via `@scrapest/config` singleton |
| **BullMQ** | Background job queue for management operations (follow/unfollow user, update session) | Redis-backed | Via `@scrapest/config` connection singleton |
| **@scrapest/tcp-rpc** | TCP-based pub/sub for broadcasting dispatch events to downstream consumers (e.g., the Express app server that delivers to WebSocket/SSE clients) | TCP port 4001 | None (internal) |

## 6. Config and Startup

### Required environment variables

| Variable | Purpose | Default |
|---|---|---|
| `VM_NAME` | Unique instance identifier (used for Redis keys, queue names, account claims) | **REQUIRED** — no default |
| `NODE_ENV` | Environment mode | `development` |

### Configuration storage

Unlike a local config file, this app stores its configuration in Redis under key `config:{vmName}`. The config is a JSON object containing:

- **X credentials** — cookies (`auth_token`, `ct0`), screen name, password, and retry count
- **Crypto keys** — JWK (ECDH key pair) and auth secret for Web Push decryption
- **Autopush state** — UAID, endpoint URL, channel ID from Mozilla

On first run (`setup()` in `webpush.ts`):
1. `AccountPoolManager.getAccount({ claimKey: vmName })` claims an X account from the pool (Redis-backed)
2. Config is loaded from Redis key `config:{vmName}`
3. If JWK is incomplete (missing private key `d`), a new ECDH key pair is generated and saved
4. If X cookies are missing, `loginToX()` performs credential-based login to X using the stored `screen_name`/`password` and saves the resulting cookies
5. Mozilla WS connection is established; on successful register, the endpoint/UAID/channelID are saved back to config

### Redis keys used

| Key | Purpose | TTL |
|---|---|---|
| `config:{vm}` | Full config JSON | Persistent |
| `health:{vm}` | Health status | 20 min (renewed every 10) |
| `claim:{vm}` | Account claim marker | Managed |
| `in_use:{login}` | Login in-use marker | Managed |
| `uname_id:{user}` | Username → X user ID mapping | Persistent |

### BullMQ queues

| Queue | Purpose |
|---|---|
| `{vm}-webpush` | Management jobs: follow-user, unfollow-user, update-session |

## 7. Output

The app does **not** write notifications to stdout — it broadcasts them over TCP to downstream consumers.

**TCP-RPC broadcast** (port 4001):
- Event name: `"dispatch-events"`
- Payload: `{ payload: SourceEvent[] }`
- Consumers: the Express app server (`@scrapest/app`) which runs a `TcpRpcClient` subscribed to `"dispatch-events"`. That app delivers the events to WebSocket and SSE clients, and fires webhooks.

**Two broadcast types per notification:**
1. **Fast event** (immediate) — `SourceEvent` with `source: "fast-x"`, containing only the notification-derived data (text, author name, icon, timestamp). Delivered first, low latency.
2. **Full event** (after GraphQL fetch) — `SourceEvent` with `source: "x"`, containing full tweet data (all entity fields, engagement metrics, etc.). Delivered seconds later.

**Console logging** (stderr):
- Connection lifecycle events (`~| Connected`, `🚨 Socket is stale`, `Connection Lost`)
- X authentication events (`*| Login successful`, `X| Check-in error`)
- Timing information for each notification (`post {id} >>{diff}ms>> autopush >>{diff}ms>> client`)
- Decrypt timing (`console.time("decrypt")` / `console.timeEnd("decrypt")`)

## 8. Test Scripts

### `test/graphql.ts`

A standalone diagnostic script (run with `bun run test/graphql.ts`) that exercises the `XGraphQL` class with three API calls:
- Fetches a user profile by screen name (`fetchUserProfile`)
- Fetches a tweet by ID (`fetchXPost`)
- Fetches a community by ID (`fetchCommunity`)

Each call is timed and results are printed to console. Used to verify that guest token acquisition and GraphQL queries are working independently of the push pipeline.

### `test/tcp-server.ts`

A standalone diagnostic script that creates a `TcpRpcServer` on port 4001 and broadcasts 10 sample dispatch events with 1-second delays. The payload is a fully-formed `SourceEvent` with realistic tweet data. Used to test the downstream TCP-RPC consumer (the Express app) without needing a live Mozilla WebSocket connection or X authentication.
