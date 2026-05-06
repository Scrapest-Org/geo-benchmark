import { Worker, type Job } from "bullmq";
import { connection, redis } from "@scrapest/config";
import { KEYS } from "@scrapest/constants";
import { prisma } from "../services/prisma";
import type { TrackedSource } from "@scrapest/prisma";
import type { InferSourceInfo } from "../services/tracking";
import { InternalService } from "../services/internal";

type TrackJob<T> = {
  source: TrackedSource;
  data: T;
  apiKey: string;
};

type JobNames =
  | "track-source"
  | "session-cleanup"
  | "claim-key"
  | "update-session-location"
  | "dispatch-events";

export const appWorker = new Worker(
  "app",
  async (job: Job<any, any, JobNames>) => {
    const internal = new InternalService();
    const { name, data } = job;
    switch (name) {
      case "session-cleanup": {
        const { userId } = data;
        const sessions = await prisma.authSession.findMany({
          where: { userId },
          orderBy: { lastSeenAt: "desc" },
          select: { id: true },
        });

        if (sessions.length > 3) {
          const toDelete = sessions.slice(3);
          await prisma.authSession.deleteMany({
            where: { id: { in: toDelete.map((s) => s.id) } },
          });
        }
        break;
      }
      case "track-source": {
        const { data, apiKey } = job.data as TrackJob<InferSourceInfo>;
        await prisma.trackedSourceMapping.create({
          data: {
            sourceInfoId: data.id,
            apiKey,
          },
        });
        break;
      }
      case "claim-key": {
        const { apiKey } = data as { apiKey: string };

        // Fetch all source IDs this key was tracking across all platforms
        const sources: Array<{ source: TrackedSource; redisKey: string }> = [
          { source: "X", redisKey: `x:key:${apiKey}` },
          { source: "DISCORD", redisKey: `discord:key:${apiKey}` },
          { source: "TELEGRAM", redisKey: `telegram:key:${apiKey}` },
        ];

        for (const { source, redisKey } of sources) {
          const externalIds = await redis.smembers(redisKey);
          for (const externalId of externalIds) {
            const sourceInfo = await prisma.sourceInfo.upsert({
              where: { source_externalId: { source, externalId } },
              update: {},
              create: { source, externalId },
              select: { id: true },
            });
            await prisma.trackedSourceMapping.upsert({
              where: {
                sourceInfoId_apiKey: {
                  sourceInfoId: sourceInfo.id,
                  apiKey,
                },
              },
              update: {},
              create: { sourceInfoId: sourceInfo.id, apiKey },
            });
          }
        }

        // Import webhook from Redis into the DB if it exists but isn't in DB yet
        const webhookUrl = await redis.get(`${KEYS.WEBHOOK}:${apiKey}`);
        if (webhookUrl) {
          const exists = await prisma.webhook.findFirst({
            where: { apiKey },
            select: { id: true },
          });
          if (!exists) {
            await prisma.webhook.create({
              data: { apiKey, url: webhookUrl, name: "Imported Webhook" },
            });
          }
        }

        break;
      }
      case "update-session-location": {
        const { sessionId, ip } = data;
        if (!ip || ip === "::1" || ip === "127.0.0.1") break;

        try {
          const res = await fetch(`http://ip-api.com/json/${ip}`);
          const json = (await res.json()) as any;
          if (json && json.status === "success") {
            const location = `${json.city}, ${json.country}`;
            await prisma.authSession.update({
              where: { id: sessionId },
              data: { location },
            });
          }
        } catch (err) {
          console.error(`[Geo] Failed to fetch location for IP ${ip}:`, err);
        }
        break;
      }
      case "dispatch-events": {
        const { payload } = data as { payload: any[] };
        if (!payload) throw new Error("No payload provided");

        await internal.handleDispatch(payload);
        break;
      }
      default:
        console.error(`Unknown job name: ${name}`);
        break;
    }
  },
  { connection, concurrency: 3 },
);

appWorker.on("failed", (job: Job | undefined, err: Error) => {
  console.error(`App Job ${job?.id} failed: ${err.message}`);
});
