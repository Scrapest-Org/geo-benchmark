import { redis } from "@scrapest/config";
import type { SourceType } from "@scrapest/core/resolvers";

export class SourceMapping {
  constructor(private name: SourceType) {}

  private key(apiKey: string) {
    return `${this.name}:key:${apiKey}`;
  }

  private reverseKey(sourceId: string | number) {
    return `${this.name}:src:${sourceId}`;
  }

  async isGloballyTracked(sourceId: string | number) {
    const count = await redis.scard(this.reverseKey(sourceId));
    return count > 0;
  }

  async track(apiKey: string, sourceId: string | number) {
    const k = this.key(apiKey);
    const rk = this.reverseKey(sourceId);

    await redis.pipeline().sadd(k, sourceId.toString()).sadd(rk, apiKey).exec();
    return await this.isGloballyTracked(sourceId);
  }

  async untrack(apiKey: string, sourceId: string | number) {
    const k = this.key(apiKey);
    const rk = this.reverseKey(sourceId);

    await redis.pipeline().srem(k, sourceId.toString()).srem(rk, apiKey).exec();
    return await this.isGloballyTracked(sourceId);
  }

  async getTracked(apiKey: string) {
    return await redis.smembers(this.key(apiKey));
  }

  async getTrackers(sourceId: string | number) {
    return await redis.smembers(this.reverseKey(sourceId));
  }

  static getRK(source: SourceType, sourceId: string | number) {
    return `${source}:src:${sourceId}`;
  }
}
