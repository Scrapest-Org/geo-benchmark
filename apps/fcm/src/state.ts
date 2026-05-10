// Persisted FCM credentials, ECDH keys, auth secret, and per-account ring
// buffer of recent persistent_ids. JSON shape and field names are byte-
// compatible with the Rust port — both implementations can read/write the
// same `state.json`.

import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";

export const RECEIVED_ID_RING_CAP = 10;

export interface AccountState {
  android_id: string;
  security_token: string;
  fcm_token: string;
  ecdh_private_b64: string;
  ecdh_public_b64: string;
  auth_secret_b64: string;
  subtype_uuid: string;
  twitter_subscribed: boolean;
  received_persistent_ids: string[];
}

export interface State {
  accounts: Record<string, AccountState>;
}

export function loadState(path: string): State {
  if (!existsSync(path)) return { accounts: {} };
  const text = readFileSync(path, "utf8");
  return JSON.parse(text) as State;
}

/** Atomic write: write to `<path>.tmp`, fsync, rename into place. The mode
 *  bit (`0o600`) and the `.tmp+rename` dance match the Rust port. */
export function saveStateAtomic(state: State, path: string): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true });
  const tmp = path.endsWith(".json") ? path.slice(0, -5) + ".json.tmp" : path + ".tmp";
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeSync(fd, JSON.stringify(state, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

export function recordPersistentId(account: AccountState, id: string): void {
  if (account.received_persistent_ids.includes(id)) return;
  if (account.received_persistent_ids.length === RECEIVED_ID_RING_CAP) {
    account.received_persistent_ids.shift();
  }
  account.received_persistent_ids.push(id);
}
