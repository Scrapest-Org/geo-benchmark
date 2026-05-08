import { redis } from "@scrapest/config";
import { KEYS, sourceMetricKeys } from "@scrapest/constants";
import pLimit from "p-limit";
import { SocketRegistry, SSERegistry, SSE_PUBLIC_AUTH } from "./ws";
import SourceEvent from "@scrapest/core/resolvers";
import { SourceMapping } from "./mapping";
import { ApiKeyCache } from "../lib/api-key-cache";

export class InternalService {
  private limit = pLimit(5);

  private async broadcast(data: SourceEvent) {
    const source = data.source === "fast-x" ? "x" : data.source;
    const rk = SourceMapping.getRK(source, data.sid);
    const apikeys = ApiKeyCache.get(rk);

    if (!apikeys?.size) return;
    SocketRegistry.broadcast([...apikeys], data);
    SSERegistry.broadcast([...apikeys, SSE_PUBLIC_AUTH], data);

    const wh_keys = [...apikeys].map((key) => `${KEYS.WEBHOOK}:${key}`);
    const webhooks = await redis.mget(...wh_keys);

    return webhooks.map((url) =>
      this.limit(async () => {
        const statsKey = `${KEYS.STATS_KEY}:${data.vmName}`;

        try {
          if (!url) return;
          const res = await fetch(url, {
            method: "POST",
            body: JSON.stringify(data),
            signal: AbortSignal.timeout(5000),
            headers: { "Content-Type": "application/json" },
          });

          if (!res.ok) {
            console.warn(`❌| Webhook [${res.status}] for ${url}`);
            await redis.hincrby(statsKey, "total_failed", 1);
          } else {
            await redis.hincrby(statsKey, "total_sent", 1);
          }
        } catch (e) {
          console.warn(`⚠️| Network error - ${url}: ${(e as Error).message}`);
          await redis.hincrby(statsKey, "total_failed", 1);
        }
      }),
    );
  }

  private async recordMetrics(
    event: SourceEvent,
    receivedAt: number,
    dispatchEnd: number,
  ) {
    const sourceLatency = receivedAt - event.timestamp;
    const internalLatency = dispatchEnd - receivedAt;
    const cutoff = dispatchEnd - 86400000;
    const member = (latency: number) => `${latency}:${event.mid}`;

    const perSource = sourceMetricKeys(event.source, event.vmName);

    await redis
      .pipeline()
      // Global latency
      .zadd(KEYS.METRICS_SOURCE_LATENCY, dispatchEnd, member(sourceLatency))
      .zadd(KEYS.METRICS_INTERNAL_LATENCY, dispatchEnd, member(internalLatency))
      .zremrangebyscore(KEYS.METRICS_SOURCE_LATENCY, 0, cutoff)
      .zremrangebyscore(KEYS.METRICS_INTERNAL_LATENCY, 0, cutoff)
      // Per-source latency
      .zadd(perSource.sourceLatency, dispatchEnd, member(sourceLatency))
      .zadd(perSource.internalLatency, dispatchEnd, member(internalLatency))
      .zremrangebyscore(perSource.sourceLatency, 0, cutoff)
      .zremrangebyscore(perSource.internalLatency, 0, cutoff)
      .exec();
  }

  public async handleDispatch(events: SourceEvent[]) {
    const receivedAt = Date.now();

    const nestedWebhookTasks = await Promise.all(
      events.map((event) => this.broadcast(event)),
    );

    const dispatchEnd = Date.now();
    const allWebhookTasks = nestedWebhookTasks.flat();

    try {
      const statsByVm = events.reduce(
        (acc, e) => {
          const vm = e.vmName || "";
          acc[vm] = (acc[vm] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      const statPromises = Object.entries(statsByVm).flatMap(([vm, count]) => {
        const statsKey = vm ? `${KEYS.STATS_KEY}:${vm}` : KEYS.STATS_KEY;
        return [
          redis.hincrby(statsKey, "events_received", count),
          redis.hincrby(statsKey, "batches_completed", 1),
        ];
      });

      await Promise.all([
        ...allWebhookTasks,
        ...events.map((e) => this.recordMetrics(e, receivedAt, dispatchEnd)),
        ...statPromises,
      ]);
    } catch (e) {
      console.error("Worker background task failed:", (e as Error).message);
    }
  }
}
