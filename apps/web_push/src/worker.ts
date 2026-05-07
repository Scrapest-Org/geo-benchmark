import { Config, connection, opts, redis } from "@scrapest/config";
import { X, type XGraphQL } from "@scrapest/core";
import SourceEvent from "@scrapest/core/resolvers";
import { type Job, Worker } from "bullmq";
import {
  appQueue,
  getAllUserInfo,
  userCache,
  type UserInfo,
  webpushQueue,
} from "./helpers";
import { randomJitter } from "@scrapest/core/utils";
import pLimit from "p-limit";

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

const MAX_DAILY_FOLLOWS = 30;

async function checkFollowLimit(accountId: string): Promise<boolean> {
  const today = new Date().toISOString().split("T")[0];
  const key = `webpush:follows:${accountId}:${today}`;
  const count = await redis.get(key);
  if (count && parseInt(count) >= MAX_DAILY_FOLLOWS) {
    return false;
  }
  return true;
}

async function incrementFollowCount(accountId: string) {
  const today = new Date().toISOString().split("T")[0];
  const key = `webpush:follows:${accountId}:${today}`;
  await redis.incr(key);
  await redis.expire(key, 86400 * 2); // Keep for 2 days
}

async function scheduleNextDayFollow(iid: string, accountId: string) {
  const baseDelay = 24 * 60 * 60 * 1000; // 24 hours
  const randomAdditional = Math.floor(Math.random() * (4 * 60 * 60 * 1000)); // up to 4 hours
  const delay = baseDelay + randomAdditional;

  console.log(
    `[${iid}] Daily follow limit reached for account ${accountId}. Rescheduling in ${Math.round(delay / 3600000)} hours.`,
  );
  await webpushQueue.add("sync-following", { targetInstance: iid }, { delay });
}

function createSyncFollowing(gql: XGraphQL, xRef: XRef, iid: string) {
  return async function syncFollowing(
    usersToProcess?: UserInfo[],
    retries = 3,
  ): Promise<void> {
    const users = usersToProcess || (await getAllUserInfo());
    if (!users.length) {
      console.info("No users to process.");
      return;
    }

    const x = xRef.current ? xRef.current : await fetchXInstance(iid);
    const accountId = x.cookies?.auth_token?.slice(-10) || iid;
    const readLimit = pLimit(10);
    const results = await Promise.allSettled(
      users.map((user) =>
        readLimit(() => gql.fetchFollowing(user.username, x.getHeaders())),
      ),
    );

    const successful = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);
    const toFollow = successful.filter((f) => !f.following);

    const failed = results
      .map((r, i) => (r.status === "rejected" ? users[i] : null))
      .filter((u): u is UserInfo => u !== null);

    if (toFollow.length) {
      let limitReached = false;
      const writeLimit = pLimit(3);
      await Promise.all(
        toFollow.map((f) =>
          writeLimit(async () => {
            if (limitReached) return;

            const canFollow = await checkFollowLimit(accountId);
            if (!canFollow) {
              limitReached = true;
              return;
            }

            try {
              await x.followUser(f.id);
              await incrementFollowCount(accountId);
              await x.turnOnNotifications(f.id);
              await Bun.sleep(randomJitter(1000, 500));
            } catch (e) {
              console.error(`[WEBPUSH] Failed to follow ${f.id}:`, e);
            }
          }),
        ),
      );

      if (limitReached) {
        await scheduleNextDayFollow(iid, accountId);
        return; // Exit early to avoid immediate retries on failed items
      }
    }

    if (failed.length > 0 && retries > 0) {
      const delay = 5000;
      console.warn(
        `${failed.length} users failed. Retrying in ${delay / 1000}s...`,
      );

      await Bun.sleep(delay);
      return syncFollowing(failed, retries - 1);
    }

    if (failed.length > 0) {
      console.error(
        `Permanent failure for ${failed.length} users after all retries.`,
      );
    }
    await userCache.bulk(successful);
  };
}

type MgmtJobNames =
  | "sync-following"
  | "unfollow-user"
  | "follow-user"
  | "update-session";

function buildWorkers(gql: XGraphQL, xRef: XRef, iid: string) {
  const syncFollowing = createSyncFollowing(gql, xRef, iid);

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
        case "sync-following": {
          const { targetInstance } = job.data;
          if (targetInstance !== iid) return;

          console.log(`[${iid}] Worker processing sync following`);
          await syncFollowing();
          break;
        }

        case "follow-user": {
          const { id, targetInstance, username } = job.data;
          if (targetInstance !== iid) return;

          const x = xRef.current ? xRef.current : await fetchXInstance(iid);
          const accountId = x.cookies?.auth_token?.slice(-10) || iid;

          const canFollow = await checkFollowLimit(accountId);
          if (!canFollow) {
            await scheduleNextDayFollow(iid, accountId);
            return;
          }

          await x.followUser(id);
          await incrementFollowCount(accountId);
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
