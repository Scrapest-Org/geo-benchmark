import { redis } from "@scrapest/config";
import { generateTOTP } from "@scrapest/core/utils/encrypt-decrypt";
import { type Account } from "@scrapest/core";
import readline from "readline";

const SOURCE_CONVEYOR = "conveyor3";
const WAREHOUSE_KEY = "warehouse";

async function main() {
  console.log(`\n🚀 Account Token Updater (${SOURCE_CONVEYOR})`);
  console.log("─".repeat(60));

  let logins = await redis.lrange(SOURCE_CONVEYOR, 0, -1);

  if (logins.length === 0) {
    console.error(`❌ No accounts found in ${SOURCE_CONVEYOR}.`);
    process.exit(1);
  }

  // Prioritize account if it exists
  // const priorityLogin = "ebtaco63866";
  // if (logins.includes(priorityLogin)) {
  //   logins = [priorityLogin, ...logins.filter((l) => l !== priorityLogin)];
  // }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query: string) =>
    new Promise<string>((resolve) => rl.question(query, resolve));

  const updatedAccounts: string[] = [];

  for (const login of logins) {
    const raw = await redis.hget(WAREHOUSE_KEY, login);
    if (!raw) {
      console.warn(`⚠️ Skipping ${login} — not found in warehouse`);
      continue;
    }

    const account = JSON.parse(raw) as Account;
    const secret = account["2FA"];

    if (!secret) {
      console.warn(`⚠️ Skipping ${login} — no 2FA secret found`);
      continue;
    }

    console.log(`\n👤 Login:    ${login}`);
    console.log(`🔑 Password: ${account.password}`);
    console.log(`🛡️  2FA Code: Loading...`);
    console.log(""); // Space for the prompt

    // Dynamic 2FA display using ANSI escape codes
    let stop2FA = false;
    const display2FA = async () => {
      while (!stop2FA) {
        const totp = generateTOTP(secret);
        const secondsToExpiry = 30 - (Math.floor(Date.now() / 1000) % 30);
        // Save cursor, move up 2 lines, clear line, print 2FA, restore cursor
        process.stdout.write(
          `\x1b[s\x1b[2A\x1b[2K\r🛡️  2FA Code: ${totp} (Expires in ${secondsToExpiry}s)\x1b[u`,
        );
        await new Promise((r) => setTimeout(r, 1000));
      }
    };

    const task = display2FA();

    const status = await question("Successful? (y/n/q): ");
    stop2FA = true;
    await task;

    if (status.toLowerCase() === "q") break;
    if (status.toLowerCase() !== "y") {
      console.log(`⏭️  Skipping ${login}...`);
      continue;
    }

    // Capture tokens
    const ct0 = await question("Enter new ct0: ");
    const auth_token = await question("Enter new auth_token: ");

    if (ct0 && auth_token) {
      account.CT0 = ct0.trim();
      account.AUTH_TOKEN = auth_token.trim();
      account.status = "active";

      await redis.hset(WAREHOUSE_KEY, login, JSON.stringify(account));
      await redis.rpush("conveyor4", login);
      console.log(`✅ Updated ${login} in warehouse and added to conveyor4.`);
      updatedAccounts.push(login);
    } else {
      console.log("⚠️ Tokens missing, skipping update.");
    }

    const next = await question("\nMove to next account? (y/q): ");
    if (next.toLowerCase() === "q") break;
  }

  rl.close();

  console.log("\n" + "=".repeat(60));
  console.log("📝 Session Summary:");
  console.log(`Total accounts updated: ${updatedAccounts.length}`);
  if (updatedAccounts.length > 0) {
    console.log("Updated Logins:", updatedAccounts.join(", "));
  }
  console.log("=".repeat(60));

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Fatal Error:", err);
  process.exit(1);
});
