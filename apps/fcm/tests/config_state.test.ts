import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig } from "../src/config.ts";
import {
  type AccountState,
  loadState,
  recordPersistentId,
  saveStateAtomic,
} from "../src/state.ts";

const sampleAccount = (): AccountState => ({
  android_id: "1",
  security_token: "2",
  fcm_token: "tok",
  ecdh_private_b64: "priv",
  ecdh_public_b64: "pub",
  auth_secret_b64: "auth",
  subtype_uuid: "uuid",
  twitter_subscribed: true,
  received_persistent_ids: [],
});

describe("config", () => {
  test("parses minimal config", () => {
    const cfg = parseConfig(`
[[account]]
label = "main"
auth_token = "abc"
ct0 = "def"
`);
    expect(cfg.accounts).toHaveLength(1);
    expect(cfg.accounts[0]!.label).toBe("main");
    expect(cfg.options.heartbeatIntervalSecs).toBe(60);
    expect(cfg.options.mtalkHost).toBe("mtalk.google.com:5228");
  });

  test("parses multi-account with options", () => {
    const cfg = parseConfig(`
[[account]]
label = "main"
auth_token = "a"
ct0 = "b"

[[account]]
label = "alt"
auth_token = "c"
ct0 = "d"

[options]
heartbeat_interval_secs = 120
mtalk_host = "mtalk4.google.com:5228"
locale = "ja"
`);
    expect(cfg.accounts).toHaveLength(2);
    expect(cfg.options.heartbeatIntervalSecs).toBe(120);
    expect(cfg.options.locale).toBe("ja");
  });

  test("rejects duplicate labels", () => {
    expect(() =>
      parseConfig(`
[[account]]
label = "x"
auth_token = "a"
ct0 = "b"

[[account]]
label = "x"
auth_token = "c"
ct0 = "d"
`),
    ).toThrow(/duplicate/);
  });

  test("rejects empty account list", () => {
    expect(() => parseConfig("")).toThrow(/no \[\[account\]\] entries/);
  });
});

describe("state", () => {
  test("round-trips to disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "fcm-state-"));
    const path = join(dir, "state.json");
    saveStateAtomic({ accounts: { main: sampleAccount() } }, path);
    const reloaded = loadState(path);
    expect(Object.keys(reloaded.accounts)).toHaveLength(1);
    expect(reloaded.accounts.main!.fcm_token).toBe("tok");
  });

  test("missing file returns default empty state", () => {
    const dir = mkdtempSync(join(tmpdir(), "fcm-state-"));
    const path = join(dir, "never_existed.json");
    expect(loadState(path)).toEqual({ accounts: {} });
  });

  test("ring buffer caps at 10", () => {
    const a = sampleAccount();
    for (let i = 0; i < 15; i++) recordPersistentId(a, `p${i}`);
    expect(a.received_persistent_ids).toHaveLength(10);
    expect(a.received_persistent_ids[0]).toBe("p5");
    expect(a.received_persistent_ids[9]).toBe("p14");
  });

  test("ring buffer dedups repeated id", () => {
    const a = sampleAccount();
    recordPersistentId(a, "x");
    recordPersistentId(a, "x");
    recordPersistentId(a, "y");
    expect(a.received_persistent_ids).toEqual(["x", "y"]);
  });

  test("atomic write leaves no .tmp file", () => {
    const dir = mkdtempSync(join(tmpdir(), "fcm-state-"));
    const path = join(dir, "state.json");
    saveStateAtomic({ accounts: {} }, path);
    expect(existsSync(path)).toBe(true);
    const tmp = path.replace(/\.json$/, ".json.tmp");
    expect(existsSync(tmp)).toBe(false);
  });

  test("state file is mode 0600", () => {
    const dir = mkdtempSync(join(tmpdir(), "fcm-state-"));
    const path = join(dir, "state.json");
    saveStateAtomic({ accounts: {} }, path);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
