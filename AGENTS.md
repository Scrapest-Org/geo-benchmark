# AGENTS.md

> AI Agent Guidelines for Scrapest

---

## Core Principles

1. **Be concise** — sacrifice grammar for brevity
2. **Respect architecture** — never bypass AccountPoolManager or BullMQ patterns
3. **Use path aliases** — `@scrapest/*` over relative imports
4. **No hardcoded secrets** — use `@scrapest/constants` for tokens/keys

---

## TypeScript Guidelines

- TypeScript strict mode enabled
- Target: ESNext
- Prefer `async/await` but promise chains are acceptable
- Match error handling patterns in surrounding code

## Import Conventions

```typescript
// Good
import { something } from "@scrapest/core";
import { API_URLS } from "@scrapest/constants";

// Bad
import { something } from "../../../core";
```

---

## Testing

- Run: `bun test`
- Use Bun native test runner
- Place tests alongside source or in `__tests__/`
- Write tests when implementing features

---

## Before Running Code Changes

1. Run linting: check `bun run format` or similar
2. Run typecheck: look for `bun run typecheck` in package.json
3. Run tests: `bun test`

---

## Redis Patterns

| Pattern               | Purpose                   |
| --------------------- | ------------------------- |
| `health:{instanceId}` | Shard health (TTL: 10min) |
| `config:*`            | Account configs           |
| `bucket:x`            | Tracked X user IDs        |
| `last_x_post:<uid>`   | Latest post ID per user   |
| `api_keys`            | Valid API keys set        |
| `metrics:latency:*`   | Latency metrics           |
| `dispatch:stats`      | Dispatch event stats      |

---

## API Conventions

- All user-facing endpoints require `x-api-key` header
- Dashboard routes use JWT (via jose)
- Admin endpoints require `ADMIN_KEY` env var

---

## Critical Architecture Rules

1. **Never bypass AccountPoolManager** — handles 3000+ X accounts for rate-limit avoidance
2. **web_push + web_poll are complementary** — run simultaneously
3. **All heavy async goes through BullMQ** — never inline heavy async in request handlers
4. **3 web_push shards** in prod (GB/US/KW proxies)

---

## Database

- PostgreSQL via Prisma 7 with `@prisma/adapter-pg`
- Migrations: `bun run migrate`
- Client gen: `bun run generate`

---

## Key Files

- `packages/core/` — X (Twitter) integration, AccountPoolManager, GuestTokenManager
- `packages/constants/` — BEARER_TOKENS, API_URLS, KEYS
- `packages/prisma/schema.prisma` — all data models

---

## When Uncertain

- Check existing code patterns in the same file/directory
- Refer to CLAUDE.md for project overview
- Ask user before making architectural changes
