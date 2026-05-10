// `test-push` subcommand: send a properly-signed Web Push (VAPID + RFC 8030
// `aesgcm`) to our own FCM endpoint. If the running receiver decrypts it,
// the FCM/MCS pipeline is healthy independent of Twitter.
//
// We use the legacy `aesgcm` content encoding (matches what Twitter sends),
// not RFC 8291 `aes128gcm`, so this also exercises our aesgcm decrypt path.

import {
  KeyObject,
  createCipheriv,
  createECDH,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
} from "node:crypto";

const TextEnc = new TextEncoder();
const AESGCM_AUTH_INFO = TextEnc.encode("Content-Encoding: auth\0");
const AESGCM_CEK_INFO_PREFIX = TextEnc.encode("Content-Encoding: aesgcm\0");
const AESGCM_NONCE_INFO_PREFIX = TextEnc.encode("Content-Encoding: nonce\0");

export async function sendTestPush(opts: {
  endpoint: string;
  uaPublicB64: string; // recipient's p256dh
  authSecretB64: string; // recipient's auth secret
  message: string;
  contact: string; // mailto:... for VAPID `sub`
}): Promise<{ status: number; body: string }> {
  const uaPublic = b64urlDecode(opts.uaPublicB64);
  const authSecret = b64urlDecode(opts.authSecretB64);
  if (uaPublic.length !== 65) throw new Error("uaPublic must be 65 bytes");
  if (authSecret.length !== 16) throw new Error("authSecret must be 16 bytes");

  // 1. VAPID keypair (ephemeral) for signing the JWT.
  const { privateKey: vapidPriv, publicKey: vapidPub } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const vapidPubSec1 = ecKeyToSec1Uncompressed(vapidPub);

  // VAPID JWT.
  const aud = originOf(opts.endpoint);
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const header = b64urlEncode(TextEnc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(
    TextEnc.encode(JSON.stringify({ aud, exp, sub: opts.contact })),
  );
  const signingInput = `${header}.${claims}`;
  const sig = sign("sha256", Buffer.from(signingInput), {
    key: vapidPriv,
    dsaEncoding: "ieee-p1363",
  });
  const jwt = `${signingInput}.${b64urlEncode(new Uint8Array(sig))}`;

  // 2. Ephemeral application-server (AS) ECDH keypair.
  const asEcdh = createECDH("prime256v1");
  asEcdh.generateKeys();
  const asPub = asEcdh.getPublicKey();

  // 3. ECDH shared secret with recipient.
  const sharedSecret = asEcdh.computeSecret(Buffer.from(uaPublic));

  // 4. RFC 8030: derive 32-byte IKM.
  const ikm = new Uint8Array(
    hkdfSync("sha256", sharedSecret, Buffer.from(authSecret), Buffer.from(AESGCM_AUTH_INFO), 32),
  );

  // 5. Per-message salt + context-bound CEK + nonce. The "P-256\0" prefix is
  // exactly 6 bytes; over-allocating by 1 leaves a trailing zero that breaks
  // HKDF parity with any RFC 8030 reference implementation.
  const salt = randomBytes(16);
  const PREFIX_LEN = 6;
  const context = new Uint8Array(PREFIX_LEN + 2 + 65 + 2 + 65);
  context.set(TextEnc.encode("P-256\0"), 0);
  new DataView(context.buffer).setUint16(PREFIX_LEN, 65, false);
  context.set(uaPublic, PREFIX_LEN + 2);
  new DataView(context.buffer).setUint16(PREFIX_LEN + 2 + 65, 65, false);
  context.set(asPub, PREFIX_LEN + 2 + 65 + 2);

  const cek = new Uint8Array(
    hkdfSync(
      "sha256",
      ikm,
      salt,
      Buffer.from(concat(AESGCM_CEK_INFO_PREFIX, context)),
      16,
    ),
  );
  const nonce = new Uint8Array(
    hkdfSync(
      "sha256",
      ikm,
      salt,
      Buffer.from(concat(AESGCM_NONCE_INFO_PREFIX, context)),
      12,
    ),
  );

  // 6. Encrypt: u16-be padding length (0) || padding (none) || message.
  const message = TextEnc.encode(opts.message);
  const plaintext = new Uint8Array(2 + message.length);
  plaintext[0] = 0;
  plaintext[1] = 0;
  plaintext.set(message, 2);
  const cipher = createCipheriv("aes-128-gcm", Buffer.from(cek), Buffer.from(nonce));
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  const body = Buffer.concat([ct, tag]);

  // 7. POST to FCM with VAPID + aesgcm headers.
  const auth = `vapid t=${jwt}, k=${b64urlEncode(vapidPubSec1)}`;
  const cryptoKey = `dh=${b64urlEncode(asPub)}`;
  const encryption = `salt=${b64urlEncode(new Uint8Array(salt))}`;

  const resp = await fetch(opts.endpoint, {
    method: "POST",
    headers: {
      authorization: auth,
      "content-encoding": "aesgcm",
      "content-type": "application/octet-stream",
      "crypto-key": cryptoKey,
      encryption,
      ttl: "60",
    },
    body,
  });
  return { status: resp.status, body: await resp.text() };
}

// ----- helpers -------------------------------------------------------------

function b64urlEncode(b: Uint8Array): string {
  return Buffer.from(b).toString("base64url");
}

function b64urlDecode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s.replace(/=+$/, ""), "base64url"));
}

function originOf(url: string): string {
  const u = new URL(url);
  return u.port ? `${u.protocol}//${u.hostname}:${u.port}` : `${u.protocol}//${u.hostname}`;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Extract the 65-byte uncompressed SEC1 P-256 point from a node:crypto
 *  KeyObject (which only exports DER/JWK/PEM). */
function ecKeyToSec1Uncompressed(key: KeyObject): Uint8Array {
  const jwk = key.export({ format: "jwk" }) as { x?: string; y?: string };
  if (!jwk.x || !jwk.y) throw new Error("EC public key missing x/y");
  const x = b64urlDecode(jwk.x);
  const y = b64urlDecode(jwk.y);
  const out = new Uint8Array(1 + x.length + y.length);
  out[0] = 0x04;
  out.set(x, 1);
  out.set(y, 1 + x.length);
  return out;
}

// Suppress unused import warnings (createPrivateKey/createPublicKey kept
// for future use; no immediate consumer in this module).
void createPrivateKey;
void createPublicKey;
