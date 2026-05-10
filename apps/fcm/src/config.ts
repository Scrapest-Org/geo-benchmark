// On-disk configuration. The user maintains a TOML file describing each
// account; we load it once at startup and never reread.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";

export interface AccountConfig {
  label: string;
  authToken: string;
  ct0: string;
}

export interface Options {
  statePath: string;
  heartbeatIntervalSecs: number;
  mtalkHost: string;
  locale: string;
}

export interface Config {
  accounts: AccountConfig[];
  options: Options;
}

export function configDir(): string {
  // Match `dirs::config_dir()` per platform.
  const home = homedir();
  switch (process.platform) {
    case "darwin":
      return join(home, "Library", "Application Support", "chrome-fcm");
    case "win32":
      return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "chrome-fcm");
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "chrome-fcm");
  }
}

export function defaultConfigPath(): string {
  return join(configDir(), "accounts.toml");
}

export function defaultStatePath(): string {
  return join(configDir(), "state.json");
}

interface RawConfig {
  account?: Array<{ label?: unknown; auth_token?: unknown; ct0?: unknown }>;
  options?: {
    state_path?: unknown;
    heartbeat_interval_secs?: unknown;
    mtalk_host?: unknown;
    locale?: unknown;
  };
}

export function parseConfig(text: string): Config {
  const raw = parseToml(text) as RawConfig;
  const accounts: AccountConfig[] = (raw.account ?? []).map((a, idx) => {
    if (typeof a.label !== "string" || a.label.length === 0) {
      throw new Error(`account[${idx}].label is required`);
    }
    if (typeof a.auth_token !== "string" || a.auth_token.length === 0) {
      throw new Error(`account[${a.label}].auth_token is required`);
    }
    if (typeof a.ct0 !== "string" || a.ct0.length === 0) {
      throw new Error(`account[${a.label}].ct0 is required`);
    }
    return { label: a.label, authToken: a.auth_token, ct0: a.ct0 };
  });

  const opt = raw.options ?? {};
  const options: Options = {
    statePath: typeof opt.state_path === "string" ? opt.state_path : defaultStatePath(),
    heartbeatIntervalSecs:
      typeof opt.heartbeat_interval_secs === "number" ? opt.heartbeat_interval_secs : 60,
    mtalkHost: typeof opt.mtalk_host === "string" ? opt.mtalk_host : "mtalk.google.com:5228",
    locale: typeof opt.locale === "string" ? opt.locale : "en",
  };

  if (accounts.length === 0) throw new Error("config has no [[account]] entries");

  const seen = new Set<string>();
  for (const a of accounts) {
    if (seen.has(a.label)) throw new Error(`duplicate account label: ${a.label}`);
    seen.add(a.label);
  }

  return { accounts, options };
}

export function loadConfig(path: string): Config {
  const text = readFileSync(path, "utf8");
  return parseConfig(text);
}
