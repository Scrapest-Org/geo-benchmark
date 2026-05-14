import { redis } from "@scrapest/config";
import AccountPoolManager from "@scrapest/core/app/account-pool-manager";
import pLimit from "p-limit";

const CONVEYOR_KEY = "conveyor";
const pool = new AccountPoolManager(CONVEYOR_KEY);
const limit = pLimit(10);

async function main() {
  // Get all unique logins from the conveyor
  const allLogins = await redis.lrange(CONVEYOR_KEY, 0, -1);
  const uniqueLogins = [...new Set(allLogins)];
  console.log(
    `🔄 ${allLogins.length} entries in "${CONVEYOR_KEY}" (${uniqueLogins.length} unique)\n`,
  );

  const valid: string[] = [];
  const invalid: string[] = [];
  const errors: string[] = [];

  const tasks = uniqueLogins.map((login) =>
    limit(async () => {
      try {
        const raw = await redis.hget("warehouse", login);
        if (!raw) {
          errors.push(login);
          console.log(`⚠️  ${login} (not in warehouse)`);
          return;
        }

        const account = JSON.parse(raw);
        const isValid = await pool.validate(account);

        if (isValid) {
          valid.push(login);
          console.log(`✅ ${login}`);
        } else {
          invalid.push(login);
          console.log(`❌ ${login}`);
        }
      } catch (e: any) {
        invalid.push(login);
        console.log(`❌ ${login} — ${e.message}`);
      }
    }),
  );

  await Promise.all(tasks);

  console.log("\n--- Validation Results ---");
  console.log(`✅ Valid:   ${valid.length}`);
  console.log(`❌ Invalid: ${invalid.length}`);
  if (errors.length > 0) console.log(`⚠️  Errors:  ${errors.length}`);

  if (invalid.length > 0) {
    console.log(`\nInvalid accounts:\n  ${invalid.join("\n  ")}`);
  }

  await redis.rpush("conveyor3", ...valid);

  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
