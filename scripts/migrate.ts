import IoRedis from "ioredis";

async function main() {
  const oldUrl = process.env.OLD_REDIS_URL;
  const newUrl = process.env.REDIS_URL;

  if (!oldUrl) {
    throw new Error("OLD_REDIS_URL environment variable is required");
  }
  if (!newUrl) {
    throw new Error("REDIS_URL environment variable is required");
  }

  console.log("Connecting to Redis instances...");
  const oldRedis = new IoRedis(oldUrl, {
    maxRetriesPerRequest: null,
    tls: oldUrl.startsWith("rediss://") ? {} : undefined,
  });

  const newRedis = new IoRedis(newUrl, {
    maxRetriesPerRequest: null,
    tls: newUrl.startsWith("rediss://") ? {} : undefined,
  });

  console.log("Fetching conveyor4 list from old Redis...");
  const accounts = await oldRedis.lrange("conveyor4", 0, -1);
  console.log(`Found ${accounts.length} accounts in old conveyor4.`);

  let successCount = 0;
  let failCount = 0;

  for (const login of accounts) {
    try {
      const data = await oldRedis.hget("warehouse", login);
      
      if (!data) {
        console.warn(`⚠️ Warning: No warehouse data found for account ${login}`);
        failCount++;
        continue;
      }

      // To avoid duplicates in conveyor4 list in case script is run multiple times
      await newRedis.lrem("conveyor4", 0, login);

      await newRedis.pipeline()
        .hset("warehouse", login, data)
        .rpush("conveyor4", login)
        .exec();

      successCount++;
      if (successCount % 100 === 0) {
        console.log(`Migrated ${successCount} accounts...`);
      }
    } catch (e) {
      console.error(`❌ Error migrating account ${login}:`, e);
      failCount++;
    }
  }

  console.log("Migration completed!");
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);

  await oldRedis.quit();
  await newRedis.quit();
}

main().catch((e) => {
  console.error("Fatal error during migration:", e);
  process.exit(1);
});
