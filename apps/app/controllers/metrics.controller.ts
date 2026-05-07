import type { Request, Response } from "express";
import { handleError } from "../utils/express";
import type { AppService } from "../services/app";
import { redis } from "@scrapest/config";
import { KEYS, sourceMetricKeys } from "@scrapest/constants";
import { parse } from "valibot";

const parseLatencies = (raw: string[]) =>
  raw.map((m) => parseInt(m.split(":")[0] ?? "0", 10)).sort((a, b) => a - b);
const percentile = (sorted: number[], p: number) => {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
};

const latencyBucket = (sorted: number[]) => ({
  p50: percentile(sorted, 50),
  p95: percentile(sorted, 95),
  p99: percentile(sorted, 99),
});

export class MetricsController {
  constructor(private readonly app: AppService) {}

  public health = async (_req: Request, res: Response) => {
    try {
      const appHealth = await this.app.health();

      const response = {
        ...appHealth,
        timestamp: new Date().toISOString(),
      };

      const isHealthy = appHealth.status === "healthy";
      res.status(isHealthy ? 200 : 207).json(response);
    } catch (error) {
      return handleError(res, error, 503);
    }
  };

  public metrics = async (_req: Request, res: Response) => {
    try {
      const windowMs = 24 * 60 * 60 * 1000;
      const since = Date.now() - windowMs;

      const [sourceRaw, internalRaw] = await Promise.all([
        redis.zrangebyscore(KEYS.METRICS_SOURCE_LATENCY, since, "+inf"),
        redis.zrangebyscore(KEYS.METRICS_INTERNAL_LATENCY, since, "+inf"),
      ]);

      const source = parseLatencies(sourceRaw);
      const internal = parseLatencies(internalRaw);

      res.status(200).json({
        window_hours: 24,
        count: { source: source.length, internal: internal.length },
        source_latency_ms: latencyBucket(source),
        internal_latency_ms: latencyBucket(internal),
      });
    } catch (error) {
      return handleError(res, error);
    }
  };

  public metricsBySource = async (req: Request, res: Response) => {
    try {
      const source = req.params.source as string;
      const vm = req.params.vm as string;

      const windowMs = 24 * 60 * 60 * 1000;
      const since = Date.now() - windowMs;
      const keys = sourceMetricKeys(source, vm);

      const [sourceRaw, internalRaw] = await Promise.all([
        redis.zrangebyscore(keys.sourceLatency, since, "+inf"),
        redis.zrangebyscore(keys.internalLatency, since, "+inf"),
      ]);

      const sourceLat = parseLatencies(sourceRaw);
      const internalLat = parseLatencies(internalRaw);

      res.status(200).json({
        source,
        window_hours: 24,
        count: { source: sourceLat.length, internal: internalLat.length },
        source_latency_ms: latencyBucket(sourceLat),
        internal_latency_ms: latencyBucket(internalLat),
      });
    } catch (error) {
      return handleError(res, error);
    }
  };

  public healthStatus = async (_req: Request, res: Response) => {
    try {
      const data = await this.app.healthStatus();
      res.status(200).json(data);
    } catch (error) {
      return handleError(res, error, 503);
    }
  };
}
