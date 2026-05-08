import { Config, connection, getEnv, opts, redis } from "@scrapest/config";
import { X, type XGraphQL } from "@scrapest/core";
import SourceEvent from "@scrapest/core/resolvers";
import { type Job, Worker } from "bullmq";
import { appQueue, userCache } from "./helpers";

interface XRef {
  current: X | null;
}

const vm = getEnv("VM_NAME");

async function fetchXInstance() {
  const raw = await redis.get(`config:${vm}`);
  if (!raw) throw new Error("Config not found");
  const parsed = JSON.parse(raw) as Config["config"];
  const cookies = parsed.x.cookies;
  return new X(cookies);
}

type MgmtJobNames = "unfollow-user" | "follow-user" | "update-session";

function buildWorkers(gql: XGraphQL, xRef: XRef) {
  const postWorker = new Worker(
    `${vm}-tweet`,
    async (job: Job<any, any, "new-tweet">) => {
      const { tag, rcv } = job.data;

      const t = await gql.fetchXPost(tag);
      const se = new SourceEvent("x", t, vm, rcv);

      await appQueue.add(
        "dispatch-events",
        { payload: [se] },
        { ...opts, attempts: 3 },
      );
      console.log(`[${vm}] Worker processed full post: ${tag}`);
    },
    { connection, concurrency: 3 },
  );

  const mgmtWorker = new Worker(
    `${vm}-webpush`,
    async (job: Job<any, any, MgmtJobNames>) => {
      switch (job.name) {
        case "follow-user": {
          const { id, username } = job.data;

          console.log(`[${vm}] Following user ${username} (${id})`);
          // const x = xRef.current ? xRef.current : await fetchXInstance(iid);

          // await x.followUser(id);
          // await x.turnOnNotifications(id);
          await userCache.set(username, id);
          break;
        }

        case "unfollow-user": {
          const { id, username } = job.data;

          const x = xRef.current ? xRef.current : await fetchXInstance();
          await x.unfollowUser(id);
          await x.turnOffNotifications(id);
          await userCache.delete(username);
          break;
        }

        case "update-session": {
          const { cookies } = job.data;
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
