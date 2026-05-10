import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { connect as tlsConnect } from "node:tls";
import { AccountPoolManager } from "@scrapest/core";
import { getEnv } from "@scrapest/config";
import { CHECKIN_URL, checkin } from "./checkin";
import { REGISTER_URL, register } from "./register";
import {
  subscriberFromRaw,
  type Subscriber,
  decryptAes128gcm,
  decryptAesgcm,
} from "./crypto";
import { loadFcmState, saveFcmState } from "./lib/state";
import type { FcmState } from "./lib/state";
import { handleNotification } from "./lib/notify";
import { Session } from "./mcs/stream";
import {
  SUBSCRIBE_URL,
  TWITTER_VAPID_PUBLIC_KEY,
  TwitterAuthError,
  subscribe,
} from "./twitter";
import "@scrapest/core/utils/console";

const vm = getEnv("VM_NAME");
const apm = new AccountPoolManager();

export async function runWithAccount() {
  const account = await apm.getAccount({ claimKey: vm });
  const cookies = { ct0: account.CT0, authToken: account.AUTH_TOKEN };

  let state = await loadFcmState(vm);

  if (!state) {
    console.info("no existing FCM credentials — running checkin + register", {
      vm,
    });

    const cred = await checkin(CHECKIN_URL);
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const ecdhPriv = ecdh.getPrivateKey();
    const ecdhPub = ecdh.getPublicKey();
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
        "en",
      );
      console.info("twitter login.json response", {
        status: 200,
        len: respText.length,
      });
    } catch (err) {
      if (err instanceof TwitterAuthError) {
        throw new Error(
          `twitter auth failed (HTTP ${err.status}): ${err.body}`,
        );
      }
      throw err;
    }

    state = {
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
    await saveFcmState(vm, state);
    console.info("bootstrap complete", { vm });
  } else if (!state.twitter_subscribed) {
    const fcmEndpoint = `https://fcm.googleapis.com/fcm/send/${state.fcm_token}`;
    await subscribe(
      SUBSCRIBE_URL,
      fcmEndpoint,
      state.ecdh_public_b64,
      state.auth_secret_b64,
      cookies,
      "en",
    );
    state.twitter_subscribed = true;
    await saveFcmState(vm, state);
    console.info("twitter subscription refreshed", { vm });
  }

  const subscriber = buildSubscriber(state);
  await receiveForever(state, subscriber);
}

async function receiveForever(
  state: FcmState,
  subscriber: Subscriber,
): Promise<void> {
  let backoffMs = 1000;
  for (;;) {
    try {
      await runOneSession(state, subscriber);
      console.info("MCS connection closed cleanly; reconnecting", { vm });
      backoffMs = 1000;
    } catch (err) {
      console.warn("MCS session error", { vm, error: String(err) });
      await Bun.sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 300_000);
    }
  }
}

async function runOneSession(
  state: FcmState,
  subscriber: Subscriber,
): Promise<void> {
  const androidId = BigInt(state.android_id);
  const securityToken = BigInt(state.security_token);
  const persistentIds = [...state.received_persistent_ids];

  const mtalkHost = process.env.MTALK_HOST ?? "mtalk.google.com:5228";
  console.info("opening MCS TLS connection", { vm, host: mtalkHost });
  const socket = await openTls(mtalkHost);
  console.info("TLS handshake done; sending LoginRequest", { vm });

  const session = await Session.login(
    socket,
    androidId,
    securityToken,
    persistentIds,
  );
  console.info("MCS logged in", { vm, host: mtalkHost });

  for (;;) {
    const msg = await session.nextData();
    if (msg === null) return;

    const encoding = msg.headers["content-encoding"];
    let plain: Uint8Array;
    try {
      if (!encoding || encoding === "aes128gcm") {
        plain = decryptAes128gcm(msg.rawData, subscriber);
      } else if (encoding === "aesgcm") {
        // plain = decryptLegacyAesgcm(msg.rawData, msg.headers, subscriber);
        const enc = msg.headers["encryption"] ?? "";
        const ck = msg.headers["crypto-key"] ?? "";
        const saltB64 = parseNamedParam(enc, "salt");
        const dhB64 = parseNamedParam(ck, "dh");
        if (!saltB64) throw new Error("aesgcm: missing salt");
        if (!dhB64) throw new Error("aesgcm: missing dh");
        const salt = Buffer.from(saltB64.replace(/=+$/, ""), "base64url");
        const asPub = Buffer.from(dhB64.replace(/=+$/, ""), "base64url");
        plain = decryptAesgcm(
          new Uint8Array(msg.rawData),
          new Uint8Array(salt),
          new Uint8Array(asPub),
          subscriber,
        );
      } else {
        console.warn("unsupported content-encoding; skipping", { encoding });
        continue;
      }
    } catch (err) {
      const dumpPath = `/tmp/ts-fcm.dms-${Date.now()}.bin`;
      try {
        const fs = await import("node:fs");
        fs.writeFileSync(dumpPath, Buffer.from(msg.rawData));
      } catch {}
      console.warn("decrypt failed; skipping", {
        vm,
        persistent_id: msg.persistentId,
        encoding: encoding ?? "(none)",
        error: String(err),
        dump: dumpPath,
      });
      continue;
    }

    await handleNotification(Buffer.from(plain));

    if (!state.received_persistent_ids.includes(msg.persistentId)) {
      if (state.received_persistent_ids.length >= 10) {
        state.received_persistent_ids.shift();
      }
      state.received_persistent_ids.push(msg.persistentId);
    }
    await saveFcmState(vm, state);
  }
}

function parseNamedParam(header: string, name: string): string | null {
  for (const seg of header.split(/[;,]/)) {
    const trimmed = seg.trim();
    if (trimmed.startsWith(name + "="))
      return trimmed.slice(name.length + 1).trim();
  }
  return null;
}

function buildSubscriber(state: FcmState): Subscriber {
  const priv = Buffer.from(state.ecdh_private_b64, "base64url");
  const pub = Buffer.from(state.ecdh_public_b64, "base64url");
  const auth = Buffer.from(state.auth_secret_b64, "base64url");
  return subscriberFromRaw(
    new Uint8Array(priv),
    new Uint8Array(pub),
    new Uint8Array(auth),
  );
}

async function openTls(hostPort: string): Promise<import("node:net").Socket> {
  const lastColon = hostPort.lastIndexOf(":");
  if (lastColon < 0)
    throw new Error(`mtalk_host must include port: ${hostPort}`);
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
