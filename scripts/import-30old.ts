import { readFileSync } from "fs";
import { resolve } from "path";
import IoRedis from "ioredis";
import { redis } from "@scrapest/config";

const CONVEYOR_KEY = "conveyor";
const WAREHOUSE_KEY = "warehouse";

type Account = {
  [K in
    | "login"
    | "password"
    | "mail"
    | "passwordmail"
    | "CT0"
    | "2FA"
    | "AUTH_TOKEN"
    | "createdAt"
    | "proxy"]: string;
} & {
  status: "active" | "inactive" | "new" | "error";
};

function parseLine(line: string): Account | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Format: user:pass:mail:mailpass:2fa:ct0:authtoken
  const parts = trimmed.split(":");
  if (parts.length !== 7) {
    console.warn(
      `⚠️ Skipping malformed line (${parts.length} parts): ${trimmed.slice(0, 40)}...`,
    );
    return null;
  }

  const [login, password, mail, passwordmail, twoFA, ct0, authToken] = parts;

  return {
    login: login!,
    password: password!,
    mail: mail!,
    passwordmail: passwordmail!,
    CT0: ct0!,
    "2FA": twoFA!,
    AUTH_TOKEN: authToken!,
    createdAt: new Date().toISOString(),
    proxy: "",
    status: "new",
  };
}

async function main() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL environment variable is required");
  }

  const filePath = resolve(import.meta.dir, "30old.txt");
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());

  console.log(`📄 Read ${lines.length} lines from 30old.txt`);

  let success = 0;
  let skipped = 0;

  for (const line of lines) {
    const account = parseLine(line);
    if (!account) {
      skipped++;
      continue;
    }

    try {
      await redis.lrem(CONVEYOR_KEY, 0, account.login);

      await redis
        .pipeline()
        .hset(WAREHOUSE_KEY, account.login, JSON.stringify(account))
        .rpush(CONVEYOR_KEY, account.login)
        .exec();

      success++;
      console.log(`✅ ${account.login}`);
    } catch (e) {
      console.error(`❌ Failed to import ${account.login}:`, e);
      skipped++;
    }
  }

  // Final stats
  const warehouseSize = await redis.hlen(WAREHOUSE_KEY);
  const conveyorSize = await redis.llen(CONVEYOR_KEY);

  console.log("\n--- Import Complete ---");
  console.log(`✅ Imported: ${success}`);
  console.log(`⚠️ Skipped:  ${skipped}`);
  console.log(`📦 Warehouse total: ${warehouseSize}`);
  console.log(`🔄 ${CONVEYOR_KEY} total: ${conveyorSize}`);

  await redis.quit();
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
