// Per-account orchestrator. One async runner per account holds the FCM
// credentials in memory, opens a TLS connection to MCS, processes inbound
// data messages, and reconnects with exponential backoff on errors.
//
// 1:1 port of `src/account.rs`.

import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { connect as tlsConnect } from "node:tls";
import { CHECKIN_URL, checkin } from "./checkin.ts";
import type { Options } from "./config.ts";
import { type Subscriber, decryptAes128gcm, decryptAesgcm, subscriberFromRaw } from "./crypto.ts";
import { emit } from "./emit.ts";
import { Session } from "./mcs/stream.ts";
import { REGISTER_URL, register } from "./register.ts";
import { type AccountState, type State, recordPersistentId, saveStateAtomic } from "./state.ts";
import {
  type Cookies,
  SUBSCRIBE_URL,
  TWITTER_VAPID_PUBLIC_KEY,
  TwitterAuthError,
  subscribe,
} from "./twitter.ts";

export interface SharedState {
  state: State;
  statePath: string;
  options: Options;
  /** Serializes concurrent saves across account tasks. */
  saveLock: { busy: boolean; queue: Array<() => void> };
}

export function newSharedState(state: State, statePath: string, options: Options): SharedState {
  return { state, statePath, options, saveLock: { busy: false, queue: [] } };
}

async function withSaveLock(shared: SharedState, fn: () => Promise<void>): Promise<void> {
  if (shared.saveLock.busy) {
    await new Promise<void>((resolve) => shared.saveLock.queue.push(resolve));
  }
  shared.saveLock.busy = true;
  try {
    await fn();
  } finally {
    shared.saveLock.busy = false;
    const next = shared.saveLock.queue.shift();
    if (next) next();
  }
}

async function saveShared(shared: SharedState): Promise<void> {
  await withSaveLock(shared, async () => {
    saveStateAtomic(shared.state, shared.statePath);
  });
}

const log = {
  info(msg: string, fields?: Record<string, unknown>) {
    process.stderr.write(`${ts()} INFO  ${msg}${fmtFields(fields)}\n`);
  },
  warn(msg: string, fields?: Record<string, unknown>) {
    process.stderr.write(`${ts()} WARN  ${msg}${fmtFields(fields)}\n`);
  },
  error(msg: string, fields?: Record<string, unknown>) {
    process.stderr.write(`${ts()} ERROR ${msg}${fmtFields(fields)}\n`);
  },
  debug(msg: string, fields?: Record<string, unknown>) {
    if (process.env.RUST_LOG?.includes("debug") || process.env.DEBUG) {
      process.stderr.write(`${ts()} DEBUG ${msg}${fmtFields(fields)}\n`);
    }
  },
};

function ts(): string {
  return new Date().toISOString();
}

function fmtFields(fields?: Record<string, unknown>): string {
  if (!fields) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(`${k}=${JSON.stringify(v)}`);
  return parts.length > 0 ? " " + parts.join(" ") : "";
}

export async function runAccount(
  label: string,
  cookies: Cookies,
  shared: SharedState,
  forceResubscribe: boolean,
): Promise<void> {
  await bootstrapIfNeeded(label, cookies, shared, forceResubscribe);
  await receiveForever(label, shared);
}

async function bootstrapIfNeeded(
  label: string,
  cookies: Cookies,
  shared: SharedState,
  forceResubscribe: boolean,
): Promise<void> {
  const existing = shared.state.accounts[label];
  if (!existing) {
    log.info("no existing FCM credentials — running checkin + register", { label });

    const cred = await checkin(CHECKIN_URL);
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const ecdhPriv = ecdh.getPrivateKey();
    const ecdhPub = ecdh.getPublicKey(); // 65-byte uncompressed SEC1 by default
    const authSecret = randomBytes(16);
    const subtype = `wp:${randomUUID()}`;

    const fcmToken = await register(
      REGISTER_URL,
      cred.androidId,
      cred.securityToken,
      subtype,
      TWITTER_VAPID_PUBLIC_KEY,
    );

    const fcmEndpoint = `https://fcm.googleapis.com/fcm/send/${fcmToken}`;
    const ecdhPubB64 = ecdhPub.toString("base64url");
    const authSecretB64 = authSecret.toString("base64url");

    try {
      const respText = await subscribe(
        SUBSCRIBE_URL,
        fcmEndpoint,
        ecdhPubB64,
        authSecretB64,
        cookies,
        shared.options.locale,
      );
      log.info("twitter login.json response", { status: 200, len: respText.length });
    } catch (err) {
      if (err instanceof TwitterAuthError) {
        throw new Error(`twitter auth failed (HTTP ${err.status}): ${err.body}`);
      }
      throw err;
    }

    shared.state.accounts[label] = {
      android_id: cred.androidId.toString(),
      security_token: cred.securityToken.toString(),
      fcm_token: fcmToken,
      ecdh_private_b64: ecdhPriv.toString("base64url"),
      ecdh_public_b64: ecdhPubB64,
      auth_secret_b64: authSecretB64,
      subtype_uuid: subtype,
      twitter_subscribed: true,
      received_persistent_ids: [],
    };
    await saveShared(shared);
    log.info("bootstrap complete", { label });
  } else if (forceResubscribe) {
    const fcmEndpoint = `https://fcm.googleapis.com/fcm/send/${existing.fcm_token}`;
    await subscribe(
      SUBSCRIBE_URL,
      fcmEndpoint,
      existing.ecdh_public_b64,
      existing.auth_secret_b64,
      cookies,
      shared.options.locale,
    );
    log.info("twitter subscription refreshed", { label });
  }
}

async function receiveForever(label: string, shared: SharedState): Promise<void> {
  let backoffMs = 1000;
  for (;;) {
    try {
      await runOneSession(label, shared);
      log.info("MCS connection closed cleanly; reconnecting", { label });
      backoffMs = 1000;
    } catch (err) {
      log.warn("MCS session error", { label, error: String(err) });
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 300_000);
    }
  }
}

async function runOneSession(label: string, shared: SharedState): Promise<void> {
  const snap = shared.state.accounts[label];
  if (!snap) throw new Error(`no state for account ${label}`);

  const androidId = BigInt(snap.android_id);
  const securityToken = BigInt(snap.security_token);
  const persistentIds = [...snap.received_persistent_ids];

  log.info("opening MCS TLS connection", { label, host: shared.options.mtalkHost });
  const socket = await openTls(shared.options.mtalkHost);
  log.info("TLS handshake done; sending LoginRequest", { label });

  const session = await Session.login(socket, androidId, securityToken, persistentIds, log);
  log.info("MCS connected and logged in", { label, host: shared.options.mtalkHost });

  const subscriber = buildSubscriber(snap);

  for (;;) {
    const msg = await session.nextData();
    if (msg === null) return;

    const encoding = msg.headers["content-encoding"];
    let plain: Uint8Array;
    try {
      if (!encoding || encoding === "aes128gcm") {
        plain = decryptAes128gcm(msg.rawData, subscriber);
      } else if (encoding === "aesgcm") {
        plain = decryptLegacyAesgcm(msg.rawData, msg.headers, subscriber);
      } else {
        log.warn("unsupported content-encoding; skipping", { encoding });
        continue;
      }
    } catch (err) {
      const dumpPath = `/tmp/ts-fcm.dms-${Date.now()}.bin`;
      try {
        const fs = await import("node:fs");
        fs.writeFileSync(dumpPath, Buffer.from(msg.rawData));
      } catch {}
      log.warn("decrypt failed; skipping", {
        label,
        persistent_id: msg.persistentId,
        encoding: encoding ?? "(none)",
        encryption_header: msg.headers["encryption"] ?? "(none)",
        crypto_key_header: msg.headers["crypto-key"]?.slice(0, 60) ?? "(none)",
        raw_data_len: msg.rawData.length,
        dump: dumpPath,
        error: String(err),
      });
      continue;
    }

    try {
      emit(label, msg.persistentId, plain);
    } catch (err) {
      log.warn("failed to emit notification", { label, error: String(err) });
    }

    const live = shared.state.accounts[label];
    if (live) recordPersistentId(live, msg.persistentId);
    await saveShared(shared);
  }
}

function decryptLegacyAesgcm(
  rawData: Uint8Array,
  headers: Record<string, string>,
  sub: Subscriber,
): Uint8Array {
  const enc = headers["encryption"] ?? "";
  const ck = headers["crypto-key"] ?? "";
  const saltB64 = parseNamedParam(enc, "salt");
  const dhB64 = parseNamedParam(ck, "dh");
  if (!saltB64) throw new Error("aesgcm: missing salt in encryption header");
  if (!dhB64) throw new Error("aesgcm: missing dh in crypto-key header");
  const salt = Buffer.from(saltB64.replace(/=+$/, ""), "base64url");
  const asPub = Buffer.from(dhB64.replace(/=+$/, ""), "base64url");
  return decryptAesgcm(new Uint8Array(rawData), new Uint8Array(salt), new Uint8Array(asPub), sub);
}

/** Pluck `<name>=<value>` from a `;`-or-`,`-separated header. Tolerates the
 *  empty leading segment Twitter sends (`"; salt=…"`). */
function parseNamedParam(header: string, name: string): string | null {
  for (const seg of header.split(/[;,]/)) {
    const trimmed = seg.trim();
    if (trimmed.startsWith(name + "=")) return trimmed.slice(name.length + 1).trim();
  }
  return null;
}

function buildSubscriber(snap: AccountState): Subscriber {
  const priv = Buffer.from(snap.ecdh_private_b64, "base64url");
  const pub = Buffer.from(snap.ecdh_public_b64, "base64url");
  const auth = Buffer.from(snap.auth_secret_b64, "base64url");
  return subscriberFromRaw(new Uint8Array(priv), new Uint8Array(pub), new Uint8Array(auth));
}

async function openTls(hostPort: string): Promise<import("node:net").Socket> {
  const lastColon = hostPort.lastIndexOf(":");
  if (lastColon < 0) throw new Error(`mtalk_host must include port: ${hostPort}`);
  const host = hostPort.slice(0, lastColon);
  const port = Number.parseInt(hostPort.slice(lastColon + 1), 10);

  return new Promise((resolve, reject) => {
    const sock = tlsConnect({ host, port, servername: host });
    const onError = (err: Error) => {
      sock.off("secureConnect", onConnect);
      reject(err);
    };
    const onConnect = () => {
      sock.off("error", onError);
      sock.setNoDelay(true);
      resolve(sock);
    };
    sock.once("secureConnect", onConnect);
    sock.once("error", onError);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
