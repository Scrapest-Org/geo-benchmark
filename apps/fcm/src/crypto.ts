// Web Push (RFC 8291) `aes128gcm` and (RFC 8030 draft-04) `aesgcm` decryption.
//
// 1:1 port of the Rust `crypto` module — same constants, same HKDF info
// strings (with their trailing NUL bytes), same plaintext-padding rules.

import { createDecipheriv, createECDH, hkdfSync } from "node:crypto";

const SALT_LEN = 16;
const RS_LEN = 4;
const IDLEN_LEN = 1;
const HEADER_FIXED_LEN = SALT_LEN + RS_LEN + IDLEN_LEN;
const KEYID_LEN = 65;
const SEC1_UNCOMPRESSED_LEN = 65;
const AUTH_SECRET_LEN = 16;
const PRIVATE_KEY_LEN = 32;

const KEY_INFO_PREFIX = new TextEncoder().encode("WebPush: info\0");
const CEK_INFO = new TextEncoder().encode("Content-Encoding: aes128gcm\0");
const NONCE_INFO = new TextEncoder().encode("Content-Encoding: nonce\0");

const AESGCM_AUTH_INFO = new TextEncoder().encode("Content-Encoding: auth\0");
const AESGCM_CEK_INFO_PREFIX = new TextEncoder().encode(
  "Content-Encoding: aesgcm\0",
);
const AESGCM_NONCE_INFO_PREFIX = new TextEncoder().encode(
  "Content-Encoding: nonce\0",
);

export interface Subscriber {
  readonly uaPrivate: Uint8Array; // 32 bytes
  readonly uaPublic: Uint8Array; // 65 bytes uncompressed SEC1
  readonly authSecret: Uint8Array; // 16 bytes
}

export function subscriberFromRaw(
  uaPrivate: Uint8Array,
  uaPublic: Uint8Array,
  authSecret: Uint8Array,
): Subscriber {
  if (uaPrivate.length !== PRIVATE_KEY_LEN) {
    throw new Error(
      `uaPrivate must be ${PRIVATE_KEY_LEN} bytes, got ${uaPrivate.length}`,
    );
  }
  if (uaPublic.length !== SEC1_UNCOMPRESSED_LEN || uaPublic[0] !== 0x04) {
    throw new Error(
      "uaPublic must be 65-byte uncompressed SEC1 (leading 0x04)",
    );
  }
  if (authSecret.length !== AUTH_SECRET_LEN) {
    throw new Error(
      `authSecret must be ${AUTH_SECRET_LEN} bytes, got ${authSecret.length}`,
    );
  }
  return { uaPrivate, uaPublic, authSecret };
}

/** RFC 8291 `aes128gcm`. The salt + sender public key + ciphertext are all in
 *  one self-describing blob in `raw_data`. */
export function decryptAes128gcm(raw: Uint8Array, sub: Subscriber): Uint8Array {
  if (raw.length < HEADER_FIXED_LEN) {
    throw new Error(`payload too short (${raw.length} < ${HEADER_FIXED_LEN})`);
  }
  const salt = raw.slice(0, SALT_LEN);
  // rs is read for completeness but not used since web-push is single-record.
  const _rs = new DataView(
    raw.buffer,
    raw.byteOffset + SALT_LEN,
    RS_LEN,
  ).getUint32(0, false);
  const idlen = raw[SALT_LEN + RS_LEN]!;
  if (idlen !== KEYID_LEN) {
    throw new Error(
      `unsupported keyid length: ${idlen} (expected ${KEYID_LEN})`,
    );
  }
  const keyidStart = HEADER_FIXED_LEN;
  const ciphertextStart = keyidStart + KEYID_LEN;
  if (raw.length < ciphertextStart + 16) {
    throw new Error("payload too short for keyid + AES-GCM tag");
  }
  const asPublic = raw.slice(keyidStart, ciphertextStart);
  const ciphertext = raw.slice(ciphertextStart);

  const sharedSecret = ecdh(sub.uaPrivate, asPublic);

  // Pass 1: HKDF(salt = auth_secret, ikm = ECDH) with key_info binding both pubs.
  const keyInfo = concat(KEY_INFO_PREFIX, sub.uaPublic, asPublic);
  const ikm = hkdf(sub.authSecret, sharedSecret, keyInfo, 32);

  // Pass 2: HKDF(salt = per-message salt, ikm) → CEK + nonce.
  const cek = hkdf(salt, ikm, CEK_INFO, 16);
  const baseNonce = hkdf(salt, ikm, NONCE_INFO, 12);

  // Web push delivers a single record (seq = 0, so nonce == base_nonce).
  const plaintextPadded = aesGcmDecrypt(cek, baseNonce, ciphertext);
  return stripRfc8188Padding(plaintextPadded);
}

/** RFC 8030 draft-04 `aesgcm`. Salt and AS public key live in HTTP-style
 *  headers (Encryption / Crypto-Key) rather than in the ciphertext. */
export function decryptAesgcm(
  ciphertext: Uint8Array,
  salt: Uint8Array,
  asPublic: Uint8Array,
  sub: Subscriber,
): Uint8Array {
  if (salt.length !== 16)
    throw new Error(`salt must be 16 bytes, got ${salt.length}`);
  if (asPublic.length !== SEC1_UNCOMPRESSED_LEN || asPublic[0] !== 0x04) {
    throw new Error("asPublic must be 65-byte uncompressed SEC1");
  }

  const sharedSecret = ecdh(sub.uaPrivate, asPublic);

  // Pass 1: bind ECDH + auth_secret with the legacy "auth" info string.
  const ikm = hkdf(sub.authSecret, sharedSecret, AESGCM_AUTH_INFO, 32);

  // Pass 2: build the "P-256\0" || u16_be(65) || ua_pub || u16_be(65) || as_pub
  // context that gets suffixed onto every info string. "P-256\0" is exactly 6
  // bytes — using 7 here leaves a stray zero byte that breaks HKDF parity
  // with the Rust port (and any other web-push receiver).
  const PREFIX_LEN = 6;
  const context = new Uint8Array(
    PREFIX_LEN + 2 + SEC1_UNCOMPRESSED_LEN + 2 + SEC1_UNCOMPRESSED_LEN,
  );
  context.set(new TextEncoder().encode("P-256\0"), 0);
  new DataView(context.buffer).setUint16(
    PREFIX_LEN,
    SEC1_UNCOMPRESSED_LEN,
    false,
  );
  context.set(sub.uaPublic, PREFIX_LEN + 2);
  new DataView(context.buffer).setUint16(
    PREFIX_LEN + 2 + SEC1_UNCOMPRESSED_LEN,
    SEC1_UNCOMPRESSED_LEN,
    false,
  );
  context.set(asPublic, PREFIX_LEN + 2 + SEC1_UNCOMPRESSED_LEN + 2);

  const cek = hkdf(salt, ikm, concat(AESGCM_CEK_INFO_PREFIX, context), 16);
  const nonce = hkdf(salt, ikm, concat(AESGCM_NONCE_INFO_PREFIX, context), 12);

  const plaintextPadded = aesGcmDecrypt(cek, nonce, ciphertext);

  // aesgcm framing: u16-be padding length, then padding, then content.
  if (plaintextPadded.length < 2) throw new Error("aesgcm plaintext too short");
  const padLen = (plaintextPadded[0]! << 8) | plaintextPadded[1]!;
  if (2 + padLen > plaintextPadded.length)
    throw new Error("aesgcm padding length out of range");
  return plaintextPadded.slice(2 + padLen);
}

function parseNamedParam(header: string, name: string): string | null {
  for (const seg of header.split(/[;,]/)) {
    const trimmed = seg.trim();
    if (trimmed.startsWith(name + "="))
      return trimmed.slice(name.length + 1).trim();
  }
  return null;
}

export function decryptLegacyAesgcm(
  msgRaw: ArrayBuffer,
  msgHeaders: Record<string, string>,
  sub: Subscriber,
): Uint8Array {
  const encryption = msgHeaders["encryption"] ?? "";
  const cryptoKey = msgHeaders["crypto-key"] ?? "";

  const salt = Buffer.from(parseNamedParam(encryption, "salt")!, "base64url");
  const dh = Buffer.from(parseNamedParam(cryptoKey, "dh")!, "base64url");

  const sharedSecret = ecdh(sub.uaPrivate, dh);
  const ikm = hkdf(sub.authSecret, sharedSecret, AESGCM_AUTH_INFO, 32);

  const cek = hkdf(salt, ikm, AESGCM_CEK_INFO_PREFIX, 16);
  const nonce = hkdf(salt, ikm, AESGCM_NONCE_INFO_PREFIX, 12);

  const plaintextPadded = aesGcmDecrypt(cek, nonce, new Uint8Array(msgRaw));

  const padLen = (plaintextPadded[0]! << 8) | plaintextPadded[1]!;
  const content = plaintextPadded.slice(2 + padLen);

  return content;
}

// ----- helpers -------------------------------------------------------------

function ecdh(privateKey: Uint8Array, otherPublic: Uint8Array): Uint8Array {
  const k = createECDH("prime256v1");
  k.setPrivateKey(Buffer.from(privateKey));
  return new Uint8Array(k.computeSecret(Buffer.from(otherPublic)));
}

function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  len: number,
): Uint8Array {
  // Node's hkdfSync returns an ArrayBuffer.
  const out = hkdfSync(
    "sha256",
    Buffer.from(ikm),
    Buffer.from(salt),
    Buffer.from(info),
    len,
  );
  return new Uint8Array(out);
}

function aesGcmDecrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  body: Uint8Array,
): Uint8Array {
  if (body.length < 16) throw new Error("ciphertext too short for AES-GCM tag");
  const tagOff = body.length - 16;
  const ct = body.slice(0, tagOff);
  const tag = body.slice(tagOff);
  const decipher = createDecipheriv(
    "aes-128-gcm",
    Buffer.from(key),
    Buffer.from(nonce),
  );
  decipher.setAuthTag(Buffer.from(tag));
  const part1 = decipher.update(Buffer.from(ct));
  const part2 = decipher.final();
  return new Uint8Array(Buffer.concat([part1, part2]));
}

/** Strip RFC 8188 record padding: data || 0x02 || 0x00*  for a single record. */
function stripRfc8188Padding(plain: Uint8Array): Uint8Array {
  let lastNonzero = -1;
  for (let i = plain.length - 1; i >= 0; i--) {
    if (plain[i] !== 0) {
      lastNonzero = i;
      break;
    }
  }
  if (lastNonzero < 0) throw new Error("missing RFC 8188 padding delimiter");
  if (plain[lastNonzero] !== 0x02)
    throw new Error("unexpected RFC 8188 delimiter");
  return plain.slice(0, lastNonzero);
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
