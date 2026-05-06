import type { Request, Response, NextFunction } from "express";
import { redis } from "@scrapest/config";

export const rateLimit = (limit = 2, windowInSeconds = 60) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as any).auth;
    if (auth?.isAdmin) {
      return next();
    }

    const identifier = auth?.apiKey || req.ip;
    const key = `rate_limit:${identifier}`;
    const now = Date.now();
    const windowStart = now - windowInSeconds * 1000;

    try {
      await redis.zremrangebyscore(key, 0, windowStart);
      const requestCount = await redis.zcard(key);

      if (requestCount >= limit) {
        return res.status(429).json({
          status: "error",
          error: "Too many requests. Please try again later.",
          retry_after: windowInSeconds,
        });
      }

      await redis
        .pipeline()
        .zadd(key, now, `${now}-${Math.random()}`)
        .expire(key, windowInSeconds)
        .exec();

      next();
    } catch (error) {
      console.error("Rate limit error:", error);
      next();
    }
  };
};
