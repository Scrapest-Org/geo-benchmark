import { connection, getEnv, opts, redis } from "@scrapest/config";
import { LRUCache } from "lru-cache";
import { Queue } from "bullmq";

class UserCache {
  private cache = new LRUCache<string, string>({
    max: 50_000, // adjust for RAM
  });

  private normalize = (str: string) => "uname_id:" + str.toLowerCase();

  async set(username: string, id: string) {
    const key = this.normalize(username);
    this.cache.set(key, id);

    await redis.set(key, id).catch((err) => {
      console.error(`Redis background set failed for ${key}:`, err);
    });
  }

  async delete(username: string) {
    const key = this.normalize(username);
    this.cache.delete(key);
    await redis.del(key);
  }

  clear = () => this.cache.clear();

  get(username: string) {
    const key = this.normalize(username);
    return this.cache.get(key) || null;
  }

  async warmup() {
    let cursor = "0";
    let count = 0;
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        "uname_id:*",
        "COUNT",
        1000,
      );
      cursor = nextCursor!;
      if (keys.length === 0) continue;
      const values = await redis.mget(...keys);
      for (let i = 0; i < keys.length; i++) {
        if (values[i]) {
          this.cache.set(keys[i]!, values[i]!);
          count++;
        }
      }
    } while (cursor !== "0");
    console.log(`[UserCache] warmed up ${count} entries`);
  }

  async bulk(users: { username: string; id: string }[]) {
    const pipeline = redis.pipeline();
    for (const { username, id } of users) {
      const key = this.normalize(username);
      this.cache.set(key, id);

      pipeline.set(key, id);
    }

    await pipeline.exec().catch((err) => {
      console.error("Redis bulk update failed:", err);
    });
  }
}

const userCache = new UserCache();
const vm = getEnv("VM_NAME");

const webpushQueue = new Queue(`${vm}-webpush`, {
  connection,
  defaultJobOptions: opts,
});

export { userCache, webpushQueue };
