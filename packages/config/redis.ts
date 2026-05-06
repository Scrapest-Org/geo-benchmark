import IoRedis from "ioredis";
import { getEnv } from "./utils";
import type { JobsOptions } from "bullmq";

const redisUrl = getEnv("REDIS_URL");
export const redis = new IoRedis(redisUrl, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  connectTimeout: 10000,
  tls: redisUrl.startsWith("rediss://") ? {} : undefined,
});

export const connection = { url: redisUrl };

export const opts: JobsOptions = {
  attempts: 10,
  backoff: {
    type: "exponential",
    delay: 5000,
  },
  removeOnComplete: true,
  removeOnFail: { age: 24 * 3600 },
};
