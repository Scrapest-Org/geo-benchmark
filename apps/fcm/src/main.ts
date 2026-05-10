#!/usr/bin/env bun
import { GuestTokenManager, XGraphQL } from "@scrapest/core";
import { getEnv, redis } from "@scrapest/config";
import { userCache } from "./lib/user-cache";
import { tcpRpcClient } from "./lib/rpc";
import buildWorkers from "./lib/worker";
import { runWithAccount } from "./account";

const vm = getEnv("VM_NAME");

const gtm = new GuestTokenManager();
const gql = new XGraphQL(gtm);

await gtm.start();
await userCache.warmup();
buildWorkers(gql);

await tcpRpcClient.connect().catch(() => {
  console.warn("⚠️ App RPC not available yet, retrying...");
});

setInterval(async () => {
  await redis.set(
    `health:${vm}_fcm`,
    JSON.stringify({ status: "running", last_checkin: new Date().toISOString() }),
    "EX",
    1200,
  );
}, 600_000);

await runWithAccount();
