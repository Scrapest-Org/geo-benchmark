import { type Config, redis, opts } from "@scrapest/config";
import { KEYS } from "@scrapest/constants";
import { GuestTokenManager, X, XGraphQL, XGraphQLSearch } from "@scrapest/core";
import { webpushQueue } from "../utils/queues";
import { appWorker } from "../workers/app.worker";

export class AppService {
  private cookies: XConfig["cookies"] | null;
  private gtm!: GuestTokenManager;
  public gql!: XGraphQL;
  private search!: XGraphQLSearch;

  private readonly shards = ["web-push-1", "web-push-2", "web-push-3"] as const;

  constructor() {
    this.cookies = null;
  }

  async stop() {
    await appWorker.close();
    this.gtm.stop();
  }

  async initialize() {
    this.gtm = new GuestTokenManager();
    await this.gtm.start();

    this.gql = new XGraphQL(this.gtm);
    this.search = new XGraphQLSearch(this.gtm);
  }

  private async getX() {
    if (this.cookies) return new X(this.cookies);

    const keysToTry = [...this.shards.map((id) => `config:${id}`), "config"];
    const configs = await redis.mget(keysToTry);

    for (const raw of configs) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as Config["config"];
        if (parsed.x?.cookies?.auth_token) {
          this.cookies = parsed.x.cookies;
          return new X(this.cookies);
        }
      } catch (e) {
        continue;
      }
    }

    throw new Error(
      "No valid shard or global configuration found in Redis. All racers might be down.",
    );
  }

  public async getUser(username: string) {
    return await this.gql.fetchUserProfile(username);
  }

  public async getPost(postId: string) {
    return await this.gql.fetchXPost(postId);
  }

  public async searchPosts(query: string, count = 20, cursor?: string) {
    const x = await this.getX();
    return await this.search.search(query, x.getHeaders(), count, cursor);
  }

  public async quickSearch(query: string, resultTypes?: string[]) {
    const x = await this.getX();
    return await this.search.quickSearch(
      query,
      x.getHeaders(),
      resultTypes as any,
    );
  }

  public async checkUser(username: string) {
    const x = await this.getX();
    return await this.gql.fetchFollowing(username, x.getHeaders());
  }

  public async enqueueFollow(id: string, username: string) {
    await Promise.all(
      this.shards.map((shardId) =>
        webpushQueue.add(
          "follow-user",
          {
            id,
            username,
            targetInstance: shardId,
          },
          opts,
        ),
      ),
    );
  }

  public async enqueueUnfollow(id: string, username: string) {
    await Promise.all(
      this.shards.map((shardId) =>
        webpushQueue.add(
          "unfollow-user",
          {
            id,
            username,
            targetInstance: shardId,
          },
          opts,
        ),
      ),
    );
  }

  private async getKeys(suffix: string = "") {
    const key = "health:" + suffix;
    const healthKeys = [];
    let cursor = "0";

    do {
      const result = await redis.scan(
        cursor,
        "MATCH",
        `${key}*`,
        "COUNT",
        2000,
      );
      cursor = result[0];
      healthKeys.push(...result[1]);
    } while (cursor !== "0");

    return healthKeys;
  }

  private async getAllFleetHealth() {
    const healthKeys = await this.getKeys();
    if (!healthKeys.length) return { shards: [], activeCount: 0 };

    const healthData = await redis.mget(healthKeys);
    const shards = [];

    let activeCount = 0;
    for (let i = 0; i < healthKeys.length; i++) {
      const healthDataItem = healthData[i];
      if (!healthDataItem) continue;

      try {
        const health = JSON.parse(healthDataItem);
        const isActive =
          health && !(health.status as string).startsWith("error");

        if (isActive) activeCount++;

        const shardData: any = {
          id: `shard-${i + 1}`,
          status: health?.status || "offline",
        };

        shards.push(shardData);
      } catch (e) {
        continue;
      }
    }

    return { shards, activeCount };
  }

  public async dispatchHealth() {
    const stats = await redis.hgetall(KEYS.STATS_KEY);

    const success = parseInt(stats.total_sent || "0");
    const failure = parseInt(stats.total_failed || "0");
    const batches = parseInt(stats.batches_completed || "0");

    const total = success + failure;
    const successRate =
      total > 0 ? ((success / total) * 100).toFixed(2) : "100";

    return {
      status: parseFloat(successRate) > 80 ? "healthy" : "degraded",
      metrics: {
        total_processed: total,
        success_count: success,
        failure_count: failure,
        success_rate: `${successRate}%`,
        batches_completed: batches,
      },
    };
  }

  public async health() {
    const { activeCount, shards } = await this.getAllFleetHealth();

    let status: "healthy" | "degraded" | "critical";
    if (activeCount === shards.length && shards.length > 0) {
      status = "healthy";
    } else if (activeCount >= shards.length / 2) {
      status = "degraded";
    } else {
      status = "critical";
    }

    return {
      status,
      fleet: {
        active: activeCount,
        total: shards.length,
        shards,
      },
    };
  }

  public async healthStatus() {
    const [xKeys, [discordKey]] = await Promise.all([
      this.getKeys("web"),
      this.getKeys("discord"),
    ]);

    const [xRaw, discord, total_sent] = await Promise.all([
      redis.mget(xKeys),
      discordKey ? redis.get(discordKey) : null,
      redis.hget("dispatch:stats", "total_sent"),
    ]);

    const xHealths: Array<WebPushHealth | WebPollHealth | null> = xRaw.map(
      (raw) => (raw ? JSON.parse(raw) : null),
    );
    const statuses = xHealths
      .filter((h): h is WebPushHealth | WebPollHealth => h !== null)
      .map((h) => h.status);

    const priority = { error: 3, initializing: 2, syncing: 1, indexing: 0 };
    const xStatus = statuses.reduce(
      (worst, current) =>
        priority[current as keyof typeof priority] >
        priority[worst as keyof typeof priority]
          ? current
          : worst,
      "indexing",
    );

    const discordHealth: DiscordHealth | null = discord
      ? JSON.parse(discord)
      : null;

    return {
      x: xStatus,
      discord: discordHealth?.status ?? "offline",
      telegram: "offline",
      reddit: "coming soon",
      total_sent: Number(total_sent),
    };
  }

  public async getXUserByID(xuid: string) {
    const { posts } = await this.gql.fetchXUserPosts(xuid);
    if (!posts.length) return null;
    return posts[0]?.author || null;
  }
}
