#!/usr/bin/env bun
// CLI entrypoint: validate / run / test-push.
// 1:1 port of `src/main.rs` argument surface.

import { Command } from "commander";
import { defaultConfigPath, loadConfig } from "./config.ts";
import { loadState } from "./state.ts";
import { sendTestPush } from "./test-push.ts";

const program = new Command();
program
  .name("chrome-fcm-ts")
  .description("Chrome FCM web-push receiver for Twitter (TypeScript port)");

program
  .command("validate")
  .option("--config <path>", "path to accounts.toml")
  .action((opts: { config?: string }) => {
    const path = opts.config ?? defaultConfigPath();
    const cfg = loadConfig(path);
    loadState(cfg.options.statePath);
    process.stdout.write(
      `config OK: ${cfg.accounts.length} accounts, state at ${cfg.options.statePath}\n`,
    );
  });

program
  .command("test-push")
  .requiredOption("--account <label>", "account label from config")
  .option("--config <path>", "path to accounts.toml")
  .option("--message <text>", "payload text", "hello from chrome-fcm-ts")
  .option("--contact <mailto>", "VAPID sub", "mailto:test@example.com")
  .action(async (opts: { account: string; config?: string; message: string; contact: string }) => {
    const path = opts.config ?? defaultConfigPath();
    const cfg = loadConfig(path);
    const state = loadState(cfg.options.statePath);
    const acct = state.accounts[opts.account];
    if (!acct) throw new Error(`no state for account ${opts.account}`);
    const endpoint = `https://fcm.googleapis.com/fcm/send/${acct.fcm_token}`;
    const result = await sendTestPush({
      endpoint,
      uaPublicB64: acct.ecdh_public_b64,
      authSecretB64: acct.auth_secret_b64,
      message: opts.message,
      contact: opts.contact,
    });
    if (result.status >= 200 && result.status < 300) {
      process.stdout.write(`OK (${result.status}): ${result.body.trim()}\n`);
    } else {
      process.stderr.write(`push rejected: HTTP ${result.status}: ${result.body}\n`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`error: ${String(err)}\n`);
  process.exit(1);
});
