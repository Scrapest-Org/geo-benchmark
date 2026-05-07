import { Config, connection, opts, redis } from "@scrapest/config";
import { X, type XGraphQL } from "@scrapest/core";
import SourceEvent from "@scrapest/core/resolvers";
import { type Job, Worker } from "bullmq";
import { appQueue, userCache } from "./helpers";

interface XRef {
  current: X | null;
}

async function fetchXInstance(iid: string) {
  const raw = await redis.get(`config:${iid}`);
  if (!raw) throw new Error("Config not found");
  const parsed = JSON.parse(raw) as Config["config"];
  const cookies = parsed.x.cookies;
  return new X(cookies);
}

type MgmtJobNames = "unfollow-user" | "follow-user" | "update-session";

function buildWorkers(gql: XGraphQL, xRef: XRef, iid: string) {
  const postWorker = new Worker(
    "tweet",
    async (job: Job<any, any, "new-tweet">) => {
      const { tag, rcv } = job.data;

      const t = await gql.fetchXPost(tag);
      const se = new SourceEvent("x", t, iid, rcv);

      await appQueue.add(
        "dispatch-events",
        { payload: [se] },
        { ...opts, attempts: 3 },
      );
      console.log(`[${iid}] Worker processed full post: ${tag}`);
    },
    { connection, concurrency: 3 },
  );

  const mgmtWorker = new Worker(
    "webpush",
    async (job: Job<any, any, MgmtJobNames>) => {
      switch (job.name) {
        case "follow-user": {
          const { id, targetInstance, username } = job.data;
          if (targetInstance !== iid) return;

          const x = xRef.current ? xRef.current : await fetchXInstance(iid);

          await x.followUser(id);
          await x.turnOnNotifications(id);
          await userCache.set(username, id);
          break;
        }

        case "unfollow-user": {
          const { id, targetInstance, username } = job.data;
          if (targetInstance !== iid) return;

          const x = xRef.current ? xRef.current : await fetchXInstance(iid);
          await x.unfollowUser(id);
          await x.turnOffNotifications(id);
          await userCache.delete(username);
          break;
        }

        case "update-session": {
          const { cookies, targetInstance } = job.data;
          if (targetInstance !== iid) return;
          xRef.current = new X(cookies);
          break;
        }

        default:
          console.warn("Unknown job type:", job.name);
          break;
      }
    },
    { connection },
  );

  return { postWorker, mgmtWorker };
}

export default buildWorkers;
