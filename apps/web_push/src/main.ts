import { setup, teardown, x } from "./webpush";
import { redis, getEnv } from "@scrapest/config";
import { AccountPoolManager, X, type Account, TXID } from "@scrapest/core";
import "@scrapest/core/utils/console";
import { webpushQueue, tweetQueue } from "./helpers";
import { GuestTokenManager, XGraphQL } from "@scrapest/core";
import buildWorkers from "./worker";
import { TIME } from "@scrapest/constants";

const gtm = new GuestTokenManager();
const gql = new XGraphQL(gtm);

const pool = new AccountPoolManager("conveyor4");
const instanceId = getEnv("INSTANCE_ID");
const xRef = { current: null as X | null };

async function runWithAccount(retries = 0): Promise<void> {
  if (retries > 5) {
    console.error("Exhausted account retries. Exiting.");
    process.exit(1);
  }

  let acc: Account;
  try {
    acc = await pool.getAccount({ claimKey: instanceId });
    console.log(
      `*| [${instanceId}] [Attempt ${retries + 1}] Setting up account: ${acc.login}`,
    );
  } catch (e) {
    console.error("Failed to pull account from pool:", e);
    await Bun.sleep(TIME.SECOND * 5);
    return runWithAccount(retries + 1);
  }

  try {
    await setup(acc, instanceId);
    await TXID.waitForHealthy({ context: `WEBPUSH_${instanceId}` });

    xRef.current = x;
    await webpushQueue.add("update-session", {
      cookies: x!.cookies,
      targetInstance: instanceId,
    });
    await webpushQueue.add("sync-following", { targetInstance: instanceId });
  } catch (e) {
    console.error(`X| Setup failed for ${acc.login}:`, e);
    await teardown(instanceId);
    return runWithAccount(retries + 1);
  }
}

const { postWorker, mgmtWorker } = buildWorkers(gql, xRef, instanceId);
async function main() {
  console.log("🚀 Starting Web Push Service...");

  await gtm.start();
  await runWithAccount();
}

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
    teardown(instanceId),
    postWorker.close(),
    mgmtWorker.close(),
    tweetQueue.close(),
    webpushQueue.close(),
  ]);

  await redis.quit();
  gtm.stop();

  console.log("👋| Web Push Service exited successfully.");
  clearTimeout(backupTimer);
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
