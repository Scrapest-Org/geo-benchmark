#!/usr/bin/env bun
import { GuestTokenManager, XGraphQL } from "@scrapest/core";
import { getEnv, redis } from "@scrapest/config";
import "@scrapest/core/utils/console";
import { userCache } from "./lib/user-cache";
import { tcpRpcClient } from "./lib/rpc";
import buildWorkers from "./lib/worker";
import { runWithAccount as _runWithAccount } from "./account";
import { TIME } from "@scrapest/constants";

const vm = getEnv("VM_NAME");

const gtm = new GuestTokenManager();
const gql = new XGraphQL(gtm);

const interval = setInterval(async () => {
  await redis.set(
    `health:${vm}_fcm`,
    JSON.stringify({
      status: "indexing",
      last_checkin: new Date().toISOString(),
    }),
    "EX",
    Math.floor((TIME._10MIN * 2) / 1000),
  );
}, TIME._10MIN);

async function runWithAccount(retries = 0): Promise<void> {
  if (retries > 5) {
    console.error("Exhausted account retries. Exiting.");
    process.exit(1);
  }
  try {
    await _runWithAccount();
  } catch (e) {
    console.error("FCM setup failed:", e);
    await Bun.sleep(5000);
    return runWithAccount(retries + 1);
  }
}

async function main() {
  console.log("🚀 Starting FCM Service...");

  await gtm.start();
  await userCache.warmup();
  buildWorkers(gql);

  await runWithAccount();
}

main().catch((err) => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});

tcpRpcClient.connect().catch(() => {
  console.warn("⚠️ App RPC not available yet, retrying...");
});

const cleanup = async () => {
  console.log("\n@FCM| Starting graceful shutdown...");
  const backupTimer = setTimeout(() => {
    console.error("Cleanup timed out, forcing exit.");
    process.exit(1);
  }, 8000);

  clearInterval(interval);
  tcpRpcClient.destroy();
  gtm.stop();

  const login = await redis.get(`claim:${vm}`);
  const keysToDel = [`health:${vm}_fcm`, `config:${vm}:fcm`, `claim:${vm}`];
  if (login) keysToDel.push(`in_use:${login}`);

  await redis.del(...keysToDel);
  await redis.quit();

  console.log("👋| FCM Service exited successfully.");
  clearTimeout(backupTimer);
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
