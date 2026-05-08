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

  async get(username: string) {
    const key = this.normalize(username);

    const localValue = this.cache.get(key);
    if (localValue) return localValue;

    const redisValue = await redis.get(key);
    if (redisValue) {
      this.cache.set(key, redisValue);
      return redisValue;
    }

    return null;
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
const tweetQueue = new Queue(`${vm}-tweet`, {
  connection,
  defaultJobOptions: opts,
});
const appQueue = new Queue(`${vm}-app`, {
  connection,
  defaultJobOptions: opts,
});

export { userCache, webpushQueue, tweetQueue, appQueue };
