// RFC 8291 §5 worked-example test vectors. If our `decryptAes128gcm` agrees
// with these byte-for-byte, the HKDF wiring, info-string NULs, key-encoding,
// and AES-GCM/RFC-8188 padding-strip are all correct.

import { describe, expect, test } from "bun:test";
import { type Subscriber, decryptAes128gcm, subscriberFromRaw } from "../src/crypto.ts";

const RFC_UA_PRIVATE = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
const RFC_UA_PUBLIC =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const RFC_AUTH_SECRET = "BTBZMqHH6r4Tts7J_aSIgg";
const RFC_CIPHERTEXT =
  "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";
const RFC_PLAINTEXT = "When I grow up, I want to be a watermelon";

const b64urlDecode = (s: string): Uint8Array =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function rfcSubscriber(): Subscriber {
  return subscriberFromRaw(
    b64urlDecode(RFC_UA_PRIVATE),
    b64urlDecode(RFC_UA_PUBLIC),
    b64urlDecode(RFC_AUTH_SECRET),
  );
}

describe("crypto.decryptAes128gcm", () => {
  test("decrypts the RFC 8291 §5 worked example", () => {
    const sub = rfcSubscriber();
    const ct = b64urlDecode(RFC_CIPHERTEXT);
    const pt = decryptAes128gcm(ct, sub);
    expect(Buffer.from(pt).toString("utf-8")).toBe(RFC_PLAINTEXT);
  });

  test("rejects truncated header", () => {
    const sub = rfcSubscriber();
    expect(() => decryptAes128gcm(new TextEncoder().encode("too short"), sub)).toThrow();
  });

  test("rejects wrong auth secret (AES-GCM tag check)", () => {
    const priv = b64urlDecode(RFC_UA_PRIVATE);
    const pub = b64urlDecode(RFC_UA_PUBLIC);
    const sub = subscriberFromRaw(priv, pub, new Uint8Array(16));
    const ct = b64urlDecode(RFC_CIPHERTEXT);
    expect(() => decryptAes128gcm(ct, sub)).toThrow();
  });

  test("rejects unsupported keyid length (idlen != 65)", () => {
    const sub = rfcSubscriber();
    const bad = new Uint8Array(16 + 4 + 1 + 32);
    // salt(16) | rs(4) | idlen(1) - default is 0 - then 32 bytes of body
    new DataView(bad.buffer).setUint32(16, 4096, false);
    bad[20] = 0;
    expect(() => decryptAes128gcm(bad, sub)).toThrow();
  });
});
