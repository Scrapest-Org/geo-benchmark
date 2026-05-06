import { redis } from "@scrapest/config";
import { KEYS, sourceMetricKeys } from "@scrapest/constants";
import pLimit from "p-limit";
import { SocketRegistry, SSERegistry, SSE_PUBLIC_AUTH } from "./ws";
import SourceEvent from "@scrapest/core/resolvers";
import { SourceMapping } from "./mapping";

export class InternalService {
  private limit = pLimit(5);

  private async broadcast(data: SourceEvent) {
    const source = data.source === "fast-x" ? "x" : data.source;
    const rk = SourceMapping.getRK(source, data.sid);
    const apikeys = await redis.smembers(rk);

    if (apikeys.length === 0) return;
    SocketRegistry.broadcast(apikeys, data);
    SSERegistry.broadcast([...apikeys, SSE_PUBLIC_AUTH], data);

    const wh_keys = apikeys.map((key) => `${KEYS.WEBHOOK}:${key}`);
    const webhooks = await redis.mget(...wh_keys);

    return webhooks.map((url) =>
      this.limit(async () => {
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
            await redis.hincrby(KEYS.STATS_KEY, "total_failed", 1);
          } else {
            await redis.hincrby(KEYS.STATS_KEY, "total_sent", 1);
          }
        } catch (e) {
          console.warn(`⚠️| Network error - ${url}: ${(e as Error).message}`);
          await redis.hincrby(KEYS.STATS_KEY, "total_failed", 1);
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

    const perSource = sourceMetricKeys(event.source);

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
    const results = await Promise.all(
      events.map(async (event) => {
        const DUP_KEY = `dup:${event.source}_${event.mid}_${event.sid}`;
        const isNew = await redis.set(DUP_KEY, "1", "EX", 1800, "NX");
        return isNew ? event : null;
      }),
    );

    const freshEvents = results.filter(Boolean) as SourceEvent[];
    if (freshEvents.length === 0) return;
    const nestedWebhookTasks = await Promise.all(
      freshEvents.map((event) => this.broadcast(event)),
    );

    const dispatchEnd = Date.now();
    const allWebhookTasks = nestedWebhookTasks.flat();

    try {
      await Promise.all([
        ...allWebhookTasks,
        ...freshEvents.map((e) =>
          this.recordMetrics(e, receivedAt, dispatchEnd),
        ),
        redis.hincrby(KEYS.STATS_KEY, "events_received", freshEvents.length),
        redis.hincrby(KEYS.STATS_KEY, "batches_completed", 1),
      ]);
    } catch (e) {
      console.error("Worker background task failed:", (e as Error).message);
    }
  }
}
