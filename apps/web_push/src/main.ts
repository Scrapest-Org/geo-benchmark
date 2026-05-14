import { setup, teardown, x } from "./webpush";
import { redis, getEnv } from "@scrapest/config";
import { AccountPoolManager, X, type Account, TXID } from "@scrapest/core";
import "@scrapest/core/utils/console";
import { userCache, webpushQueue } from "./helpers";
import { GuestTokenManager, XGraphQL } from "@scrapest/core";
import { appClient } from "./rpc";
import buildWorkers from "./worker";
import { TIME } from "@scrapest/constants";

const gtm = new GuestTokenManager();
const gql = new XGraphQL(gtm);

const pool = new AccountPoolManager("conveyor3");
const vmName = getEnv("VM_NAME");
const xRef = { current: null as X | null };

async function runWithAccount(retries = 0): Promise<void> {
  if (retries > 5) {
    console.error("Exhausted account retries. Exiting.");
    process.exit(1);
  }

  let acc: Account;
  try {
    acc = await pool.getAccount({ claimKey: vmName });
    console.log(
      `*| [${vmName}] [Attempt ${retries + 1}] Setting up account: ${acc.login}`,
    );
  } catch (e) {
    console.error("Failed to pull account from pool:", e);
    await Bun.sleep(TIME.SECOND * 5);
    return runWithAccount(retries + 1);
  }

  try {
    await setup(acc, vmName);
    await TXID.waitForHealthy({ context: `WEBPUSH_${vmName}` });

    xRef.current = x;
    await webpushQueue.add("update-session", {
      cookies: x!.cookies,
    });
  } catch (e) {
    console.error(`X| Setup failed for ${acc.login}:`, e);
    await teardown(vmName);
    return runWithAccount(retries + 1);
  }
}

const { mgmtWorker } = buildWorkers(gql, xRef);
async function main() {
  console.log("🚀 Starting Web Push Service...");

  await userCache.warmup();
  await gtm.start();
  await runWithAccount();
}
appClient.connect().catch(() => {
  console.warn("⚠️ App RPC not available yet, retrying...");
});
main().catch((err) => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});

const cleanup = async () => {
  console.log("\n@WP| Starting graceful shutdown...");
  const backupTimer = setTimeout(() => {
    console.error("Cleanup timed out, forcing exit.");
    process.exit(1);
  }, 8000);

  await Promise.all([
    teardown(vmName),
    mgmtWorker.close(),
    webpushQueue.close(),
  ]);

  appClient.destroy();
  await redis.quit();
  gtm.stop();

  console.log("👋| Web Push Service exited successfully.");
  clearTimeout(backupTimer);
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
