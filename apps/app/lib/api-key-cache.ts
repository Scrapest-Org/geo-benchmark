import { redis } from "@scrapest/config";
import type { Redis } from "ioredis";

const cache = new Map<string, Set<string>>();

export { cache as ApiKeyCache };

export function addKey(rk: string, apiKey: string): void {
  if (!cache.has(rk)) cache.set(rk, new Set());
  cache.get(rk)!.add(apiKey);
}

export function removeKey(rk: string, apiKey: string): void {
  const set = cache.get(rk);
  if (!set) return;
  set.delete(apiKey);
  if (set.size === 0) cache.delete(rk);
}

export async function warmup(): Promise<void> {
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      "*:src:*",
      "COUNT",
      1000,
    );
    cursor = nextCursor!;
    if (keys.length === 0) continue;
    const members = await Promise.all(keys.map((k) => redis.smembers(k)));
    for (let i = 0; i < keys.length; i++) {
      if (members[i]!.length > 0) cache.set(keys[i]!, new Set(members[i]!));
    }
  } while (cursor !== "0");
  console.log(`[ApiKeyCache] warmed up — ${cache.size} source keys cached`);
}
